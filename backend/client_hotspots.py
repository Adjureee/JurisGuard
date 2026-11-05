"""Offline, conservative matching of client addresses to local barangay references."""
import re
import unicodedata


def normalize(value):
    return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', value or '').encode('ascii', 'ignore').decode().lower()).strip()


def address_barangay(address, references):
    text = ' ' + normalize(address) + ' '
    # Require the city explicitly: identical barangay names exist elsewhere.
    if ' panabo ' not in text:
        return 'Unspecified'
    matches = [name for name in references if ' ' + normalize(name) + ' ' in text]
    return matches[0] if len(matches) == 1 else 'Unspecified'


def client_hotspots(clients, references):
    buckets = {}
    seen = set()
    for client in clients:
        if client.client_id in seen:
            continue
        seen.add(client.client_id)
        address = (client.details.address if client.details else '') or ''
        name = address_barangay(address, references)
        if name == 'Unspecified':
            name = address.strip() or 'Address not provided'
        buckets[name] = buckets.get(name, 0) + 1
    stats, points = [], []
    for name, count in sorted(buckets.items(), key=lambda item: -item[1]):
        coords = references.get(name)
        stats.append(dict(barangay=name, city='Panabo City' if coords else '', total_cases=count,
                          active_cases=count, terminated_cases=0, most_common_category='Client addresses',
                          latitude=coords[0] if coords else None, longitude=coords[1] if coords else None))
        if coords:
            points.append(dict(case_id=len(points), barangay=name, latitude=coords[0], longitude=coords[1],
                               weight=count, source='barangay', status='client', category='Client addresses'))
    return stats, points
