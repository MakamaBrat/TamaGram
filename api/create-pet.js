// api/create-pet.js
//
// Unity вызывает при нажатии "Завести питомца".
// Сервер сам решает стартовые параметры (100/50/50/50 и т.п.) —
// клиент не может подсунуть свои значения при создании.
//
// Имя и эмодзи-лицо питомца задаются ТОЛЬКО здесь, при создании — после
// этого их поменять нельзя (см. src/App.jsx: AppearanceModal больше не
// даёт выбрать обычный эмодзи, только TG-эмодзи/GIF).

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { verifySession } from '../lib/verifySession.js';
import { applyCors } from '../lib/cors.js';

const MAX_PETS_PER_PLAYER = 5; // защита от спама созданием
const MAX_EMOJI_LENGTH = 8; // генеральный запас под эмодзи + variation selector

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const session = verifySession(token);

  if (!session.ok) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const { name, emoji } = req.body;
  const petName = (name || 'Pet').toString().slice(0, 32); // ограничение длины

  let petEmoji = null;
  if (emoji !== undefined && emoji !== null && emoji !== '') {
    if (typeof emoji !== 'string' || emoji.length > MAX_EMOJI_LENGTH) {
      return res.status(400).json({ error: 'Invalid emoji' });
    }
    petEmoji = emoji;
  }

  const { data: player, error: playerError } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('telegram_id', session.telegramId)
    .single();

  if (playerError || !player) {
    console.error('player lookup error:', playerError);
    return res.status(404).json({ error: 'Player not found', details: playerError?.message });
  }

  const { count, error: countError } = await supabaseAdmin
    .from('pets')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', player.id);

  if (countError) {
    console.error('pets count error:', countError);
    return res.status(500).json({ error: 'DB error (count)', details: countError.message });
  }

  if (count >= MAX_PETS_PER_PLAYER) {
    return res.status(400).json({ error: `Максимум ${MAX_PETS_PER_PLAYER} питомцев` });
  }

  const { data: pet, error } = await supabaseAdmin
    .from('pets')
    .insert({
      owner_id: player.id,
      name: petName,
      emoji: petEmoji,
      happiness: 50,
      hunger: 50,
      energy: 50,
      cleanliness: 50,
    })
    .select()
    .single();

  if (error) {
    console.error('pet insert error:', error);
    return res.status(500).json({ error: 'DB error (insert)', details: error.message });
  }

  return res.status(200).json({ pet });
}
