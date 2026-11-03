#!/usr/bin/env python3
"""Turn each fish's rig into a mesh the shader can swim.

    python -I tools/bake.py [--plate 7198037] [--only slug ...]

For every vertex of a fine grid over the cutout:
  s   station along the body: 0 at the head line, 1 at the tail start. Off the body it is the
      station of the place the ray grows from, found by walking inside the silhouette.
  d   how far along that ray, in body lengths. 0 on the body.
  z   inflation from the body curves, in body lengths before the per-fish thickness.
  r   on a paired fin only: distance from the hinge, in body lengths.
Space: x in body lengths, 0 at mid-body, +x toward the tail; y up.
Layout of mesh.bin and its offsets are recorded in rig.json under "mesh".
"""
import argparse, glob, json, os, struct, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy import sparse
from scipy.sparse.csgraph import dijkstra

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import ROOT, dense_curves

FIELD = 3          # plate px per field px
FLOATS = 8         # x y u v s d z r

# Per body type. Wavelength and amplitude in body lengths; tempo in cycles per second.
TYPES = {
    'eel':      dict(wavelength=.72, amplitude=.065, tempo=.42, envelope=1.0, head=.12, lag=1.0, flex=.14, thick=.42, flap=.22),
    'disc':     dict(wavelength=1.5, amplitude=.075, tempo=.34, envelope=3.0, head=.00, lag=2.2, flex=.20, thick=.20, flap=.30),
    'deep':     dict(wavelength=1.2, amplitude=.095, tempo=.42, envelope=2.6, head=.02, lag=1.8, flex=.22, thick=.28, flap=.30),
    'wrasse':   dict(wavelength=1.05, amplitude=.100, tempo=.50, envelope=2.2, head=.03, lag=1.6, flex=.22, thick=.36, flap=.30),
    'fusiform': dict(wavelength=1.0, amplitude=.105, tempo=.58, envelope=2.4, head=.03, lag=1.4, flex=.24, thick=.38, flap=.30),
}

def load_alpha(path, size):
    a = Image.open(path).convert('RGBA').getchannel('A')
    return np.asarray(a.resize(size, Image.BILINEAR)).astype(np.float32) / 255

def plate_alpha(d, rig):
    """Body and fin alpha at plate resolution."""
    W, H = rig['size_plate']
    ox, oy = rig['origin']
    body = load_alpha(f'{d}/color.png', (W, H))
    fins = []
    for i, fin in enumerate(rig['fins']):
        x, y, w, h = fin['box']
        a = load_alpha(f'{d}/fin{i}-color.png', (w, h))
        fins.append((x - ox, y - oy, w, h, a))
    return body, fins

def fields(rig, body, fins):
    W, H = rig['size_plate']
    ox, oy = rig['origin']
    fw, fh = W // FIELD + 1, H // FIELD + 1
    hx, tx = rig['head'][0], rig['tail'][0]
    L = abs(tx - hx)
    full = body.copy()
    for x, y, w, h, a in fins:
        full[y:y + h, x:x + w] = np.maximum(full[y:y + h, x:x + w], a)
    M = np.asarray(Image.fromarray(full).resize((fw, fh), Image.BOX)) > .02
    M = ndi.binary_closing(M, iterations=1)
    X = (np.arange(fw) + .5) * FIELD + ox
    Y = (np.arange(fh) + .5) * FIELD + oy
    t, b = dense_curves(rig, X)
    valid = ~np.isnan(t)
    t2 = np.where(valid, t, 1e9); b2 = np.where(valid, b, -1e9)
    B = (Y[:, None] >= t2[None, :]) & (Y[:, None] <= b2[None, :])
    sx = np.clip((X - hx) / (tx - hx), 0, 1)
    s = np.broadcast_to(sx, (fh, fw)).astype(np.float32).copy()

    # Walk from the body out through the silhouette. Rays keep the station they grew from.
    idx = -np.ones((fh, fw), np.int64)
    ys, xs = np.nonzero(M | B)
    idx[ys, xs] = np.arange(len(ys))
    rows, cols, wgt = [], [], []
    for dy, dx, w in ((0, 1, 1.), (1, 0, 1.), (1, 1, 1.414), (1, -1, 1.414)):
        ny, nx = ys + dy, xs + dx
        ok = (ny >= 0) & (ny < fh) & (nx >= 0) & (nx < fw)
        a, c = idx[ys[ok], xs[ok]], idx[ny[ok], nx[ok]]
        k = c >= 0
        rows.append(a[k]); cols.append(c[k]); wgt.append(np.full(k.sum(), w))
    rows, cols, wgt = np.concatenate(rows), np.concatenate(cols), np.concatenate(wgt)
    G = sparse.csr_matrix((wgt, (rows, cols)), shape=(len(ys), len(ys)))
    seeds = idx[B & (idx >= 0)]
    dist, _, src = dijkstra(G, directed=False, indices=seeds, min_only=True, return_predecessors=True)
    dist = np.where(np.isfinite(dist), dist, 0)
    dd = np.zeros((fh, fw), np.float32)
    dd[ys, xs] = dist * FIELD / L
    root = np.where(src >= 0, src, 0)
    s2 = s.copy()
    s2[ys, xs] = s[ys[root], xs[root]]
    s2[B] = s[B]

    # Rays converge at medial lines; soften the station there so neighbours never tear.
    sig = max(2.0, .018 * L / FIELD)
    w = (M | B).astype(np.float32)
    sm = ndi.gaussian_filter(s2 * w, sig) / np.maximum(ndi.gaussian_filter(w, sig), 1e-3)
    fade = np.clip(dd / .02, 0, 1)   # exact on the body, softened out along the ray
    s3 = s2 * (1 - fade) + sm * fade
    dd = ndi.gaussian_filter(dd * w, 1.0) / np.maximum(ndi.gaussian_filter(w, 1.0), 1e-3) * (w > 0)

    # Inflate from the body curves. Tapered to nothing at the peduncle and at the snout.
    hh = np.where(valid, (b2 - t2) / 2, 0)
    cy = np.where(valid, (b2 + t2) / 2, 0)
    u = (Y[:, None] - cy[None, :]) / np.maximum(hh[None, :], 1)
    prof = np.clip(1 - u ** 2, 0, 1) * (np.abs(u) < 1)
    taper = np.clip((1 - sx) / .12, 0, 1)
    taper = taper * taper * (3 - 2 * taper)
    z = prof * (hh / L)[None, :] * taper[None, :]
    z = ndi.gaussian_filter(z.astype(np.float32), 1.2)

    # Everything off the silhouette takes its nearest neighbour, so mesh edges stay put
    known = M | B
    _, (iy, ix) = ndi.distance_transform_edt(~known, return_indices=True)
    return dict(s=s3[iy, ix], d=dd[iy, ix], z=z, L=L, fw=fw, fh=fh)

