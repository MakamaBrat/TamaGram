# TamaGram — React frontend

Replaces the Unity WebGL client with a React app that talks to your
existing Vercel + Supabase backend (`/api/auth`, `/api/player-state`,
`/api/create-pet`, `/api/pet-action`, and the bot webhook you already had).

## What this adds

- **Create a pet** — name + emoji screen, calls `POST /api/create-pet`.
  Both are chosen **once, at creation** — there's no way to rename a pet
  or change its plain-emoji face afterwards.
- **Multiple pets, up to 5** — a small pet-switcher (tap the emoji
  bubbles above the pet card) lets you flip between your pets. Adding
  one more is a "+ Новый питомец" button in Settings, which opens the
  same create screen in a modal.
- **Delete a pet** — Settings → "🗑 Удалить", asks for confirmation,
  calls `POST /api/delete-pet`. Irreversible.
- **Pet age** — shown under the name, computed client-side from
  `created_at` (minutes → hours → days → months → years).
- **Watch over it** — stat bars (happiness/hunger/energy/clean) fed by
  `GET /api/player-state`, actions (Feed/Wash/Play/Sleep) call
  `POST /api/pet-action` and respect the server's cooldowns.
- **A little TV in the room** — a small looping YouTube embed sits in
  the retro TV's screen in `room.png`, purely decorative.
- **Set the pet's picture** — tap the pet (or the 🖼️ icon) to open the
  appearance sheet, two tabs (the plain-emoji tab moved to pet creation):
  - **TG-эмодзи**: real Telegram custom emoji (the ones from the emoji
    panel, including Premium/animated ones). Deep-links into your bot;
    the player sends one emoji as a message, the webhook detects the
    `custom_emoji` entity, fetches the sticker via
    `getCustomEmojiStickers` + `getFile`, and stores it (`.webm` video or
    `.tgs` Lottie — both are supported, rendered with `<video>` or
    `lottie-web` respectively).
  - **GIF**: same deep-link flow, player sends a GIF file instead.
  
  These two are mutually exclusive — setting one clears the other.
  Priority when rendering: GIF → custom emoji → creation-time emoji →
  default art.

## Backend changes needed

1. Copy `backend-additions/api/set-pet-appearance.js` into your `/api` folder.
2. Copy `backend-additions/api/delete-pet.js` into your `/api` folder.
3. **Replace** your existing `api/telegram-webhook.js` with
   `backend-additions/api/telegram-webhook.js` (adds custom-emoji capture
   alongside the existing GIF flow).
4. **Replace** your existing `api/create-pet.js` with the one in this
   package's `api/create-pet.js` (now also accepts `emoji` at creation).
5. Run, in order:
   - `backend-additions/migration_add_pet_emoji.sql`
   - `backend-additions/migration_add_pet_custom_emoji.sql`
   - `backend-additions/migration_add_pet_created_at.sql`
6. In `src/App.jsx`, `BOT_USERNAME` is already set to `Tamagrambot`.

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
