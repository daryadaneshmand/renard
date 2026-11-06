#!/usr/bin/env python3
"""Find which Harvard leaf shows each Commons plate, by matching the engraved line, and write the table.

    python -I tools/find_leaves.py [--fetch] [--min .25]

Reads   cache/thumbs/<id>.jpg              the Commons thumbs tools/plates.html already uses
        cache/harvard-thumbs/L<leaf>.jpg   a quarter size of each illustrated leaf, 15 MB in all
Writes  tools/harvard-plates.json          keeps any row marked "verified", which the full scans confirmed

--fetch gets the leaf thumbs first, one at a time. Scores from the plates checked at full size run .43 to
.74, with the next best leaf at .08 to .15, so a low score means no match rather than a doubtful one.
On the first run 71 of 107 matched here. A second pass over the rest with quarter turns and 3% of scale
either way found only 7199006, at leaf 209 and scale .97. Many of the others are text pages. Check any
new plate at full size with transfer_corrections.py before trusting its row.
"""
import argparse, glob, json, os, re, time, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.feature import match_template

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITEM = 'PoissonsecrevisIRena'
TABLE = f'{ROOT}/tools/harvard-plates.json'
# Illustrated leaves by the item's scandata: odd leaves 21 to 219, less 107, plus the fold-out at 220.
LEAVES = [n for n in range(21, 220, 2) if n != 107] + [220]

def fetch_thumbs():
    out = f'{ROOT}/cache/harvard-thumbs'
    os.makedirs(out, exist_ok=True)
    for n in LEAVES:
        path = f'{out}/L{n:04d}.jpg'
        if os.path.exists(path):
            continue
        rq = urllib.request.Request(f'https://archive.org/download/{ITEM}/page/n{n - 1}_w720.jpg',
                                    headers={'User-Agent': 'renard-water/0.1 (personal art piece)'})
        open(path, 'wb').write(urllib.request.urlopen(rq, timeout=60).read())
        time.sleep(1)

def highpass(a, sig=4):
    a = a.astype(np.float32)
    return a - ndi.gaussian_filter(a, sig)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--min', type=float, default=.25)
    a = ap.parse_args()
    if a.fetch:
        fetch_thumbs()
    leaves = {}
    for f in sorted(glob.glob(f'{ROOT}/cache/harvard-thumbs/L*.jpg')):
        im = Image.open(f).convert('L')
        leaves[int(os.path.basename(f)[1:5])] = highpass(np.asarray(im.resize((im.width // 4, im.height // 4), Image.LANCZOS)))
    old = json.load(open(TABLE))['plates'] if os.path.exists(TABLE) else {}
    plates = {}
    for f in json.load(open(f'{ROOT}/tools/commons-files.json')):
        pid = re.search(r'\((\d+)\)', f['title'])[1]
        if old.get(pid, {}).get('verified'):
            plates[pid] = old[pid]
            continue
        t = Image.open(f'{ROOT}/cache/thumbs/{pid}.jpg').convert('L')
        w, h = round(f['width'] / 16), round(f['height'] / 16)
        q = highpass(np.asarray(t.resize((w, h), Image.LANCZOS)))[int(.2 * h):int(.8 * h), int(.2 * w):int(.8 * w)]
        best = sorted(((float(match_template(g, q).max()), k) for k, g in leaves.items() if g.shape[0] >= q.shape[0] and g.shape[1] >= q.shape[1]), reverse=True)
        plates[pid] = dict(leaf=best[0][1] if best[0][0] >= a.min else None, score=round(best[0][0], 3), next=round(best[1][0], 3))
    json.dump(dict(item=ITEM, copy='Harvard University, Museum of Comparative Zoology, Ernst Mayr Library. Public domain per the Biodiversity Heritage Library.',
                   url=f'https://archive.org/details/{ITEM}',
                   leaf_url=f'https://archive.org/download/{ITEM}/{ITEM}_jp2.zip/{ITEM}_jp2%2F{ITEM}_<leaf, four digits>.jp2', plates=plates),
              open(TABLE, 'w'), indent=1)

if __name__ == '__main__':
    main()
