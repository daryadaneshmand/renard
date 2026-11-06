#!/usr/bin/env python3
"""Move a plate's hand corrections from one scan to another by registering the engraved line.

    python -I tools/transfer_corrections.py <plate id> --from <scan> --to <scan> --report out.json [--write]

Used once, to carry the corrections typed against the Commons scans over to Harvard's copy, which is
the same engraved plate on differently shrunk paper with different paint. Paint is ignored: only thin
darks are compared. Registers the whole plate to get close, then each fish on its own, since paper
distorts differently from place to place. Polygons, hinges, head and tail go through the fish's map
point by point. A body line is rebuilt, because after even a slight shear a station's top and bottom
no longer share an x, and the rig needs them to.

Maps run from the source scan to the target scan, both as printed (unrotated). A fish on a rotated
frame is taken back to as printed, mapped, and rotated again with the target's width.
--write replaces corrections/<id>.json and manifests/<id>.json; git has the old ones.
"""
import argparse, json, os, re, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.interpolate import PchipInterpolator
from skimage.feature import match_template

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def lines(path):
    """Thin darks only. Wash, paint and paper tone all vanish."""
    g = np.asarray(Image.open(path).convert('RGB')).astype(np.float32).mean(-1)
    hp = ndi.gaussian_filter(g, 1.0) - ndi.gaussian_filter(g, 9)
    return np.minimum(hp, 0)

def design(xy, deg, c):
    x = (xy[:, 0] - c[0]) / c[2]; y = (xy[:, 1] - c[1]) / c[2]
    t = [np.ones_like(x), x, y]
    if deg >= 2: t += [x * x, x * y, y * y]
    if deg >= 3: t += [x ** 3, x * x * y, x * y * y, y ** 3]
    return np.stack(t, 1)

class Map:
    """Polynomial from source px to target px, with its own centre and scale for conditioning."""
    def __init__(self, deg, c, cx, cy):
        self.deg, self.c, self.cx, self.cy = deg, c, cx, cy
    def __call__(self, xy):
        A = design(np.atleast_2d(np.asarray(xy, float)), self.deg, self.c)
        return np.stack([A @ self.cx, A @ self.cy], 1)
    def dump(self):
        return dict(deg=self.deg, c=list(map(float, self.c)), cx=self.cx.tolist(), cy=self.cy.tolist())

def fit(src, dst, deg, iters=6, w0=None):
    c = (src[:, 0].mean(), src[:, 1].mean(), max(np.ptp(src, 0).max(), 1) / 2)
    A = design(src, deg, c)
    w = np.ones(len(src)) if w0 is None else w0
    for _ in range(iters):
        cx = np.linalg.lstsq(A * w[:, None], dst[:, 0] * w, rcond=None)[0]
        cy = np.linalg.lstsq(A * w[:, None], dst[:, 1] * w, rcond=None)[0]
        r = np.hypot(A @ cx - dst[:, 0], A @ cy - dst[:, 1])
        s = max(np.median(r) * 1.5, .5)
        w = 1 / (1 + (r / (2 * s)) ** 2)        # Cauchy: a mismatched patch stops counting
    return Map(deg, c, cx, cy), r

def subpixel(m, y, x):
    def peak(a, b, c):
        d = a - 2 * b + c
        return 0 if d >= 0 else .5 * (a - c) / d
    dy = peak(m[y - 1, x], m[y, x], m[y + 1, x]) if 0 < y < m.shape[0] - 1 else 0
    dx = peak(m[y, x - 1], m[y, x], m[y, x + 1]) if 0 < x < m.shape[1] - 1 else 0
    return y + dy, x + dx

def patches(A, B, box, guess, size, step, reach, min_ncc):
    """Displacement samples: for each patch of A in box, where its line lands in B."""
    H, W = A.shape
    Hb, Wb = B.shape
    x0, y0, x1, y1 = box
    src, dst, score = [], [], []
    for y in range(int(max(y0, 0)), int(min(y1, H - size)), step):
        for x in range(int(max(x0, 0)), int(min(x1, W - size)), step):
            t = A[y:y + size, x:x + size]
            if (t < -10).mean() < .02:      # nothing engraved here
                continue
            cen = np.array([[x + size / 2, y + size / 2]])
            p = guess(cen)[0]
            bx, by = int(round(p[0] - size / 2)), int(round(p[1] - size / 2))
            a, b, c, d = by - reach, by + size + reach, bx - reach, bx + size + reach
            if a < 0 or c < 0 or b > Hb or d > Wb:
                continue
            m = match_template(B[a:b, c:d], t)
            yy, xx = np.unravel_index(m.argmax(), m.shape)
            if m[yy, xx] < min_ncc or yy in (0, m.shape[0] - 1) or xx in (0, m.shape[1] - 1):
                continue
            sy, sx = subpixel(m, yy, xx)
            src.append(cen[0]); dst.append((c + sx + size / 2, a + sy + size / 2)); score.append(m[yy, xx])
    return np.array(src), np.array(dst), np.array(score)

