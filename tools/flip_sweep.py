#!/usr/bin/env python3
"""Flipped triangles over 48 phases, computed from the equation with no browser.

    python -I tools/flip_sweep.py <readback dir> [--root assets/fish] [--json out.json] [slug ...]

check_wave.py looks at 4 phases, and a sweep finds more. The readback dir only supplies each fish's
camera (model and vp), so it comes from `node tools/capture.cjs readback <dir>`. Phases are 2 pi i / 48.
Same flip test as check_wave.py: body triangles whose area changes sign on screen.
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bake import read_part
from check_wave import expected, ROOT

def sweep(root, src, slug):
    d = f'{root}/{slug}'
    rig = json.load(open(f'{d}/rig.json'))
    buf = open(f'{d}/mesh.bin', 'rb').read()
    r0 = next(r for r in json.load(open(f'{src}/{slug}.json')) if r['part'] < 0)
    v, tris = read_part(buf, rig['mesh']['body'], rig['mesh']['space'])
    v = v.astype(np.float64)
    a, b, c = tris.reshape(-1, 3).T
    rest = v[:, :2]
    aspect = 1000 / 620
    e1r, e2r = rest[b] - rest[a], rest[c] - rest[a]
    area_r = e1r[:, 0] * e2r[:, 1] - e1r[:, 1] * e2r[:, 0]
    area_r = np.where(np.abs(area_r) < 1e-12, 1e-12, area_r)
    per = []
    for i in range(48):
        want = expected(v, r0['swim'], 2 * np.pi * i / 48, r0['hingeN'], r0['model'], r0['vp'], r0.get('lift', 1))
        s = want[:, :2] / want[:, 3:] * np.array([aspect, 1])
        e1s, e2s = s[b] - s[a], s[c] - s[a]
        area_s = e1s[:, 0] * e2s[:, 1] - e1s[:, 1] * e2s[:, 0]
        per.append(int(((area_s / area_r) < 0).sum()))
    return per

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('slugs', nargs='*')
    ap.add_argument('--root', default=f'{ROOT}/assets/fish')
    ap.add_argument('--json')
    a = ap.parse_args()
    import glob
    slugs = a.slugs or sorted(os.path.basename(f)[:-5] for f in glob.glob(f'{a.src}/*.json'))
    out = {}
    for s in slugs:
        per = sweep(a.root, a.src, s)
        out[s] = per
        w = int(np.argmax(per))
        print(f"{s:28s} worst {per[w]:5d} at phase {2 * np.pi * w / 48:.2f}   total {sum(per):6d} over {sum(1 for p in per if p):2d} phases")
    if a.json:
        json.dump(out, open(a.json, 'w'))
