// api/pet-action.js
//
// Unity НИКОГДА не присылает "новое значение happiness = 87".
// Unity присылает только НАМЕРЕНИЕ: "покормить питомца id=42".
// Сервер сам знает, на сколько меняются параметры за одно действие,
// и применяет это через SQL (increment), а не перезаписью произвольным
// числом. Так игрок не может прислать happiness=999 через перехват
// запроса.

import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { verifySession } from '../lib/verifySession.js';
import { applyCors } from '../lib/cors.js';

// Жёстко заданные на сервере эффекты действий — клиент их не контролирует
const ACTIONS = {
  feed:  { hunger: +25, energy: +5,  happiness: +5,  cleanliness: -5, cooldownSec: 60 },
  play:  { happiness: +20, energy: -15, hunger: -10, cleanliness: -5, cooldownSec: 60 },
  wash:  { cleanliness: +30, happiness: +5, cooldownSec: 120 },
  sleep: { energy: +30, happiness: +2, cooldownSec: 300 },
};

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}

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

  const { petId, action } = req.body;
  const effect = ACTIONS[action];

  if (!effect) {
    return res.status(400).json({ error: 'Unknown action' });
  }

  // проверяем, что питомец действительно принадлежит этому игроку
  const { data: player, error: playerError } = await supabaseAdmin
    .from('players')
    .select('id')
    .eq('telegram_id', session.telegramId)
    .single();

  // раньше отсутствие игрока не проверялось: если players lookup вернёт
  // null (например, сессия валидна, но запись почему-то отсутствует),
  // следующий .eq('owner_id', player.id) уронил бы функцию с TypeError
  // ("Cannot read properties of null") вместо аккуратного 404.
  if (playerError || !player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const { data: pet, error: petError } = await supabaseAdmin
    .from('pets')
    .select('*')
    .eq('id', petId)
    .eq('owner_id', player.id)
    .single();

  if (petError || !pet) {
    return res.status(404).json({ error: 'Pet not found or not yours' });
  }

  // антиспам: не даём повторять действие чаще cooldownSec
  const secondsSinceUpdate = (Date.now() - new Date(pet.updated_at).getTime()) / 1000;
  if (secondsSinceUpdate < effect.cooldownSec) {
    return res.status(429).json({
      error: 'Action on cooldown',
      retryAfterSec: Math.ceil(effect.cooldownSec - secondsSinceUpdate),
    });
  }

  const newValues = {
    happiness: clamp(pet.happiness + (effect.happiness || 0)),
    hunger: clamp(pet.hunger + (effect.hunger || 0)),
    energy: clamp(pet.energy + (effect.energy || 0)),
    cleanliness: clamp(pet.cleanliness + (effect.cleanliness || 0)),
    // Кулдаун выше считается от pet.updated_at. Если в таблице нет
    // отдельного триггера, который сам проставляет updated_at при
    // UPDATE, это поле никогда не менялось бы — и после первого
    // успешного действия кулдаун переставал бы работать вообще
    // (secondsSinceUpdate считался бы от одной и той же старой даты
    // и всегда оказывался бы больше cooldownSec). Проставляем явно,
    // чтобы антиспам работал независимо от наличия триггера в БД.
    updated_at: new Date().toISOString(),
  };

  const { data: updatedPet, error: updateError } = await supabaseAdmin
    .from('pets')
    .update(newValues)
    .eq('id', petId)
    .select()
    .single();

  if (updateError) {
    console.error(updateError);
    return res.status(500).json({ error: 'DB error' });
  }

  return res.status(200).json({ pet: updatedPet });
}
