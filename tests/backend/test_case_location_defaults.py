"""Ensure missing case locations do not acquire a fabricated city."""

import unittest

import models


class CaseLocationDefaultsTests(unittest.TestCase):
    def test_incident_city_has_no_orm_default(self):
        column = models.Case.__table__.c.incident_city
        self.assertTrue(column.nullable)
        self.assertIsNone(column.default)
        self.assertIsNone(column.server_default)
