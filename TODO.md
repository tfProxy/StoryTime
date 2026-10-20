# TODO

Planned work. Each item says what it is for, how it could be built, and what is still undecided.

## Illustrate chapter page

These build on the page at `src/app/c/[id]/illustrate/page.tsx`, with `ImagePromptPanel` and `ComfyGenerate` in `src/components/`, and the ComfyUI code in `src/lib/comfy/`. All ComfyUI calls are made from the browser, never from the StoryTime server.

### 1. Record how each picture was made (done)

Items 2, 4 and 5 need to know, for a picture, what prompt and settings made it and which chapter it was made for. ComfyUI's own history can't be relied on: it is kept in memory and lost when ComfyUI restarts. Its output files survive a restart, but the API has no way to list them. So StoryTime keeps its own log. What exists now:

- **The job log** (migration 11, `src/lib/pictureJobs.ts`, `src/app/api/picture-jobs/route.ts`).
  - `picture_jobs` has one row per finished job: the prompt, negative prompt, checkpoint, size, seed, count, `moment` (`start` or `end`), `source` and `denoise` (both null until img2img exists), and `images`, the list of ComfyUI `{filename, subfolder, type}`.
  - `ComfyGenerate` records a job with `POST /api/picture-jobs` once ComfyUI has finished. If that fails the pictures still appear, with a message, and can be used; they just have no prompt kept.
  - `GET /api/picture-jobs?story=<id>` or `?chapter=<id>` lists jobs newest first. `limit` is 1 to 200 (default 50). The reply is `{ jobs, next }`: pass `next` back as `before` for the following page; `next` is null at the end.
  - The pictures stay in ComfyUI, so item 2 still has to show them through ComfyUI's `/view`, and say so on a tile whose file is gone.
- **Jobs are tagged in ComfyUI.** `POST /prompt` carries `extra_data: { storytime: { chapterId, storyId } }`, and the saved pictures are filed under `StoryTime/<story id>/<chapter id>`. `fillWorkflow` sets that prefix only where the workflow's `filename_prefix` is `StoryTime` or contains `{{prefix}}`; any other prefix is left alone.
- **A saved header or footer remembers its prompt.** `chapter_images` has `job_id`, `prompt` and `negative` (null for uploads). `PUT /api/chapters/:id/images/:slot?job=<job id>` looks the job up and copies its prompt and negative prompt, so a long prompt never travels in the URL. The job can belong to any chapter, which is what item 2 needs. A job id that isn't known is ignored. The prompt and negative prompt are in the JSON export and import; `job_id` is not, and neither is the job log (the pictures belong to the ComfyUI machine).
- `scripts/adminCore.mjs` deletes a chapter's jobs along with the chapter.
- Not done: pruning old log rows. Rows are small, so it can wait.

### 2. Past pictures, including other chapters'

What it's for: a picture made for one chapter can turn out to suit another, such as the one before.

- A **"Past pictures"** section on the Illustrate page, under the new candidates. It is read from the job log (item 1) for the whole story, newest first.
  - Group the pictures by the chapter they were made for, with the chapter's title, and add a filter for "this chapter" or "this story".
  - Load more as you scroll, or with a "Show more" button.
- Each tile reuses the candidate card: "Use as header picture", "Use as footer picture", "Open full size", plus "Load prompt" (item 3) and "Start from this" (item 4). Using a picture saves it to the chapter whose page is open, whichever chapter it was made for.
- Turn the candidate tile in `ComfyGenerate.tsx` into its own component, so new and past pictures share it.
- Optional extra: import from ComfyUI's history (`GET /history?max_items=200`), for pictures made before the log existed or made in ComfyUI itself. Take only entries tagged `storytime` or whose files start with `StoryTime`. The prompt text can be read back from the workflow stored in the entry (`prompt[2]`), using the same node-finding logic as `promptNodes`.
- Undecided: pictures from other stories would be one more filter. Leave them out unless asked.

### 3. See the chapter while illustrating (done)

