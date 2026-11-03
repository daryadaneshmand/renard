#!/usr/bin/env python3
"""Contact sheets of what extract.py wrote. Read them at full size.

    python -I tools/sheet.py assets/fish out.png [--ground 0.2,0.25,0.5]
Row per fish: color and ink on a hard contrast ground, so any paper in the edge shows.
"""
import argparse, glob, json, os
import numpy as np
from PIL import Image, ImageDraw

def comp(fg, bg):
    a = fg[..., 3:]
    return fg[..., :3] * a + bg * (1 - a)

def load(p):
    return np.asarray(Image.open(p).convert('RGBA')).astype(np.float32) / 255

def fish_layers(d, rig):
    c = load(f'{d}/color.png'); i = load(f'{d}/ink.png')
    s = rig['tex_scale']
    for n, fin in enumerate(rig.get('fins', [])):
        fc = load(f'{d}/fin{n}-color.png'); fi = load(f'{d}/fin{n}-ink.png')
        x = round((fin['box'][0] - rig['origin'][0]) * s); y = round((fin['box'][1] - rig['origin'][1]) * s)
        hh = min(fc.shape[0], c.shape[0] - y); ww = min(fc.shape[1], c.shape[1] - x)
        over = fc[:hh, :ww]
        a = over[..., 3:]
        base = c[y:y + hh, x:x + ww]
        oa = a + base[..., 3:] * (1 - a)
        c[y:y + hh, x:x + ww, :3] = np.where(oa > 1e-3, (over[..., :3] * a + base[..., :3] * base[..., 3:] * (1 - a)) / np.maximum(oa, 1e-3), 0)
        c[y:y + hh, x:x + ww, 3:] = oa
        ia = fi[:hh, :ww, 3:]
        i[y:y + hh, x:x + ww, 3:] = np.maximum(i[y:y + hh, x:x + ww, 3:], ia)
    return c, i

def build(root, out, ground=(.16, .2, .42), paper=(.93, .89, .80), maxw=1500):
    rows, W = [], 0
    g = np.array(ground, np.float32); pap = np.array(paper, np.float32)
    meta = sorted(glob.glob(f'{root}/plate-*.json'))
    slugs = json.load(open(meta[0]))['fish'] if meta else sorted(os.listdir(root))
    for slug in slugs:
        d = f'{root}/{slug}'
        rig = json.load(open(f'{d}/rig.json'))
        c, i = fish_layers(d, rig)
        col = comp(c, g)
        inkbg = np.broadcast_to(pap, c.shape[:2] + (3,)).copy()
        # ink look: the silhouette in paper tone over the same hard ground, line on top
        ink = comp(np.dstack([inkbg, c[..., 3]]), g)
        ink = ink * (1 - i[..., 3:]) + i[..., :3] * i[..., 3:]
        row = np.concatenate([col, np.broadcast_to(g, (col.shape[0], 16, 3)), ink], 1)
        if row.shape[1] > maxw * 2:
            sc = maxw * 2 / row.shape[1]
            row = np.asarray(Image.fromarray((row * 255).astype('uint8')).resize((maxw * 2, round(row.shape[0] * sc)), Image.LANCZOS)).astype(np.float32) / 255
        rows.append((slug, row))
        W = max(W, row.shape[1])
    H = sum(r.shape[0] + 34 for _, r in rows)
    can = np.broadcast_to(g, (H, W, 3)).copy()
    y = 0
    labels = []
    for slug, r in rows:
        labels.append((y + 6, slug))
        y += 28
        can[y:y + r.shape[0], :r.shape[1]] = r
        y += r.shape[0] + 6
    img = Image.fromarray((np.clip(can, 0, 1) * 255).astype('uint8'))
    dr = ImageDraw.Draw(img)
    for yy, s in labels:
        dr.text((8, yy), s, fill=(255, 255, 255))
    img.save(out)
    print(out, img.size)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('root'); ap.add_argument('out')
    ap.add_argument('--ground', default='.16,.2,.42')
    a = ap.parse_args()
    build(a.root, a.out, tuple(float(v) for v in a.ground.split(',')))
