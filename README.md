# Renard

Louis Renard's fish, cut from his 1754 plates and swimming live in the browser. Credit: Louis Renard, *Poissons, ecrevisses et crabes*, 1754 edition, public domain. Scans from the Harvard Ernst Mayr Library copy at Internet Archive (https://archive.org/details/PoissonsecrevisIRena), with Wikimedia Commons (`Category:Poissons,_ecrevisses_et_crabes_(1754)`) as the fallback source.

Status: extraction, correction, rig and water are built for Fol. 1, 2, 3, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21 and 24, and V., VI., IX., X., XVI., XXVII. and XL. Planche (129 fish, plus 3 hidden). Open `/index.html`.

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

The window is never left empty: `keepCovered` in `water.js` sends the next fish in early enough that at least one is always showing, and `coveredFor` works out how long the fish already out will last, allowing for their pace wandering. Other fish still come and go at random as company, where before the water was sometimes left alone. A fish sent as company takes the turn `keepCovered` was holding, so if its own route would reach the window too late, say the long way in out of the haze, it takes the crossing planned for it instead (`companyPlan`). `?arrive=1` is the exception, below.

It fetches a fish only as its turn comes: `index.json` lists them all, one turn waits ready while the others swim, 6 fish are held on the GPU unless more than that are in use, and a fish that will not load sits out the visit. The first turn is from the lighter half of the catalog, by the sizes in `index.json`.

**Companions.** Three pairs of different prints swim together, chosen because both the identity and the behavior hold up in `research/fish-natural-history.json`: Sian Mamel and Sian Femel (Abudefduf vaigiensis, in aggregations, and his caption treats "ces deux petits poissons" together), Besaantie and Moorse-Afgodt (both Zanclus cornutus, FishBase "generally 2 or 3"), Paradys and Paradys vischje (both Labroides dimidiatus, cleaning stations hold a pair of adults). Everyone else swims alone, including fish with unknown behavior and fish whose species schools, since no second print exists for them. Ican Tomtombo and Tomtombo 40 are one species too and are deliberately not paired: the sourced behavior is solitary.

`PAIRS` and `BUDDY` at the top of `water.js` are the whole of it, and the motion numbers in `BUDDY` are Darya's call. A pair is one turn in the shuffled bag. Neither is ready until both have loaded. If one fails, or is still not in `PARTNER_WAIT` seconds after the other, the one that is here swims alone. They share a size and a speed. The follower's route is the leader's, moved up or down and nearer or farther, and `validate` holds it to the same rules as any path. `alike` also turns down routes where the two would look different in size or heading. Each step the follower aims for a place behind the leader, with a gap that slowly opens and closes, and gets there by changing its pace within what `coveredFor` allows. Each has its own tail rate. Their clock runs in water time, so the arrow keys change how fast they go and not how they go. A pair starts while there is room for one more fish, so it can take the count one over `maxFish`. Fish are counted one by one, not pairs as one. Eviction treats a pair as one: both leave the GPU together, and neither leaves while the other is swimming.

`tools/buddy_check.cjs` is the check. It reads numbers from simulated time and cannot say how they look moving.

**Schools.** A trial, since one species has one print and a school can only be copies of it. Five fish school, chosen from `research/fish-natural-history.json`, and `SCHOOLS` at the top of `water.js` says how sound each one is: Groot Half-Beck, Dorade-Dauphin, Eenhoorn, Sambilang, and Vliegende Harder, the softest, whose identity is firm only to family. Byenaneque and Carcasse are left out, as commented lines. `SCHOOL` holds every number, and they are Darya's call. A school is one turn in the bag, and all its members draw from one print on the GPU, so it is all there or none of it is. A print that fails, or does not answer in `PARTNER_WAIT` seconds, sits out the visit. It runs on the same code as a pair: the leader's route, each follower's route moved to its own place, `validate` and `alike` on every one, and the clock in water time. Each member has its own level, place along the route, size, depth, tail phase, tail rate and tail width. A school waits until `company` other fish are in the water, unless `keepCovered` needs it sooner, and then goes with fewer members rather than pass `most`, and never under 3. There are never two schools at once, and no company joins one. A tall window has 3 of each. `?school=<slug>` shows one school, and until it is gone there is nothing else to send, so the window is empty between crossings. `?fish=` never schools, and `?arrive=1` is one fish. With reduced motion a school starts in view, near still. `tools/school_check.cjs` is the check: `schools`, `normal`, `load`, `real`, `fps`. It reads numbers and cannot say how they look moving.

- `i` switches color and ink.
- Left and right arrows make everything slower or faster together, a tap at a time or by holding: 0.1x to 4x, eased in, tail beat and new arrivals included. `tools/speed_check.cjs` is the check.
- `?arrive=1` is one fish, one crossing, then an empty, still window with the render loop stopped, and never a pair. `?fish=<slug>` picks the fish (a comma list without `?arrive`), `?credit` shows the credit line. Both of a pair in the list swim as a pair, so `?fish=sian-mamel,sian-femel` is how to look at one; either alone is just that fish. Until both are gone there is nothing else to send, so a list that short leaves the window empty between crossings.
- `?seed=<n>` repeats a run. `?manual=1` is for tools/water_check.cjs: no loop, driven by script, every fish held from the start.
- `prefers-reduced-motion` gives near-still drift with two fish, or a school when one is out.

## License

The code is MIT, see `LICENSE`. Renard's plates are in the public domain, and so are the fish cut from them in `assets/`.