`src/components/IllustrateChapter.tsx` shows the chapter being illustrated: its summary (or "No summary yet" with a link to the summary page), a "Show the whole chapter" fold with the text as the reading page shows it, and a "Story so far" fold with the previous chapter's running summary (the text the prompt is written from; absent on a first chapter). Which folds are open is remembered in `localStorage`. On a screen 64rem or wider it sits in a sticky column beside the prompt and the pictures; on a phone it is a block above the prompt. Test: `tests/e2e/illustrate-chapter.e2e.mjs`.

### 4. Bring back the prompt a picture was made with (done)

A saved header or footer that came from ComfyUI shows "Made from: …" (the prompt cut to 160 characters; the full prompt is the tooltip), the checkpoint, size and seed when the job is still in the log, and a **Load prompt** button. It fills in the Prompt and Negative prompt boxes and scrolls to them. `IllustrateWorkspace` holds the prompt box and the picture cards, and `chapterImageMade` (`src/lib/chapterImages.ts`) reads what each saved picture was made from for the server-rendered page. After a load, a **Reuse seed N** box appears beside Make more; it is unticked, and ticking it queues the job with that seed.

- Not done: Load prompt does not change the checkpoint or size settings (they are shared settings, and changing them silently seemed wrong); the card shows them so they can be set by hand. Item 2's past-picture tiles still need their own Load prompt button, which can call the same load.
- Test: `tests/e2e/illustrate-comfy.e2e.mjs` (Made from, Load prompt, Reuse seed, an uploaded picture showing no Made from).

### 5. Image to image, with a strength control

What it's for: making variations of a picture you already have, with a slider for how far they may drift.

- Starting picture: any candidate, past picture, or the chapter's saved header or footer picture ("Start from this" on each tile or card). The chosen one shows as a small thumbnail with a "Clear" button. With nothing chosen, the page makes pictures from the prompt alone as it does now.
- Getting the picture to ComfyUI: `POST /upload/image`, multipart, with fields `image` and `type=input`. The reply gives the name to put in a `LoadImage` node.
  - A picture already in ComfyUI's output folder could be referred to as `"name.png [output]"` without uploading. Check that the installed ComfyUI version accepts that before relying on it.
  - The saved header or footer is fetched from StoryTime's `/api/chapters/:id/images/:slot` and then uploaded.
- Workflow, in `src/lib/comfy/workflow.ts`:
  - Add a built-in img2img variant: `LoadImage` → `VAEEncode` (with the checkpoint's VAE) → `KSampler.latent_image`, with `denoise` set to the strength. For more than one picture, add `RepeatLatentBatch` with `amount = count`.
  - For custom workflows, add `{{image}}` and `{{denoise}}` placeholders. With no placeholders, detect the `EmptyLatentImage` and rewire it automatically, as `fillWorkflow` does for the prompt.
  - Extend `describeWorkflow` so Settings says whether a workflow can do img2img.
- Controls:
  - A **Strength** slider from 0.05 to 1.0, saved in `settings.comfy.denoise` (schema default about 0.55, with `.catch`).
  - Help text: "Low keeps the picture close; high changes more."
  - The Size menu is disabled while a starting picture is chosen, because the size comes from the picture. Optionally, offer a scale (1×, 1.5×) for upscaling passes.
- The job log (item 1) records `source` and `denoise`, so a variation's history can be followed.
- Tests:
  - Unit tests for the img2img workflow building, both built-in and placeholder.
  - Extend `fakeComfy.mjs` with `/upload/image`.
  - An e2e test that starts from a candidate and checks that the queued workflow has a `LoadImage` with the uploaded name and the chosen denoise.
- Undecided: inpainting (masking part of the picture) would be a separate later step, and isn't covered here.

### Order

Items 1, 3 and 4 are done. Next are 2, then 5.

## Also planned (from the pictures plan)

- **Cover picture:** a version of the Illustrate page for the story's cover. The prompt is harder because the story branches, so it might be written from the premise, the codex and the first chapter, or from a chosen path.
- **Consistent characters:**
  - A per-character "look" (a fixed tag string, or a reference picture for IP-Adapter) taken from the codex, so the same person looks the same in every chapter.
  - A LoRA per story could be a workflow setting.
