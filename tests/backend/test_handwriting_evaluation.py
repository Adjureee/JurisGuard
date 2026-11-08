"""Synthetic references; never count predictions as ground truth."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('handwriting_evaluation', Path(__file__).resolve().parents[2]/'scripts/evaluate_handwriting_pair.py')
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class HandwritingEvaluationTests(unittest.TestCase):
    def test_no_verified_answers_yields_no_accuracy_percentage(self):
        counts, metric = evaluation.verified_scores({'applicant': {'name':'SYNTHETIC'}},
            {'fields': {'applicant.name': {'verified':False, 'value':'SYNTHETIC'}}})
        self.assertEqual(counts['unverified'], 1)
        self.assertEqual(metric['verified_fields'], 0)
        self.assertIsNone(metric['exact_match_percent'])

    def test_exact_match_omission_and_error_use_only_verified_denominator(self):
        counts, metric = evaluation.verified_scores({'applicant':dict(name='SYNTHETIC',phone='',age='3O')},
            {'fields': {'applicant.'+key: dict(verified=True,value=value) for key,value in dict(name='SYNTHETIC',phone='00000000000',age='30').items()}})
        self.assertEqual(counts,dict(correct=1,omitted=1,incorrect=1,unverified=0))
        self.assertEqual(metric['verified_fields'],3)
        self.assertEqual(metric['exact_match_percent'],33.33)
