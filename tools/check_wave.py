#!/usr/bin/env python3
"""Does the shader do what the equation says? And does the mesh smear?

    python -I tools/check_wave.py <readback dir> [slug ...]

Recomputes every vertex from mesh.bin and the documented equation, independently of the GLSL, and
compares to the clip coordinates the vertex shader wrote through transform feedback.
Then measures how far any triangle gets stretched on screen: a smear shows up as a large
ratio between a triangle's edges on screen and the same edges on the plate.
"""
import glob, json, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

def expected(v, sw, phase, hinge, model, vp):
    x, y, s0, d, z, r = v[:, 0], v[:, 1], v[:, 4], v[:, 5], v[:, 6], v[:, 7]
    s = np.clip(s0, 1e-4, 1)
    k = 2 * np.pi / sw['wavelength']
    u, env, h, lag, flex = sw['amplitude'], sw['envelope'], sw['head'], sw['lag'], sw['flex']
    A = u * (h + (1 - h) * s ** env)
    dA = u * (1 - h) * env * s ** (env - 1)
    F = flex * d / (1 + .6 * d)
    dF = flex / (1 + .6 * d) ** 2
    ph = k * s - phase - lag * d
    sn, cs = np.sin(ph), np.cos(ph)
    off = (A + F) * sn
    t = smoothstep(.96, 1, s) * smoothstep(0, .03, d)
    slope = (dA * sn + A * k * cs) * (1 - t) + (dF * sn - (A + F) * lag * cs) * t
    px = x - .5 * slope * off
    py = y.copy()
    pz = sw['thick'] * z + off
    if hinge[0] or hinge[1]:
        al = sw['flap'] * (.5 + .5 * np.sin(.5 * phase - 2 * lag * r))
        m = r > 0
        px = px - np.where(m, hinge[0] * r * (1 - np.cos(al)), 0)
        py = py - np.where(m, hinge[1] * r * (1 - np.cos(al)), 0)
        pz = pz + np.where(m, r * np.sin(al), 0) + .002
    P = np.stack([px, py, pz, np.ones_like(px)], 1)
    M = np.array(vp, float).reshape(4, 4, order='F') @ np.array(model, float).reshape(4, 4, order='F')
    return P @ M.T

def main():
    src = sys.argv[1]
    slugs = sys.argv[2:] or sorted(os.path.basename(f)[:-5] for f in glob.glob(f'{src}/*.json'))
    worst = 0
    print(f"{'fish':24s} {'max clip err':>12s}  {'stretch max':>11s} {'squeeze min':>11s} {'flipped':>8s}  tail stretch")
    for slug in slugs:
        d = f'{ROOT}/assets/fish/{slug}'
        rig = json.load(open(f'{d}/rig.json'))
        bin_ = open(f'{d}/mesh.bin', 'rb').read()
        res = json.load(open(f'{src}/{slug}.json'))
        err = 0
        smax, smin, flips, tail = 0, 9, 0, 0
        for r in res:
            e = rig['mesh']['body'] if r['part'] < 0 else rig['mesh']['fins'][r['part']]
            v = np.frombuffer(bin_, np.float32, e['verts'] * rig['mesh']['floats'], e['vert_off']).reshape(-1, rig['mesh']['floats']).astype(np.float64)
            got = np.array(r['clip'], float).reshape(-1, 4)
            want = expected(v, r['swim'], r['phase'], r['hingeN'], r['model'], r['vp'])
            # in normalised device units: the size that would move a pixel
            gn, wn = got[:, :3] / got[:, 3:], want[:, :3] / want[:, 3:]
            err = max(err, float(np.abs(gn[:, :2] - wn[:, :2]).max()))
            if r['part'] < 0:
                tri = np.frombuffer(bin_, np.uint32, e['idx'], e['idx_off']).reshape(-1, 3)
                # compare screen edges to rest edges, in x only: the wave acts along x
                a, b, c = tri.T
                # rest: fish plane; screen: NDC scaled back by rest-pose factor
                rest = v[:, :2]
                scr = gn[:, :2]
                sc = np.median(np.abs(scr[:, 1] - scr[:, 1].mean())) / max(np.median(np.abs(rest[:, 1] - rest[:, 1].mean())), 1e-6)
                aspect = 1000 / 620
                sxy = scr * np.array([aspect, 1]) / sc
                e1r, e2r = rest[b] - rest[a], rest[c] - rest[a]
                e1s, e2s = sxy[b] - sxy[a], sxy[c] - sxy[a]
                area_r = e1r[:, 0] * e2r[:, 1] - e1r[:, 1] * e2r[:, 0]
                area_s = e1s[:, 0] * e2s[:, 1] - e1s[:, 1] * e2s[:, 0]
                ratio = area_s / np.where(np.abs(area_r) < 1e-12, 1e-12, area_r)
                flips += int((ratio < 0).sum())
                smax = max(smax, float(np.percentile(ratio, 99.9)))
                smin = min(smin, float(np.percentile(ratio, .1)))
                tailm = v[a, 4] > .9
                if tailm.any():
                    tail = max(tail, float(np.abs(ratio[tailm]).max()))
        worst = max(worst, err)
        print(f"{slug:24s} {err:12.2e}  {smax:11.2f} {smin:11.2f} {flips:8d}  {tail:.2f}")
    px = worst * 500
    print(f'worst vertex error {worst:.2e} NDC, about {px:.4f} px at 1000 px wide')
    print('PASS' if px < .05 else 'FAIL')
    return 0 if px < .05 else 1

if __name__ == '__main__':
    sys.exit(main())
