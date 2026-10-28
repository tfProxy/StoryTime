# TODO

What is left to do, as a simple list. Finished work isn't listed; the code and tests describe it.

Last checked against the code: 2026-10-27.

## To try on the real machines

Everything below is built and passes its tests against fakes, but has not been tried for real.

**On the NAS**
- [ ] Before updating, check the server can reach ComfyUI and Ollama: `docker exec -it storytime node -e "fetch('http://<comfy-ip>:8188/system_stats').then(r=>r.text()).then(console.log)"`, and the same for `http://<ollama-ip>:11434/api/ps`. Both must print JSON; if not, change the addresses in Settings (Settings › Test from server says the same).
- [ ] Queue 4 pictures on the phone, lock the phone, wait, unlock: they should be ready.
- [ ] Start a write-ahead run, close every tab, reopen later: it should have carried on.
- [ ] Compose Pull and Compose Up during a long picture job: the job should be found again and recorded once.
- [ ] Live updates arrive (the header counts change without a reload). A proxy in front of StoryTime that buffers `text/event-stream` would stop them.

**On a real ComfyUI**
- [ ] Earlier pictures: make some, pin one, reload (only it shows), use one from All, restart ComfyUI, check they still load from `/view`.
- [ ] Start from a picture with the built-in workflow, then with your own exported workflow (with and without `{{image}}`). Check the upload works through your CORS setup and that a 1344 × 768 start picture fits in memory. A workflow with `KSamplerAdvanced` has no `denoise`, so StoryTime says it can't start from a picture; see whether that matters.
- [ ] Reference pictures (IP-Adapter): install `ComfyUI_IPAdapter_plus` and the model files (`docs/pictures.md`). For an Illustrious or NoobAI checkpoint and a furry merge, try a character as a reference for a new scene, a header as the reference for its footer, a style reference, a codex picture, and the story style picture. Note the strengths that work and what each reference adds to the time, then change the defaults. Confirm NoobAI's own adapter beats the SDXL one on Illustrious and furry merges.
- [ ] Refine inpainting: paint a small area (a hand or a face) on a real picture and Go at strength 0.6; compare with before the change (seam, detail, time). Also try a mask near the picture's edge, a picture whose size isn't a multiple of 16, and each **Under the paint** choice. The redraw now runs only the steps its strength needs, so compare two or three pictures for look.

**With your own models and devices**
- [ ] Story review against the real models: Find tags, Help me write it, Check continuity, Check summaries. Prompt quality with a small local model is unknown.
- [ ] Run `npm run test:e2e` with Edge on the Windows machine (`AGENTS.md`); if any file fails only there, note which and why in `AGENTS.md`.
- [ ] A real phone with touch: Review page tabs and checkboxes, the Refine screen.

## To build

Roughly in order of usefulness. Nothing here is agreed to start without asking where it goes in the UI.

**Illustrate and pictures**
- [ ] Forget lost pictures: rejecting hides a picture ComfyUI has lost, but removing the record (`DELETE /api/picture-jobs/:id`) and pruning old rows aren't built.
- [ ] Batching quick Queue clicks per model: today one global Drawing setting (`comfy.batchClicks`); make it per drawing preset or model family (`src/lib/comfy/drawModels.ts`), because some models batch and some don't (Krea 2 doesn't).
- [ ] Settings are saved on every tick while sliding Strength (all settings, including the workflow text). Debounce it if it is noticeable on the NAS.
- [ ] A Scale menu (1×, 1.5×) that resizes the starting picture before re-drawing it.
- [ ] Import from ComfyUI's history (`GET /history?max_items=200`, `listHistory` in `client.ts`) for pictures made before the log existed or in ComfyUI itself: take entries tagged `storytime` or with files starting `StoryTime`; read the prompt back from the stored workflow (`prompt[2]`) with the node-finding in `workflow.ts`.
- [ ] Pictures from other stories, as one more view beside Other chapters.
- [ ] Maybe: the full-size viewer for Other chapters' pictures and the saved header and footer (they open in a new tab now), and pin / reject for pictures in Other chapters.

**Reference pictures and characters**
- [ ] Instruct prompts written by the AI should say which reference is which ("image 2 is Jim").
- [ ] Use as story style picture in a picture's ☰ menu; include the style picture in the JSON export.
- [ ] Upload a picture for a codex entry; codex thumbnails in the writing page's codex drawer.
- [ ] A per-character "look" as a fixed tag string taken from the codex; a LoRA per story as a workflow setting.
- [ ] Later: a region per character for two-character scenes (IP-Adapter `attn_mask`), the face adapter, Flux Redux for the Flux family.

**Inpainting**
- [ ] Masks with the edit models (Qwen-Image-Edit, Kontext): needs a decision on where "edit by instruction, only here" lives in Refine. Technically small: add `mask?` to `EditParams`, call `redrawOnlyMask(wf, mask, "11", "13", …)` in `buildEdit`, and allow masks on edits in `maskOf`, `sameJob` and `pictureJobs.ts` (which rejects them today).
- [ ] Flux Fill and inpaint-trained checkpoints (phase F), and outpainting. Only worth it if Flux redraws still show seams.

**Story review and tags**
- [ ] A short label field on tags (a tag has only a name).
- [ ] Name variants in the codex-gap check ("Jon" and "John"); only exact names and aliases match now.
- [ ] Optional check: tense, point of view or tone drifting from the story's style.
- [ ] Which tags count as changes in the continuity check is fixed in code (`CHANGE_EVENT_TAGS`: tf, tg); make it a setting if wanted.
- [ ] State tags (a stretch like `species: wolf` from one chapter to another, folded along a path). Not wanted for now.
- [ ] A nightly review run for chapters changed that day. Only if asked.

**Server and code**
- [ ] Route the remaining one-off AI calls (codex scan, tag suggestions, summaries, Write prompt, Refine's prompt) through a server `POST /api/ai/chat` stream, so the browser never calls providers and no CORS setup is needed.
- [ ] A `/api/comfy/view` proxy so the Refine canvas can load ComfyUI pictures without CORS.
- [ ] `src/lib/aiRuns/api.ts` goes through a self fetch to the server's own API; it could use SQLite directly.
- [ ] Fix the one known lint error, in `src/components/OutlineSummaries.tsx` (set-state-in-effect).
