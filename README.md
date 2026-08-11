# TamaGram — React frontend

Replaces the Unity WebGL client with a React app that talks to your
existing Vercel + Supabase backend (`/api/auth`, `/api/player-state`,
`/api/create-pet`, `/api/pet-action`, and the bot webhook you already had).

## What this adds

- **Create a pet** — name screen, calls `POST /api/create-pet`.
- **Watch over it** — stat bars (happiness/hunger/energy/clean) fed by
  `GET /api/player-state`, actions (Feed/Wash/Play/Sleep) call
  `POST /api/pet-action` and respect the server's cooldowns.
- **Set the pet's picture** — tap the pet (or the 🖼️ icon) to open the
  appearance sheet:
  - **Emoji tab**: pick one of a preset grid, saved instantly via a new
    endpoint, `POST /api/set-pet-appearance` (included in
    `backend-additions/api/set-pet-appearance.js` — copy it into your
    existing `/api` folder).
  - **GIF tab**: deep-links into your Telegram bot (`/start pet_<id>`),
    reusing the upload flow already in `api/telegram-webhook.js`. The app
    polls `player-state` every 15s so the new `gif_url` shows up without
    a manual refresh. If a GIF is set it takes priority over the emoji.

## Backend changes needed

1. Copy `backend-additions/api/set-pet-appearance.js` into your `/api` folder.
2. Run `backend-additions/migration_add_pet_emoji.sql` in the Supabase SQL
   editor (adds `pets.emoji` and refreshes the `pets_with_owner` view).
3. In `src/App.jsx`, set `BOT_USERNAME` to your bot's `@username` (without
   the `@`) so the "send a GIF to the bot" button knows where to link.

## Running it

```bash
npm install
# point VITE_API_ORIGIN at your deployed backend for local dev, e.g.:
echo "VITE_API_ORIGIN=https://your-project.vercel.app" > .env.local
npm run dev
```

For production, `npm run build` and deploy the `dist/` folder to the same
Vercel project as your `/api` functions (or any static host, as long as
`/api/*` is reachable — see `vite.config.js` for the dev-time proxy, and
add an equivalent rewrite/proxy for prod if you host the frontend
separately from the API).

Note: `/api/auth` verifies real Telegram `initData`, so this app only
authenticates when opened **inside Telegram** as a Mini App (e.g. via your
bot's menu button or an inline "Open" button) — a plain browser tab has no
valid `initData` to send.
