# Plan: better inpainting (Refine's painted-area redraw)

**Status (2026-10-27): phases A to D are done and on `main`. E (masks with the edit models) and F (inpaint-trained models, Flux Fill) are deferred. None of it has been tried on a real ComfyUI; see the manual check under "Rules for every phase".**

Written 2026-10-26 for agents picking up this work. Read this whole file before starting a task, then only the code each task names. `CLAUDE.md` and `AGENTS.md` rules apply throughout: Edit/Write tools only (no sed, heredocs or scripts to change source), checks sized to the change, one logical change per commit, "ship it" process. Read `docs/illustrate.md` before touching `src/lib/comfy/` and update it in the same change when behaviour it describes changes.

## Why

Refine redraws a painted area with: whole picture → `VAEEncode` → `SetLatentNoiseMask` → `KSampler` → `VAEDecode` → paste the original back outside the mask (`ImageCompositeMasked`). That is the minimum that works. The Krita AI Diffusion plugin (https://github.com/Acly/krita-ai-diffusion, `ai_diffusion/backend/workflow.py`) does more, and these tasks bring over the parts that matter for this app, in order of value for effort:

| Phase | Change | Gain |
|---|---|---|
| A | Run only the steps the strength needs (`KSamplerAdvanced`) | **Speed**: a 0.5 redraw takes about half the time |
| B | Grow the mask for sampling, keep the original for the paste; `DifferentialDiffusion` | Seams hidden, soft edges honoured |
| C | Crop to the painted area plus context, redraw that at full model resolution, paste back | **Quality** for small masks (hands, faces) |
| D | Fill the painted area (grey or blur) before encoding | Removing things works at middle strengths. **Needs the owner to say where the control goes.** |
| E | Masked edits with Qwen-Image-Edit / Kontext | Deferred, see the end |
| F | Flux Fill / inpaint-trained checkpoints | Deferred, see the end |

Do them in order A, B, C, D. Each phase is its own commit (and each can be shipped alone). Phases B, C and D build on helpers from the one before.

## What exists now (read these, nothing else, to start)

- `src/lib/comfy/workflow.ts`: `BUILTIN_WORKFLOW`, `BUILTIN_IMG2IMG`, `BUILTIN_INPAINT` (static graph with `{{mask}}`), `fillWorkflow`, `startFromImage` (for custom workflows without placeholders), **`redrawOnlyMask(wf, mask, load, repeat)`** (adds `LoadImageMask`, `SetLatentNoiseMask`, `InvertMask`, and an `ImageCompositeMasked` before each `SaveImage`), `describeWorkflow`.
- `src/lib/comfy/drawModels.ts`: the model-family workflows (Z-Image, Flux, Chroma, Qwen-Image, Krea2). `startLatent(p)` makes `LoadImage "10"` → `ImageScale "11"` (to `snap16(p.width/height)`) → `VAEEncode "12"` → `RepeatLatentBatch "13"`. `sampleAndSave` makes the `KSampler "8"`, `VAEDecode "20"`, `SaveImage "21"`. `buildDraw` calls `redrawOnlyMask(wf, p.mask, "11", "13")` at the end.
- `src/lib/comfy/makeJob.ts`: `queueJob` uploads the picture and the mask (`uploadMask`), then calls `fillWorkflow` or `buildDraw` with `mask: maskName`. `maskOf(input)` is null for edits.
- `src/lib/mask.ts`: `MaskState = { strokes, softness (pixels of canvas blur), inverted }`, `PaintedArea` (adds `id`, `width`, `height`, and `render` on the server), `renderMask`.
- `src/lib/comfy/jobSpec.ts`: `toSpec` / `fromSpec` carry a job to the server worker. A server-side `PaintedArea` has `strokes: []`, so anything computed from strokes must be computed in `toSpec` (browser) and carried in `SpecMask`.
- Tests: `tests/unit/comfy-workflow.test.mts` (lines ~231-265 are the mask tests), `tests/unit/draw-models.test.mts` (~98-103), `tests/unit/mask.test.mts`, `tests/unit/job-spec.test.mts`; browser: `tests/e2e/refine-*.e2e.mjs`; the fake ComfyUI `tests/e2e/fakeComfy.mjs` has a `NODES` list (about line 105) of the node classes it accepts. **Every new node class below must be added to that list**, or the browser tests fail with "Cannot execute because node X does not exist".

ComfyUI core nodes used (all part of ComfyUI itself, none needs a custom-node pack). Input names are exactly these:

| Node | Inputs → output |
|---|---|
| `KSamplerAdvanced` | `add_noise` ("enable"), `noise_seed`, `steps`, `cfg`, `sampler_name`, `scheduler`, `start_at_step`, `end_at_step`, `return_with_leftover_noise` ("disable"), `model`, `positive`, `negative`, `latent_image` → LATENT |
| `GrowMask` | `mask`, `expand` (int pixels), `tapered_corners` (bool) → MASK |
| `DifferentialDiffusion` | `model` → MODEL |
| `ImageCrop` | `image`, `width`, `height`, `x`, `y` → IMAGE |
| `CropMask` | `mask`, `x`, `y`, `width`, `height` → MASK |
| `MaskToImage` | `mask` → IMAGE |
| `ImageToMask` | `image`, `channel` ("red") → MASK |
| `ImageScale` | `image`, `upscale_method` ("lanczos", "bilinear", "area"), `width`, `height`, `crop` ("disabled") → IMAGE |
| `ImageScaleBy` | `image`, `upscale_method`, `scale_by` → IMAGE |
| `RepeatImageBatch` | `image`, `amount` → IMAGE |
| `EmptyImage` | `width`, `height`, `batch_size`, `color` (int, 0x808080 = 8421504) → IMAGE |
| `ImageCompositeMasked` | `destination`, `source`, `x`, `y`, `resize_source`, `mask` → IMAGE. White in `mask` shows `source`. ComfyUI repeats `source` (not `destination`) to `destination`'s batch size, and resizes `mask` to `source`'s size. |

## Rules for every phase

- Pure functions in `src/lib/comfy/` or `src/lib/mask.ts` with unit tests. No DOM, no network.
- Never mutate `BUILTIN_*` workflows (`fillSettings` copies; keep it that way, the tests check it).
- Custom workflows **with placeholders** (`{{prompt}}` etc.) are the author's own graph: do not add nodes to them in any phase (only the existing `{{mask}}` handling applies). "Ours" means: the built-in workflow, a custom workflow without placeholders (`describeWorkflow(wf).mode === "detected"`), or a model-family workflow.
- Keep node ids stable where tests or links refer to them; new nodes get ids starting `storytime_`.
- Without a mask, every workflow must come out **exactly as today**. Each phase needs a test that says so.
- Checks (CLAUDE.md, "feature"): `npx tsc --noEmit`, `npx next build`, `node tests/run.mjs unit`, `node tests/run.mjs e2e refine illustrate-edit illustrate-families`, then the screenshots rule if the UI changed. Say plainly at the end that **a real ComfyUI was not used**, and give the owner this manual check: on Refine, paint a small area (a hand or a face) on a real picture, Go at strength 0.6, and compare the result against the picture before the change (seam, detail, time).

---

## Phase A: run only the steps the strength needs

**Background.** ComfyUI's `KSampler` with `denoise` 0.5 and `steps` 30 builds a 60-step schedule and runs the last 30 steps: the time is the same as at denoise 1. `KSamplerAdvanced` with `start_at_step` 15 of 30 runs 15 steps from the same noise level. Krita does the latter (`apply_strength`), so a partial redraw is faster there. This is the only change here that makes jobs faster.

**Do this in `workflow.ts`:**

```ts
/** Steps a redraw at `denoise` runs: the share of `steps` it needs, but at least 4 (or all of them if fewer). */
export const stepsToRun = (steps: number, denoise: number) => Math.min(steps, Math.max(Math.round(steps * denoise), Math.min(steps, 4)));

/**
 * Turns a KSampler that starts from a picture (denoise below 1) into a KSamplerAdvanced that starts part way
 * through its steps. ComfyUI's KSampler would run all of `steps` on a longer schedule; this runs only
 * stepsToRun(steps, denoise). Everything else about the node is kept, and its id, so links to it still work.
 */
export function partialSteps(node: WorkflowNode) { ... }
```

`partialSteps` does nothing unless `node.class_type === "KSampler"` and `typeof denoise === "number"` and `0 < denoise < 1`. Otherwise: `start = steps - stepsToRun(steps, denoise)`; set `class_type = "KSamplerAdvanced"` and `inputs = { add_noise: "enable", noise_seed: seed, steps, cfg, sampler_name, scheduler, start_at_step: start, end_at_step: 10000, return_with_leftover_noise: "disable", model, positive, negative, latent_image }` (copy the six link/value inputs from the old node).

**Where to call it:**
1. `fillWorkflow`: after `fillSettings` and the `builtin && p.sampler` block, `if (builtin && p.image) partialSteps(out["3"])`. Only the built-in workflow. Custom workflows keep their own sampler untouched.
2. `drawModels.ts` `sampleAndSave`: build the `KSampler "8"` as now, then `if (p.image) partialSteps(node)`.
3. Not for edit models (`editModels.ts`): their default strength is 1; leave them.

`withReferences` (`ipAdapter.ts` line 115) already accepts `KSamplerAdvanced`. `redrawOnlyMask` and `addLoras` look nodes up by id and by link, not class, so they are unaffected.

**Update tests** (they assert `KSampler` and `inputs.denoise`): `comfy-workflow.test.mts` ~237 and ~251 and any other `denoise === 0.4`; `draw-models.test.mts` `only(m, "KSampler")` for redraws. A redraw at denoise below 1 now has `class_type "KSamplerAdvanced"`, `start_at_step`, `steps`; at denoise 1 (or no starting picture) it is still a `KSampler`. Add `stepsToRun` cases (30 steps at 0.5 → 15; at 0.05 → 4; 4 steps at 0.25 → 4; 8 steps at 0.5 → 4).

**Tell the owner** in the final message: the look of a partial redraw changes slightly (fewer, larger steps), so compare two or three pictures. To undo it, remove the two `partialSteps` calls.

Docs: in `docs/illustrate.md` ("Workflows" bullet) say a redraw below full strength runs only the steps it needs.

---

## Phase B: grow the mask for sampling, and Differential Diffusion

**Idea (Krita does both).** Sample over a *slightly larger* mask than the one used for the final paste. The seam then falls inside redrawn pixels, not across the edge of them. `DifferentialDiffusion` makes the soft edge of the mask mean something: pixels near the edge get less change, instead of the sampler treating the mask as on/off.

**In `src/lib/mask.ts`** add and unit-test:

```ts
/** How far the sampled area grows past the painted one: 1% of the picture's longer side, at least 4 pixels. */
export const maskGrow = (width: number, height: number) => Math.max(4, Math.round(Math.max(width, height) / 100));
```

**In `workflow.ts`:**

1. `PictureParams.grow?: number` (pixels).
2. `growNoiseMask(wf: Workflow, grow: number)`: if `grow <= 0` return. For every node of class `SetLatentNoiseMask` whose `mask` input is a link, add `storytime_grow_<n>` = `{ class_type: "GrowMask", inputs: { mask: <old link>, expand: grow, tapered_corners: true } }` and point `mask` at `[thatId, 0]`. (The paste in `redrawOnlyMask` keeps using the **un-grown** mask: do not change that.)
3. `addDifferentialDiffusion(wf)`: for each node with class `KSampler` or `KSamplerAdvanced` whose `model` is a link, add one `DifferentialDiffusion` node per distinct model link (id `storytime_dd_<n>`), and point those samplers' `model` at it.
4. In `fillWorkflow`, after `withReferences` (so the adapters are inside it) and only when `p.image && p.mask` and the workflow is "ours" (see Rules): `growNoiseMask(out, p.grow ?? 0)` then `addDifferentialDiffusion(out)`. For the built-in workflow the `SetLatentNoiseMask` is node "14" in `BUILTIN_INPAINT`, so the same function works.
5. `drawModels.ts`: `DrawParams.grow?: number`; in `buildDraw`, after the `switchToGgufLoaders` call and the `redrawOnlyMask` call, do the same two calls.
6. `makeJob.ts`: pass `grow: maskGrow(area.width, area.height)` next to `mask: maskName` in the `buildDraw` and `fillWorkflow` calls.

`DifferentialDiffusion` is in ComfyUI core since early 2024; do not add it to a family's `nodes` list (that would stop old ComfyUIs drawing at all). A too-old ComfyUI shows its own "node does not exist" error on a masked job.

**Tests:** built-in, detected and family each get a `GrowMask` between the mask loader and `SetLatentNoiseMask`, the `ImageCompositeMasked` mask still comes (inverted) from the un-grown `LoadImageMask`, and every sampler's `model` goes through `DifferentialDiffusion`; a placeholder workflow gets nothing added; no mask → no new nodes. Add `GrowMask`, `DifferentialDiffusion` to the fake's `NODES`.

---

## Phase C: crop to the painted area and its context

**Idea.** Krita redraws only a region around the mask (the mask plus padding for context), scaled to the model's native size, then scales it back and pastes it. Right now a small mask in a 1344 × 768 picture gets a few hundred latent pixels, so hands and faces come out soft. After this, a 300-pixel hand is redrawn from a crop scaled up toward the model's native size.

**What it does not do:** speed. A crop scaled up to about one megapixel costs about what the whole 1344 × 768 picture does. It pays off for pictures much larger than one megapixel; for these it is a quality gain.

### C1. Pure helpers: new file `src/lib/comfy/inpaintRegion.ts` (+ `tests/unit/inpaint-region.test.mts`)

```ts
export type Box = { x: number; y: number; w: number; h: number };
export type CropPlan = Box & { sw: number; sh: number; scale: number }; // the box, and the size it is redrawn at

/** The painted pixels' bounding box, from the strokes: null when nothing is painted. */
export function maskBounds(state: MaskState, width: number, height: number): Box | null
export function contextBox(bounds: Box, picW: number, picH: number, nativeArea: number): CropPlan | null
```

`maskBounds`: if `state.inverted`, the whole picture. Else the union of the bounding boxes of all strokes that are not `tool === "eraser"`: for a `fill` stroke the box of its points; for a `brush` stroke the box of its points grown by `size / 2` on every side. Then grow by `2 * softness` and clamp to the picture. An eraser can only shrink the painted area, so ignoring it gives a box that is slightly too big, never too small. No such strokes → null. Round outwards to whole pixels.

`contextBox(bounds, picW, picH, nativeArea)`, in this order:
1. `pad = max(64, round(0.5 * max(bounds.w, bounds.h)))`; grow the box by `pad` on every side.
2. `minSide = round(0.6 * sqrt(nativeArea))`; if a side is shorter, grow it equally on both sides to `minSide`.
3. Fit to the picture: a side longer than the picture becomes the whole side; otherwise shift (do not shrink) the box so it lies inside.
4. If the box's area is at least 80% of the picture's, return **null** (cropping is not worth it).
5. `scale = clamp(sqrt(nativeArea / (w * h)), 0.5, 2)`; `sw = max(16, round(w * scale / 16) * 16)`, `sh` likewise (multiples of 16 so SDXL-style checkpoints and the 16-pixel-block families both accept them). Return `{ x, y, w, h, sw, sh, scale }`.

`nativeArea` is `comfy.width * comfy.height` (Settings' picture size) in `queueJob`.

Tests: no strokes → null; eraser-only → null; one brush dot; a fill polygon; inverted → full picture; a small mask in a big picture crops; a mask covering most of the picture → `contextBox` null; sides are inside the picture; `sw`/`sh` multiples of 16; thin tall masks; mask at a corner (box shifted, not shrunk).

### C2. Carry the box to the server

- `mask.ts`: `PaintedArea.bounds?: Box | null` ("set only on the server, where the strokes are not kept").
- `jobSpec.ts`: `SpecMask.bounds: Box | null`; `toSpec` sets `bounds: maskBounds(mask, mask.width, mask.height)`; `fromSpec` puts `bounds` on the `PaintedArea` it builds. Update `tests/unit/job-spec.test.mts` for the new field.
- `makeJob.ts` `queueJob`, once `from` and `area` are known: `const bounds = area.bounds !== undefined ? area.bounds : maskBounds(area, area.width, area.height); const crop = bounds ? contextBox(bounds, from.width, from.height, comfy.width * comfy.height) : null;`. Pass `crop` to `fillWorkflow` and `buildDraw`. The job's recorded `width`/`height`, and `hooks.onSize`, stay the **full** picture's size: the saved pictures are full size.

### C3. The graph: new `redrawCropped` in `workflow.ts` (exported, used by `drawModels.ts` too)

```ts
redrawCropped(wf, { mask, full, repeat, count, crop, grow, scale })
//  mask:   the uploaded mask's name        full:  id of the LoadImage node holding the full picture
//  repeat: id of the RepeatLatentBatch    count: batch size
//  crop:   the CropPlan                   grow:  maskGrow(...) in full-picture pixels
//  scale:  true when this function must scale the crop to sw × sh; false when the workflow scales it itself (families' ImageScale "11")
```

Order matters; do the steps in this order:

1. `storytime_crop` = `ImageCrop { image: [full,0], width: crop.w, height: crop.h, x: crop.x, y: crop.y }`.
2. If `scale`: `storytime_crop_scale` = `ImageScale { image: [storytime_crop,0], upscale_method: "lanczos", width: crop.sw, height: crop.sh, crop: "disabled" }`; `into` is that node, else `storytime_crop`.
3. **Re-point first:** every node input that links to `[full, 0]` becomes `[into, 0]` (this is the `VAEEncode`'s `pixels`, or the family's `ImageScale "11"` image). Do this before adding anything that reads `full`.
4. Mask: `storytime_mask` = `LoadImageMask { image: mask, channel: "red" }`; `storytime_mask_crop` = `CropMask { mask: [storytime_mask,0], x, y, width: w, height: h }`; `storytime_mask_img` = `MaskToImage { mask: [storytime_mask_crop,0] }`; `storytime_mask_scaled` = `ImageScale { image: [storytime_mask_img,0], upscale_method: "bilinear", width: sw, height: sh, crop: "disabled" }`; `storytime_mask_small` = `ImageToMask { image: [storytime_mask_scaled,0], channel: "red" }`.
5. Noise mask: every link to `[repeat, 0]` becomes `[storytime_noise_mask, 0]`; `storytime_noise_mask` = `SetLatentNoiseMask { samples: [repeat,0], mask: [storytime_mask_small,0] }`. Then `growNoiseMask(wf, round(grow * crop.scale))` (Phase B; the grow is in the crop's scaled pixels).
6. Paste back, for each `SaveImage`/`PreviewImage` whose `images` links to a `VAEDecode` (as `redrawOnlyMask` does): `storytime_back_<i>` = `ImageScale { image: <that link>, upscale_method: "lanczos", width: crop.w, height: crop.h, crop: "disabled" }`; `storytime_full_<i>` = `RepeatImageBatch { image: [full,0], amount: count }`; `storytime_paste_<i>` = `ImageCompositeMasked { destination: [storytime_full_<i>,0], source: [storytime_back_<i>,0], x: crop.x, y: crop.y, resize_source: false, mask: [storytime_mask_crop,0] }`; the save's `images` becomes `[storytime_paste_<i>,0]`. Note the orientation differs from `redrawOnlyMask`: here the destination is the *original*, repeated to the batch, because it is the one that is full size, and the mask is the **un-grown, un-inverted** crop of the painted mask.

### C4. Call sites

- **Built-in** (`fillWorkflow`): when `p.image && p.mask && p.crop`, start from `BUILTIN_IMG2IMG` instead of `BUILTIN_INPAINT` (the static graph has no place for a crop), then `redrawCropped(out, { mask: p.mask, full: "10", repeat: "12", count: p.count, crop: p.crop, grow: p.grow ?? 0, scale: true })`, then the Phase B `addDifferentialDiffusion`. Without `p.crop` nothing changes.
- **Custom, no placeholders** (`startFromImage`): `if (p.mask) p.crop ? redrawCropped(wf, { …, full: load, repeat, scale: true }) : redrawOnlyMask(wf, p.mask, load, repeat)`.
- **Families** (`drawModels.ts`): `DrawParams.crop?: CropPlan`. In `startLatent`, when `p.crop`, scale to `p.crop.sw × p.crop.sh` instead of `snap16(p.width/height)`. In `buildDraw`, `if (p.image && p.mask) p.crop ? redrawCropped(wf, { mask, full: "10", repeat: "13", count: p.count, crop: p.crop, grow: p.grow ?? 0, scale: false }) : redrawOnlyMask(wf, p.mask, "11", "13", …)`.
- **Placeholder workflows**: never cropped.

### C5. Tests and checks

- Unit: for built-in, detected and family, with and without a crop: every link points at an existing node (write a small `assertLinksResolve(wf)` helper in the test file); the saved image comes through `ImageCompositeMasked` whose `destination` is a `RepeatImageBatch` of the full `LoadImage`; the `VAEEncode` (or family `ImageScale`) reads from the crop, not the full picture; `x`, `y`, `w`, `h`, `sw`, `sh` are as in the plan; without a mask or a crop the graphs are identical to Phase B's.
- Add `ImageCrop`, `CropMask`, `MaskToImage`, `ImageToMask`, `RepeatImageBatch` to the fake's `NODES`.
- Browser: `refine-generate`, `refine-results`, `refine-accept`. The fake does not run the graph, so these only prove the job is accepted.
- **Cannot be tested without a real ComfyUI:** that the pasted result lines up. State that, and give the owner the manual check above, with a mask near the picture's edge and a picture whose size isn't a multiple of 16.

Docs: `docs/illustrate.md` (Workflows bullet): the crop, the grow and Differential Diffusion; the fact that custom placeholder workflows are untouched.

---

## Phase D: fill the painted area before encoding

**Ask the owner first** (CLAUDE.md: UI placement must be confirmed): where the control goes. Suggested: a "Under the paint" menu beside the Strength slider in `src/components/refine/RefinePromptPanel.tsx` with *Keep what's there* (default, today's behaviour), *Blur it*, *Grey*. Do not start the UI before they answer.

**Why.** At middle strengths the sampler still sees the pixels under the mask, so removing an object tends to redraw the object. Krita fills the area first (`fill_masked`, `blur_masked`).

**Work (after the owner answers):**
1. `JobInput.fill?: "keep" | "blur" | "grey"` in `makeJob.ts`; add it to the `sameJob` key (only when a mask is used) and carry it through `jobSpec.ts` (it is plain data, so it passes through `...rest`); a test in `tests/unit/job-spec.test.mts`.
2. `fillUnderMask(wf, { encode, pixelsFrom, mask, size, kind })` in `workflow.ts`, run **after** Phase C/B's mask nodes exist and only for `blur`/`grey`:
   - `grey`: `storytime_fill` = `EmptyImage { width: size.w, height: size.h, batch_size: 1, color: 8421504 }`.
   - `blur`: `storytime_fill_small` = `ImageScaleBy { image: <the picture that is encoded>, upscale_method: "area", scale_by: 0.0625 }`; `storytime_fill` = `ImageScale { image: storytime_fill_small, upscale_method: "bilinear", width: size.w, height: size.h, crop: "disabled" }`.
   - both: `storytime_fill_paste` = `ImageCompositeMasked { destination: <the picture that is encoded>, source: storytime_fill, x: 0, y: 0, resize_source: false, mask: <the grown noise mask> }`; the `VAEEncode`'s `pixels` (built-in/detected) or the family's `VAEEncode "12"` pixels becomes `[storytime_fill_paste, 0]`.
   - `size` is `crop.sw × crop.sh` when cropped, else the picture's size (families: snapped to 16).
   - The final paste-back is untouched, so only the encoded copy is filled.
3. Tests like Phase C's. Docs: a sentence in `docs/illustrate.md`.

---

## Deferred (do not start without the owner)

**E. Masks with the edit models (Qwen-Image-Edit, Kontext).** Today `maskOf` returns null for an edit and `pictureJobs.ts` rejects a mask on an edit, and Refine never builds edits (`edit: null` in `RefinePromptPanel.tsx`), so this needs a decision on where "edit by instruction, only here" lives in the UI. Technically it is small: add `mask?` to `EditParams`, call `redrawOnlyMask(wf, mask, "11", "13", …)` in `buildEdit` (the `ImageScale "11"` is the edit-sized original and `"13"` the repeated latent), allow masks on edits in `maskOf`/`sameJob`/`pictureJobs`. The model still sees the whole picture, which is what lets it follow the instruction.

**F. Inpaint-trained models.** Krita uses inpaint-trained models (SDXL inpaint checkpoints through `InpaintModelConditioning`, Flux Fill, inpaint ControlNets) above a strength threshold. StoryTime cannot tell an inpaint checkpoint from a normal one, and Flux Fill is a separate ~12 GB download that would need a new model part in `modelParts.ts`/`drawModels.ts` and a new setup check. Only worth it if Flux redraws still show seams after B and C.

## Not worth copying

Krita's ControlNet, regions, live mode, upscaling pass and its custom node pack (`comfyui-tooling-nodes`) are separate features or are not needed: every node above is in ComfyUI core.
