"""Execute real auth functions without importing main's database mutations."""
import ast
import base64
import hashlib
import hmac
import json
import secrets
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote, urlparse, parse_qs
import unittest
from unittest.mock import Mock
import argon2
from fastapi import HTTPException, FastAPI, Depends, Form, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Literal
import models
from auth_limits import AttemptLimiter


def auth_namespace():
    names = {'hash_password', 'verify_password', 'generate_mfa_secret', '_mfa_secret_bytes',
             'generate_totp', 'verify_totp', 'mfa_otpauth_uri', 'create_mfa_trusted_device_token',
             'verify_mfa_trusted_device_token', 'b64url', 'b64url_decode', 'create_access_token',
             'read_access_token', 'current_user', 'setup_mfa', 'enable_mfa', 'disable_mfa', 'login',
             'logout_access_token', 'is_admin_role', 'admin_user'}
    handlers = {'current_user', 'setup_mfa', 'enable_mfa', 'disable_mfa', 'login', 'logout_access_token', 'admin_user'}
    tree = ast.parse((Path(__file__).resolve().parents[2]/'backend/main.py').read_text(encoding='utf-8'))
    functions = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            node.decorator_list = []
            node.returns = None
            for arg in node.args.args:
                arg.annotation = None
            if node.name == 'current_user':
                node.args.defaults = node.args.defaults[-1:]
            elif node.name in handlers:
                node.args.defaults = []
            functions.append(node)
    namespace = dict(globals(), SECRET_KEY='synthetic-auth-test-key-not-for-production',
                     TOKEN_TTL_MINUTES=720, REQUIRE_MFA=False, write_audit=Mock(),
                     auth_attempts=AttemptLimiter(), source_attempts=AttemptLimiter(attempts=60))
    exec(compile(ast.Module(body=functions, type_ignores=[]), 'backend/main.py', 'exec'), namespace)
    return namespace


