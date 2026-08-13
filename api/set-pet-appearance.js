// api/set-pet-appearance.js
//
// Drop this file into your existing /api folder (alongside pet-action.js).
// Lets the React client set a decorative emoji "face" for a pet, or clear
// it when the player switches to a GIF (uploaded separately through the
// Telegram bot flow in api/telegram-webhook.js).
//
// This is purely cosmetic and has no effect on stats/economy, so unlike
// pet-action.js it's safe to trust the value the client sends (still
// validated: must be one short string, and the pet must belong to the
// caller).

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { verifySession } from '../lib/verifySession.js';
import { applyCors } from '../lib/cors.js';

const MAX_EMOJI_LENGTH = 8; // generous enough for one emoji + variation selectors

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

  const { petId, emoji, clearGif } = req.body;

  if (emoji !== undefined && emoji !== null) {
    if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > MAX_EMOJI_LENGTH) {
      return res.status(400).json({ error: 'Invalid emoji' });
    }
  }

  const { data: player, error: playerError } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('telegram_id', session.telegramId)
    .single();

  if (playerError || !player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const { data: pet, error: petError } = await supabaseAdmin
    .from('pets')
    .select('id')
    .eq('id', petId)
    .eq('owner_id', player.id)
    .single();

  if (petError || !pet) {
    return res.status(404).json({ error: 'Pet not found or not yours' });
  }

  const updateValues = {};
  if (emoji !== undefined) {
    updateValues.emoji = emoji;
    // выбор обычного emoji вытесняет ранее поставленный gif/custom emoji
    updateValues.gif_url = null;
  }
  if (clearGif) updateValues.gif_url = null;

  const { data: updatedPet, error: updateError } = await supabaseAdmin
    .from('pets')
    .update(updateValues)
    .eq('id', petId)
    .select()
    .single();

  if (updateError) {
    console.error(updateError);
    return res.status(500).json({ error: 'DB error' });
  }

  return res.status(200).json({ pet: updatedPet });
}
