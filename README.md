# StoryTime

Branching, choose-your-own-adventure stories, with optional AI help. It is a single-user app: there
are no accounts, logins or author names, and anyone who can reach the site can read and edit
everything. You bring your own AI (OpenAI, Anthropic, OpenRouter, or a local model through Ollama), and your keys
never leave your browser.

## What it does

- **Read and write** branching stories. Any chapter can have any number of choices; a choice stays
  "unwritten" until a chapter is written for it.
- **AI drafting** in the browser, in four steps: brainstorm ideas and pick the codex entries, have
  the AI write the chapter from the story so far (revise, undo, step between drafts), write or
  generate a summary and choices, then post. "Continue with AI" jumps straight to a draft.
- **Covers**: the story list shows each story as a book cover in a grid. Upload one from the story's
  details page; stories without one get a generated cover.
- **Style notes**: per-story instructions for the AI (point of view, tense, tone, things to avoid),
  sent with every drafting prompt. Set them when starting a story, or change them from the Style
  notes section on any writing page; a change is tried out on that page until you save it for the
  whole story.
- **Codex**: per-branch notes on characters, places and facts (a character who turns into a horse
  stays human on other branches). The AI can scan chapters for entries, draft entries, and bring an
  entry up to date with the story. While writing, you can read, edit and add entries without leaving
  the page; those changes stay in the draft and are saved with the chapter when it is posted (or
  straight away, if you date them to an earlier chapter).
- **Edit chapters later**; every earlier version is kept.
- **Outline and export**: a tree view of every branch, and downloads as readable Markdown, a single
  HTML file that plays the story offline (it remembers what the reader has seen, and can forget it),
  Twine (Twee) or full JSON. The HTML and Twine files include only finished branches. Any
  chapter (from its page or the outline) can also export just the route from the first chapter to
  it as one continuous Markdown read, and the codex page downloads that branch's codex as a
  Markdown "story bible".
- **Maintenance**: a command-line tool for backups, removing and restoring items, and reverting chapters.

## Run locally

```
npm install
npm run dev        # http://localhost:3737
```

Data lives in `data/storytime.db` (SQLite). Override with `STORYTIME_DB=/path/to/file.db`.
Each person opens **Settings** in the app to add connections to their AI servers (several are fine, such as two Ollama machines and OpenRouter), star the models they want, and pick the defaults. While writing, each draft can switch to any starred model for writing and for suggestions.

Settings has four tabs:

