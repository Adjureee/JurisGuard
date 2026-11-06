"""Build a public offline city/province lookup from attributed admin boundaries.

Requires Shapely for this development-only build. Never reads client data.
No network is used by the application's matcher at runtime.
"""
import hashlib
import json
from pathlib import Path
import urllib.request
from shapely.geometry import shape

ROOT=Path(__file__).resolve().parents[1]
URL='https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/41af8f1/releaseData/gbOpen/PHL/ADM2/geoBoundaries-PHL-ADM2_simplified.geojson'
SOURCE=ROOT/'.local/reference/geoBoundaries-PHL-ADM2_simplified.geojson'


def main():
    SOURCE.parent.mkdir(parents=True,exist_ok=True)
    if not SOURCE.exists() or SOURCE.read_bytes().startswith(b'version https://git-lfs'):
        with urllib.request.urlopen(URL,timeout=60) as response:
            SOURCE.write_bytes(response.read())
    provinces=json.loads(SOURCE.read_text())
    cities=json.loads((ROOT/'frontend/public/maps/philippines-cities.geojson').read_text())
    parents=[(f['properties']['shapeName'],shape(f['geometry']).buffer(0)) for f in provinces['features']]
    lookup={}
    unresolved=[]
    for feature in cities['features']:
        geometry=shape(feature['geometry']).buffer(0)
        # Area overlap uses admin polygons, never a client's guessed coordinates.
        overlaps=sorted([(geometry.intersection(p).area/geometry.area,name) for name,p in parents if geometry.intersects(p)],reverse=True)
        if overlaps and overlaps[0][0]>=.95 and (len(overlaps)==1 or overlaps[1][0]<.05):
            lookup[feature['properties']['shapeID']]=overlaps[0][1]
        else:
            unresolved.append(feature['properties']['shapeName'])
    output=ROOT/'frontend/src/components/dashboard/cityProvinceIndex.json'
    result={'source':URL,'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'cityBoundarySha256':hashlib.sha256((ROOT/'frontend/public/maps/philippines-cities.geojson').read_bytes()).hexdigest(),
        'license':'CC BY 3.0 IGO; geoBoundaries / NAMRIA / PSA / OCHA Philippines',
        'method':'Unique province polygon covering at least 95% of city/municipality area',
        'parents':lookup}
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'indexed':len(lookup),'unresolved':len(unresolved),'unresolved_names':unresolved}))


if __name__=='__main__': main()
