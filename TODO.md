# TODO

Planned work, with what you need to know to start. Finished work isn't listed; the code and tests describe it.

## How chapter pictures work now

Read this before touching the Illustrate page (`src/app/c/[id]/illustrate/page.tsx`). All ComfyUI calls are made from the browser, never from the StoryTime server.

- **Components** (`src/components/`): `IllustrateWorkspace` holds the state shared by the page (the prompt loaded from a saved picture, and the starting picture). It renders `ImagePromptPanel` (prompt, then `ComfyGenerate`), `PastPictures` and the two `ChapterImageEditor` cards. `PictureTile` is one picture with its Use / Start from this buttons, and `usePictureSaver` saves a picture as the header or footer; both are shared by new and past pictures. `IllustrateChapter` is the chapter panel.
- **ComfyUI code** (`src/lib/comfy/`): `client.ts` (HTTP and WebSocket calls, `uploadImage`), `workflow.ts` (filling a workflow; see below), `startPicture.ts` (`StartPicture`, `fromComfyImage`, `fromSaved`, `uploadStart`).
- **Workflows.** Built-in SDXL text-to-image, and `BUILTIN_IMG2IMG` when a starting picture is chosen. A custom workflow (Settings) is filled by placeholders (`{{prompt}} {{negative}} {{checkpoint}} {{width}} {{height}} {{count}} {{seed}} {{prefix}}`, and for image to image `{{image}} {{denoise}}`), or, with none, by finding the usual nodes. A custom workflow with no placeholders is started from a picture by swapping its `EmptyLatentImage` for LoadImage → VAEEncode → RepeatLatentBatch and setting every numeric `denoise` input; it needs a VAE (a `VAEDecode`'s link or a `CheckpointLoaderSimple`). `describeWorkflow(...).image` says whether a workflow can.
- **The job log** (`picture_jobs`; `src/lib/pictureJobs.ts`; `/api/picture-jobs`). One row per finished job: prompt, negative, checkpoint, size, seed, count, `moment`, `source` (`comfy:<subfolder/file>` or `saved:<chapter id>:<slot>`, null for text-to-image), `denoise`, and `images` (ComfyUI `{filename, subfolder, type}`). `GET ?story=` or `?chapter=` lists newest first, `limit` 1 to 200, and `next` is passed back as `before`. The pictures stay in ComfyUI and are shown through its `/view`, so a lost file shows "ComfyUI no longer has this picture".
- **A saved header or footer** keeps the prompt and negative prompt that made it (`chapter_images.job_id/prompt/negative`, copied from the job by `PUT .../images/:slot?job=<id>`). Uploads keep none. The job log and `job_id` are not in the JSON export.
- **Jobs are tagged in ComfyUI:** `extra_data.storytime = {chapterId, storyId}`, and saved pictures are filed under `StoryTime/<story id>/<chapter id>` where the workflow's prefix is `StoryTime` or contains `{{prefix}}`.
- **Settings** (`settings.comfy`): url, workflow, checkpoint, width, height, count, denoise (0.05 to 1, default 0.55). They are shared across stories and held on the server.
- **Tests:** `tests/e2e/fakeComfy.mjs` is a fake ComfyUI (progress over WebSocket, `/view`, `/history`, `/upload/image`, a `fail` mode). The page's tests are `illustrate-comfy`, `illustrate-past`, `illustrate-start` and `illustrate-chapter`; the workflow logic is in `tests/unit/comfy-workflow.test.mts`.

## Not yet checked against a real ComfyUI

The tests use a fake. Before building more on this, try once on the real machine and write down what differs:

1. Past pictures: make pictures, reload, and use one from "Past pictures". Restart ComfyUI and check the pictures still load from `/view`.
2. Start from a picture with the built-in workflow, then with your own exported workflow (with and without `{{image}}`). Check the upload (`/upload/image`, `type=input`) works through your CORS setup, and that a 1344 × 768 start picture fits in memory.
3. A workflow with `KSamplerAdvanced` has no `denoise` input, so StoryTime says it can't start from a picture. See whether that matters to you.

## Next steps, roughly in order of usefulness

1. **Load prompt should also offer the checkpoint and size.** The job log has them. Now only the prompt, negative and seed are brought back, because the checkpoint and size are shared settings. Option: a "Also use its checkpoint and size" tick beside Reuse seed.
2. **Keep Past pictures current.** It lists what existed when the page opened, so pictures made since appear only under the new pictures. Refresh it when a job is recorded and hide the jobs already shown above, so nothing is shown twice. This needs `ComfyGenerate` to tell the workspace (a callback through `ImagePromptPanel`).
3. **Say which picture is in use.** Mark the past picture that is the current header or footer (the saved picture has `job_id`; the tile needs the image index too, which isn't stored yet).
4. **Forget lost pictures.** When a past picture's file is gone, offer to remove the record (a `DELETE /api/picture-jobs/:id`), and think about pruning old rows.
5. **Settings writes while sliding Strength.** Each tick saves all settings, including the workflow text, to the server. Debounce it if it is noticeable on the NAS.
6. **Scale / upscale pass.** A Scale menu (1×, 1.5×) that resizes the starting picture before re-drawing it. Left out for now.
7. **Import from ComfyUI's history** (`GET /history?max_items=200`) for pictures made before the log existed or in ComfyUI itself. Take entries tagged `storytime` or whose files start with `StoryTime`; the prompt can be read back from the stored workflow (`prompt[2]`) with the node-finding in `workflow.ts`. Not built.
8. **Pictures from other stories** as one more filter in Past pictures. Left out unless asked.
9. **Inpainting** (masking part of a picture) is a separate, larger step.

## Also planned (from the pictures plan)

- **Cover picture:** a version of the Illustrate page for the story's cover. The prompt is harder because the story branches, so it might be written from the premise, the codex and the first chapter, or from a chosen path.
- **Consistent characters:**
  - A per-character "look" (a fixed tag string, or a reference picture for IP-Adapter) taken from the codex, so the same person looks the same in every chapter.
  - A LoRA per story could be a workflow setting.
