# Renard

Louis Renard's fish, cut from his 1754 plates and swimming live in the browser. Credit: Louis Renard, 1754 edition, via Polona and Wikimedia Commons (`Category:Poissons,_ecrevisses_et_crabes_(1754)`, public domain). Local only for now.

Status: extraction, correction, rig and water are built for Fol. 3, Fol. 10, Fol. 12, Fol. 18, Fol. 24, V. Planche, VI. Planche, Planche Neuvieme, Planche Dixieme, XVI. Planche, XXVII. Planche and XL. Planche (64 fish). Open `/index.html`.

## Run it

    python3 -I -m http.server 8918 --bind 127.0.0.1 --directory .

- `/swim.html` is the rig bench: pick a fish, five knobs (Wavelength, Tail Amplitude, Tempo, Envelope, Fin Lag), key `i` switches color and ink. `?fish=bezaan`, `?still=1`, `?hide=1`, `?w=&h=`.
- `/tools/correct.html` is the correction tool: drag the body line, head and tail, box a paired fin, box out caption text welded to a fish. Save downloads `corrections/<plate id>.json` whole.

## Rebuild a plate

Python with numpy, pillow, scipy, scikit-image. Run with `-I`.

    python -I tools/extract.py "File:Poissons, ecrevisses et crabes 1754 (7198037).jpg" [--only slug ...]
    python -I tools/bake.py [--plate 7198037] [--only slug ...]
    python -I tools/sheet.py assets/fish sheet.png [--plate 7198037]

`extract.py` downloads the original once into the gitignored `cache/`, with a descriptive User-Agent. It reads `manifests/<id>.json` (written by hand: names, facing, a rough point on each fish, `rotate` for plates printed head up, on the plate or on one fish where a plate mixes both, `slug` where Renard reuses a name, `black_test` to opt in to the wash test, `skip` to leave a fish out) and `corrections/<id>.json` (body lines, fins, `solid`, `cut`, `clear`, `trim`, `fill_body`, `ink`, `close_field`). All rig coordinates are plate pixels, in the rotated frame on a rotated plate. Bake rewrites `assets/fish/index.json` from every plate it finds, whatever `--plate` or `--only` limit it to. Add `--out <dir>` to try a plate without touching `assets/`.

Checks, with Playwright installed outside the repo (`NODE_PATH=<dir>/node_modules`) and the server running. `tools/water_check.cjs` covers the water: `sim`, `perf`, `motion`, `arrive`, `shot`, `clip`.

    node tools/capture.cjs frames <dir>      8 phases, both looks, every fish
    python -I tools/phasesheet.py <dir> <out>
    node tools/capture.cjs readback <dir>    vertex shader output through transform feedback
    python -I tools/check_wave.py <dir>      that output against the equation, plus triangle stretch
    node tools/capture.cjs tempo bezaan      tempo changes mid-swim: nothing may jump
    node tools/capture.cjs perf              frame time with all rigs drawn
    node tools/capture.cjs clip <dir> <slug> [frames] [look]

## How the pieces work

**Cut.** Distance from a smooth local paper estimate in Lab, counting darkening and color but never lightening, because the scan is sharpened and paper beside a black edge glows brighter than paper. Edge pixels are unmixed against the local paper and hold the fish's color at any opacity, so there is no halo. Slots between fin rays stay open; pale interiors are kept.

**Trim.** With `trim` in a correction, paper that came along with the fish goes: it walks in from outside through anything the color of paper, stopped by the engraved outline and the body. Check the result at 100% on a dark ground, since paper hides on a paper ground.

**Line.** Black top-hat for thin darks, plus solids (dark and low chroma) filled in, as continuous alpha. Ink color is sampled from the plate. With `black_test` on, a fish whose darks have soft edges counts as wash, and only near-black fills in.

**Paired fins.** Each fin lifts onto its own layer. What it was covering is filled from nearby wash, with no line or spots. That fill is the only paint in the piece that is not on the plate, and it only shows as a fin lifts.

**Swim.** `rig.js`, vertex shader, WebGL2, no libraries, no build:

    offset = A(s) * sin(k*s - phase - lag*d)

`s` runs head to tail along the body; `d` runs out along a fin ray, measured inside the silhouette, so rays keep the station they grew from. Phase accumulates, so tempo changes never jump. Where two long parts run close, `close_field: false` stops the walk bridging the gap between them, as on Cambing's filaments. The mesh is inflated from the body curves and depth tested, so the fish occludes itself. Paired fins hinge, tip behind root. Per-type defaults are in `TYPES` in `tools/bake.py`.

**Files.** Per fish: `color.webp` (quality 90, lossless alpha), `ink.webp` (lossless), a pair for each paired fin, `rig.json`, and `mesh.bin`. The mesh is a regular grid, so the file holds one bit per cell and then s, d, z, r as 16-bit values per vertex. `read_part` in `tools/bake.py` and `decodePart` in `rig.js` must agree.

**Ground and line color** on the bench come from the plate (`assets/fish/index.json`). The water's look is Darya's call.

## The water

`index.html` is the piece. Its look is one block of constants at the top of that file: ground, line, strength, weight, motion. `water.js` holds the rest: each fish gets one long path that begins and ends where it cannot be seen, either past the window's side or so far off that haze has taken it. Nothing knows about the window's edges, so nothing can turn at one.

The window is never left empty: `keepCovered` in `water.js` sends the next fish in early enough that at least one is always showing, and `coveredFor` works out how long the fish already out will last, allowing for their pace wandering. Other fish still come and go at random as company, where before the water was sometimes left alone. `?arrive=1` is the exception, below.

It fetches a fish only as its turn comes: `index.json` lists them all, one waits ready while the others swim, at most 6 are held on the GPU, and a fish that will not load sits out the visit. The first fish is from the lighter half of the catalog, by the sizes in `index.json`.

- `i` switches color and ink.
- `?arrive=1` is one fish, one crossing, then an empty, still window with the render loop stopped. `?fish=<slug>` picks the fish (a comma list without `?arrive`), `?credit` shows the credit line.
- `?seed=<n>` repeats a run. `?manual=1` is for tools/water_check.cjs: no loop, driven by script, every fish held from the start.
- `prefers-reduced-motion` gives near-still drift with two fish.
