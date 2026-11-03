#!/usr/bin/env python3
"""Cut every fish out of one Renard plate.

    python -I tools/extract.py "File:Poissons, ecrevisses et crabes 1754 (7198037).jpg"

Reads   manifests/<id>.json      names and facing, written by hand
        corrections/<id>.json    hand-made fixes (optional), see correct.html
Writes  assets/fish/<slug>/color.png  his color, straight alpha, edge unmixed from the paper
        assets/fish/<slug>/ink.png    his line, ink color with alpha; solid blacks stay filled
        assets/fish/<slug>/rig.json   body curves, head, tail, paired fins, facing
"""
import argparse, json, os, re, sys, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import color, measure, morphology, segmentation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = 'renard-water/0.1 (art piece; https://github.com/daryadaneshmand/renard) python-urllib'
MAX_TEX = 2048

# ---------------------------------------------------------------- source
def plate_id(title):
    m = re.search(r'\((\d+)\)', title)
    return m.group(1) if m else re.sub(r'\W+', '_', title)

def fetch(title):
    """Cached original from Commons. One request, descriptive agent."""
    pid = plate_id(title)
    path = os.path.join(ROOT, 'cache', pid + '.jpg')
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    api = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(dict(
        action='query', titles=title, prop='imageinfo', iiprop='url', format='json'))
    rq = urllib.request.Request(api, headers={'User-Agent': UA})
    pages = json.load(urllib.request.urlopen(rq, timeout=60))['query']['pages']
    url = next(iter(pages.values()))['imageinfo'][0]['url']
    time.sleep(1)
    rq = urllib.request.Request(url, headers={'User-Agent': UA})
    data = urllib.request.urlopen(rq, timeout=300).read()
    with open(path, 'wb') as f:
        f.write(data)
    return path

# ---------------------------------------------------------------- paper
def paper_field(lab):
    """A smooth local estimate of the paper in Lab, so foxing and page tone stay paper."""
    sm = lab[::8, ::8]
    pm = sm[..., 0] > np.percentile(sm[..., 0], 40)
    for _ in range(4):
        w = ndi.gaussian_filter(pm.astype(np.float32), 30)
        bg = np.stack([ndi.gaussian_filter(sm[..., i] * pm, 30) / np.maximum(w, 1e-3) for i in range(3)], -1)
        pm = np.sqrt(((sm - bg) ** 2).sum(-1)) < 5
    out = np.stack([np.asarray(Image.fromarray(bg[..., i]).resize((lab.shape[1], lab.shape[0]), Image.BILINEAR))
                    for i in range(3)], -1)
    return out

def hysteresis(de, low, high):
    lbl, n = ndi.label(de > low)
    keep = np.zeros(n + 1, bool)
    keep[np.unique(lbl[de > high])] = True
    keep[0] = False
    return keep[lbl]

def solid_mask(de, low, high, wide=7):
    """Everything that is fish. Pale interiors count; slots between fin rays do not.

    Paper is flooded in from the page edge. A pale patch reached only through a break
    in an engraved outline is interior if it is too fat to be a slot between rays.
    """
    raw = hysteresis(de, low, high)
    raw = morphology.remove_small_objects(raw, max_size=30)
    sealed = ndi.binary_dilation(raw, iterations=1)
    tight = ndi.binary_fill_holes(sealed)
    closed = ndi.binary_fill_holes(ndi.binary_closing(np.pad(raw, wide + 2), morphology.disk(wide)))[wide + 2:-wide - 2, wide + 2:-wide - 2]
    candidates = closed & ~tight          # reachable only through a gap narrower than 2*wide
    lbl, n = ndi.label(candidates)
    solid = tight.copy()
    if n:
        fat = ndi.maximum(ndi.distance_transform_edt(candidates), lbl, np.arange(1, n + 1))
        keep = np.zeros(n + 1, bool)
        keep[1:] = fat >= wide - 1
        solid |= keep[lbl]
    return solid, raw

