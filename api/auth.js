// api/auth.js
//
// Вызывается Unity при входе в игру.
// Ожидает POST { initData: "<telegram webapp init data>" }
// Возвращает данные игрока + список его питомцев.
//
// ВАЖНО: если Unity — НЕ Telegram Mini App (отдельное standalone
// приложение), initData взять неоткуда, и эту проверку нужно заменить
// на другой auth-flow (см. комментарий в конце файла).

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { verifyTelegramInitData } from '../lib/verifyTelegram.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { initData } = req.body;

  const check = verifyTelegramInitData(initData);
  if (!check.ok) {
    return res.status(401).json({ error: 'Invalid or expired auth data' });
  }

  const { telegramId, username } = check;

  // upsert игрока (создаём, если первый вход; иначе обновляем ник
  // и отмечаем время последней активности)
  const { data: player, error: upsertError } = await supabaseAdmin
    .from('players')
    .upsert(
      {
        telegram_id: telegramId,
        nickname: username,
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

  // выдаём короткоживущий сессионный токен (просто подписанный telegramId),
  // чтобы последующие запросы не таскали initData каждый раз
  const sessionToken = signSession(telegramId);

  return res.status(200).json({
    player,
    pets,
    sessionToken,
  });
}

// ------------------------------------------------------------
// Простая подпись сессии на базе HMAC (не JWT-библиотека, но тот же принцип)
// ------------------------------------------------------------
import crypto from 'crypto';

function signSession(telegramId) {
  const payload = `${telegramId}.${Date.now() + 1000 * 60 * 60 * 24}`; // 24ч
  const sig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64');
}

/*
============================================================
ЕСЛИ UNITY — ОТДЕЛЬНОЕ STANDALONE ПРИЛОЖЕНИЕ (не Telegram Mini App):
============================================================
initData проверить не получится, т.к. его выдаёт только Telegram
WebApp SDK внутри Telegram-клиента. Вариант для standalone:

1. Игрок открывает бота, пишет /login
2. Бот генерирует одноразовый код (например 6 цифр) и сохраняет
   в таблицу login_codes { code, telegram_id, expires_at }
3. Игрок вводит этот код в Unity
4. Unity шлёт код на /api/auth-by-code
5. Сервер проверяет код, находит telegram_id, выдаёт sessionToken
   (тот же принцип, что signSession выше), код одноразовый — сразу удаляется
============================================================
*/
