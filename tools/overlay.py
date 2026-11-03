#!/usr/bin/env python3
"""Draw a fish's rig over its plate crop, with a tick grid in plate pixels, for the hand pass.

    python -I tools/overlay.py assets/fish/<slug> out.png [--step 100] [--box x y w h] [--zoom 2]
"""
import argparse, json
import numpy as np
from PIL import Image, ImageDraw

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir'); ap.add_argument('out')
    ap.add_argument('--step', type=int, default=100)
    ap.add_argument('--box', type=int, nargs=4)
    ap.add_argument('--zoom', type=float, default=1)
    ap.add_argument('--plate', help='use this plate image instead of the cutout')
    a = ap.parse_args()
    rig = json.load(open(a.dir + '/rig.json'))
    ox, oy = rig['origin']; pw, ph = rig['size_plate']
    x0, y0, w, h = a.box if a.box else (ox, oy, pw, ph)
    if a.plate:
        im = Image.open(a.plate).convert('RGB').crop((x0, y0, x0 + w, y0 + h))
    else:
        c = Image.open(a.dir + '/color.webp').convert('RGBA')
        c = c.resize((pw, ph), Image.LANCZOS) if rig['tex_scale'] != 1 else c
        bg = Image.new('RGBA', c.size, (60, 70, 130, 255)); bg.alpha_composite(c)
        im = bg.convert('RGB').crop((x0 - ox, y0 - oy, x0 - ox + w, y0 - oy + h))
    z = a.zoom
    im = im.resize((int(w * z), int(h * z)), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    P = lambda x, y: ((x - x0) * z, (y - y0) * z)
    s = a.step
    for gx in range((x0 // s + 1) * s, x0 + w, s):
        d.line([P(gx, y0), P(gx, y0 + h)], fill=(255, 255, 255), width=1)
        d.text((P(gx, y0)[0] + 2, 2), str(gx), fill=(255, 255, 0))
    for gy in range((y0 // s + 1) * s, y0 + h, s):
        d.line([P(x0, gy), P(x0 + w, gy)], fill=(255, 255, 255), width=1)
        d.text((2, P(x0, gy)[1] + 2), str(gy), fill=(255, 255, 0))
    b = rig['body']
    d.line([P(x, y) for x, y in zip(b['x'], b['top'])], fill=(0, 255, 90), width=2)
    d.line([P(x, y) for x, y in zip(b['x'], b['bot'])], fill=(255, 60, 240), width=2)
    for x, y in zip(b['x'], b['top']):
        d.ellipse([P(x - 3 / z, y - 3 / z), P(x + 3 / z, y + 3 / z)], outline=(0, 255, 90))
    for x, y in zip(b['x'], b['bot']):
        d.ellipse([P(x - 3 / z, y - 3 / z), P(x + 3 / z, y + 3 / z)], outline=(255, 60, 240))
    for nm, col in (('head', (255, 255, 0)), ('tail', (0, 255, 255))):
        x, y = rig[nm]
        d.line([P(x, y - 80), P(x, y + 80)], fill=col, width=2)
    for f in rig.get('fins', []):
        d.line([P(*p) for p in f['poly'] + f['poly'][:1]], fill=(255, 140, 0), width=2)
        d.line([P(*p) for p in f['hinge']], fill=(255, 0, 0), width=3)
    im.save(a.out)
    print(a.out, im.size)

if __name__ == '__main__':
    main()
