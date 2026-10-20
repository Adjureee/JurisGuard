"""Launch the disposable local test API with external network connections denied.

Use only with DATABASE_URL pointing at the isolated synthetic PostgreSQL cluster.
This guard applies to this Python process, not the operating system or browser.
"""

import os
import socket
import sys
from pathlib import Path

if os.environ.get("E2E_ISOLATED_DB") != "jurisguard_synthetic:55439":
    raise SystemExit("Isolated test database marker required")
if os.environ.get("DATABASE_URL") != "postgresql://jurisguard_test@127.0.0.1:55439/jurisguard_synthetic":
    raise SystemExit("Refusing to launch against any other database")

original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex


def allow_loopback(address):
    if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1", "localhost"):
        raise OSError(f"External socket connection blocked: {address[0]}")


def guarded_connect(self, address):
    allow_loopback(address)
    return original_connect(self, address)


def guarded_connect_ex(self, address):
    allow_loopback(address)
    return original_connect_ex(self, address)


socket.socket.connect = guarded_connect
socket.socket.connect_ex = guarded_connect_ex
if "--self-test" in sys.argv:
    for operation in ("connect", "connect_ex"):
        with socket.socket() as probe:
            try:
                getattr(probe, operation)(("203.0.113.1", 443))
            except OSError as exc:
                assert "External socket connection blocked" in str(exc), exc
            else:
                raise AssertionError(f"{operation} allowed external networking")
    print("PASS: external TCP connections rejected before touching the network")
    raise SystemExit(0)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

import uvicorn

uvicorn.run("main:app", host="127.0.0.1", port=58086, log_level="info")
