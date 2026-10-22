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

## Also planned (from the pictures plan)

- **Consistent characters:**
  - A per-character "look" (a fixed tag string, or a reference picture for IP-Adapter) taken from the codex, so the same person looks the same in every chapter.
  - A LoRA per story could be a workflow setting.
