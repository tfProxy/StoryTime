# Running on Unraid (or any Docker host)

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
