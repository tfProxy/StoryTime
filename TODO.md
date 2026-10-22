# TODO

Planned work, with what you need to know to start. Finished work isn't listed; the code and tests describe it. How the Illustrate page works is in `docs/illustrate.md`: read it before touching that page.

## Not yet checked against a real ComfyUI

The tests use a fake. Before building more on this, try once on the real machine and write down what differs:

1. Earlier pictures: make pictures, pin one, reload (only it shows), and use one from All. Restart ComfyUI and check the pictures still load from `/view`.
2. Start from a picture with the built-in workflow, then with your own exported workflow (with and without `{{image}}`). Check the upload (`/upload/image`, `type=input`) works through your CORS setup, and that a 1344 × 768 start picture fits in memory.
3. A workflow with `KSamplerAdvanced` has no `denoise` input, so StoryTime says it can't start from a picture. See whether that matters to you.

## Next steps, roughly in order of usefulness

1. **The rest of the Illustrate plan** (agreed with the owner; the layout, prompt grouping, Load prompt from any picture, the job queue, remembered prompts, pin / reject and the full-size viewer are done):
   - Maybe: the viewer for Other chapters' pictures and the saved header and footer (now they open in a new tab).
   - Left out of pin / reject: marking pictures in Other chapters.
2. **Forget lost pictures.** Rejecting hides a picture ComfyUI has lost; removing the record (a `DELETE /api/picture-jobs/:id`) and pruning old rows aren't built.
3. **Settings writes while sliding Strength.** Each tick saves all settings, including the workflow text, to the server. Debounce it if it is noticeable on the NAS.
4. **Scale / upscale pass.** A Scale menu (1×, 1.5×) that resizes the starting picture before re-drawing it. Left out for now.
5. **Import from ComfyUI's history** (`GET /history?max_items=200`) for pictures made before the log existed or in ComfyUI itself. Take entries tagged `storytime` or whose files start with `StoryTime`; the prompt can be read back from the stored workflow (`prompt[2]`) with the node-finding in `workflow.ts`. Not built.
6. **Pictures from other stories** as one more view beside Other chapters. Left out unless asked.
7. **Inpainting** (redrawing only a painted part of a picture). Phase 1 is done: Redraw takes a painted area (Paint area, or Change part of this… in a picture's ☰ menu; see `docs/illustrate.md`). Still to do:
   - Phase 2: edit models with a mask: run the edit, then paste back only the masked area.
   - Phase 3: zoom-in crop and stitch for small areas, so a small painted area is drawn at full resolution.
   - Phase 4: Flux Fill and outpainting (extending a picture past its edges).

## Reference pictures (agreed with the owner, 2026-10-22)

Give a picture job up to four reference pictures (a character, an item, a place, a style), so the same character, outfit or place comes back, chosen mostly from pictures already made: a codex entry's picture, a recent header or footer, a pinned picture, the cover, or an upload.

**Decisions so far**
- SDXL checkpoints (furry, Illustrious and NoobAI merges; Pony to be supported) do most of the drawing, so references work through **IP-Adapter** on the author's own drawing preset, keeping its look. Qwen-Image-Edit is too slow for every picture; it gets references only on the Instruct tab, for fix-ups ("put the outfit from image 2 on the man in image 1").
- Custom nodes are fine when standard: `ComfyUI_IPAdapter_plus` (through ComfyUI-Manager). The setup check finds them and their model files, and `docs/pictures.md` says how to install them.
- A codex entry's picture can change over the story (Jim becomes a woman in chapter 12), on that branch only, like codex text.
- Codex pictures get a page of their own, built from the same shared picture page as the chapter and cover pages (stage 1).
- Style: the story's art-style text is enough at first; a style picture comes later (stage 4).
- Two specific characters in one picture (a region per character) waits until later.
- Not checked on a real ComfyUI yet (the owner is away from it). Stages 1 to 3 don't wait for it; see "Check on the real ComfyUI" below.

**Which IP-Adapter files.** The right adapter depends on what the checkpoint was trained from, which the file name rarely says. A drawing preset gets a **Model base** setting (SDXL, Illustrious, NoobAI, Pony; checkpoint presets only), guessed when the preset is made (from the name, and from ComfyUI's `GET /view_metadata/checkpoints?filename=` when the file has `modelspec.architecture` metadata) and changeable in Settings. Each base names its adapter and CLIP Vision files, found by name like model parts (`modelParts.ts`), each overridable in Settings:
- SDXL and Pony: `ip-adapter-plus_sdxl_vit-h.safetensors` with `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` (Pony works less well; say so).
- NoobAI and Illustrious: NoobAI's own adapter (`noobIPAMARK1_mark1.safetensors`, Laxhar's `noob_ipa`) with the CLIP Vision model its page names (ViT-bigG, to confirm). Confirm on the real ComfyUI that Illustrious and furry merges do better with it than with the SDXL one.

**Stages**
1. **One shared picture page** (no visible change; every existing test must still pass). `PictureTarget` becomes a tagged union (`{kind: "chapter", ...} | {kind: "cover", ...}`, later `"codex"`), replacing the ~20 `chapterId === null` checks with what the target says about itself (slots, save API, page, job tag, prefix, storage key, label). One workspace and one prompt panel replace `IllustrateWorkspace`/`CoverWorkspace` and `ImagePromptPanel`/`CoverPromptPanel`: a top part that depends on the target (what the AI writes the prompt from: the chapter text and moment, the cover's Write from), the shared middle (prompt boxes, Always include, Edit, Model Settings, Queue; References in stage 2), and the destinations (header and footer cards, the cover card). Pages stay pages, not pop-ups: jobs take minutes and the picture queue links back to them.
2. **References from existing pictures.** (Stage 2a, the setup, is done: a preset's model base, the IP-Adapter setup check and `docs/pictures.md`; the rest is not.)
   - A `Reference` is `{source, label, role: "character" | "item" | "place" | "style", weight}`; `source` as in the job log (`comfy:<file>`, `saved:<id>:<slot>`, later `codex:<picture id>`, or an upload). Uploaded to ComfyUI once per key, like the starting picture.
   - Workflows: for each reference, `IPAdapterAdvanced` (from `IPAdapterModelLoader` and `CLIPVisionLoader`) chained in front of the sampler's model, weight type "linear" (style: "style transfer"), end at 0.8 by default. In the built-in SDXL workflows (text to image, Redraw, painted area) and in pasted workflows without placeholders (found by the KSampler's `model` input). Placeholder workflows and the model families say references aren't available, with the reason (`describeWorkflow(...).refs`). Instruct: Qwen-Image-Edit takes the starting picture as image 1 and up to two references as images 2 and 3 (`TextEncodeQwenImageEditPlus`); Kontext one more `ReferenceLatent`.
   - The setup check (`check.ts`) reports the IP-Adapter nodes and, per drawing preset, its base's files, with a link to the new install section in `docs/pictures.md`.
   - UI, in the shared middle under the Prompt box: a References section (thumbnail, label, role, strength slider, ✕ for each), one-tap suggestions above it (making a footer: this chapter's header; making a header: the previous chapter's footer on the path), and **Add reference** opening a picker dialog with Suggested, Pictures (this chapter's pinned pictures, the headers and footers on the path, the cover) and Upload. "Use as reference" in every picture's ☰ menu.
   - Kept per chapter and moment with the prompt boxes (`picture_prompts.refs`, and `cover_prompts.refs`); the job log records them (`picture_jobs.refs`), so Info shows them, Load prompt brings them back, `sameJob` and `timeline()` tell them apart.
3. **Codex pictures.**
   - `codex_pictures` (story, entry, anchor chapter or null for the whole story, job and index, the image, prompt, negative, posted, removed): the picture at a chapter is the one anchored nearest to it on its root-to-chapter path, as codex text is folded (`codex.ts`).
   - A codex picture page (`kind: "codex"` target): the prompt written from the entry's text as of a chapter, aimed at a clear full-body picture on a plain background; saving it asks which chapter it starts from.
   - The Codex panel shows each entry's picture and links to its page. The picker gets a Codex tab, and entries whose name or aliases are in the prompt or scene are suggested with their picture as of this chapter.
   - Instruct prompts written by the AI are told which reference is which ("image 2 is Jim").
4. **A story style picture** (a story setting), added to every job in style-transfer mode, with a switch to leave it out.
5. **Later:** a region per character for two-character scenes (IP-Adapter `attn_mask`), the face adapter, Flux Redux for the Flux family.

**Check on the real ComfyUI** (when the owner is at it, before relying on stage 2): install `ComfyUI_IPAdapter_plus` and the files above, then for an Illustrious or NoobAI checkpoint and a furry merge: a character picture as a reference for a new scene, a header as a reference for its footer, and a style reference. Note the strengths that work and the time each reference adds, and put better defaults in.

## Also planned (from the pictures plan)

- **Consistent characters:**
  - A per-character "look" as a fixed tag string taken from the codex (the reference picture is planned above).
  - A LoRA per story could be a workflow setting.
