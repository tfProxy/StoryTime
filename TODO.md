# TODO

Planned work, with what you need to know to start. Finished work isn't listed; the code and tests describe it.

## How chapter pictures work now

Read this before touching the Illustrate page (`src/app/c/[id]/illustrate/page.tsx`). All ComfyUI calls are made from the browser, never from the StoryTime server.

- **Components** (`src/components/`): `IllustrateWorkspace` holds the state shared by the page (the prompt loaded from a picture, the starting picture, and all of the chapter's pictures as `Picture`s from `pictures.ts`: the page's jobs, then those made on this visit, marked `fresh`) and lays out the two columns: `.illustrate-controls` (the `IllustrateChapter` panel, passed in by the page, then `ImagePromptPanel`: prompt, then `ComfyGenerate`) and `.illustrate-gallery` (the two `ChapterImageEditor` cards first, to compare new pictures with, then `ChapterPictures`). On a wide screen (64rem) the controls column is sticky and the page uses up to 120rem. `ComfyGenerate` queues a job on every click (several can wait in ComfyUI's queue, each with the prompt and settings as they were when queued), lists them with their progress and Stop at the top of the Pictures panel (a portal into `queueSlot`), and hands each finished job's pictures up through `onPictures`. Stop only interrupts a job ComfyUI's `/queue` says is running, since older ComfyUIs interrupt whatever is running.
- **The Pictures panel** (`ChapterPictures`) groups pictures by prompt and negative prompt, newest group first, in views (`inView` in `pictures.ts`): **Pinned & new** (default: pinned, plus this visit's unmarked ones until Clear unpinned), **All** (everything not rejected), **Rejected**, and **Other chapters** (`OtherChapterPictures`: the story's other chapters, paged, through `?story=&not_chapter=`). So on return only pinned pictures show. Clear keeps nothing on the server. Pin (☆/★) and reject (✕, ↺ to restore) sit on the picture; each change saves at once, is put back if the server refuses, and offers Undo. Clicking a picture opens `PictureViewer` (a modal `<dialog>`, whole screen) on it, going through the view's pictures in the order shown: ← → or a swipe, P pins, X rejects (a picture that leaves the view moves the viewer on), Esc closes; it has Use as header/footer and Load prompt too. Ctrl/Cmd/Shift or middle click still opens the picture in a new tab. `PictureTile` is one picture with its mark buttons, Use / Start from this / Load prompt and a caption; `usePictureSaver` saves a picture as the header or footer.
- **ComfyUI code** (`src/lib/comfy/`): `client.ts` (HTTP and WebSocket calls, `uploadImage`), `workflow.ts` (filling a workflow; see below), `startPicture.ts` (`StartPicture`, `fromComfyImage`, `fromSaved`, `uploadStart`).
- **Workflows.** Built-in SDXL text-to-image, and `BUILTIN_IMG2IMG` when a starting picture is chosen. A custom workflow (Settings) is filled by placeholders (`{{prompt}} {{negative}} {{checkpoint}} {{width}} {{height}} {{count}} {{seed}} {{prefix}}`, and for image to image `{{image}} {{denoise}}`), or, with none, by finding the usual nodes. A custom workflow with no placeholders is started from a picture by swapping its `EmptyLatentImage` for LoadImage → VAEEncode → RepeatLatentBatch and setting every numeric `denoise` input; it needs a VAE (a `VAEDecode`'s link or a `CheckpointLoaderSimple`). `describeWorkflow(...).image` says whether a workflow can.
- **The job log** (`picture_jobs`; `src/lib/pictureJobs.ts`; `/api/picture-jobs`). One row per finished job: prompt, negative, checkpoint, size, seed, count, `moment`, `source` (`comfy:<subfolder/file>` or `saved:<chapter id>:<slot>`, null for text-to-image), `denoise`, and `images` (ComfyUI `{filename, subfolder, type}`). `GET ?story=` (optionally `&not_chapter=`) or `?chapter=` lists newest first, `limit` 1 to 200, and `next` is passed back as `before`; each job has `marks`, one per picture (`pinned`, `rejected` or null), from `picture_marks` (migration 13), set with `PUT /api/picture-jobs/:id/mark {index, mark}`. The Illustrate page loads the chapter's latest 1000 jobs with it (`chapterPictureJobs`). The pictures stay in ComfyUI and are shown through its `/view`, so a lost file shows "ComfyUI no longer has this picture".
- **The prompt boxes are kept per chapter** (`picture_drafts`, migration 12; `src/lib/pictureDrafts.ts`; `GET/PUT /api/chapters/:id/picture-draft`): prompt, negative, scene, What to show and moment. The page loads them with the chapter; `usePictureDraft` saves 0.7 s after typing stops, and sends a change still waiting (with `keepalive`) on `pagehide` or when the panel unmounts. Not in the JSON export.
- **A saved header or footer** keeps the prompt and negative prompt that made it (`chapter_images.job_id/prompt/negative`, copied from the job by `PUT .../images/:slot?job=<id>`). Uploads keep none. The job log and `job_id` are not in the JSON export.
- **Jobs are tagged in ComfyUI:** `extra_data.storytime = {chapterId, storyId}`, and saved pictures are filed under `StoryTime/<story id>/<chapter id>` where the workflow's prefix is `StoryTime` or contains `{{prefix}}`.
- **Settings** (`settings.comfy`): url, workflow, checkpoint, width, height, count, denoise (0.05 to 1, default 0.55). They are shared across stories and held on the server.
- **Freeing ComfyUI's memory for a text model:** each AI connection has `freeComfy`. When it is on and a ComfyUI address is set, `streamChat` first sends `POST /free {unload_models, free_memory}` (`freeComfyMemory` in `comfy/client.ts`; 3 s timeout, failures ignored). Not yet tried against a real ComfyUI.
- **Tests:** `tests/e2e/fakeComfy.mjs` is a fake ComfyUI (progress over WebSocket, `/view`, `/history`, `/upload/image`, a `fail` mode). The page's tests are `illustrate-comfy`, `illustrate-past`, `illustrate-start`, `illustrate-chapter`, `illustrate-viewer` and `illustrate-draft` (with `tests/api/picture-drafts`); the workflow logic is in `tests/unit/comfy-workflow.test.mts`.

## Not yet checked against a real ComfyUI

The tests use a fake. Before building more on this, try once on the real machine and write down what differs:

1. Earlier pictures: make pictures, pin one, reload (only it shows), and use one from All. Restart ComfyUI and check the pictures still load from `/view`.
2. Start from a picture with the built-in workflow, then with your own exported workflow (with and without `{{image}}`). Check the upload (`/upload/image`, `type=input`) works through your CORS setup, and that a 1344 × 768 start picture fits in memory.
3. A workflow with `KSamplerAdvanced` has no `denoise` input, so StoryTime says it can't start from a picture. See whether that matters to you.

## Next steps, roughly in order of usefulness

1. **The rest of the Illustrate plan** (agreed with the owner; the layout, prompt grouping, Load prompt from any picture, the job queue, remembered prompts, pin / reject and the full-size viewer are done):
   - Maybe: jobs still running carry on after a reload, found again through ComfyUI's `/history`.
   - Maybe: the viewer for Other chapters' pictures and the saved header and footer (now they open in a new tab).
   - Left out of pin / reject: a ⋯ menu for the picture's other buttons (they fit in one or two lines as they are), and marking pictures in Other chapters.
2. **Say which picture is in use.** Mark the gallery picture that is the current header or footer (the saved picture has `job_id`; it needs the image index too, which isn't stored yet).
3. **Forget lost pictures.** Rejecting hides a picture ComfyUI has lost; removing the record (a `DELETE /api/picture-jobs/:id`) and pruning old rows aren't built.
4. **Settings writes while sliding Strength.** Each tick saves all settings, including the workflow text, to the server. Debounce it if it is noticeable on the NAS.
5. **Scale / upscale pass.** A Scale menu (1×, 1.5×) that resizes the starting picture before re-drawing it. Left out for now.
6. **Import from ComfyUI's history** (`GET /history?max_items=200`) for pictures made before the log existed or in ComfyUI itself. Take entries tagged `storytime` or whose files start with `StoryTime`; the prompt can be read back from the stored workflow (`prompt[2]`) with the node-finding in `workflow.ts`. Not built.
7. **Pictures from other stories** as one more view beside Other chapters. Left out unless asked.
8. **Inpainting** (masking part of a picture) is a separate, larger step.

## Also planned (from the pictures plan)

- **Cover picture:** a version of the Illustrate page for the story's cover. The prompt is harder because the story branches, so it might be written from the premise, the codex and the first chapter, or from a chosen path.
- **Consistent characters:**
  - A per-character "look" (a fixed tag string, or a reference picture for IP-Adapter) taken from the codex, so the same person looks the same in every chapter.
  - A LoRA per story could be a workflow setting.
