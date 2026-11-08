"""Opt-in messaging API integration with synthetic rows rolled back afterward.

Set JURISGUARD_LOCAL_INTEGRATION=1 to use the configured local PostgreSQL DB.
"""
import os
import unittest


@unittest.skipUnless(
    os.getenv("JURISGUARD_LOCAL_INTEGRATION") == "1",
    "explicit local DB integration only",
)
class PrivateMessagingApiTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from sqlalchemy.orm import Session
        import main

        self.main = main
        self.connection = main.engine.connect()
        self.transaction = self.connection.begin()
        self.db = Session(bind=self.connection, join_transaction_mode="create_savepoint")
        self.api = TestClient(main.app)
        role_names = {"attorney": "staff", "administrator": "admin", "admin_staff": "admin staff"}
        self.roles = {}
        for offset, (key, role_name) in enumerate(role_names.items()):
            role = self.db.query(main.models.Role).filter(
                main.models.Role.role_name.ilike(role_name),
            ).first()
            if role is None:
                role = main.models.Role(role_id=-918000 - offset, role_name=role_name, permissions="")
                self.db.add(role)
                self.db.flush()
            self.roles[key] = role

        self.attorney_a = self.make_user(-918101, "sender", self.roles["attorney"])
        self.attorney_b = self.make_user(-918102, "recipient", self.roles["attorney"])
        self.attorney_c = self.make_user(-918103, "unrelated", self.roles["attorney"])
        self.administrator = self.make_user(-918104, "administrator", self.roles["administrator"])
        self.admin_staff = self.make_user(-918105, "admin-staff", self.roles["admin_staff"])
        self.db.flush()
        self.actor = [self.attorney_a]
        main.app.dependency_overrides[main.current_user] = lambda: self.actor[0]
        main.app.dependency_overrides[main.get_db] = lambda: self.db

    def tearDown(self):
        self.main.app.dependency_overrides.clear()
        self.db.close()
        self.transaction.rollback()
        self.connection.close()

    def make_user(self, user_id, label, role):
        user = self.main.models.User(
            user_id=user_id,
            role=role,
            username=f"synthetic-message-{label}",
            email=f"{label}@example.invalid",
            full_name=f"Synthetic {label}",
            password_hash="NOT-A-LOGIN-HASH",
            is_active=True,
            approval_status="approved",
        )
        self.db.add(user)
        return user

    def test_authorization_privacy_validation_send_unread_and_read_flow(self):
        main = self.main

        # The real authenticated dependency rejects requests without a bearer token.
        main.app.dependency_overrides.pop(main.current_user)
        self.assertEqual(self.api.get("/api/messages/personnel").status_code, 401)
        main.app.dependency_overrides[main.current_user] = lambda: self.actor[0]

        personnel = self.api.get("/api/messages/personnel")
        self.assertEqual(personnel.status_code, 200, personnel.text)
        roster = personnel.json()["personnel"]
        self.assertTrue(any(person["user_id"] == self.attorney_a.user_id and person["is_self"] for person in roster))
        self.assertTrue(any(person["user_id"] == self.administrator.user_id for person in roster))
        self.assertFalse(any(person["user_id"] == self.admin_staff.user_id for person in roster))

        base = f"/api/messages/{self.attorney_b.user_id}"
        self.assertEqual(self.api.post(base, json={"content": "   "}).status_code, 422)
        self.assertEqual(self.api.post(base, json={"content": "Invalid\u0000message"}).status_code, 422)
        self.assertEqual(self.api.post(base, json={"content": "x" * 2001}).status_code, 422)
        self.assertEqual(self.api.post(base, json={"content": "valid", "sender_user_id": self.attorney_c.user_id}).status_code, 422)
        self.assertEqual(self.api.post(f"/api/messages/{self.admin_staff.user_id}", json={"content": "Synthetic"}).status_code, 404)

        sent = self.api.post(base, json={"content": "  Synthetic confidential message  "})
        self.assertEqual(sent.status_code, 200, sent.text)
        message = sent.json()
        self.assertEqual(message["content"], "Synthetic confidential message")
        notification = self.db.query(main.models.Notification).filter(
            main.models.Notification.event_key == f"private-message:{message['message_id']}"
        ).one()
        self.assertNotIn(message["content"], notification.message)

        # Reactions use the same authenticated and participant-scoped access.
        reaction_path = f"/api/messages/{self.attorney_b.user_id}/{message['message_id']}/reaction"
        main.app.dependency_overrides.pop(main.current_user)
        self.assertEqual(self.api.post(reaction_path, json={"emoji": "👍"}).status_code, 401)
        main.app.dependency_overrides[main.current_user] = lambda: self.actor[0]
        liked = self.api.post(reaction_path, json={"emoji": "👍"})
        self.assertEqual(liked.status_code, 200, liked.text)
        self.assertEqual(liked.json()["reactions"], [{"emoji": "👍", "count": 1, "reacted_by_me": True}])
        self.assertEqual(self.api.post(reaction_path, json={"emoji": "not-an-emoji"}).status_code, 422)

        self.actor[0] = self.attorney_b
        roster = self.api.get("/api/messages/personnel").json()["personnel"]
        self.assertEqual(next(person["unread_count"] for person in roster if person["user_id"] == self.attorney_a.user_id), 1)
        received = self.api.get(f"/api/messages/{self.attorney_a.user_id}")
        self.assertEqual(received.status_code, 200, received.text)
        self.assertEqual([row["content"] for row in received.json()["messages"]], [message["content"]])
        self.assertFalse(received.json()["messages"][0]["is_mine"])
        visible_reaction = received.json()["messages"][0]["reactions"][0]
        self.assertEqual(visible_reaction, {"emoji": "👍", "count": 1, "reacted_by_me": False})
        recipient_reaction_path = f"/api/messages/{self.attorney_a.user_id}/{message['message_id']}/reaction"
        recipient_like = self.api.post(recipient_reaction_path, json={"emoji": "👍"})
        self.assertEqual(recipient_like.status_code, 200, recipient_like.text)
        self.assertEqual(recipient_like.json()["reactions"], [{"emoji": "👍", "count": 2, "reacted_by_me": True}])
        recipient_change = self.api.post(recipient_reaction_path, json={"emoji": "❤️"})
        self.assertEqual(recipient_change.status_code, 200, recipient_change.text)
        self.assertEqual(
            {item["emoji"]: (item["count"], item["reacted_by_me"]) for item in recipient_change.json()["reactions"]},
            {"👍": (1, False), "❤️": (1, True)},
        )
        recipient_remove = self.api.post(recipient_reaction_path, json={"emoji": "❤️"})
        self.assertEqual(recipient_remove.status_code, 200, recipient_remove.text)
        self.assertEqual(recipient_remove.json()["reactions"], [{"emoji": "👍", "count": 1, "reacted_by_me": False}])

        # A third attorney can message either participant, but sees only that
        # separate conversation, never the attorney_a/attorney_b messages.
        self.actor[0] = self.attorney_c
        unrelated = self.api.get(f"/api/messages/{self.attorney_b.user_id}")
        self.assertEqual(unrelated.status_code, 200, unrelated.text)
        self.assertEqual(unrelated.json()["messages"], [])
        self.assertEqual(self.api.post(f"/api/messages/{self.attorney_b.user_id}/{message['message_id']}/reaction", json={"emoji": "😂"}).status_code, 404)

        self.actor[0] = self.administrator
        admin_view = self.api.get(f"/api/messages/{self.attorney_a.user_id}")
        self.assertEqual(admin_view.status_code, 200, admin_view.text)
        self.assertEqual(admin_view.json()["messages"], [])
        self.assertEqual(self.api.post(f"/api/messages/{self.attorney_a.user_id}/{message['message_id']}/reaction", json={"emoji": "😂"}).status_code, 404)
        self.assertEqual(self.api.post(f"/api/messages/{self.attorney_c.user_id}", json={"content": "Synthetic admin note"}).status_code, 200)
        self.assertEqual(self.api.post(f"/api/messages/{self.administrator.user_id}", json={"content": "Self message"}).status_code, 404)

        # Admin Staff has no private messaging access under the current rules.
        self.actor[0] = self.admin_staff
        self.assertEqual(self.api.get("/api/messages/personnel").status_code, 403)
        self.assertEqual(self.api.get(f"/api/messages/{self.attorney_a.user_id}").status_code, 403)
        self.assertEqual(self.api.post(f"/api/messages/{self.attorney_a.user_id}", json={"content": "Synthetic"}).status_code, 403)
        self.assertEqual(self.api.post(f"/api/messages/{self.attorney_a.user_id}/read").status_code, 403)

        self.actor[0] = self.attorney_b
        marked = self.api.post(f"/api/messages/{self.attorney_a.user_id}/read")
        self.assertEqual(marked.status_code, 200, marked.text)
        self.assertGreaterEqual(marked.json()["updated"], 1)
        roster = self.api.get("/api/messages/personnel").json()["personnel"]
        self.assertEqual(next(person["unread_count"] for person in roster if person["user_id"] == self.attorney_a.user_id), 0)
        self.db.refresh(self.db.get(main.models.PrivateMessage, message["message_id"]))
        self.assertIsNotNone(self.db.get(main.models.PrivateMessage, message["message_id"]).read_at)


if __name__ == "__main__":
    unittest.main()
