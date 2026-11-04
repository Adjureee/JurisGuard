import unittest
from types import SimpleNamespace as S
from backend.client_hotspots import address_barangay, client_hotspots


class ClientHotspotTests(unittest.TestCase):
    references = {'Gredu': (7.29, 125.67), 'Cagangohan': (7.28, 125.68)}

    def test_conservative_address_matching(self):
        self.assertEqual(address_barangay('Brgy Gredu Panabo City', self.references), 'Gredu')
        for value in ('', 'Gredu Mati City', 'Gredu Cagangohan Panabo'):
            self.assertEqual(address_barangay(value, self.references), 'Unspecified')

    def test_unique_clients_including_without_cases(self):
        client = S(client_id=1, details=S(address='Gredu Panabo'))
        stats, points = client_hotspots([client, client, S(client_id=2, details=None)], self.references)
        self.assertEqual(sum(row['total_cases'] for row in stats), 2)
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0]['weight'], 1)

    def test_outside_panabo_address_is_preserved_without_guessing_coordinates(self):
        stats, points = client_hotspots([S(client_id=3, details=S(address='Brgy Central Mati City'))], self.references)
        self.assertEqual(stats[0]['barangay'], 'Brgy Central Mati City')
        self.assertIsNone(stats[0]['latitude'])
        self.assertEqual(points, [])


if __name__ == '__main__':
    unittest.main()
