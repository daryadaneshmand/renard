#!/usr/bin/env python3
"""Compose captured frames into one sheet per fish: 8 phases in color, 8 in ink, cropped tight.

    python -I tools/phasesheet.py <frames dir> <out dir> [slug ...]
"""
import glob, os, re, sys
import numpy as np
from PIL import Image, ImageDraw

def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    slugs = sys.argv[3:] or sorted({re.sub(r'-(color|ink)-\d\.png$', '', os.path.basename(f)) for f in glob.glob(f'{src}/*-color-0.png')})
    for slug in slugs:
        ims = [Image.open(f'{src}/{slug}-{l}-{i}.png').convert('RGB') for l in ('color', 'ink') for i in range(8)]
        arr = [np.asarray(i).astype(np.int16) for i in ims]
        g = arr[0][0, 0]
        diff = np.any([np.abs(a - g).sum(-1) > 12 for a in arr], axis=0)
        ys, xs = np.nonzero(diff)
        box = (max(0, xs.min() - 8), max(0, ys.min() - 8), xs.max() + 9, ys.max() + 9)
        w, h = box[2] - box[0], box[3] - box[1]
        cols = 4 if w < 520 * 1.5 else 2      # long fish get two columns, so they stay large
        k = min(1.0, (1980 / cols - 8) / w)
        cw, ch = int(w * k), int(h * k)
        rows = 8 // cols
        can = Image.new('RGB', (cols * (cw + 8), 2 * rows * (ch + 8) + 30), tuple(int(v) for v in g))
        d = ImageDraw.Draw(can)
        d.text((6, 4), f'{slug}  top: color  bottom: ink  phase 0 to 7/8 turn, yaw 24', fill=(0, 0, 0))
        for n, im in enumerate(ims):
            look, i = n // 8, n % 8
            c = im.crop(box).resize((cw, ch), Image.LANCZOS)
            can.paste(c, ((i % cols) * (cw + 8), 26 + (look * rows + i // cols) * (ch + 8)))
        can.save(f'{out}/{slug}.png')
        print(f'{out}/{slug}.png', can.size)

if __name__ == '__main__':
    main()
