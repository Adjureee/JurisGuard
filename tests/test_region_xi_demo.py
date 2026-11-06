"""Synthetic fixture regression checks; no database or private data access."""
from collections import Counter
import unittest
from scripts.region_xi_demo import AS_OF, BATCH, PLACES, fixture, validate


class DemoDataTests(unittest.TestCase):
    def setUp(self):
        self.rows = [fixture(i) for i in range(1,101)]

    def test_unique_people_and_consistent_dates(self):
        self.assertTrue(validate(self.rows))
        for r in self.rows:
            self.assertIn(BATCH, r['note'])
            self.assertNotIn('SYNTHETIC', r['name'])
            self.assertLessEqual(r['received'], AS_OF)
            self.assertEqual(r['last_date'], max(date for date,_ in r['events']))

    def test_dataset_distribution(self):
        self.assertEqual(Counter(r['case_type'] for r in self.rows), {'Criminal':70,'Civil':30})
        self.assertEqual(Counter(r['status'] for r in self.rows), {'Pending':80,'Terminated':20})
        self.assertEqual(Counter(r['location'] for r in self.rows), {'Urban':50,'Rural':50})
        self.assertEqual(len(PLACES),16)
        self.assertEqual(sum(bool(r['representative']) for r in self.rows),42)

    def test_applicant_and_representative_are_separate(self):
        for r in self.rows:
            rep=r['representative']
            if rep:
                self.assertNotEqual(rep['name'],r['name'])
                self.assertNotEqual(rep['contact_no'],r['contact_no'])
                self.assertGreaterEqual(rep['age'],18)
            if r['detained']:
                self.assertTrue(rep)
                self.assertTrue(r['facility'])
                self.assertFalse(r['terminated'])

    def test_contacts_and_geography_have_explicit_provenance(self):
        for r in self.rows:
            self.assertTrue(r['contact_no'].startswith('000-') or not r['contact_no'])
            self.assertTrue(r['email'].endswith('@example.invalid') or not r['email'])
            self.assertTrue(r['psgc_url'].startswith('https://psa.gov.ph/classification/psgc/'))
            self.assertIn('Purok ',r['address'])
            self.assertIn(r['city'],r['address'])


if __name__=='__main__':
    unittest.main()
