# Running on Unraid (or any Docker host)

The app is one container with one data folder. GitHub Actions builds and tests the image on every
push to `main` and publishes it as `ghcr.io/tfproxy/storytime` (public, no login needed), so the NAS
only downloads it. Use the Compose Manager plugin on Unraid, or any machine with Docker Compose:

```
# docker-compose.yml (the one in this repo works as is)
services:
  storytime:
    image: ghcr.io/tfproxy/storytime:latest
    ports: ["3737:3737"]
    volumes: ["/mnt/user/appdata/storytime:/data"]
    restart: unless-stopped
```

Then `docker compose up -d` (on Unraid: Compose Pull, then Compose Up). The site is on port 3737.
Settings can come from environment variables or a `.env` file next to the compose file:
`STORYTIME_PORT` (published port) and `STORYTIME_DATA` (data folder, default `./data`).

**Updating:** after a push to `main`, wait for its CI run to pass (the Actions tab on GitHub; the
image is published at the end of it), then `docker compose pull && docker compose up -d` (on
Unraid: Compose Pull, then Compose Up). Database upgrades happen automatically on start.

**Going back to an earlier version:** each image is also tagged with its commit, for example
`ghcr.io/tfproxy/storytime:sha-4afc91f`. Put that tag in place of `latest`, pull and start. Database
upgrades are not undone, so an older version may not open a database a newer one has upgraded; take a
backup (below) before updating if that matters.

**Building from source instead:** replace the `image:` line with
`build: https://github.com/tfProxy/StoryTime.git#main` and update with
`docker compose build --pull --no-cache && docker compose up -d` (slow: it compiles on the NAS).

**Without Compose:** `docker run -d --name storytime -p 3737:3737 -v /mnt/user/appdata/storytime:/data ghcr.io/tfproxy/storytime:latest`;
to update, `docker pull ghcr.io/tfproxy/storytime:latest`, then remove the container and run it again.

Notes:

- Put the data folder in your appdata backups, or use the built-in consistent copy, which is safe
  while the app runs: `docker exec storytime node scripts/admin.mjs backup /data/backups/storytime-$(date +%F).db`.
- The container reports health at `/api/health`.
- The site has no logins, so anyone who can reach it can read, post and edit. Keep it on your home
  network, reach it over a VPN such as Tailscale, or put it behind a reverse proxy that adds its own
  authentication before exposing it any further.
- AI and ComfyUI addresses: the container makes the picture jobs, AI runs and Generates itself, so the
  addresses in Settings must work from inside the container. Use LAN addresses, not `localhost`
  (Settings › Test from server checks each one). A few AI calls (the codex scan, writing a picture
  prompt) still go from the browser, so with Ollama the address must also work from your browser
  and Ollama must allow the site's address (`OLLAMA_ORIGINS`). The browser also loads pictures
  straight from ComfyUI.
- A reverse proxy in front of StoryTime must not buffer `text/event-stream`, or the queue's live
  updates (the header counts, progress) stop arriving.
