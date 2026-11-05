"""Download a bounded, attributed offline map package from OpenFreeMap.

Provider limits: <=3000 tiles, <=50 MB, <=4 concurrent requests per download.
Never downloads client records or sends client addresses.
"""
import concurrent.futures
import gzip
import json
import math
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / 'frontend/public/maps/streets'
HEADERS = {'User-Agent': 'JurisGuard-OfflineMapSetup/1.0 (local PAO client-address analytics)'}


def request(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=40) as response:
        return response.read()


def tiles(bounds, minimum, maximum):
    west, south, east, north = bounds
    for z in range(minimum, maximum + 1):
        def xy(lon, lat):
            return int((lon + 180) / 360 * 2**z), int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z)
        x0, y0 = xy(west, north)
        x1, y1 = xy(east, south)
        for x in range(x0, x1+1):
            for y in range(y0, y1+1):
                yield z, x, y


def main():
    metadata = json.loads(request('https://tiles.openfreemap.org/planet'))
    template = metadata['tiles'][0]
    jobs = [('overview', tile) for tile in tiles((116.8, 4.5, 126.8, 21.2), 0, 8)]
    jobs += [('mati', tile) for tile in tiles((126.05, 6.7, 126.4, 7.18), 9, 14)]
    if len(jobs) > 3000:
        raise RuntimeError('Provider tile-count limit exceeded')
    total = 0
    def download(job):
        name, (z, x, y) = job
        path = ROOT / name / str(z) / str(x) / f'{y}.pbf'
        if path.exists():
            return len(path.read_bytes())
        data = request(template.replace('{z}', str(z)).replace('{x}', str(x)).replace('{y}', str(y)))
        size = len(data)
        if data[:2] == b'\x1f\x8b':
            data = gzip.decompress(data)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return size
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for index, size in enumerate(pool.map(download, jobs)):
            total += size
            if total > 50_000_000:
                pool.shutdown(wait=False, cancel_futures=True)
                raise RuntimeError('Provider 50 MB download limit reached')
            if index % 100 == 0:
                print(f'{index+1}/{len(jobs)} tiles; {total/1e6:.1f} MB', flush=True)
    font = ROOT / 'fonts/Noto Sans Regular/0-255.pbf'
    font.parent.mkdir(parents=True, exist_ok=True)
    font.write_bytes(request('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf'))
    print(f'Complete: {len(jobs)} tiles, {total/1e6:.1f} MB downloaded', flush=True)


if __name__ == '__main__':
    main()
