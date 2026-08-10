// lib/verifySession.js
import crypto from 'crypto';

/**
 * @param {string} token - base64 строка "telegramId.expires.sig"
 * @returns {{ ok: boolean, telegramId?: number }}
 */
export function verifySession(token) {
  if (!token) return { ok: false };

  let decoded;
  try {
    decoded = Buffer.from(token, 'base64').toString('utf8');
  } catch {
    return { ok: false };
  }

  const [telegramId, expires, sig] = decoded.split('.');
  if (!telegramId || !expires || !sig) return { ok: false };

  const payload = `${telegramId}.${expires}`;
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(payload)
    .digest('hex');

  if (sig !== expectedSig) return { ok: false };
  if (Date.now() > parseInt(expires, 10)) return { ok: false, expired: true };

  return { ok: true, telegramId: parseInt(telegramId, 10) };
}
