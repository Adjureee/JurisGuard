"""Classification values remain unresolved without documented review."""

import unittest
import ast
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import models
from classification_evidence import reviewed_flag_input, stored_reviewed_flags


_MAIN = Path(__file__).resolve().parents[2] / "backend" / "main.py"
_TREE = ast.parse(_MAIN.read_text(encoding="utf-8"))
_FUNCTIONS = [
    node for node in _TREE.body
    if isinstance(node, ast.FunctionDef) and node.name in {"get_client_payload", "case_participant_payload"}
]
_NAMESPACE = {"models": models, "stored_reviewed_flags": stored_reviewed_flags, "Any": Any}
exec(compile(ast.Module(body=_FUNCTIONS, type_ignores=[]), str(_MAIN), "exec"), _NAMESPACE)


class ClassificationEvidenceTests(unittest.TestCase):
    def test_model_has_nullable_flags_without_false_defaults(self):
        table = models.ClientClassification.__table__
        for name in ("class_female", "class_senior_citizen", "class_cicl"):
            column = table.c[name]
            self.assertTrue(column.nullable)
            self.assertIsNone(column.default)
            self.assertIsNone(column.server_default)

    def test_absent_or_unreviewed_input_does_not_set_flags(self):
        self.assertIsNone(reviewed_flag_input({}))
        self.assertIsNone(reviewed_flag_input({"flag_female": True}))
        self.assertIsNone(reviewed_flag_input({"flags_reviewed": False, "flag_female": True}))

    def test_reviewed_values_preserve_true_false_and_unknown(self):
        self.assertEqual(reviewed_flag_input({
            "flags_reviewed": True,
            "flag_female": False,
            "flag_senior": True,
        }), {"flag_female": False, "flag_senior": True, "flag_cicl": None})

    def test_invalid_boolean_strings_are_rejected(self):
        with self.assertRaises(ValueError):
            reviewed_flag_input({"flags_reviewed": "true"})
        with self.assertRaises(ValueError):
            reviewed_flag_input({"flags_reviewed": True, "flag_cicl": "false"})

    def test_legacy_values_are_masked_until_reviewed(self):
        classification = SimpleNamespace(
            flags_reviewed=False,
            class_female=True,
            class_senior_citizen=False,
            class_cicl=False,
        )
        self.assertEqual(stored_reviewed_flags(classification), {
            "flag_female": None, "flag_senior": None, "flag_cicl": None,
        })
        classification.flags_reviewed = True
        self.assertEqual(stored_reviewed_flags(classification), {
            "flag_female": True, "flag_senior": False, "flag_cicl": False,
        })

    def test_api_payloads_never_derive_flags_from_age_or_sex(self):
        client = models.Client(client_id=3, name="Synthetic Client", age=70, sex="Female")
        client.details = models.ClientDetails(client_id=3)
        client.classification = models.ClientClassification(
            client_id=3, flags_reviewed=False,
            class_female=True, class_senior_citizen=True, class_cicl=False,
        )
        payload = _NAMESPACE["get_client_payload"](client)["client_classification"]
        self.assertFalse(payload["flags_reviewed"])
        self.assertEqual([payload[key] for key in ("flag_female", "flag_senior", "flag_cicl")], [None] * 3)

        participant = SimpleNamespace(
            client=client, case=None, case_client_id=1, client_id=3,
            party_represented="Synthetic party", applicant_role="", applicant_role_other="",
        )
        row = _NAMESPACE["case_participant_payload"](participant)["classification"]
        self.assertEqual([row[key] for key in ("flag_female", "flag_senior", "flag_cicl")], [None] * 3)

        client.classification.flags_reviewed = True
        payload = _NAMESPACE["get_client_payload"](client)["client_classification"]
        self.assertEqual([payload[key] for key in ("flag_female", "flag_senior", "flag_cicl")], [True, True, False])


if __name__ == "__main__":
    unittest.main()