def plate_map(A, B):
    """Close first at a sixth of the scale, assuming no rotation or scale to speak of, then a fine grid."""
    k = 6
    a, b = ndi.zoom(A, 1 / k, order=1), ndi.zoom(B, 1 / k, order=1)
    h, w = a.shape
    t = a[int(.25 * h):int(.75 * h), int(.25 * w):int(.75 * w)]
    if t.shape[0] > b.shape[0] or t.shape[1] > b.shape[1]:
        t = a[int(.3 * h):int(.7 * h), int(.3 * w):int(.7 * w)]
    m = match_template(b, t)
    yy, xx = np.unravel_index(m.argmax(), m.shape)
    x_off = (xx - int((.25 if t.shape[1] == int(.75 * w) - int(.25 * w) else .3) * w)) * k
    y_off = (yy - int((.25 if t.shape[0] == int(.75 * h) - int(.25 * h) else .3) * h)) * k
    guess = lambda p: p + np.array([x_off, y_off])
    src, dst, sc = patches(A, B, (0, 0, A.shape[1], A.shape[0]), guess, 128, 256, 48, .3)
    mp, r = fit(src, dst, 1)
    src, dst, sc = patches(A, B, (0, 0, A.shape[1], A.shape[0]), mp, 128, 128, 16, .3)
    mp, r = fit(src, dst, 1)
    return mp, dict(coarse_ncc=float(m.max()), n=len(src), p50=float(np.median(r)), p90=float(np.percentile(r, 90)), ncc=float(np.median(sc)))

class Field:
    """A smooth map plus what is left of the paper's local warp, as a kernel over the patches that agree."""
    def __init__(self, base, src, res, sigma):
        self.base, self.src, self.res, self.sigma = base, src, res, sigma
    def __call__(self, xy):
        xy = np.atleast_2d(np.asarray(xy, float))
        d2 = ((xy[:, None, :] - self.src[None, :, :]) ** 2).sum(-1)
        w = np.exp(-d2 / (2 * self.sigma ** 2))
        return self.base(xy) + (w[..., None] * self.res[None]).sum(1) / (w.sum(1, keepdims=True) + 1e-3)

SIGMA = 100

def inliers(src, dst, base, tol=2.5, k=12):
    """Periodic hatching can match a stroke over: a patch that disagrees with its neighbours is dropped."""
    ok = np.ones(len(src), bool)
    for _ in range(3):
        r = dst - base(src)
        d2 = ((src[:, None] - src[ok][None]) ** 2).sum(-1)
        near = np.argsort(d2, axis=1)[:, :min(k, ok.sum())]
        med = np.median(r[ok][near], axis=1)
        ok = np.hypot(*(r - med).T) < tol
    return ok

