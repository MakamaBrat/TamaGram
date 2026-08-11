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
  appearance sheet, three tabs:
  - **Эмодзи**: pick a plain unicode emoji from a preset grid, saved
    instantly via `POST /api/set-pet-appearance`.
  - **TG-эмодзи**: real Telegram custom emoji (the ones from the emoji
    panel, including Premium/animated ones). Deep-links into your bot;
    the player sends one emoji as a message, the webhook detects the
    `custom_emoji` entity, fetches the sticker via
    `getCustomEmojiStickers` + `getFile`, and stores it (`.webm` video or
    `.tgs` Lottie — both are supported, rendered with `<video>` or
    `lottie-web` respectively).
  - **GIF**: same deep-link flow, player sends a GIF file instead.
  
  All three are mutually exclusive — setting one clears the other two.
  Priority when rendering: GIF → custom emoji → plain emoji → default art.

## Backend changes needed

1. Copy `backend-additions/api/set-pet-appearance.js` into your `/api` folder.
2. **Replace** your existing `api/telegram-webhook.js` with
   `backend-additions/api/telegram-webhook.js` (adds custom-emoji capture
   alongside the existing GIF flow).
3. Run, in order:
   - `backend-additions/migration_add_pet_emoji.sql`
   - `backend-additions/migration_add_pet_custom_emoji.sql`
4. In `src/App.jsx`, `BOT_USERNAME` is already set to `Tamagrambot`.

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
