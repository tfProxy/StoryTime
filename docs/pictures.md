# Pictures with ComfyUI

How to set up the machine that makes StoryTime's pictures, and how to use presets, LoRAs and the edit models. The code behind the Illustrate page is described in `docs/illustrate.md`.

## Picture presets

Pictures are made with named presets, set in **Settings**, one tab for each kind:

- **Drawing**: how new pictures are drawn, and redrawn from a picture. Each drawing preset has its
  own **Model type** (a checkpoint, or one of the
  [newer models](#newer-models-z-image-flux-chroma-qwen-image)), checkpoint or model files, LoRAs
  (see [Your own LoRAs](#your-own-loras)), Redraw strength, sampler settings and, optionally, a
  workflow of your own.
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

## Newer models (Z-Image, Flux, Chroma, Qwen-Image, Krea 2)

A drawing preset draws with an all-in-one SDXL-style checkpoint by default (Model type **Checkpoint**).
Newer models don't come as one file: they are a **diffusion model**, a **text encoder** (Flux has two) and a
**VAE**, which ComfyUI loads separately. Choose the model in the drawing preset's **Model type** menu and
StoryTime draws with its own built-in workflow for it, with no workflow to paste. (A workflow pasted in
the preset's card still overrides everything.)

| Model type | Folder | Recommended file | Where to get it |
| --- | --- | --- | --- |
| Z-Image (Turbo) | `models/diffusion_models` | `z_image_turbo_bf16.safetensors` | [Comfy-Org/z_image_turbo](https://huggingface.co/Comfy-Org/z_image_turbo/tree/main/split_files) |
| | `models/text_encoders` | `qwen_3_4b.safetensors` | the same repository |
| | `models/vae` | `ae.safetensors` (the Flux VAE) | the same repository |
| Flux | `models/diffusion_models` | `flux1-dev-fp8.safetensors` (the diffusion model alone, not an all-in-one checkpoint) | [Kijai/flux-fp8](https://huggingface.co/Kijai/flux-fp8), or a Flux fine-tune from Civitai |
| | `models/text_encoders` | `clip_l.safetensors` and `t5xxl_fp8_e4m3fn_scaled.safetensors` | [Comfy-Org/flux_text_encoders](https://huggingface.co/Comfy-Org/flux_text_encoders/tree/main) |
| | `models/vae` | `ae.safetensors` | the Z-Image repository above, or [black-forest-labs/FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell/tree/main) |
| Chroma | `models/diffusion_models` | `Chroma1-HD.safetensors` | [lodestones/Chroma1-HD](https://huggingface.co/lodestones/Chroma1-HD/tree/main) |
| | `models/text_encoders` | `t5xxl_fp8_e4m3fn_scaled.safetensors` | [Comfy-Org/flux_text_encoders](https://huggingface.co/Comfy-Org/flux_text_encoders/tree/main) |
| | `models/vae` | `ae.safetensors` | as for Flux |
| Qwen-Image | `models/diffusion_models` | `qwen_image_fp8_e4m3fn.safetensors` | [Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/tree/main/split_files) |
| | `models/text_encoders` | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | the same repository |
| | `models/vae` | `qwen_image_vae.safetensors` | the same repository |
| Krea 2 (Kroma) | `models/diffusion_models` | `kroma-v0.3.1-turbo-opd.safetensors` | [lodestones/Kroma](https://huggingface.co/lodestones/Kroma/tree/main), or Krea 2 itself |
| | `models/text_encoders` | `qwen3vl_4b_bf16.safetensors` | [Comfy-Org/Qwen3-VL](https://huggingface.co/Comfy-Org/Qwen3-VL/tree/main/text_encoders) |
| | `models/vae` | `wan_2.1_vae.safetensors` | [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/vae) |

Qwen-Image's text encoder and VAE are the ones the Qwen edit tab uses, so if you set that up
(step 3 of [Edit models in ComfyUI](#edit-models-in-comfyui)) you already have them. The model is a
different file: **Qwen-Image**, not Qwen-Image-Edit. A preset finds only its own model by name, so the
two sit side by side in `models/diffusion_models`.

The repositories of **Comfy-Org** are ComfyUI's own repackaged copies, so their file names are the ones
StoryTime looks for. Open the repository's `split_files` folder and download each file into the folder
in the table (a subfolder is fine), then restart ComfyUI. A preset finds each file by its name, and
also accepts other versions of it (a bf16 or fp8 model, a fine-tune with the model's name in its file
name), so a preset only needs to **choose** a file when the one found isn't the one you want.

### Settings

In **Settings › Drawing**, a preset's card has:

- **Model type**: Checkpoint (SDXL, Pony, Illustrious, SD 1.5), Z-Image, and so on. Choosing a type
  puts the prompt style on **Sentences** (these models understand sentences, not tag lists), puts the
  **Advanced** sampler settings back to that model's defaults and clears the chosen model files, so
  any changes you made to them are lost. (Your LoRAs, prompts and Redraw strength stay.)
- **Model**, **Text encoder** and **VAE** menus instead of the Checkpoint menu. Each starts on "Found
  by its name" and shows the file it would use. They list the files ComfyUI has, and a `.gguf` file is
  marked "(GGUF)". A fine-tune from Civitai goes in `models/diffusion_models` like the original
  (see [GGUF models](#gguf-models)).
- **Keep the text encoder on the CPU**: loads the text encoder into system memory so the graphics card
  has room for the model; reading the prompt is a little slower.
- **Advanced**: steps, CFG, sampler and scheduler, and **Shift** where the model has one. Each shows its default.

The card tells you when ComfyUI doesn't have a file or a node the preset needs. **Check setup** on the
Drawing tab lists, for each preset, the files it found, the nodes it needs and "install ComfyUI-GGUF" when
you chose a `.gguf` file and ComfyUI can't load it.

A picture's log entry and **Info** show the model file (and LoRAs). LoRAs for these presets go on the
model only; use LoRAs made for the same model (a Z-Image LoRA for Z-Image).

### Krea 2 (Kroma)

Photographic, and quick: 8 steps of Euler at CFG 1, so like Z-Image the **negative prompt does nothing**.
It follows [the Kroma / Krea 2 workflow](https://gabrielx.com/comfyui-kroma-chroma-krea-2-simple-workflow-with-amateur-slider-and-2x-upscale/):
a text-to-image picture is scaled up 2x (lanczos) and redrawn lightly by a second sampler (4 steps of
`res_multistep` beta at a denoise of 0.14, which adds detail and grain; ComfyUI has `res_multistep`
itself, no custom node). The pictures therefore come out twice the size you choose; set **Upscale**
under Advanced to 1 to skip that pass, or to another number to scale by that. Redraw (from a starting
picture) never does the second pass. The **Amateur slider** is a LoRA, not a setting: download
`AmateurSlider-KREA2_v1.safetensors` into `models/loras` and add it to the preset's LoRAs (1.1 looks
amateur; negative values look more polished, down to -2). The text encoder type is `krea2`, which needs
a recent ComfyUI.

### Z-Image Turbo

The fastest of them: 9 steps of `res_multistep` at CFG 1, so a picture takes seconds. Because it runs
at CFG 1, the **negative prompt does nothing**. Its prompts are sentences. The bf16 file is about 12 GB,
more than a 12 GB card holds with the text encoder, so ComfyUI moves parts of it to system memory,
which is slower. A GGUF quant of the model (search Hugging Face for "Z-Image-Turbo GGUF"; a Q6_K or
Q8_0 file) fits whole, and ComfyUI-GGUF loads it (see [GGUF models](#gguf-models)).

### Flux

FLUX.1 dev (or schnell) and fine-tunes of them. The workflow is ComfyUI's usual Flux one: two text
encoders (CLIP-L and T5-XXL), a **Guidance** setting (3.5; it is in Advanced) instead of CFG, and 20
steps of Euler. Flux has no negative prompt, so that box does nothing. For **schnell** or a
fine-tune that is distilled to fewer steps, set the steps under Advanced to what its page says (4 for
schnell). The model file must be the diffusion model alone; an all-in-one `flux1-dev-fp8` checkpoint
(which Comfy-Org's repository has) goes in `models/checkpoints` and is not what this preset loads. The
files of FLUX.1 Kontext (the editing model) and Chroma are not taken for a Flux model.

12 GB: the fp8 model (about 12 GB) is more than the card holds with the text encoders, so ComfyUI
moves parts to system memory. A **Q4_K_S** or **Q5_K_S** GGUF quant of FLUX.1 dev
([city96/FLUX.1-dev-gguf](https://huggingface.co/city96/FLUX.1-dev-gguf), or `FLUX.1-schnell-gguf`)
fits; a GGUF T5-XXL (`t5-v1_1-xxl-encoder-Q5_K_M.gguf`, in
[city96/t5-v1_1-xxl-encoder-gguf](https://huggingface.co/city96/t5-v1_1-xxl-encoder-gguf)) also works.
Turning on **Keep the text encoder on the CPU** (62 GB of RAM is plenty) leaves the card to the model.

### Chroma

An uncensored model built from FLUX.1 schnell, trained for real CFG: the default is 26 steps of Euler
with the beta scheduler at **CFG 4**, so unlike Flux, the **negative prompt matters** (put things like
"lowres, watermark, deformed" in the preset's negative prompt). It needs only the T5-XXL text encoder
(no CLIP-L) and the same VAE. If ComfyUI has the `T5TokenizerOptions` node, the workflow uses it as
ComfyUI's own template does; without it the picture is still drawn. Chroma is a smaller model than
Flux (about 9 billion parameters), so a **Q5** or **Q4** GGUF quant (search "Chroma1-HD GGUF"; for
example from silveroxides on Hugging Face) fits a 12 GB card whole, with the text encoder on the CPU.

### Qwen-Image

A 20-billion-parameter model that follows long, detailed prompts closely and can draw readable text
(a sign, a book cover's title). Prompts are sentences. It uses a real negative prompt at **CFG 2.5**,
20 steps of Euler, and **Shift** 3.1 (ComfyUI's own template). It is the heaviest of these: the fp8
model is about 20 GB and its Qwen 2.5 VL text encoder about 9 GB. On a 12 GB card use a **Q4** GGUF quant
([unsloth/Qwen-Image-GGUF](https://huggingface.co/unsloth/Qwen-Image-GGUF) or
[city96/Qwen-Image-gguf](https://huggingface.co/city96/Qwen-Image-gguf): Q4_K_S or Q4_0) and turn on
**Keep the text encoder on the CPU** (the PC's 62 GB of RAM holds it), which leaves the card to the model;
reading the prompt is then a little slower. Keep the text encoder as the fp8 safetensors file: it
needs no extra node, and is the safe choice (a GGUF one also loads, with ComfyUI-GGUF; a drawing
doesn't need the `mmproj` file that editing a picture does). Qwen-Image runs at 20 steps, so a picture
takes noticeably longer than Z-Image's.

## Reference pictures (IP-Adapter)

Reference pictures (a character, an outfit, a place, so the same one comes back) are drawn with
**IP-Adapter** on your drawing preset's own checkpoint, so the preset keeps its look. This is optional: a
preset without it draws exactly as before. Settings › Drawing › **Check setup** shows a "Reference pictures
(IP-Adapter)" line under each checkpoint preset, saying "ready" or what is missing. (Pictures can't use
references yet; this is the setup for when they can.)

1. **Install the nodes.** In ComfyUI-Manager search for **ComfyUI_IPAdapter_plus** (by cubiq) and install it,
   or `git clone` <https://github.com/cubiq/ComfyUI_IPAdapter_plus> into `ComfyUI/custom_nodes`, then
   restart ComfyUI. Until you do, the check says "install ComfyUI_IPAdapter_plus through ComfyUI-Manager".
2. **Choose the preset's Model base** (Settings › Drawing, on the preset's card). It decides which files are
   used. Left on "Guess from the file name", a name with "noob" is NoobAI, one with "illustrious", "illu",
   "ilxl" or "_il" followed by a version (`novaFurryXL_ilV180A`) is Illustrious, one with "pony" or "pdxl" is Pony, and anything else is SDXL. Choose it yourself
   when the name doesn't say.
3. **Download the two files** for that base. Create the folders if they aren't there, then restart ComfyUI.

| Model base | Put in `ComfyUI/models/ipadapter` | Put in `ComfyUI/models/clip_vision` |
| --- | --- | --- |
| SDXL, Pony | `ip-adapter-plus_sdxl_vit-h.safetensors` | `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` |
| NoobAI, Illustrious | `noobIPAMARK1_mark1.safetensors` | `CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors` |

Where to get them:

- **SDXL and Pony:** the [h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter) page on Hugging Face. The
  adapter is `sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors`. The CLIP Vision model is
  `models/image_encoder/model.safetensors` there; save it under the name in the table.
- **NoobAI and Illustrious:** [Laxhar/noob_ipa](https://huggingface.co/Laxhar/noob_ipa) on Hugging Face has
  the adapter (`noobIPAMARK1_mark1.safetensors`). Check that page for the CLIP Vision model it names (it uses
  the larger bigG one, `CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors`) and download that one.

Pony works less well: the SDXL adapter wasn't trained on Pony's way of describing pictures, so a Pony
checkpoint follows a reference less closely than a NoobAI or Illustrious one does. The files are the same
as for SDXL, so it is set up in the same way.

### When a reference pulls in its drawing style

A character, item or place reference is followed up to halfway through the steps, at a strength you set
per reference (a lower strength pulls less). If the reference still drags its look into the picture, two
settings on the drawing preset's card (Settings › Drawing) change how:

- **Reference mode** chooses which layers of the model see the reference. "Everything" is the default. The
  "weaker" modes hold some layers back; which one keeps a character without its style depends on the model,
  so try them one at a time with the same prompt and seed.
- **Reference stops at** is how far through the steps the reference is followed. Earlier lets the model's
  own style take over sooner.

Style references ignore both and always run to the end.

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

- **Drawing**: the checkpoints, and for each drawing preset whether ComfyUI has its checkpoint (or,
  for a [newer model](#newer-models-z-image-flux-chroma-qwen-image), each file it needs), its LoRAs
  and the nodes its workflow uses;
- **Qwen edit** and **Flux edit**: whether ComfyUI has each file and the nodes the model needs. A
  missing file is named with the folder it goes in. Missing nodes, or a text encoder type ComfyUI
  doesn't know, mean ComfyUI needs updating (step 1). For Qwen-Image-Edit, also the Lightning LoRA it
  found and its steps, or that it isn't installed. It is optional: Qwen is ready without it.

Each edit model's tab also says whether the model is installed. A model's presets can be chosen on
the Illustrate page only when everything it needs is there. The check looks
for the files above by name, and also accepts other versions of the same file, such as a bf16
model, another fp8 version, `t5xxl_fp16`, or a newer Qwen-Image-Edit release. If several match, the
one listed above is used. A preset can also choose its own files (see
[Your own edit models](#your-own-edit-models)). GGUF versions work too, with an extra custom node
(see [GGUF models](#gguf-models)).

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
**LoraLoader**, so they change the model and the text encoder; a preset of a newer model type uses
**LoraLoaderModelOnly**, like the edit presets); in an edit preset, after the
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

- **Model:** a model in `ComfyUI/models/diffusion_models` (a `.gguf` one too, see
  [GGUF models](#gguf-models)), or an **all-in-one checkpoint** in
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

### GGUF models

A GGUF file is a smaller (quantised) copy of a model, which fits in less graphics memory: a good fit
for a 12 GB card. ComfyUI can't load them by itself, so:

1. Install the **ComfyUI-GGUF** custom nodes (city96): in ComfyUI-Manager search for "GGUF", or
   `git clone` <https://github.com/city96/ComfyUI-GGUF> into `ComfyUI/custom_nodes` and install its
   requirements, then restart ComfyUI. Until you do, the setup check on the edit tab says "GGUF files:
   install the ComfyUI-GGUF custom nodes to use them", and no `.gguf` file is offered.
2. Put the `.gguf` model in `ComfyUI/models/diffusion_models` (or `models/unet`). It then shows in the
   preset's **Model files** menus marked "(GGUF)", and is found by its name like the other versions
   (`Qwen-Image-Edit-2509-Q4_K_M.gguf`, `Qwen-Image-Edit-Rapid-AIO-v11-Q4_0.gguf`, a `kontext` file).
   If the recommended safetensors file is also there, that one is still used until you choose the GGUF one.
3. Keep the text encoder as the **fp8 safetensors** file from step 3 above. A GGUF Qwen 2.5 VL text
   encoder only sees the picture with its `mmproj` file beside it, so the safetensors one is the safer
   choice. (A GGUF T5 for Kontext works.) The VAE stays as it is.

For 12 GB, try a **Q4_0** or **Q4_K_S** quant (larger quants fit less well), and turn on **Keep the text
encoder on the CPU** in the preset's card (below). Fast (Lightning) and your own LoRAs work with GGUF models.

Some to try:

- **Qwen-Image-Edit Rapid AIO, GGUF:**
  [Phil2Sat/Qwen-Image-Edit-Rapid-AIO-GGUF](https://huggingface.co/Phil2Sat/Qwen-Image-Edit-Rapid-AIO-GGUF)
  on Hugging Face. These hold only the model, so the text encoder and VAE are the usual separate
  files (untick **Fast** and set 4 steps and CFG 1, as for the Rapid AIO checkpoint above).
- **Qwen-Image-Edit 2511, GGUF:**
  [unsloth/Qwen-Image-Edit-2511-GGUF](https://huggingface.co/unsloth/Qwen-Image-Edit-2511-GGUF).

Drawing presets of the [newer models](#newer-models-z-image-flux-chroma-qwen-image) use GGUF files in
the same way: their **Model** and **Text encoder** menus list `.gguf` files marked "(GGUF)", and
a GGUF text encoder (Qwen 3 for Z-Image, T5-XXL for Flux and Chroma) is loaded with ComfyUI-GGUF's
`CLIPLoaderGGUF` or `DualCLIPLoaderGGUF`. Their **Check setup** says "install the ComfyUI-GGUF custom
nodes" when you chose a `.gguf` file and ComfyUI can't load it. Civitai fine-tunes that come as GGUF
files go in `models/diffusion_models` too.

### Each preset's settings

Each edit preset also has:

- **Keep the text encoder on the CPU:** loads the text encoder into system memory instead of the
  graphics card's, so the card has room for the model. Reading the instruction is a little slower. It
  uses the `device` choice of ComfyUI's text encoder loader; where the loader in use has none (some
  GGUF loaders), the card says it doesn't apply and nothing is sent.
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

### Using reference pictures in an edit

On the Edit tab, the References section above the instruction lets you add pictures that show the
model what to take: a character's face, an outfit, a prop. The starting picture is always the one
that is changed; references are only looked at. (Edits don't use IP-Adapter, and a reference's
Role and weight settings don't matter here. Only which pictures are in the list, and their order.)

**Qwen-Image-Edit** takes up to two references. It numbers the pictures in the order they are
given: the starting picture is **image 1**, the first reference in the list is **image 2**, and the
second is **image 3**. Refer to them by those numbers in the instruction:

- With one reference: `Give the girl in image 1 the jacket from image 2.`
- With two: `Put the sword from image 2 in the knight's hand in image 1, and make his armour match image 3.`
- Keep the face: `Replace the man in image 1 with the character from image 2, in the same pose.`

**FLUX.1 Kontext** takes one reference and has no numbering. Describe it in words instead:

- `Give the woman the same red jacket as in the reference picture.`
- `Make the character look like the one in the second picture, keeping the first picture's pose and background.`

You don't have to say which picture is edited: StoryTime puts a sentence in front of your
instruction ("Edit image 1, keeping its composition, pose and background. Use image 2 only as a
reference for how things look…"). Name what to take from the reference, such as the jacket, the face
or the sword, because "use the reference" alone gives the model little to go on. A third reference on
Qwen, or a second on Kontext, is left out, and a note says so.

If the result looks like the reference with your starting picture mixed in, name the one thing to
take from it ("only the jacket"), lower the Strength so it stays closer to the starting picture, or
use a reference that shows only that thing.

### Tips for instructions

- Say what to change, not the whole scene: "remove the logo on his shirt", "make it night",
  "add more smoke around him", "change her coat to red".
- Change one thing at a time, and use **Edit this** on the result for the next change. Every pass
  softens the picture a little, so a long chain of edits slowly loses detail.
- Edits keep the picture's shape at about one megapixel (a 1344 × 768 picture comes back at
  1360 × 768).
- An edit doesn't use the drawing preset's checkpoint or the story's art style, so a strong style change can drift from
  the rest of the story. Redraw at a low strength brings it back.