# ---------------------------------------------------------------- matte
def unmix(rgb, de, m, paper_rgb, f_hi=22.0):
    """Straight-alpha cutout with no paper in the edge.

    For a pixel in the edge band c = a*f + (1-a)*p, where f is the fish color just inside
    and p the local paper. Solve for a and store f, so the edge is fish at any opacity.
    """
    inner = ndi.binary_erosion(m, iterations=2)
    strong = m & (de > f_hi)
    core = inner | strong
    if not core.any():
        core = m
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    f = rgb[iy, ix]
    diff = f - paper_rgb
    den = (diff ** 2).sum(-1)
    a = ((rgb - paper_rgb) * diff).sum(-1) / np.maximum(den, 1e-5)
    a = np.clip(a, 0, 1)
    geo = np.clip(ndi.gaussian_filter(m.astype(np.float32), 0.8) * 2 - 0.5, 0, 1)
    weak = den < (0.10 ** 2)      # pale fish against pale paper: color says nothing, use shape
    a = np.where(weak, geo, a)
    a = np.minimum(a, np.clip(ndi.gaussian_filter(ndi.binary_dilation(m, iterations=1).astype(np.float32), 0.7) * 1.6, 0, 1))
    a = np.where(core, 1.0, a)
    # a fish cannot hold low-alpha specks away from its own body
    return f, a

# ---------------------------------------------------------------- line
def line_layer(L, chroma, m, cfg):
    """His engraved line as continuous alpha. Thin darks by black top-hat, plus filled solids."""
    Ls = ndi.gaussian_filter(L, cfg.get('blur', 0.6))
    closed = ndi.grey_closing(Ls, footprint=morphology.disk(cfg.get('reach', 6)))
    hat = closed - Ls
    line = np.clip((hat - cfg['hat_lo']) / (cfg['hat_hi'] - cfg['hat_lo']), 0, 1)
    if 'coarse' in cfg:
        # For a fish drawn in wash lines: its broad strokes, from the plate, under a lighter hatch
        b, r, lo, hi = cfg['coarse']
        Lb = ndi.gaussian_filter(L, b)
        line = np.maximum(line, np.clip((ndi.grey_closing(Lb, footprint=morphology.disk(r)) - Lb - lo) / (hi - lo), 0, 1))
    # solids: truly dark, low chroma. The painted blacks are blotchy, so close and fill small gaps.
    dark = (Ls < cfg['black_L']) & (chroma < cfg['black_C'])
    dark = morphology.remove_small_objects(dark, max_size=10)
    lbl, n = ndi.label(dark)
    solid = dark
    if n:
        blob = ndi.binary_closing(np.pad(dark, 6), morphology.disk(2))[6:-6, 6:-6]
        blob = morphology.remove_small_holes(blob, max_size=cfg['black_hole'])
        solid = dark | blob
    sol = np.clip(ndi.gaussian_filter(solid.astype(np.float32), 0.7) * 1.5 - 0.25, 0, 1)
    ink = np.maximum(line, sol)
    return ink, solid

# ---------------------------------------------------------------- body fit
def edge_curves(m):
    """Per-column silhouette top and bottom."""
    w = m.shape[1]
    top = np.full(w, np.nan)
    bot = np.full(w, np.nan)
    any_ = m.any(0)
    top[any_] = m.argmax(0)[any_]
    bot[any_] = m.shape[0] - 1 - m[::-1].argmax(0)[any_]
    return top, bot

def lower_envelope(y, lam, iters=12, asym=0.02):
    """Smooth curve that hugs the small values of y, ignoring upward excursions (fins)."""
    from scipy.sparse import diags, eye
    from scipy.sparse.linalg import spsolve
    n = len(y)
    D = diags([1., -2., 1.], [0, 1, 2], shape=(n - 2, n))
    P = lam * D.T @ D
    wgt = np.ones(n)
    z = y.copy()
    for _ in range(iters):
        W = diags(wgt)
        z = spsolve((W + P).tocsc(), wgt * y)
        wgt = np.where(y > z, asym, 1 - asym)
    return z

