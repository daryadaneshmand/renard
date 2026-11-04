# Find which Commons plate each of her low-res downloads shows, by template match on grayscale against cache/thumbs.
# About 2 minutes an image. Usage: match_plates.py <side-by-side.png> <image> [<image> ...]
import glob, os, sys, numpy as np
from PIL import Image
from skimage.feature import match_template
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
thumbs = sorted(glob.glob(f'{root}/cache/thumbs/*.jpg'))
T = {}
for t in thumbs:
    T[os.path.basename(t)[:-4]] = np.asarray(Image.open(t).convert('L').resize((320, 490)), dtype=float)
results = {}
for f in sorted(sys.argv[2:]):
    im = Image.open(f).convert('L')
    best = []
    for rot in (0, 90, 270):
        r = im.rotate(rot, expand=True)
        for frac in (.35, .45, .55, .65, .75, .85, .95):
            w = int(320 * frac); h = int(r.height * w / r.width)
            if h >= 490 or h < 30: continue
            q = np.asarray(r.resize((w, h)), dtype=float)
            for pid, a in T.items():
                s = match_template(a, q).max()
                best.append((float(s), pid, rot, frac))
    best.sort(reverse=True)
    seen = []; 
    for b in best:
        if b[1] not in [x[1] for x in seen]: seen.append(b)
        if len(seen) == 3: break
    print(os.path.basename(f)[:13], [(round(s, 3), p, r, fr) for s, p, r, fr in seen], flush=True)
    results[f] = seen[0]
# side by side: their download next to the best Commons match
H = 620; rows = []
for f, (s, pid, rot, fr) in results.items():
    a = Image.open(f).convert('RGB').rotate(rot, expand=True); b = Image.open(f'{root}/cache/thumbs/{pid}.jpg').convert('RGB')
    a = a.resize((int(a.width * H / a.height), H)); b = b.resize((int(b.width * H / b.height), H))
    rows += [a, b]
W = sum(i.width + 8 for i in rows); o = Image.new('RGB', (W, H), 'white'); x = 0
for i in rows: o.paste(i, (x, 0)); x += i.width + 8
o.save(sys.argv[1])