def sample(F, px, py):
    """Fields at crop-relative plate px."""
    co = np.vstack([py / FIELD - .5, px / FIELD - .5])
    return {k: ndi.map_coordinates(F[k], co, order=1, mode='nearest') for k in ('s', 'd', 'z')}

def grid_mesh(x0, y0, w, h, alpha, cell, tear=None):
    """Grid over (x0,y0,w,h) in crop px, keeping cells that hold any alpha."""
    nx, ny = int(np.ceil(w / cell)), int(np.ceil(h / cell))
    xs = x0 + np.arange(nx + 1) * w / nx
    ys = y0 + np.arange(ny + 1) * h / ny
    # any alpha in a cell, by max over the cell plus a pixel of margin
    H, W = alpha.shape
    big = ndi.maximum_filter(alpha, size=3) > .004
    sat = np.pad(big.astype(np.int64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    def count(a, b, c, d):
        return sat[d, b] - sat[c, b] - sat[d, a] + sat[c, a]
    xi = np.clip((xs - x0).round().astype(int), 0, W)
    yi = np.clip((ys - y0).round().astype(int), 0, H)
    keep = np.zeros((ny, nx), bool)
    for j in range(ny):
        keep[j] = count(xi[:-1], xi[1:], yi[j], yi[j + 1]) > 0
    return xs, ys, keep

def bake_fish(d):
    rig = json.load(open(f'{d}/rig.json'))
    body, fins = plate_alpha(d, rig)
    F = fields(rig, body, fins)
    L = F['L']
    ox, oy = rig['origin']
    W, H = rig['size_plate']
    sgn = 1.0 if rig['tail'][0] > rig['head'][0] else -1.0
    # mid-body in crop px
    cx = (rig['head'][0] + rig['tail'][0]) / 2 - ox
    cy = (rig['head'][1] + rig['tail'][1]) / 2 - oy
    cell = float(np.clip(L / 200, 4, 10))
    chunks, offs = [], []
    pos = 0

    xs, ys, keep = grid_mesh(0, 0, W, H, body, cell)
    nx, ny = len(xs), len(ys)
    PX, PY = np.meshgrid(xs, ys)
    f = sample(F, PX.ravel(), PY.ravel())
    d_ = f['d'].reshape(ny, nx); s_ = f['s'].reshape(ny, nx)
    # a cell bridging two rays that are far apart along the fish would stretch: open it instead
    corners = lambda a: np.stack([a[:-1, :-1], a[:-1, 1:], a[1:, :-1], a[1:, 1:]])
    tears = (np.ptp(corners(d_), axis=0) > .10) | (np.ptp(corners(s_), axis=0) > .18)
    torn = int((tears & keep).sum())
    keep &= ~tears
    vid = -np.ones((ny, nx), np.int64)
    used = np.zeros((ny, nx), bool)
    jj, ii = np.nonzero(keep)
    for dj, di in ((0, 0), (0, 1), (1, 0), (1, 1)):
        used[jj + dj, ii + di] = True
    vy, vx = np.nonzero(used)
    vid[vy, vx] = np.arange(len(vy))
    px, py = xs[vx], ys[vy]
    v = np.zeros((len(vy), FLOATS), np.float32)
    v[:, 0] = sgn * (px - cx) / L
    v[:, 1] = -(py - cy) / L
    v[:, 2] = px / W
    v[:, 3] = py / H
    v[:, 4] = s_[vy, vx]
    v[:, 5] = d_[vy, vx]
    v[:, 6] = f['z'].reshape(ny, nx)[vy, vx]
    a, b, c, e = vid[jj, ii], vid[jj, ii + 1], vid[jj + 1, ii], vid[jj + 1, ii + 1]
    tri = np.stack([a, b, c, b, e, c], 1).astype(np.uint32).ravel()
    def add(v, tri):
        nonlocal pos
        entry = dict(vert_off=pos, verts=len(v), idx_off=pos + v.nbytes, idx=len(tri))
        chunks.extend([v.tobytes(), tri.tobytes()])
        pos += v.nbytes + tri.nbytes
        return entry
    mesh = dict(body=add(v, tri), fins=[], L=L, cell=cell, torn=torn, floats=FLOATS)

    # Paired fins, each its own mesh, with z taken from the body they lie on
    for k, (fx, fy, fw_, fh_, fa) in enumerate(fins):
        fin = rig['fins'][k]
        cellf = float(np.clip(min(cell, max(fw_, fh_) / 28), 3, 10))
        xs_, ys_, keep_ = grid_mesh(fx, fy, fw_, fh_, fa, cellf)
        nx_, ny_ = len(xs_), len(ys_)
        jj_, ii_ = np.nonzero(keep_)
        used_ = np.zeros((ny_, nx_), bool)
        for dj, di in ((0, 0), (0, 1), (1, 0), (1, 1)):
            used_[jj_ + dj, ii_ + di] = True
        vid_ = -np.ones((ny_, nx_), np.int64)
        vy_, vx_ = np.nonzero(used_)
        vid_[vy_, vx_] = np.arange(len(vy_))
        px_, py_ = xs_[vx_], ys_[vy_]
        ff = sample(F, px_, py_)
        h0 = np.array(fin['hinge'][0], float) - (ox, oy)
        h1 = np.array(fin['hinge'][1], float) - (ox, oy)
        along = (h1 - h0) / np.linalg.norm(h1 - h0)
        n = np.array([-along[1], along[0]])
        c_ = np.array([px_.mean(), py_.mean()])
        if (c_ - h0) @ n < 0:
            n = -n
        r = np.maximum(((np.stack([px_, py_], 1) - h0) @ n) / L, 0)
        vf = np.zeros((len(vy_), FLOATS), np.float32)
        vf[:, 0] = sgn * (px_ - cx) / L
        vf[:, 1] = -(py_ - cy) / L
        vf[:, 2] = (px_ - fx) / fw_
        vf[:, 3] = (py_ - fy) / fh_
        # the same station as the body under each vertex, so the fin rides the wave and never sinks in
        vf[:, 4] = ff['s']
        vf[:, 5] = 0
        vf[:, 6] = ff['z']
        vf[:, 7] = r
        a, b, c, e = vid_[jj_, ii_], vid_[jj_, ii_ + 1], vid_[jj_ + 1, ii_], vid_[jj_ + 1, ii_ + 1]
        trif = np.stack([a, b, c, b, e, c], 1).astype(np.uint32).ravel()
        entry = add(vf, trif)
        entry['hinge_n'] = [float(sgn * n[0]), float(-n[1])]
        mesh['fins'].append(entry)

    with open(f'{d}/mesh.bin', 'wb') as fp:
        for c_ in chunks:
            fp.write(c_)
    rig['mesh'] = mesh
    rig['swim'] = dict(TYPES.get(rig.get('type', 'wrasse'), TYPES['wrasse']), **rig.get('swim_override', {}))
    # extents in fish space, for framing
    allv = np.frombuffer(chunks[0], np.float32).reshape(-1, FLOATS)
    rig['extent'] = [float(allv[:, 0].min()), float(allv[:, 0].max()), float(allv[:, 1].min()), float(allv[:, 1].max())]
    with open(f'{d}/rig.json', 'w') as fp:
        json.dump(rig, fp, indent=1)
    print(f"{rig['slug']:24s} L={L:6.0f} cell={cell:4.1f} body v={mesh['body']['verts']:6d} t={mesh['body']['idx'] // 3:6d} torn={torn:4d} "
          f"fins={[e['verts'] for e in mesh['fins']]}  s[{v[:, 4].min():.2f},{v[:, 4].max():.2f}] d<{v[:, 5].max():.2f} z<{v[:, 6].max():.3f} {os.path.getsize(f'{d}/mesh.bin') // 1024}K")
    return rig

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=f'{ROOT}/assets/fish')
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    meta = json.load(open(sorted(glob.glob(f'{a.root}/plate-*.json'))[0]))
    rigs = []
    for slug in meta['fish']:
        if a.only and slug not in a.only:
            continue
        rigs.append(bake_fish(f'{a.root}/{slug}'))
    if not a.only:
        idx = dict(paper=meta['paper'], ink=meta['ink'], credit=meta['credit'], fish=meta['fish'])
        with open(f'{a.root}/index.json', 'w') as fp:
            json.dump(idx, fp, indent=1)

if __name__ == '__main__':
    main()
