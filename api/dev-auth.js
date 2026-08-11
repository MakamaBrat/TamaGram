// api/dev-auth.js
//
// ТОЛЬКО ДЛЯ ЛОКАЛЬНОЙ РАЗРАБОТКИ / ТЕСТОВ В UNITY EDITOR.
//
// В отличие от /api/auth, этот эндпоинт НЕ проверяет подпись Telegram
// (initData) — просто логинит/создаёт игрока по переданному telegramId.
// Это нужно, потому что в Unity Editor реального initData взять неоткуда
// (его выдаёт только Telegram WebApp SDK внутри самого Telegram).
//
// Работает ТОЛЬКО если на сервере явно включена переменная окружения
// ALLOW_DEV_AUTH=1. Без неё — 403. Держите эту переменную выключенной
// (или не задавайте вовсе) на Production-деплое, чтобы никто не мог
// залогиниться под произвольным telegramId в обход Telegram-проверки.

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { applyCors } from '../lib/cors.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.ALLOW_DEV_AUTH !== '1') {
    return res.status(403).json({ error: 'Dev auth is disabled on this deployment' });
  }

  const { telegramId, nickname } = req.body;

  if (!telegramId) {
    return res.status(400).json({ error: 'telegramId required' });
  }

  const { data: player, error: upsertError } = await supabaseAdmin
    .from('players')
    .upsert(
      {
        telegram_id: telegramId,
        nickname: nickname || 'EditorTester',
        last_active_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' }
    )
    .select()
    .single();

  if (upsertError) {
    console.error(upsertError);
    return res.status(500).json({ error: 'DB error' });
  }

  const { data: pets, error: petsError } = await supabaseAdmin
    .from('pets')
    .select('*')
    .eq('owner_id', player.id);

  if (petsError) {
    console.error(petsError);
    return res.status(500).json({ error: 'DB error' });
  }

  const sessionToken = signSession(telegramId);

  return res.status(200).json({ player, pets, sessionToken });
}

// Тот же принцип подписи, что и в api/auth.js — используется тот же
// SESSION_SECRET, поэтому выданный токен нормально пройдёт verifySession()
// в /api/create-pet и /api/pet-action.
function signSession(telegramId) {
  const payload = `${telegramId}.${Date.now() + 1000 * 60 * 60 * 24}`;
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64');
}
