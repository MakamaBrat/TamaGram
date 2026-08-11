// api/delete-pet.js
//
// Drop this file into your existing /api folder (alongside create-pet.js).
// Lets the player permanently delete one of their pets. Irreversible —
// the row (and whatever it points at, like a GIF/custom-emoji URL) is
// just gone; storage objects in `pet-gifs` are left as-is (harmless
// orphaned files, not worth the extra round-trip to clean up here).

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { verifySession } from '../lib/verifySession.js';
import { applyCors } from '../lib/cors.js';

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

  const { petId } = req.body;
  if (!petId) {
    return res.status(400).json({ error: 'petId required' });
  }

  const { data: player, error: playerError } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('telegram_id', session.telegramId)
    .single();

  if (playerError || !player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  // scope the delete to (petId AND owner_id) in the query itself, rather
  // than a separate existence check, so there's no window between
  // "check" and "delete" — and a pet that isn't the caller's simply
  // deletes zero rows instead of ever being touched.
  const { data: deleted, error: deleteError } = await supabaseAdmin
    .from('pets')
    .delete()
    .eq('id', petId)
    .eq('owner_id', player.id)
    .select('id')
    .maybeSingle();

  if (deleteError) {
    console.error('pet delete error:', deleteError);
    return res.status(500).json({ error: 'DB error', details: deleteError.message });
  }

  if (!deleted) {
    return res.status(404).json({ error: 'Pet not found or not yours' });
  }

  return res.status(200).json({ ok: true, petId: deleted.id });
}