- **Connections:** the AI servers, and the address of the ComfyUI machine that makes pictures.
- **Writing:** the starred models, the default models, and options such as temperature and the context budget.
- **Pictures:** the ComfyUI setup check, then one card for new pictures and Redraw (the redraw strength, your own
  workflow, and the built-in workflow's steps, CFG and sampler) and one card per edit model (see
  [Edit models in ComfyUI](#edit-models-in-comfyui)).
- **Backup:** export the settings to a file, or import them.

Each tab has its own address (`/settings#pictures`), so a link or a reload comes back to it.

## Running on Unraid (or any Docker host)

The app is one container with one data folder. There is no registry or prebuilt image: Docker
downloads the source from GitHub and builds it when you start the stack (the first build takes a few
minutes). Use the Compose Manager plugin on Unraid, or any machine with Docker Compose:

```
# docker-compose.yml (the one in this repo works as is)
services:
  storytime:
    build: https://github.com/tfProxy/StoryTime.git#main
    ports: ["3737:3737"]
    volumes: ["/mnt/user/appdata/storytime:/data"]
    environment:
    restart: unless-stopped
```

Then `docker compose up -d --build`. The site is on port 3737. Settings can come from environment
variables or a `.env` file next to the compose file: `STORYTIME_PORT` (published port) and
`STORYTIME_DATA` (data folder, default `./data`).

**Updating:** Compose doesn't notice new commits by itself. To get the latest code run
`docker compose build --pull --no-cache && docker compose up -d`. Database upgrades happen
automatically on start. The repository must be public (or put an access token in the URL).

**Without Compose:** `docker build -t storytime https://github.com/tfProxy/StoryTime.git` and then
`docker run -d -p 3737:3737 -v /mnt/user/appdata/storytime:/data storytime`.

Notes:

- Put the data folder in your appdata backups, or use the built-in consistent copy, which is safe
  while the app runs: `docker exec storytime node scripts/admin.mjs backup /data/backups/storytime-$(date +%F).db`.
- The container reports health at `/api/health`.
- The site has no logins, so anyone who can reach it can read, post and edit. Keep it on your home
  network, reach it over a VPN such as Tailscale, or put it behind a reverse proxy that adds its own
  authentication before exposing it any further.
- Local AI with Ollama: the browser talks to Ollama directly, so Ollama must allow the site's
  address (`OLLAMA_ORIGINS`), and the Ollama URL in each person's Settings must be reachable from
  their browser (use the PC's or server's LAN address, not `localhost`, unless Ollama runs on the
  same machine as the browser).

## Picture presets

Pictures are made with named presets, set in **Settings**, one tab for each kind:

- **Drawing**: how new pictures are drawn, and redrawn from a picture. Each drawing preset has its
  own checkpoint, LoRAs (see [Your own LoRAs](#your-own-loras)), Redraw strength, sampler settings and,
  optionally, a workflow of your own.
- **Qwen edit** and **Flux edit**: how pictures are edited by instruction with each edit model. Each
  edit preset has its own LoRAs, Fast box, default strength and the model's settings.

Each preset is a card: its name and a summary line, opened to change it. **Duplicate** copies one to
try a variation, **New … preset** adds an empty one, and **Delete** asks first (the last preset of
a kind can't be deleted). Each tab also has **Check setup**, which asks ComfyUI what it has (see
[step 5](#5-restart-comfyui-and-check)).

Which drawing preset a picture uses:

1. Each story chooses one on its details page, under **Pictures** (with its prompt style and art
   style). A story that hasn't chosen one uses the top preset; **Move to top** on a card changes
   which that is.
2. On a chapter's Illustrate page, **Make pictures** has a **Preset** menu, which starts on the
   story's (marked "the story's"). Choosing another is saved for that chapter only; choosing the
   story's again makes the chapter follow the story.

The edit presets are chosen on the Illustrate page's Edit tab, from one menu that lists each model's
presets under its name; the last one used is remembered.

Upgrading from a version without presets: the first time StoryTime starts, your picture settings
become presets. Each checkpoint your stories used becomes a drawing preset named after it (one named
"Default" when they all used the same one), with your workflow, Redraw strength and sampler settings,
and each story uses the one with its checkpoint. Each edit model gets a "Default" preset with its
LoRA stack, Fast box and settings.

## Edit models in ComfyUI

On a chapter's Illustrate page, a picture's ☰ menu has two ways to start from it:

- **Redraw from this** makes new pictures from the prompt, starting from the picture, with a
  Strength slider (low keeps it close, high changes more).
- **Edit this** changes the picture by following an instruction, such as "remove the logo on his
  shirt" or "add more smoke around him". The prompt isn't used. Each click makes one edit with a new
  seed, and **Edit this** on an edit carries on from it.

Both open the same starting picture, on the Redraw or the Edit tab, and you can switch tabs. Edits
need one of two edit models on your ComfyUI machine. **Edit this** stays greyed out until ComfyUI
has at least one of them.

| Model | Good at | Download size | Graphics card |
| --- | --- | --- | --- |
| Qwen-Image-Edit (2509) | Precise changes: removing or adding things, text, clothes | about 30 GB | 24 GB is comfortable; 16 GB works if the PC has 64 GB of RAM (ComfyUI moves part of the model there, which is slower) |
| FLUX.1 Kontext dev | Keeping a character the same while changing the scene or the style | about 17 GB | 12 to 16 GB |

You can install one or both. Each edit loads its model, so the first edit after making ordinary
pictures (or after a text model has used the card) takes longer.

### 1. Update ComfyUI

The edit models need a ComfyUI from autumn 2025 or newer.

- **ComfyUI Desktop:** it updates itself; restart it to pick up an update.
- **Windows portable:** run `update\update_comfyui.bat`.
- **Installed with git:** in the ComfyUI folder, run `git pull`, then
  `pip install -r requirements.txt` in the same Python environment ComfyUI uses.
- **ComfyUI Manager:** Manager › Update ComfyUI, then restart.

### 2. Find the models folder

Every file below goes in a subfolder of ComfyUI's `models` folder:

- Windows portable: `ComfyUI_windows_portable\ComfyUI\models`
- git install: `ComfyUI/models`
- ComfyUI Desktop: `Documents\ComfyUI\models` (or the folder you chose when installing)

The subfolders (`diffusion_models`, `text_encoders`, `vae`, `loras`) already exist; create any that don't. A
file can also go in a subfolder of its own, such as `diffusion_models/qwen/`.

### 3. Download Qwen-Image-Edit

| File | Put it in | Size |
| --- | --- | --- |
| [qwen_image_edit_2509_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | `models/diffusion_models` | about 20 GB |
| [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `models/text_encoders` | about 9 GB |
| [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `models/vae` | about 250 MB |

#### Optional: the Lightning LoRA, for fast Qwen edits

Out of the box, a Qwen edit runs 20 steps at CFG 2.5, which can take a minute or more per picture.
The Lightning LoRA from lightx2v is trained to do the same job in 4 (or 8) steps at CFG 1, so an
edit is several times faster. It gives up a little fine detail; the 8-step version gives up less.

| File | Put it in | Size |
| --- | --- | --- |
| [Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-4steps-V1.0-bf16.safetensors) (fastest) | `models/loras` | under 1 GB |
| or [Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors](https://huggingface.co/lightx2v/Qwen-Image-Lightning/resolve/main/Qwen-Image-Edit-2509/Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors) (a little better, half as fast) | `models/loras` | under 1 GB |

- Take the LoRA made for your model's release: the **2509** LoRA for the 2509 model. The
  [lightx2v/Qwen-Image-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Lightning) page has
  one folder per release. The ones named `Qwen-Image-Lightning-…` (without "Edit") are for
  Qwen-Image, which makes pictures from a prompt, and don't work for edits.
- StoryTime reads the number of steps from the file name (`4steps`, `8steps`). If you put several
  in `loras`, it uses one whose name has the same release number as the model (such as 2509), and
  otherwise the 4-step one above.
- Once the LoRA is installed, the Edit tab shows a **Fast (Lightning, 4 steps)** box under the preset
  menu when a Qwen-Image-Edit preset is chosen, and each Qwen preset in **Settings › Qwen edit** has
  the same box. It starts ticked; untick it for the full steps when you want the most detail. The
  choice is kept with the preset. Pictures made fast say "fast" in their caption, and Info lists the
  LoRA beside the model file.
- FLUX.1 Kontext has no Lightning LoRA here; it always runs its full steps (20 unless you change
  them, see [Each preset's settings](#each-presets-settings)).

### 4. Download FLUX.1 Kontext dev

| File | Put it in | Size |
| --- | --- | --- |
| [flux1-dev-kontext_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/split_files/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors) | `models/diffusion_models` | about 12 GB |
| [clip_l.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors) | `models/text_encoders` | about 250 MB |
| [t5xxl_fp8_e4m3fn_scaled.safetensors](https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn_scaled.safetensors) | `models/text_encoders` | about 5 GB |
| [ae.safetensors](https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors) | `models/vae` | about 330 MB |

FLUX.1 Kontext dev is under Black Forest Labs' non-commercial licence, which suits a personal story
app. If you already make pictures with FLUX.1, you probably have `clip_l`, `t5xxl` and `ae`
already.

The links download straight away in a browser. For files this big a download manager or the
command line can resume a broken download, for example `curl -L -C - -O <link>` (in PowerShell,
`curl.exe`). If a link stops working, search Hugging Face for the file name.

### 5. Restart ComfyUI and check

Restart ComfyUI so it lists the new files. Then, in StoryTime, open the **Qwen edit** (or **Flux
edit**) tab of **Settings** and press **Check setup**. (The ComfyUI address is on the
**Connections** tab.) Each tab shows what the check found for it:

- **Drawing**: the checkpoints, and for each drawing preset whether ComfyUI has its checkpoint, its
  LoRAs and the nodes its workflow uses;
- **Qwen edit** and **Flux edit**: whether ComfyUI has each file and the nodes the model needs. A
  missing file is named with the folder it goes in. Missing nodes, or a text encoder type ComfyUI
  doesn't know, mean ComfyUI needs updating (step 1). For Qwen-Image-Edit, also the Lightning LoRA it
  found and its steps, or that it isn't installed. It is optional: Qwen is ready without it.

Each edit model's tab also says whether the model is installed. A model's presets can be chosen on
the Illustrate page only when everything it needs is there. The check looks
for the files above by name, and also accepts other versions of the same file, such as a bf16
model, another fp8 version, `t5xxl_fp16`, or a newer Qwen-Image-Edit release. If several match, the
one listed above is used. A preset can also choose its own files (see
[Your own edit models](#your-own-edit-models)). GGUF versions are not supported, because they need a
custom loader node.

### Your own LoRAs

Every preset, drawing or edit, has a LoRA stack of its own, such as one for a story's main character
or for an art style, so its pictures keep that look.

1. Put the LoRA files in `ComfyUI/models/loras` (a subfolder is fine) and restart ComfyUI. Use LoRAs
   made for the model they go with: for a drawing preset, one made for its checkpoint's kind of model
   (SDXL, Pony, SD 1.5…); for an edit preset, a Qwen-Image or Qwen-Image-Edit LoRA for
   Qwen-Image-Edit, a FLUX.1 LoRA for FLUX.1 Kontext. A LoRA made for another kind of model has no
   effect: ComfyUI skips the parts that don't fit and says so in its console.
2. In **Settings**, open the preset's card and, under **LoRAs**, press **Add LoRA to …**, choose
   the file from ComfyUI's list and set its strength: 1 is full strength, 0.5 half, and below 0 works
   against the LoRA. ↑ moves a LoRA earlier; ✕ takes it out. A stack holds up to 8 LoRAs. Settings
   asks ComfyUI for its files each time it opens, so a LoRA added since shows up there.
3. On the Illustrate page, the chosen preset's LoRAs are listed under its menu, each with a box to
   switch it on or off for the next pictures. The boxes are saved with the preset.

The LoRAs apply in the order listed: in a drawing preset, after the checkpoint (with ComfyUI's
**LoraLoader**, so they change the model and the text encoder); in an edit preset, after the
Lightning LoRA when **Fast** is on (with **LoraLoaderModelOnly**, so they change the model but not
the text encoder; a trigger word still works if you put it in the instruction). A drawing preset with
a workflow of your own gets its LoRAs after the workflow's Load Checkpoint node, or after its Load
Diffusion Model node (model only) when it has no checkpoint loader. A LoRA that ComfyUI no longer
lists is marked "missing" on the Illustrate page, and pictures go ahead without it. A picture's
caption says how many LoRAs made it, and **Info** lists each one with its strength.

### Your own edit models

An edit preset can use other model files than the ones found by their names, such as an uncensored
fine-tune. LoRAs alone often can't make an edit model follow instructions it was trained to ignore;
a fine-tuned model can. Open the preset's card in Settings (Qwen edit or Flux edit tab) and its
**Model files**:

- **Model:** a model in `ComfyUI/models/diffusion_models`, or an **all-in-one checkpoint** in
  `ComfyUI/models/checkpoints` (the model, text encoder and VAE in one file, loaded with ComfyUI's
  Load Checkpoint).
- **Text encoder(s)** and **VAE:** another file from their folders. With an all-in-one checkpoint
  they are the checkpoint's own unless you choose one.

Leave a choice on "Found by its name" to keep using the usual file. If ComfyUI no longer lists a chosen
file, the card says so and the Edit tab greys the preset out. The job log and a picture's Info name
the model or checkpoint used.

Some fine-tunes to try:

- **Qwen-Image-Edit Rapid AIO, NSFW** by Phr00t
  ([Hugging Face](https://huggingface.co/Phr00t/Qwen-Image-Edit-Rapid-AIO), marked not for all
  audiences): an all-in-one checkpoint, about 28 GB, with NSFW LoRAs and Lightning merged in. Pick a
  version folder (`vNN/Qwen-Rapid-AIO-NSFW-vNN.safetensors`) and put the file in
  `models/checkpoints`. Reportedly, earlier versions such as v19 keep a picture more consistent, and
  later ones (v22, v23, made from Qwen-Image-Edit 2511) follow the instruction better. Lightning is
  already in it, so untick **Fast**, and under **Advanced** set 4 steps, CFG 1 and the sampler and
  scheduler its page gives for that version (for example lcm / beta).
- **An abliterated Qwen 2.5 VL text encoder**, such as
  [Qwen2.5-VL-7B-Huihui-Abliterated-ComfyUI](https://huggingface.co/ethanfel/Qwen2.5-VL-7B-Huihui-Abliterated-ComfyUI-ConvRot-INT8),
  in `models/text_encoders`: choose it as the preset's text encoder. It is an experiment. The text
  encoder only turns the instruction into numbers and doesn't refuse anything, so the model does more
  than the encoder, and a report found that an abliterated encoder alone changed nothing.
- **FLUX.1 Kontext:** no uncensored Kontext fine-tune was found (as of October 2026). The NSFW Flux
  models, such as Chroma, are built on FLUX.1 dev or schnell and can't edit by instruction. Flux's T5
  text encoder doesn't refuse, so changing it doesn't help.

### Each preset's settings

Each edit preset also has:

- **Default strength:** where the Edit tab's Strength slider starts for that preset. At 1 the model
  follows the instruction freely. Lower, it starts from the picture with less noise on it, so more of
  the picture stays as it was, but too low and the change may not happen at all. You can still move
  the slider on the Edit tab for the edits at hand; it is kept for that chapter, in that browser,
  until you choose another preset.
- **Advanced**, folded away: steps, CFG, sampler and scheduler, plus **Shift** for Qwen-Image-Edit
  and **Guidance** for FLUX.1 Kontext. Each shows its default next to it. The sampler and scheduler
  lists come from your ComfyUI. **Reset to defaults** puts them back (the default strength stays as
  it is).

| Setting | Qwen-Image-Edit | FLUX.1 Kontext | What it does |
| --- | --- | --- | --- |
| Steps | 20 | 20 | More is slower and usually a little cleaner. |
| CFG | 2.5 | 1 | How strongly the instruction is followed; too high looks burnt. Kontext uses Guidance instead, so leave its CFG at 1. |
| Sampler / scheduler | euler / simple | euler / simple | How each step is taken. |
| Shift | 3 | – | Higher spends more of the steps on the big shapes; lower on detail. |
| Guidance | – | 2.5 | How closely Kontext follows the instruction; raise it a little when an edit is ignored. |

With **Fast** on, Qwen edits use the Lightning LoRA's steps (4 or 8) at CFG 1 instead of the steps and
CFG above; the sampler, scheduler and shift still apply.

Drawing presets work the same way for pictures made from a prompt: the **Redraw strength** (where
the Redraw tab's slider starts; moving the slider there is kept for that chapter, in that browser)
and, under Advanced, the built-in SDXL workflow's steps (30), CFG (6), sampler (dpmpp_2m) and
scheduler (karras). A workflow of your own, pasted under **Workflow** in the preset's card, keeps its
own sampler settings; change them in ComfyUI and export it again.

### Tips for instructions

- Say what to change, not the whole scene: "remove the logo on his shirt", "make it night",
  "add more smoke around him", "change her coat to red".
- Change one thing at a time, and use **Edit this** on the result for the next change. Every pass
  softens the picture a little, so a long chain of edits slowly loses detail.
- Edits keep the picture's shape at about one megapixel (a 1344 × 768 picture comes back at
  1360 × 768).
- An edit doesn't use the drawing preset's checkpoint or the story's art style, so a strong style change can drift from
  the rest of the story. Redraw at a low strength brings it back.

## Maintenance

There is no admin page. The command-line tool runs on the machine hosting the database:
`node scripts/admin.mjs help`. In Docker: `docker exec -it storytime node scripts/admin.mjs recent 20`.
It can scan recent activity, delete chapters, choices, stories and codex changes, revert a chapter to
an earlier revision, and make a backup.

Deleting is permanent (take a backup first if you might want it back). Deleting a chapter also
deletes everything below it, and the choice that led to it becomes an unwritten slot again, so a
replacement can be written.

## How it works

- No accounts, logins or author names; one person is assumed.
- The server stores stories (chapters, choices, codex changes), the settings, including AI keys, and
  drafts, so every browser sees the same ones. A draft is saved as you write, along with the page's
  working state (brainstorm ideas, length, codex picks, an unsent instruction), so you can start a
  chapter on one device and finish it on another. If the same draft is changed in two tabs, the
  second save is refused and the page asks which version to keep. Drafts that older versions kept
  in the browser move to the server the first time drafts are opened. The settings page can export
  settings to a file.
- Any chapter can be edited. Every edit keeps the previous version in `chapter_revisions`, and the
  chapter shows an "edited" marker linking to its history.
- The codex is an append-only log per story: each change (create / replace / retire) is anchored at
  a chapter and applies to that chapter and its descendants. The codex at a chapter is the fold of
  the changes on the path from the root to it (deeper anchors win, then later posts). Codex changes
  never touch chapter text, and other branches never see them.
- Each chapter can carry a `summary` (a paragraph about itself, written by you or generated
  from the chapter text) and a `path_summary` (a rolling summary of the story through it). Prompts
  send the most recent chapters verbatim, the ones before as their own summaries, and the rolling
  summary only for whatever is older still, so most of the context is one step from the original
  text. The browser generates them with the cheaper model when a chapter is posted (an edit keeps the
  existing summary unless you change it), and
  fills in any that are missing (for example below an edited chapter) before generating, but only
  when older chapters would not fit in the context budget. They are a cache. A story's
  outline links to a "Redo summaries" page that regenerates all of them from the browser.

## Tests

```
npm test            # unit + API tests (starts a throwaway server and database)
npm run test:unit   # pure-logic tests only
npm run test:api    # HTTP API tests
npm run test:e2e    # browser tests with Playwright (uses Microsoft Edge by default)
npm run test:all    # everything
node tests/run.mjs e2e illustrate-resume   # only the files whose name contains the word(s) given
```

The API and browser suites build the app if needed and run it on port 3111 with a temporary
database; the browser tests also run a fake AI server on port 3222. Set
`E2E_CHANNEL=chrome` (or `bundled`, after `npx playwright-core install chromium`) to use a
different browser, or `E2E_EXECUTABLE=/path/to/chromium` to use a specific browser binary. Pass `--build` (`node tests/run.mjs --build api`) to force a rebuild first.