class AuthenticationTests(unittest.TestCase):
    def test_required_mfa_blocks_old_and_enrollment_sessions_from_records(self):
        self.auth['REQUIRE_MFA'] = True
        self.db.get.side_effect = lambda model, key: None if model is models.RevokedAccessToken else self.user
        enrollment_token = self.login()['access_token']
        with self.assertRaises(HTTPException) as denied:
            self.auth['current_user'](enrollment_token, self.db)
        self.assertEqual(denied.exception.status_code, 403)
        setup_request = SimpleNamespace(method='POST', url=SimpleNamespace(path='/api/auth/me/mfa/setup'))
        self.assertIs(self.auth['current_user'](enrollment_token, self.db, setup_request), self.user)
        setup = self.auth['setup_mfa'](self.user, self.db)
        code = self.auth['generate_totp'](setup['secret'])
        self.auth['enable_mfa'](SimpleNamespace(code=code), None, self.user, self.db)
        with self.assertRaises(HTTPException):
            self.auth['current_user'](enrollment_token, self.db)
        with self.assertRaises(HTTPException):
            self.login(trusted=self.auth['create_mfa_trusted_device_token'](self.user))
        verified = self.login(code, remember=True)
        self.assertIsNone(verified['mfa_trusted_device_token'])
        self.assertIs(self.auth['current_user'](verified['access_token'], self.db), self.user)

    def test_http_authenticator_flow_and_logout_revocation(self):
        # Compile the original route decorators, form bindings and dependencies;
        # exclude only module startup which would mutate the configured database.
        revoked = set()
        self.db.get.side_effect = lambda model, key: (key in revoked) if model is models.RevokedAccessToken else self.user
        self.db.add.side_effect = lambda row: revoked.add(row.token_hash)

        def get_db():
            yield self.db

        app = FastAPI()
        ns = dict(self.auth, app=app, get_db=get_db, Depends=Depends, Form=Form,
                  Request=Request, Session=Session, BaseModel=BaseModel, Literal=Literal,
                  OAuth2PasswordRequestForm=OAuth2PasswordRequestForm,
                  oauth2_scheme=OAuth2PasswordBearer(tokenUrl='/api/auth/token'))
        route_names = {'current_user', 'login', 'setup_mfa', 'enable_mfa', 'disable_mfa', 'logout_access_token'}
        class_names = {'TokenResponse', 'MfaSetupResponse', 'MfaVerifyPayload'}
        tree = ast.parse((Path(__file__).resolve().parents[2]/'backend/main.py').read_text(encoding='utf-8'))
        selected = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in route_names
                    or isinstance(n, ast.ClassDef) and n.name in class_names]
        exec(compile(ast.Module(body=selected, type_ignores=[]), 'backend/main.py', 'exec'), ns)
        with TestClient(app) as client:
            form = {'username': self.user.email, 'password': 'synthetic-password'}
            self.assertEqual(client.post('/api/auth/me/mfa/setup').status_code, 401)
            response = client.post('/api/auth/token', data=form)
            self.assertEqual(response.status_code, 200)
            headers = {'Authorization': 'Bearer '+response.json()['access_token']}
            setup = client.post('/api/auth/me/mfa/setup', headers=headers)
            self.assertEqual(setup.status_code, 200)
            code = ns['generate_totp'](setup.json()['secret'])
            self.assertEqual(client.post('/api/auth/me/mfa/enable', json={'code': code}, headers=headers).status_code, 200)
            self.assertEqual(client.post('/api/auth/token', data=form).status_code, 401)
            signed_in = client.post('/api/auth/token', data=dict(form, otp_code=code, remember_device='true'))
            self.assertEqual(signed_in.status_code, 200)
            trusted = signed_in.json()['mfa_trusted_device_token']
            self.assertEqual(client.post('/api/auth/me/mfa/setup', headers={'Authorization': 'Bearer '+trusted}).status_code, 401)
            self.assertEqual(client.post('/api/auth/me/mfa/disable', json={'code': code}, headers=headers).status_code, 200)
            self.assertEqual(client.post('/api/auth/logout', headers=headers).status_code, 200)
            self.assertEqual(client.post('/api/auth/me/mfa/setup', headers=headers).status_code, 401)

    def test_attempt_limit_expiry_and_capacity(self):
        now = [100]
        limiter = AttemptLimiter(attempts=2, window=60, capacity=1, clock=lambda: now[0])
        limiter.consume('synthetic')
        limiter.consume('synthetic')
        for identity in ('synthetic', 'other'):
            with self.assertRaises(HTTPException) as error:
                limiter.consume(identity)
            self.assertEqual(error.exception.status_code, 429)
            self.assertEqual(error.exception.headers['Retry-After'], '60')
        now[0] += 60
        limiter.consume('other')

    def test_login_and_mfa_endpoints_limit_attempts(self):
        self.auth['auth_attempts'] = AttemptLimiter(attempts=2)
        for _ in range(2):
            with self.assertRaises(HTTPException) as error:
                self.login(password='wrong')
            self.assertEqual(error.exception.status_code, 401)
        with self.assertRaises(HTTPException) as error:
            self.login(password='wrong')
        self.assertEqual(error.exception.status_code, 429)
        self.user.mfa_secret = self.auth['generate_mfa_secret']()
        for _ in range(2):
            with self.assertRaises(HTTPException):
                self.auth['enable_mfa'](SimpleNamespace(code='bad'), None, self.user, self.db)
        with self.assertRaises(HTTPException) as error:
            self.auth['disable_mfa'](SimpleNamespace(code='bad'), None, self.user, self.db)
        self.assertEqual(error.exception.status_code, 429)

    def setUp(self):
        self.auth = auth_namespace()
        self.db = Mock()
        self.user = SimpleNamespace(user_id=9, email='synthetic@example.test', username='synthetic',
                                    mfa_secret=None, mfa_enabled=False, is_active=True,
                                    approval_status='approved', role=None)
        self.user.password_hash = self.auth['hash_password']('synthetic-password')
        self.db.query.return_value.filter.return_value.first.return_value = self.user

    def login(self, code=None, trusted=None, remember=False, password='synthetic-password'):
        return self.auth['login'](None, SimpleNamespace(username=self.user.email, password=password),
                                  code, trusted, remember, self.db)

    def test_authenticator_setup_enable_login_trust_disable(self):
        setup = self.auth['setup_mfa'](self.user, self.db)
        uri = urlparse(setup['otpauth_uri'])
        self.assertEqual(uri.scheme, 'otpauth')
        self.assertEqual(parse_qs(uri.query)['secret'][0], setup['secret'])
        code = self.auth['generate_totp'](setup['secret'])
        self.auth['enable_mfa'](SimpleNamespace(code=code), None, self.user, self.db)
        self.assertTrue(self.user.mfa_enabled)
        with self.assertRaises(HTTPException):
            self.login()
        with self.assertRaises(HTTPException) as invalid:
            self.login('invalid')
        self.assertEqual(invalid.exception.detail, 'Invalid MFA code')
        result = self.login(code, remember=True)
        self.assertEqual(self.auth['read_access_token'](result['access_token']), 9)
        trusted = result['mfa_trusted_device_token']
        self.assertTrue(self.login(trusted=trusted)['access_token'])
        with self.assertRaises(HTTPException):
            self.auth['disable_mfa'](SimpleNamespace(code='invalid'), None, self.user, self.db)
        self.auth['disable_mfa'](SimpleNamespace(code=code), None, self.user, self.db)
        self.assertFalse(self.user.mfa_enabled)
        self.assertIsNone(self.user.mfa_secret)
        self.assertFalse(self.auth['verify_mfa_trusted_device_token'](self.user, trusted))

    def test_trusted_token_is_not_a_bearer_token(self):
        self.user.mfa_secret = self.auth['generate_mfa_secret']()
        token = self.auth['create_mfa_trusted_device_token'](self.user)
        with self.assertRaises(HTTPException) as caught:
            self.auth['read_access_token'](token)
        self.assertEqual(caught.exception.status_code, 401)

    def test_password_rejection_is_safe(self):
        for stored in ('plaintext', 'pbkdf2_sha256$', 'pbkdf2_sha256$x$bad', '$argon2id$garbage'):
            self.assertFalse(self.auth['verify_password']('plaintext', stored))
        with self.assertRaises(HTTPException):
            self.login(password='incorrect')

    def test_passwords_are_hashed_with_argon2id(self):
        first = self.auth['hash_password']('synthetic-password')
        second = self.auth['hash_password']('synthetic-password')
        self.assertTrue(first.startswith('$argon2id$v=19$m=65536,t=3,p=4$'))
        self.assertNotEqual(first, second)
        self.assertTrue(self.auth['verify_password']('synthetic-password', first))
        self.assertFalse(self.auth['verify_password']('synthetic-passworD', first))

    def test_legacy_pbkdf2_hash_is_upgraded_to_argon2id_on_login(self):
        salt = secrets.token_hex(16)
        digest = hashlib.pbkdf2_hmac('sha256', b'synthetic-password', salt.encode(), 120_000).hex()
        legacy = f'pbkdf2_sha256${salt}${digest}'
        self.assertTrue(self.auth['verify_password']('synthetic-password', legacy))
        self.user.password_hash = legacy
        with self.assertRaises(HTTPException):
            self.login(password='incorrect')
        self.assertEqual(self.user.password_hash, legacy)
        self.login()
        self.assertTrue(self.user.password_hash.startswith('$argon2id$'))
        self.assertTrue(self.auth['verify_password']('synthetic-password', self.user.password_hash))

    def test_totp_reference_vector_and_bad_input(self):
        secret = base64.b32encode(b'12345678901234567890').decode()
        self.assertEqual(self.auth['generate_totp'](secret, datetime.fromtimestamp(59, timezone.utc)), '287082')
        for bad in ('１２３４５６', 'a123456', '123456x', ''):
            self.assertFalse(self.auth['verify_totp'](secret, bad))
        self.assertFalse(self.auth['verify_totp']('invalid!', '123456'))

    def test_tampered_expired_and_wrong_user_tokens(self):
        token = self.auth['create_access_token'](9)
        with self.assertRaises(HTTPException):
            self.auth['read_access_token'](token+'x')
        self.auth['TOKEN_TTL_MINUTES'] = 0
        with self.assertRaises(HTTPException):
            self.auth['read_access_token'](self.auth['create_access_token'](9))
        self.user.mfa_secret = self.auth['generate_mfa_secret']()
        trusted = self.auth['create_mfa_trusted_device_token'](self.user, -1)
        self.assertFalse(self.auth['verify_mfa_trusted_device_token'](self.user, trusted))
        trusted = self.auth['create_mfa_trusted_device_token'](self.user)
        self.user.user_id = 10
        self.assertFalse(self.auth['verify_mfa_trusted_device_token'](self.user, trusted))

    def test_revoked_disabled_pending_and_nonadmin_access(self):
        token = self.auth['create_access_token'](9)
        self.db.get.return_value = object()
        with self.assertRaises(HTTPException):
            self.auth['current_user'](token, self.db)
        for active, status in ((False, 'approved'), (True, 'pending')):
            self.user.is_active, self.user.approval_status = active, status
            with self.assertRaises(HTTPException):
                self.login()
        with self.assertRaises(HTTPException) as caught:
            self.auth['admin_user'](self.user)
        self.assertEqual(caught.exception.status_code, 403)