def fit_body(m, facing):
    """Automatic body fit. Rough on purpose: the hand pass in corrections/ has the last word.

    Opening removes rays and spines; asymmetric smoothing then refuses to follow fins
    away from the body on either side.
    """
    h, w = m.shape
    r = max(3, int(0.05 * min(h, w)))
    small = m[::2, ::2]
    op = morphology.opening(small, morphology.disk(max(2, r // 2)))
    op = np.asarray(Image.fromarray((op * 255).astype('uint8')).resize((w, h), Image.NEAREST)) > 0
    lbl, n = ndi.label(op)
    if n == 0:
        op = m
    elif n > 1:
        op = lbl == (np.argmax(np.bincount(lbl.ravel())[1:]) + 1)
    top, bot = edge_curves(op)
    cols = np.where(~np.isnan(top))[0]
    c0, c1 = cols[0], cols[-1]
    xs = np.arange(c0, c1 + 1)
    t = np.interp(xs, cols, top[cols]); b = np.interp(xs, cols, bot[cols])
    lam = (0.25 * len(xs)) ** 2
    # Note the sign: top is small y, so a fin above is a small value. Hug large values of top.
    tt = -lower_envelope(-t, lam)
    bb = lower_envelope(b, lam)
    good = bb - tt > 2
    th = bb - tt
    # tail start: where the silhouette, walking from the tail, reaches its narrowest neck
    prof = th.copy()
    span = len(xs)
    if facing == 'left':
        win = np.arange(int(0.55 * span), int(0.97 * span))
    else:
        win = np.arange(int(0.03 * span), int(0.45 * span))
    tail_i = win[np.argmin(prof[win])]
    return dict(xs=xs, top=tt, bot=bb, tail=int(xs[tail_i]), head=int(xs[0] if facing == 'left' else xs[-1]))

def stations(fit, facing, n=24):
    x0, x1 = (fit['head'], fit['tail']) if facing == 'left' else (fit['tail'], fit['head'])
    st = np.linspace(x0, x1, n)
    return st, np.interp(st, fit['xs'], fit['top']), np.interp(st, fit['xs'], fit['bot'])

# ---------------------------------------------------------------- plate
CFG = dict(low=8.0, high=16.0, wide=7, hat_lo=6.0, hat_hi=17.0, black_L=36.0, black_C=20.0, black_hole=400)

def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def analyse_plate(path, page=(.03, .05, .94, .95), cfg=CFG, rotate=0):
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    if rotate:      # some plates print the fish head up: k quarter turns counterclockwise
        im = np.rot90(im, rotate).copy()
    H, W, _ = im.shape
    x0, y0, x1, y1 = int(page[0] * W), int(page[1] * H), int(page[2] * W), int(page[3] * H)
    rgb = im[y0:y1, x0:x1]
    lab = color.rgb2lab(rgb).astype(np.float32)
    bg = paper_field(lab)
    # Distance from paper counts darkening and color, never lightening. The scan is sharpened,
    # so paper beside a black edge overshoots brighter than paper. That glow is the halo.
    # Overshoot also bleaches: paper that is lighter and less yellow than paper is still paper.
    dv = lab - bg
    dv[..., 0] = np.minimum(dv[..., 0], 0)
    de = np.sqrt((dv ** 2).sum(-1))
    bleached = (lab[..., 0] > bg[..., 0] - 2) & (np.hypot(lab[..., 1], lab[..., 2]) < np.hypot(bg[..., 1], bg[..., 2]) + 3)
    de[bleached] = np.minimum(de[bleached], 2.0)
    paper_rgb = color.lab2rgb(bg[::8, ::8]).astype(np.float32)
    paper_rgb = np.asarray(Image.fromarray((paper_rgb * 255).astype('uint8')).resize((rgb.shape[1], rgb.shape[0]), Image.BILINEAR)).astype(np.float32) / 255
    solid, raw = solid_mask(de, cfg['low'], cfg['high'], cfg['wide'])
    return dict(rgb=rgb, lab=lab, de=de, paper=paper_rgb, solid=solid, raw=raw, offset=(x0, y0), bg=bg)

def components(A, min_frac=0.0015):
    lbl = measure.label(A['solid'], connectivity=2)
    props = [p for p in measure.regionprops(lbl) if p.area > min_frac * lbl.size]
    return lbl, props

# ---------------------------------------------------------------- one fish
PAD = 12

def poly_mask(shape, pts, origin=(0, 0)):
    from skimage.draw import polygon
    pts = np.asarray(pts, float)
    rr, cc = polygon(pts[:, 1] - origin[1], pts[:, 0] - origin[0], shape)
    out = np.zeros(shape, bool)
    out[rr, cc] = True
    return out

def body_polygon(rig):
    b = rig['body']
    return np.column_stack([b['x'] + b['x'][::-1], b['top'] + b['bot'][::-1]])

def dense_curves(rig, xs):
    """Body top and bottom at any x, by monotone interpolation of the stations."""
    from scipy.interpolate import PchipInterpolator as P
    b = rig['body']
    x = np.asarray(b['x'], float)
    order = np.argsort(x)
    x = x[order]
    t = P(x, np.asarray(b['top'], float)[order], extrapolate=False)(xs)
    u = P(x, np.asarray(b['bot'], float)[order], extrapolate=False)(xs)
    return t, u

def body_mask(shape, rig, origin):
    b = rig['body']
    xs = np.arange(shape[1]) + origin[0]
    t, u = dense_curves(rig, xs)
    Y = np.arange(shape[0])[:, None] + origin[1]
    return (Y >= t[None, :]) & (Y <= u[None, :])

def clean_specks(mask, de, keep_de=26.0):
    """Stipple and foxing caught on the silhouette. Thin things with real ink in them stay."""
    op = ndi.binary_opening(mask, iterations=3)
    spur = mask & ~op
    lbl, n = ndi.label(spur)
    if not n:
        return mask
    idx = np.arange(1, n + 1)
    area = ndi.sum(spur, lbl, idx)
    peak = ndi.maximum(de, lbl, idx)
    drop = np.zeros(n + 1, bool)
    drop[1:] = (area < 60) & (peak < keep_de)
    out = mask & ~drop[lbl]
    lbl, n = ndi.label(out)
    if n > 1:
        out = lbl == (np.argmax(np.bincount(lbl.ravel())[1:]) + 1)
    return out

def pushpull(rgb, known):
    """Quiet color fill for what the paired fin was covering. Seen only as the fin lifts."""
    levels = [(rgb * known[..., None], known.astype(np.float32))]
    while min(levels[-1][1].shape) > 2:
        c, w = levels[-1]
        h2, w2 = c.shape[0] // 2, c.shape[1] // 2
        cc = c[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2, 3).sum((1, 3))
        ww = w[:h2 * 2, :w2 * 2].reshape(h2, 2, w2, 2).sum((1, 3))
        levels.append((cc, ww))
    c, w = levels[-1]
    fill = c / np.maximum(w, 1e-4)[..., None]
    for c, w in reversed(levels[:-1]):
        up = np.stack([np.asarray(Image.fromarray(fill[..., i]).resize((w.shape[1], w.shape[0]), Image.BILINEAR))
                       for i in range(3)], -1)
        cur = c / np.maximum(w, 1e-4)[..., None]
        fill = np.where(w[..., None] > 0, cur, up)
    return np.where(known[..., None], rgb, fill)

def to_png(path, rgb, a, scale):
    arr = np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])
    img = Image.fromarray((arr * 255 + .5).astype('uint8'), 'RGBA')
    if scale != 1:
        # rgb is already extended past the edge, so color and alpha resample independently
        size = (round(arr.shape[1] * scale), round(arr.shape[0] * scale))
        out = [np.asarray(Image.fromarray(arr[..., i].astype(np.float32)).resize(size, Image.LANCZOS)) for i in range(4)]
        img = Image.fromarray((np.clip(np.dstack(out), 0, 1) * 255 + .5).astype('uint8'), 'RGBA')
    img.save(path, optimize=False, compress_level=6)
    return img.size

def cut_fish(A, lbl, prop, entry, corr, plate, outdir, ink_rgb):
    a0, c0, a1, c1 = prop.bbox
    h, w = lbl.shape
    a0, c0, a1, c1 = max(0, a0 - PAD), max(0, c0 - PAD), min(h, a1 + PAD), min(w, c1 + PAD)
    ox, oy = A['offset'][0] + c0, A['offset'][1] + a0      # plate px of the crop's corner
    origin = (ox, oy)
    sl = (slice(a0, a1), slice(c0, c1))
    rgb, de, paper, Lab = A['rgb'][sl], A['de'][sl], A['paper'][sl], A['lab'][sl]
    m = lbl[sl] == prop.label
    m = clean_specks(m, de)
    facing = corr.get('facing', entry.get('facing', 'left'))

    # the hand pass may add fish where the color gave out and remove what is not fish
    for poly in corr.get('solid', []):
        m |= poly_mask(m.shape, poly, origin)
    for poly in corr.get('cut', []):
        m &= ~poly_mask(m.shape, poly, origin)

    fit = fit_body(m, facing)
    st, t, b = stations(fit, facing)
    rig = dict(name=entry['name'], slug=slugify(entry['name']), number=entry.get('number'), type=entry.get('type', 'wrasse'),
               facing=facing, plate=dict(title=plate['title'], folio=plate.get('folio')),
               origin=[int(ox), int(oy)], size_plate=[int(c1 - c0), int(a1 - a0)],
               head=[float(fit['head']) + ox, float((np.interp(fit['head'], fit['xs'], fit['top']) + np.interp(fit['head'], fit['xs'], fit['bot'])) / 2) + oy],
               tail=[float(fit['tail']) + ox, float((np.interp(fit['tail'], fit['xs'], fit['top']) + np.interp(fit['tail'], fit['xs'], fit['bot'])) / 2) + oy],
               body=dict(x=(st + ox).round(1).tolist(), top=(t + oy).round(1).tolist(), bot=(b + oy).round(1).tolist()),
               fins=[], source='auto')
    for k in ('head', 'tail', 'body', 'fins', 'type'):
        if k in corr:
            rig[k] = corr[k]
    if {'body'} & set(corr):
        rig['source'] = 'hand'

    bm = body_mask(m.shape, rig, origin)
    if corr.get('fill_body'):
        # inside the body line it is fish, however pale. Kamboton's white needs this.
        m |= ndi.binary_erosion(bm, iterations=3)
    m = ndi.binary_fill_holes(m)
    for poly in corr.get('cut', []):
        m &= ~poly_mask(m.shape, poly, origin)

    f, alpha = unmix(rgb, de, m, paper)
    # ink
    L = Lab[..., 0]
    chroma = np.hypot(Lab[..., 1], Lab[..., 2])
    ink, solid = line_layer(L, chroma, m, {**CFG, **corr.get('ink', {})})
    outer = np.clip(ndi.gaussian_filter(ndi.binary_dilation(m, iterations=1).astype(np.float32), .7) * 1.6, 0, 1)
    ink = ink * outer

    os.makedirs(outdir, exist_ok=True)
    scale = min(1.0, MAX_TEX / max(rgb.shape[:2]))
    rig['tex_scale'] = scale

    # paired fins: lift each onto its own layer, then quietly fill what it was covering
    body_rgb, body_a, body_ink = f.copy(), alpha.copy(), ink.copy()
    all_fin = np.zeros(m.shape, bool)
    for i, fin in enumerate(rig['fins']):
        pm = fin_region(fin, rgb, L, m, bm, origin)
        all_fin |= pm
        soft = np.clip(ndi.gaussian_filter(pm.astype(np.float32), .8), 0, 1)
        fa, fi = alpha * soft, ink * soft
        ys, xs = np.where(soft > .01)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        to_png(f'{outdir}/fin{i}-color.png', f[y0:y1, x0:x1], fa[y0:y1, x0:x1], scale)
        to_png(f'{outdir}/fin{i}-ink.png', np.broadcast_to(ink_rgb, (y1 - y0, x1 - x0, 3)), fi[y0:y1, x0:x1], scale)
        fin['box'] = [int(x0 + ox), int(y0 + oy), int(x1 - x0), int(y1 - y0)]
    if all_fin.any():
        grown = ndi.binary_dilation(all_fin, iterations=3)
        # Fill from the wash only: no engraved line and no small spot may bleed in as gray.
        # Wide solids stay, so a fin lying across Bezaan's black band keeps black under it.
        wide = morphology.opening(solid, morphology.disk(14))
        known = m & ~ndi.binary_dilation(all_fin, iterations=7) & ~((ink > .15) & ~wide)
        filled = pushpull(rgb, known)
        soft = np.clip(ndi.gaussian_filter(grown.astype(np.float32), 1.0), 0, 1)
        body_rgb = np.where(grown[..., None], filled, f)
        inside = ndi.binary_erosion(bm, iterations=1)
        body_a = np.where(all_fin | grown, np.where(inside, 1.0, alpha * (1 - soft)), alpha)
        # keep the rest of the silhouette exact, take the fin's line away
        body_ink = ink * (1 - soft)

    size = to_png(f'{outdir}/color.png', body_rgb, body_a, scale)
    to_png(f'{outdir}/ink.png', np.broadcast_to(ink_rgb, ink.shape + (3,)), body_ink, scale)
    rig['tex_size'] = list(size)
    with open(f'{outdir}/rig.json', 'w') as fp:
        json.dump(rig, fp, indent=1)
    return rig, dict(rgb=f, alpha=alpha, ink=ink, m=m, solid=solid, origin=origin, de=de, paper=paper)

def fin_region(fin, rgb, L, m, bm, origin):
    """Snap a rough hand polygon to the engraved outline of the fin.

    Over the body the outline decides. Past the body line the silhouette already does,
    so a fin hanging free only needs a generous polygon."""
    pm = poly_mask(m.shape, fin['poly'], origin)
    inner = ndi.binary_erosion(pm, iterations=8)
    outer = ~ndi.binary_dilation(pm, iterations=9)
    if not inner.any():
        return pm & m
    markers = np.zeros(m.shape, np.int32)
    markers[outer] = 1
    markers[inner] = 2
    ys, xs = np.where(ndi.binary_dilation(pm, iterations=8))
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    grad = ndi.gaussian_gradient_magnitude(L[y0:y1, x0:x1], 1.0)
    lab = segmentation.watershed(grad, markers[y0:y1, x0:x1])
    out = np.zeros(m.shape, bool)
    out[y0:y1, x0:x1] = lab == 2
    # the fin's own outline is dark and belongs with the fin
    # Fin rays are strong edges too, so the watershed can stop on an inner ray. The polygon is a floor.
    out = ndi.binary_dilation(out | pm, iterations=4) & m
    out |= ndi.binary_dilation(pm, iterations=8) & ~bm & m
    return out

# ---------------------------------------------------------------- run
def sample_ink(A):
    """The plate's own black, from its darkest low-chroma pixels."""
    L = A['lab'][..., 0]
    C = np.hypot(A['lab'][..., 1], A['lab'][..., 2])
    sel = (L < np.percentile(L[A['solid']], 5)) & (C < 20) & A['solid']
    return np.median(A['rgb'][sel], axis=0)

def run(title, only=None, out_root=None, report=True):
    pid = plate_id(title)
    path = fetch(title)
    manifest = json.load(open(f'{ROOT}/manifests/{pid}.json'))
    corrpath = f'{ROOT}/corrections/{pid}.json'
    corrections = json.load(open(corrpath)) if os.path.exists(corrpath) else {}
    rot = manifest.get('rotate', 0)
    W0, _ = Image.open(path).size
    A = analyse_plate(path, page=tuple(manifest.get('page', (.03, .05, .94, .95))), rotate=rot)
    lbl, props = components(A)
    out_root = out_root or f'{ROOT}/assets/fish'
    ink_rgb = sample_ink(A)
    paper_rgb = np.median(A['paper'].reshape(-1, 3), axis=0)
    ox, oy = A['offset']
    # claim components by the manifest's rough point
    # 'at' is always read off the plate as printed
    at = [(e['at'][1], W0 - 1 - e['at'][0]) if rot == 1 else tuple(e['at']) for e in manifest['fish']]
    pts = [(x - ox, y - oy) for x, y in at]
    used, results, problems = {}, [], []
    for e, (x, y) in zip(manifest['fish'], pts):
        best, bestd = None, 1e18
        for p in props:
            cy, cx = p.centroid
            hit = 0 <= int(y) < lbl.shape[0] and 0 <= int(x) < lbl.shape[1] and lbl[int(y), int(x)] == p.label
            d = 0 if hit else np.hypot(cx - x, cy - y)
            if d < bestd:
                best, bestd = p, d
        if best is None:
            problems.append((e['name'], 'no component'))
            continue
        if best.label in used:
            problems.append((e['name'], f"same component as {used[best.label]}: merged"))
        used.setdefault(best.label, e['name'])
        slug = slugify(e['name'])
        if only and slug not in only:
            continue
        corr = corrections.get(slug, {})
        rig, dbg = cut_fish(A, lbl, best, e, corr, manifest, f'{out_root}/{slug}', ink_rgb)
        results.append((rig, dbg))
    unclaimed = [p for p in props if p.label not in used]
    meta = dict(title=title, id=pid, paper=[float(v) for v in paper_rgb], ink=[float(v) for v in ink_rgb],
                fish=[r[0]['slug'] for r in results], credit='Louis Renard, 1754 edition, via Polona and Wikimedia Commons')
    os.makedirs(out_root, exist_ok=True)
    with open(f'{out_root}/plate-{pid}.json', 'w') as fp:
        json.dump(meta, fp, indent=1)
    if report:
        print(f'{pid}: {len(props)} components over size, {len(manifest["fish"])} in manifest, '
              f'{len(unclaimed)} unclaimed, {len(problems)} problems {problems}')
        print('paper', meta['paper'], 'ink', meta['ink'])
    return A, results, problems, unclaimed

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('title')
    ap.add_argument('--only', nargs='*')
    ap.add_argument('--out')
    a = ap.parse_args()
    run(a.title, a.only, a.out)
