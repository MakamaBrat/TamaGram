// api/telegram-webhook.js
//
// REPLACES your existing api/telegram-webhook.js.
// Adds support for real Telegram custom emoji (the ones from the emoji
// panel, often Premium/animated) as an alternative to sending a GIF.
// Custom emoji are Telegram stickers under the hood — either .webm
// (video) or .tgs (gzipped Lottie JSON) — so we fetch the file the same
// way as the GIF flow and store both the URL and which kind it is, so
// the frontend knows how to play it back.

import { supabaseAdmin as supabase } from '../lib/supabaseAdmin.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_GIF_SIZE = 128 * 1024; // 128 KB
const MAX_EMOJI_SIZE = 256 * 1024; // 256 KB (tgs/webm stickers are small)

async function tgApi(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function downloadTelegramFile(fileId) {
  const fileInfo = await tgApi('getFile', { file_id: fileId });
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const ext = filePath.split('.').pop().toLowerCase();
  return { buffer, ext };
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
          text: `Пришлите GIF (до ${MAX_GIF_SIZE / 1024} КБ) или отправьте одно Telegram-эмодзи из панели — я поставлю его питомцу.`,
        });
      }
      return res.status(200).send('ok');
    }

    const { data: pending } = await supabase
      .from('pending_uploads')
      .select('pet_id')
      .eq('telegram_id', telegramId)
      .single();

    // --- Вариант 1: обычный файл-GIF ---
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
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Нужен файл в формате GIF.' });
        return res.status(200).send('ok');
      }

      if (!pending) {
        await tgApi('sendMessage', {
          chat_id: telegramId,
          text: 'Сначала откройте загрузку из игры (кнопка у питомца).',
        });
        return res.status(200).send('ok');
      }

      const { buffer } = await downloadTelegramFile(file.file_id);
      const fileName = `pet_${pending.pet_id}_${Date.now()}.gif`;

      const { error: uploadError } = await supabase.storage
        .from('pet-gifs')
        .upload(fileName, buffer, { contentType: 'image/gif', upsert: true });

      if (uploadError) {
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Ошибка загрузки, попробуйте ещё раз.' });
        return res.status(200).send('ok');
      }

      const { data: publicUrlData } = supabase.storage.from('pet-gifs').getPublicUrl(fileName);

      // GIF, обычный emoji и custom emoji взаимоисключающие — новая
      // картинка сбрасывает две другие.
      const { error: dbError } = await supabase
        .from('pets')
        .update({ gif_url: publicUrlData.publicUrl, emoji: null, custom_emoji_url: null, custom_emoji_type: null })
        .eq('id', pending.pet_id);

      if (dbError) {
        console.error('pets update error (gif):', dbError);
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Файл загрузился, но не удалось сохранить его в базе. Попробуйте ещё раз.' });
        return res.status(200).send('ok');
      }

      await supabase.from('pending_uploads').delete().eq('telegram_id', telegramId);
      await tgApi('sendMessage', { chat_id: telegramId, text: 'Готово! Гифка загружена питомцу 🎉' });
      return res.status(200).send('ok');
    }

    // --- Вариант 2: Telegram custom emoji, присланное как сообщение ---
    // Отправка эмодзи из панели Telegram приходит как обычное текстовое
    // сообщение с entity типа "custom_emoji" (обычный юникод-эмодзи такой
    // entity не получает — под ним ничего делать не нужно).
    const customEmojiEntity = (message.entities || []).find((e) => e.type === 'custom_emoji');

    if (customEmojiEntity) {
      if (!pending) {
        await tgApi('sendMessage', {
          chat_id: telegramId,
          text: 'Сначала откройте загрузку из игры (кнопка у питомца).',
        });
        return res.status(200).send('ok');
      }

      const stickerInfo = await tgApi('getCustomEmojiStickers', {
        custom_emoji_ids: [customEmojiEntity.custom_emoji_id],
      });
      const sticker = stickerInfo.result && stickerInfo.result[0];

      if (!sticker) {
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Не удалось получить это эмодзи, попробуйте другое.' });
        return res.status(200).send('ok');
      }

      const { buffer, ext } = await downloadTelegramFile(sticker.file_id);

      if (buffer.length > MAX_EMOJI_SIZE) {
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Это эмодзи слишком большое, попробуйте другое.' });
        return res.status(200).send('ok');
      }

      // .tgs (Lottie) или .webm (видео) — определяем по расширению файла,
      // которое отдаёт сам Telegram, чтобы фронтенд знал, каким плеером
      // его показывать.
      const emojiType = ext === 'webm' ? 'webm' : 'tgs';
      const contentType = emojiType === 'webm' ? 'video/webm' : 'application/gzip';
      const fileName = `pet_${pending.pet_id}_emoji_${Date.now()}.${emojiType}`;

      const { error: uploadError } = await supabase.storage
        .from('pet-gifs')
        .upload(fileName, buffer, { contentType, upsert: true });

      if (uploadError) {
        console.error('pet-gifs upload error (custom emoji):', uploadError);
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Ошибка загрузки, попробуйте ещё раз.' });
        return res.status(200).send('ok');
      }

      const { data: publicUrlData } = supabase.storage.from('pet-gifs').getPublicUrl(fileName);

      const { error: dbError } = await supabase
        .from('pets')
        .update({
          custom_emoji_url: publicUrlData.publicUrl,
          custom_emoji_type: emojiType,
          gif_url: null,
          emoji: null,
        })
        .eq('id', pending.pet_id);

      if (dbError) {
        console.error('pets update error (custom emoji):', dbError);
        await tgApi('sendMessage', {
          chat_id: telegramId,
          text:
            'Файл загрузился, но не удалось сохранить его в базе. Скорее всего, в таблице pets ' +
            'ещё нет колонок custom_emoji_url/custom_emoji_type — прогоните migration_add_pet_custom_emoji.sql.',
        });
        return res.status(200).send('ok');
      }

      await supabase.from('pending_uploads').delete().eq('telegram_id', telegramId);
      await tgApi('sendMessage', { chat_id: telegramId, text: 'Готово! Эмодзи поставлено питомцу 🎉' });
      return res.status(200).send('ok');
    }

    // Ничего не подошло: это был текст, но не GIF/документ и без
    // custom_emoji entity (скорее всего — обычный юникод-смайлик, а не
    // настоящее Telegram custom emoji из панели). Не молчим, а объясняем,
    // иначе для игрока это выглядит так, будто бот ничего не сделал.
    if (pending && message.text) {
      await tgApi('sendMessage', {
        chat_id: telegramId,
        text:
          'Это похоже на обычный смайлик с клавиатуры, а не на Telegram-эмодзи. ' +
          'Нужно эмодзи именно из панели эмодзи Telegram (иконка 😀 в поле ввода) — ' +
          'вставь его туда и отправь одним сообщением. Либо пришли GIF, если так проще.',
      });
      return res.status(200).send('ok');
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    return res.status(200).send('ok');
  }
}
