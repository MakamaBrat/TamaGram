// src/api.js
//
// Thin wrapper around the existing Vercel functions in /api. The React
// app replaces the old Unity client but speaks the exact same protocol:
// - POST /api/auth            { initData }              -> { player, pets, sessionToken }
// - GET  /api/player-state     (Bearer session)          -> { player, pets }
// - POST /api/create-pet      { name, emoji }  (Bearer session) -> { pet }
//   (name + emoji are set once, at creation — no endpoint edits them after)
// - POST /api/delete-pet      { petId } (Bearer session) -> { ok, petId }
//   (new endpoint, see api/delete-pet.js added alongside this app)
// - POST /api/pet-action      { petId, action } (Bearer) -> { pet }
// - POST /api/set-pet-appearance { petId, emoji } (Bearer) -> { pet }
//   (new endpoint, see api/set-pet-appearance.js added alongside this app)
//
// The session token itself is just an opaque string handed back by the
// server (see lib/verifySession.js) — we cache it in sessionStorage so we
// don't have to re-send initData on every request, but we always keep
// initData around to silently re-auth if the token expires.

const SESSION_KEY = 'tamagram-session-token';

function getTelegram() {
  return typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
}

// In real Telegram usage, WebApp.initData is provided automatically.
// Outside Telegram (plain browser, local dev) there is no valid initData,
// so /api/auth will reject it — devs should point VITE_API_ORIGIN at a
// backend with a relaxed auth for local testing, or run inside Telegram.
function getInitData() {
  const tg = getTelegram();
  return tg?.initData || '';
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`/api/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function authenticate() {
  const initData = getInitData();
  const data = await request('auth', { method: 'POST', body: { initData }, auth: false });
  sessionStorage.setItem(SESSION_KEY, data.sessionToken);
  return data; // { player, pets, sessionToken }
}

export function getPlayerState() {
  return request('player-state', { method: 'GET' });
}

export function createPet(name, emoji) {
  return request('create-pet', { method: 'POST', body: { name, emoji } });
}

export function deletePet(petId) {
  return request('delete-pet', { method: 'POST', body: { petId } });
}

export function petAction(petId, action) {
  return request('pet-action', { method: 'POST', body: { petId, action } });
}

export function setPetAppearance(petId, { emoji, clearGif } = {}) {
  return request('set-pet-appearance', {
    method: 'POST',
    body: { petId, emoji, clearGif },
  });
}

export function hasSession() {
  return Boolean(sessionStorage.getItem(SESSION_KEY));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function getTelegramUser() {
  return getTelegram()?.initDataUnsafe?.user;
}

export function getBotDeepLink(botUsername, petId) {
  return `https://t.me/${botUsername}?start=pet_${petId}`;
}

export function openTelegramLink(url) {
  const tg = getTelegram();
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
  } else {
    window.open(url, '_blank');
  }
}

export function initTelegram() {
  const tg = getTelegram();
  if (tg) {
    tg.ready();
    tg.expand();
  }
  return tg;
}
