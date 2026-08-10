// api/telegram-webhook.js
import { supabaseAdmin as supabase } from '../lib/supabaseAdmin.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_GIF_SIZE = 128 * 1024; // 128 KB

async function tgApi(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');

  const message = req.body.message;
  if (!message) return res.status(200).send('ok');

  const telegramId = message.from.id;
  const nickname = message.from.username || message.from.first_name;

  try {
    // регистрация/обновление ника при любом сообщении
    await supabase
      .from('players')
      .upsert({ telegram_id: telegramId, nickname }, { onConflict: 'telegram_id' });

    // /start pet_<id>
    if (message.text && message.text.startsWith('/start')) {
      const payload = message.text.split(' ')[1];

      if (payload && payload.startsWith('pet_')) {
        const petId = parseInt(payload.replace('pet_', ''), 10);

        const { data: player } = await supabase
          .from('players')
          .select('id')
          .eq('telegram_id', telegramId)
          .single();

        const { data: pet } = await supabase
          .from('pets')
          .select('id, owner_id')
          .eq('id', petId)
          .single();

        if (!pet || pet.owner_id !== player.id) {
          await tgApi('sendMessage', {
            chat_id: telegramId,
            text: 'Питомец не найден или не принадлежит вам.',
          });
          return res.status(200).send('ok');
        }

        await supabase
          .from('pending_uploads')
          .upsert({ telegram_id: telegramId, pet_id: petId });

        await tgApi('sendMessage', {
          chat_id: telegramId,
          text: `Пришлите GIF для питомца (до ${MAX_GIF_SIZE / 1024} КБ).`,
        });
      }
      return res.status(200).send('ok');
    }

    // Присланный файл
    if (message.animation || message.document) {
      const file = message.animation || message.document;

      if (file.file_size > MAX_GIF_SIZE) {
        await tgApi('sendMessage', {
          chat_id: telegramId,
          text: `Файл слишком большой (${Math.round(file.file_size / 1024)} КБ). Максимум ${MAX_GIF_SIZE / 1024} КБ.`,
        });
        return res.status(200).send('ok');
      }

      const mime = file.mime_type || '';
      if (!mime.includes('gif')) {
        await tgApi('sendMessage', {
          chat_id: telegramId,
          text: 'Нужен файл в формате GIF.',
        });
        return res.status(200).send('ok');
      }

      const { data: pending } = await supabase
        .from('pending_uploads')
        .select('pet_id')
        .eq('telegram_id', telegramId)
        .single();

      if (!pending) {
        await tgApi('sendMessage', {
          chat_id: telegramId,
          text: 'Сначала откройте загрузку gif из игры (кнопка у питомца).',
        });
        return res.status(200).send('ok');
      }

      const fileInfo = await tgApi('getFile', { file_id: file.file_id });
      const filePath = fileInfo.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

      const fileRes = await fetch(fileUrl);
      const buffer = Buffer.from(await fileRes.arrayBuffer());

      const fileName = `pet_${pending.pet_id}_${Date.now()}.gif`;

      const { error: uploadError } = await supabase.storage
        .from('pet-gifs')
        .upload(fileName, buffer, { contentType: 'image/gif', upsert: true });

      if (uploadError) {
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Ошибка загрузки, попробуйте ещё раз.' });
        return res.status(200).send('ok');
      }

      const { data: publicUrlData } = supabase.storage.from('pet-gifs').getPublicUrl(fileName);

      await supabase
        .from('pets')
        .update({ gif_url: publicUrlData.publicUrl })
        .eq('id', pending.pet_id);

      await supabase.from('pending_uploads').delete().eq('telegram_id', telegramId);

      await tgApi('sendMessage', { chat_id: telegramId, text: 'Готово! Гифка загружена питомцу 🎉' });
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    return res.status(200).send('ok');
  }
}