def fish_map(A, B, box, plate):
    """Fit one fish. Polynomial for the broad shape, kernel for the rest, scored by holding patches out."""
    w, h = box[2] - box[0], box[3] - box[1]
    size = 96 if min(w, h) > 240 else 64
    src, dst, sc = patches(A, B, box, plate, size, size // 2, 10, .5)
    if len(src) < 12:
        return plate, dict(deg='plate', n=len(src), held_p50=None, held_p90=None, ncc=None, note='too few patches, plate map used')
    deg = 2 if len(src) >= 24 else 1
    base0, _ = fit(src, dst, deg)
    ok = inliers(src, dst, base0)
    src1, dst1 = src[ok], dst[ok]
    base, _ = fit(src1, dst1, deg)
    fold = np.random.default_rng(1).integers(0, 5, len(src1))
    err = np.zeros(len(src1))
    for k in range(5):
        tr = fold != k
        b, _ = fit(src1[tr], dst1[tr], deg)
        err[~tr] = np.hypot(*(Field(b, src1[tr], dst1[tr] - b(src1[tr]), SIGMA)(src1[~tr]) - dst1[~tr]).T)
    mp = Field(base, src1, dst1 - base(src1), SIGMA)
    off = np.hypot(*(mp(src1) - plate(src1)).T)
    return mp, dict(deg=deg, n=len(src), kept=int(ok.sum()), held_p50=float(np.median(err)), held_p90=float(np.percentile(err, 90)),
                    ncc=float(np.median(sc)), off_plate_max=float(off.max()))

# ---- moving the numbers
def to_printed(xy, r, W):
    xy = np.atleast_2d(np.asarray(xy, float))
    return np.stack([W - 1 - xy[:, 1], xy[:, 0]], 1) if r == 1 else xy

def from_printed(xy, r, W):
    return np.stack([xy[:, 1], W - 1 - xy[:, 0]], 1) if r == 1 else xy

def round1(a):
    return np.round(a, 1).tolist()

def move_body(body, f):
    x = np.asarray(body['x'], float)
    t1, b1 = f(np.stack([x, body['top']], 1)), f(np.stack([x, body['bot']], 1))
    # The new stations sit under the old ones' midpoints. Each curve is read off where it landed.
    xs = f(np.stack([x, (np.asarray(body['top']) + np.asarray(body['bot'])) / 2], 1))[:, 0]
    assert (np.diff(xs) > 0).all() and (np.diff(t1[:, 0]) > 0).all() and (np.diff(b1[:, 0]) > 0).all()
    top = PchipInterpolator(t1[:, 0], t1[:, 1], extrapolate=True)(xs)
    bot = PchipInterpolator(b1[:, 0], b1[:, 1], extrapolate=True)(xs)
    return dict(x=round1(xs), top=round1(top), bot=round1(bot))

def move_fish(c, f):
    pts = lambda p: round1(f(p))
    out = dict(c)
    for k in ('head', 'tail'):
        if k in c:
            out[k] = pts([c[k]])[0]
    if 'body' in c:
        out['body'] = move_body(c['body'], f)
    if 'fins' in c:
        out['fins'] = [{**fin, 'poly': pts(fin['poly']), 'hinge': pts(fin['hinge'])} for fin in c['fins']]
    for k in ('cut', 'clear', 'solid'):
        if k in c:
            out[k] = [pts(p) for p in c[k]]
    if isinstance(c.get('trim'), dict):
        t = dict(c['trim'])
        for k in ('keep', 'open'):
            if k in t:
                t[k] = [pts(p) for p in t[k]]
        out['trim'] = t
    return out

def git_json(rev, path):
    return json.loads(subprocess.check_output(['git', '-C', ROOT, 'show', f'{rev}:{path}']))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pid')
    ap.add_argument('--from', dest='src', required=True)
    ap.add_argument('--to', dest='dst', required=True)
    ap.add_argument('--leaf', type=int)
    ap.add_argument('--report', required=True)
    ap.add_argument('--rev', default='8d7824b', help='the commit whose corrections are in the source scan')
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    man, corr = git_json(a.rev, f'manifests/{a.pid}.json'), git_json(a.rev, f'corrections/{a.pid}.json')
    A, B = lines(a.src), lines(a.dst)
    Wa, Wb = A.shape[1], B.shape[1]
    plate, st = plate_map(A, B)
    M = np.array([plate.cx[1:], plate.cy[1:]]) / plate.c[2]
    sx, sy = np.hypot(*M[:, 0]), np.hypot(*M[:, 1])
    rep = dict(plate=a.pid, size_src=[A.shape[1], A.shape[0]], size_dst=[B.shape[1], B.shape[0]], plate_fit=st,
               dst_px_per_src_px=[float(sx), float(sy)], src_px_per_dst_px=float(2 / (sx + sy)),
               rotation_deg=float(np.degrees(np.arctan2(M[1, 0], M[0, 0]))), map=plate.dump(), fish={})
    print(f"{a.pid}: {rep['src_px_per_dst_px']:.4f} src px per dst px, rot {rep['rotation_deg']:.2f} deg, {st['n']} patches, residual p50 {st['p50']:.2f} p90 {st['p90']:.2f}, ncc {st['ncc']:.2f}")
    rot0 = man.get('rotate', 0)
    new_corr, inside = dict(corr), True
    for e in man['fish']:
        slug = e.get('slug') or re.sub(r'[^a-z0-9]+', '-', e['name'].lower()).strip('-')
        r = e.get('rotate', rot0)
        if slug in corr and 'body' in corr[slug]:
            b = corr[slug]['body']
            rig = git_json(a.rev, f'assets/fish/{slug}/rig.json')
            ox, oy = rig['origin']; w, h = rig['size_plate']
            cs = to_printed([[ox, oy], [ox + w, oy], [ox, oy + h], [ox + w, oy + h]], r, Wa)
            box = (cs[:, 0].min() - 20, cs[:, 1].min() - 20, cs[:, 0].max() + 20, cs[:, 1].max() + 20)
        else:
            box = (e['at'][0] - 500, e['at'][1] - 500, e['at'][0] + 500, e['at'][1] + 500)
        mp, s = fish_map(A, B, box, plate)
        s['box_src'] = [float(v) for v in box]
        c2 = mp([box[0], box[1]])[0], mp([box[2], box[3]])[0]
        s['box_dst'] = [float(c2[0][0]), float(c2[0][1]), float(c2[1][0]), float(c2[1][1])]
        s['inside_leaf'] = bool(c2[0][0] >= 0 and c2[0][1] >= 0 and c2[1][0] <= Wb and c2[1][1] <= B.shape[0])
        rep['fish'][slug] = s
        print(f"  {slug:26s} n {s['n']:4d} kept {s.get('kept', 0):4d} held-out p50 {s.get('held_p50') or 0:.2f} p90 {s.get('held_p90') or 0:.2f} ncc {s.get('ncc') or 0:.2f} off plate {s.get('off_plate_max', 0):.1f} inside {s['inside_leaf']}")
        f = lambda xy: from_printed(mp(to_printed(xy, r, Wa)), r, Wb)
        if slug in corr:
            new_corr[slug] = move_fish(corr[slug], f)
        e['at'] = [round(v) for v in mp([e['at']])[0]]
    if a.leaf:
        man['leaf'] = a.leaf
    json.dump(rep, open(a.report, 'w'), indent=1)
    if a.write:
        json.dump(new_corr, open(f'{ROOT}/corrections/{a.pid}.json', 'w'))
        json.dump(man, open(f'{ROOT}/manifests/{a.pid}.json', 'w'), indent=1)

if __name__ == '__main__':
    main()
