# Renard

Louis Renard's fish, cut from his 1754 plates and swimming live in the browser. Credit: Louis Renard, 1754 edition, via Polona and Wikimedia Commons (`Category:Poissons,_ecrevisses_et_crabes_(1754)`, public domain). Local only for now.

Status: extraction, correction and rig are built for Fol. 3 (10 fish). The water (`index.html`) is the next milestone.

## Run it

    python3 -I -m http.server 8918 --bind 127.0.0.1 --directory .

- `/swim.html` is the rig bench: pick a fish, five knobs (Wavelength, Tail Amplitude, Tempo, Envelope, Fin Lag), key `i` switches color and ink. `?fish=bezaan`, `?still=1`, `?hide=1`, `?w=&h=`.
- `/tools/correct.html` is the correction tool: drag the body line, head and tail, box a paired fin, box out caption text welded to a fish. Save downloads `corrections/<plate id>.json` whole.

## Rebuild a plate

Python with numpy, pillow, scipy, scikit-image. Run with `-I`.

    python -I tools/extract.py "File:Poissons, ecrevisses et crabes 1754 (7198037).jpg"
    python -I tools/bake.py
    python -I tools/sheet.py assets/fish sheet.png

`extract.py` downloads the original once into the gitignored `cache/`, with a descriptive User-Agent. It reads `manifests/<id>.json` (written by hand: names, facing, a rough point on each fish, `rotate` for plates printed head up) and `corrections/<id>.json` (body lines, fins, `solid`, `cut`, `fill_body`). All rig coordinates are plate pixels. Add `--out <dir>` to try a plate without touching `assets/`.

Checks, with Playwright installed outside the repo (`NODE_PATH=<dir>/node_modules`) and the server running:

    node tools/capture.cjs frames <dir>      8 phases, both looks, every fish
    python -I tools/phasesheet.py <dir> <out>
    node tools/capture.cjs readback <dir>    vertex shader output through transform feedback
    python -I tools/check_wave.py <dir>      that output against the equation, plus triangle stretch
    node tools/capture.cjs tempo bezaan      tempo changes mid-swim: nothing may jump
    node tools/capture.cjs perf              frame time with all rigs drawn
    node tools/capture.cjs clip <dir> <slug> [frames] [look]

## How the pieces work

**Cut.** Distance from a smooth local paper estimate in Lab, counting darkening and color but never lightening, because the scan is sharpened and paper beside a black edge glows brighter than paper. Edge pixels are unmixed against the local paper and hold the fish's color at any opacity, so there is no halo. Slots between fin rays stay open; pale interiors are kept.

**Line.** Black top-hat for thin darks, plus solids (dark and low chroma) filled in, as continuous alpha. Ink color is sampled from the plate.

**Paired fins.** Each fin lifts onto its own layer. What it was covering is filled from nearby wash, with no line or spots. That fill is the only paint in the piece that is not on the plate, and it only shows as a fin lifts.

**Swim.** `rig.js`, vertex shader, WebGL2, no libraries, no build:

    offset = A(s) * sin(k*s - phase - lag*d)

`s` runs head to tail along the body; `d` runs out along a fin ray, measured inside the silhouette, so rays keep the station they grew from. Phase accumulates, so tempo changes never jump. The mesh is inflated from the body curves and depth tested, so the fish occludes itself. Paired fins hinge, tip behind root. Per-type defaults are in `TYPES` in `tools/bake.py`.

**Ground and line color** on the bench come from the plate (`assets/fish/index.json`). The water's look is Darya's call.

## The water

`index.html` is the piece. Its look is one block of constants at the top of that file: ground, line, strength, weight, motion. `water.js` holds the rest: each fish gets one long path that begins and ends where it cannot be seen, either past the window's side or so far off that haze has taken it. Nothing knows about the window's edges, so nothing can turn at one.

- `i` switches color and ink.
- `?arrive=1` is one fish, one crossing, then an empty, still window with the render loop stopped. `?fish=<slug>` picks the fish, `?credit` shows the credit line.
- `?seed=<n>` repeats a run. `?manual=1` is for tools/water_check.cjs: no loop, driven by script.
- `prefers-reduced-motion` gives near-still drift with two fish.
