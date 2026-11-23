# Project context for contributors and AI assistants

Node.js service: BirdNET-Go detections -> FLUX.2-painted 1800s-style plates -> a portrait page for a Samsung EM32DX
Spectra 6 e-paper panel, delivered over Samsung MDC. Sibling of `../samsung-epaper-calendar` (same panel code). User docs: `README.md`.
Panel facts: `docs/PROTOCOL.md`. Tests: `npm test` (node:test, no network).

## Rules
- Panel conversation files (`mdc`, `wake`, `panel`, `mdcPush`, `controller`, `mqtt`, `quantize`, `inks`, `netcheck`) are copied from the
  calendar project; fix bugs in both. Read the calendar's CLAUDE.md rules on MDC (timeouts, push counts only when the panel fetches the image URL, content id = picture hash).
- The default `cluster` layout draws cut-outs (`cutout.mjs`: flood fill from the edges through paper-coloured, gently changing pixels; specks and enclosed scraps removed; alpha feathered) packed by `pack.mjs` (biggest in the middle, nearest free spot on a widening oval, compaction, binary search for the largest scale that fits). Cut-outs are cached as `<slug>.cut.png`; a plate's cut-out is made when it is painted. Prompts ask FLUX.2 for a flat shadowless ground because the cut-out depends on it.
- The ground colour is chosen per animal (`keys.mjs`: the candidate whose hue the reference photo wears least) because a fixed magenta cut holes in pink sheens and feet. `KEYED` is tight on purpose (reach 45, hole 28, erode 1) and the despill drops fringe pixels that are mostly ground instead of subtracting them. Prompts are per kind of animal (`taxa.mjs`: GBIF name match, cached in `<PLATE_DIR>/taxa.json`); `EXCLUDE` drops non-wildlife labels. Old plates have no `taxon`/`key` in their json: they cut fine, they just repaint as "animal" if repainted with lookup failing.
- Two layers: `ctx` = everything read (text, rules; snapped to inks), `art` = paper, hatching, bird cut-outs (true color). Folio/specimen set a cut-out on a cream plate; cluster draws cut-outs straight on the page.
- **Nothing on the picture may depend on the time of day or on counts**: the controller hashes the frame. Plate numbers are by first-heard order; the sheet is the busiest six shown in that order.
- Plates are made in the background, one at a time (`plates.mjs`), never during a render; missing ones render as "plate in preparation". Daily cap `PLATES_PER_DAY`; failures retried after 6 h.
- Image backends (`imagegen.mjs`): `openai` (/images/generations, /images/edits) and `comfyui` (FLUX.2 graph: UNETLoader, CLIPLoader type flux2, Flux2Scheduler, SamplerCustomAdvanced; edit adds LoadImage -> VAEEncode -> ReferenceLatent). The home server's :8000 is chat only; FLUX.2 is on ComfyUI :8188.
- `render()` queues frames one at a time (`px()` reads current geometry). Landscape displays (rotation 90/270) draw a landscape canvas and rotate on encode.
- The `theme` of the controller/displays is the art style (gould, audubon, engraving, woodblock, midcentury). Each style in `plates.mjs` STYLES has a prompt `medium`, a `credit` and a page `look` (paper colour, label font). `scripts/render-samples.mjs` paints a set of birds in several styles and renders a page per style to `data/samples/`.
- `.env` holds the panel PIN and MQTT credentials: never commit or print it.
