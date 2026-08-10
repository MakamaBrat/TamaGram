// api/player-state.js
//
// Unity вызывает это при старте сцены и при возврате из Telegram
// (OnApplicationFocus), чтобы подтянуть свежие данные — включая
// gif_url, который мог обновиться после отправки файла боту.

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { verifySession } from '../lib/verifySession.js';
import { applyCors } from '../lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const session = verifySession(token);

  if (!session.ok) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const { data: player, error: playerError } = await supabaseAdmin
    .from('players')
    .select('*')
    .eq('telegram_id', session.telegramId)
    .single();

  if (playerError || !player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const { data: pets, error: petsError } = await supabaseAdmin
    .from('pets')
    .select('*')
    .eq('owner_id', player.id);

  if (petsError) {
    return res.status(500).json({ error: 'DB error' });
  }

  return res.status(200).json({ player, pets });
}
