// lib/verifyTelegram.js
//
// Проверка подлинности данных, присланных из Telegram Mini App.
// Unity (если это Telegram WebApp / Mini App) получает от Telegram
// объект initData, который ПОДПИСАН секретом бота. Клиент не может
// подделать telegram_id, потому что не знает BOT_TOKEN.
//
// Подробнее: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import crypto from 'crypto';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Проверяет initData, присланный из Unity/WebApp.
 * @param {string} initData - строка initData как есть (query-string формат)
 * @returns {{ ok: boolean, telegramId?: number, username?: string }}
 */
export function verifyTelegramInitData(initData) {
  if (!initData) return { ok: false };

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false };

  params.delete('hash');

  // Строим data_check_string: отсортированные пары key=value через \n
  const dataCheckArr = [];
  for (const [key, value] of [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  // secret_key = HMAC_SHA256(bot_token, "WebAppData")
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();

  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) {
    return { ok: false };
  }

  // Опционально: проверка, что initData не старше N минут (защита от replay)
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  const now = Math.floor(Date.now() / 1000);
  const MAX_AGE_SECONDS = 3600; // 1 час
  if (now - authDate > MAX_AGE_SECONDS) {
    return { ok: false, expired: true };
  }

  const userJson = params.get('user');
  if (!userJson) return { ok: false };

  const user = JSON.parse(userJson);

  return {
    ok: true,
    telegramId: user.id,
    username: user.username || user.first_name || 'Player',
  };
}
