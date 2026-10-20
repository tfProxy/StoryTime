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

The subfolders (`diffusion_models`, `text_encoders`, `vae`) already exist; create any that don't. A
file can also go in a subfolder of its own, such as `diffusion_models/qwen/`.

### 3. Download Qwen-Image-Edit

| File | Put it in | Size |
| --- | --- | --- |
| [qwen_image_edit_2509_fp8_e4m3fn.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors) | `models/diffusion_models` | about 20 GB |
| [qwen_2.5_vl_7b_fp8_scaled.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) | `models/text_encoders` | about 9 GB |
| [qwen_image_vae.safetensors](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors) | `models/vae` | about 250 MB |

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

Restart ComfyUI so it lists the new files. Then, in StoryTime, open **Settings › Pictures (ComfyUI)**
and press **Check setup**. It reports:

- the checkpoints and the nodes your picture workflow uses;
- for each edit model, whether ComfyUI has each file and the nodes it needs. A missing file is named
  with the folder it goes in. Missing nodes, or a text encoder type ComfyUI doesn't know, mean
  ComfyUI needs updating (step 1).

A model is offered on the Illustrate page only when everything it needs is there. The check looks
for the files above by name, and also accepts other versions of the same file, such as a bf16
model, another fp8 version, `t5xxl_fp16`, or a newer Qwen-Image-Edit release. If several match, the
one listed above is used. GGUF versions are not supported, because they need a custom loader node.

### Tips for instructions

- Say what to change, not the whole scene: "remove the logo on his shirt", "make it night",
  "add more smoke around him", "change her coat to red".
- Change one thing at a time, and use **Edit this** on the result for the next change. Every pass
  softens the picture a little, so a long chain of edits slowly loses detail.
- Edits keep the picture's shape at about one megapixel (a 1344 × 768 picture comes back at
  1360 × 768).
- An edit doesn't use the story's checkpoint or art style, so a strong style change can drift from
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
```

The API and browser suites build the app if needed and run it on port 3111 with a temporary
database; the browser tests also run a fake AI server on port 3222. Set
`E2E_CHANNEL=chrome` (or `bundled`, after `npx playwright-core install chromium`) to use a
different browser, or `E2E_EXECUTABLE=/path/to/chromium` to use a specific browser binary. Pass `--build` (`node tests/run.mjs --build api`) to force a rebuild first.
