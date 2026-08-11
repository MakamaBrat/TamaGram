// api/telegram-webhook.js
//
// ИЗМЕНЕНИЕ: custom emoji из панели Telegram (.webm с альфа-каналом,
// реже .tgs/Lottie) больше не сохраняются как отдельный custom_emoji_url —
// они конвертируются через ffmpeg в анимированный GIF с прозрачностью и
// пишутся в то же поле gif_url, что и обычные GIF-файлы. Это позволяет
// использовать один и тот же GifPlayer/UniGif на клиенте без доработок.
//
// ВАЖНО про требования окружения:
// 1. npm i ffmpeg-static  — даёт статический бинарник ffmpeg, который
//    работает в Vercel serverless (обычного системного ffmpeg там нет).
// 2. .tgs (Lottie JSON) НЕ конвертируется этим кодом — ffmpeg с ним не
//    работает, это не видео и не картинка, а анимация покадрово по
//    JSON-описанию. Такие эмодзи здесь просто отклоняются с понятным
//    сообщением пользователю (см. handleCustomEmoji). Если понадобится
//    поддержка .tgs — это отдельная история (rlottie / lottie-web +
//    headless-рендер в кадры), сообщи отдельно.
// 3. GIF хранит только бинарную прозрачность (0 или 255), без
//    полутонов — для эмодзи с чёткими краями обычно выглядит нормально,
//    для "дымчатых"/полупрозрачных эффектов возможны артефакты по краям.
// 4. Конвертация занимает время — держи в уме таймаут функции на Vercel
//    (по умолчанию 10с на Hobby-плане, до 60с на Pro). Если вебхук долго
//    отвечает, Telegram может повторить доставку апдейта — идемпотентность
//    (upsert / pending_uploads.delete в конце) уже на это рассчитана.

import { supabaseAdmin as supabase } from '../lib/supabaseAdmin.js';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import ffmpegPath from 'ffmpeg-static';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MAX_GIF_SIZE = 128 * 1024; // 128 KB — обычные присланные GIF-файлы
const MAX_EMOJI_SOURCE_SIZE = 256 * 1024; // 256 KB — исходный .webm/.tgs от Telegram
const MAX_CONVERTED_GIF_SIZE = 512 * 1024; // 512 KB — итоговый GIF после конвертации (кадры + альфа занимают больше места, чем видео)

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

// ------------------------------------------------------------
// webm (VP8/VP9, в т.ч. с альфа-каналом) -> анимированный GIF
// с прозрачностью, через двухпроходную палитру ffmpeg (лучшее
// качество цвета, чем однопроходная конвертация).
// ------------------------------------------------------------
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function convertWebmToGif(webmBuffer) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'emoji-'));
  const inputPath = path.join(tmpDir, 'in.webm');
  const palettePath = path.join(tmpDir, 'palette.png');
  const outputPath = path.join(tmpDir, 'out.gif');

  try {
    await fs.writeFile(inputPath, webmBuffer);

    // Проход 1: строим палитру. reserve_transparent=1 резервирует
    // индекс под прозрачный цвет — без этого альфа-канал потеряется
    // при квантовании в 256-цветную GIF-палитру.
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-vf', 'fps=20,scale=200:-1:flags=lanczos,palettegen=reserve_transparent=1',
      palettePath,
    ]);

    // Проход 2: рендерим GIF с этой палитрой.
    // format=yuva420p сохраняет альфа-канал из исходного видео (если он
    // там есть — Telegram custom emoji обычно кодируются именно так).
    // paletteuse с alpha_threshold режет полупрозрачные пиксели по
    // порогу в бинарную прозрачность, как того требует формат GIF.
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-i', palettePath,
      '-lavfi',
      'fps=20,scale=200:-1:flags=lanczos,format=yuva420p[x];[x][1:v]paletteuse=alpha_threshold=128',
      '-loop', '0',
      outputPath,
    ]);

    const gifBuffer = await fs.readFile(outputPath);
    return gifBuffer;
  } finally {
    // не блокируем ответ на очистке tmp — но и не оставляем мусор внутри инстанса
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
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

    // --- Вариант 2: Telegram custom emoji ---
    // Присылается как текстовое сообщение с entity типа "custom_emoji"
    // (обычный юникод-смайлик такой entity не получает).
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

      if (buffer.length > MAX_EMOJI_SOURCE_SIZE) {
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Это эмодзи слишком большое, попробуйте другое.' });
        return res.status(200).send('ok');
      }

      // .tgs — это Lottie (gzipped JSON), ffmpeg такое не декодирует.
      // Отклоняем с понятным сообщением вместо тихого падения.
      if (ext !== 'webm') {
        await tgApi('sendMessage', {
          chat_id: telegramId,
          text: 'Это эмодзи в анимационном формате (не видео), пока такое не поддерживается. Попробуйте другое эмодзи или пришлите GIF.',
        });
        return res.status(200).send('ok');
      }

      let gifBuffer;
      try {
        gifBuffer = await convertWebmToGif(buffer);
      } catch (convertError) {
        console.error('ffmpeg convert error:', convertError);
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Не удалось обработать это эмодзи, попробуйте другое.' });
        return res.status(200).send('ok');
      }

      if (gifBuffer.length > MAX_CONVERTED_GIF_SIZE) {
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Это эмодзи слишком большое после обработки, попробуйте другое.' });
        return res.status(200).send('ok');
      }

      const fileName = `pet_${pending.pet_id}_${Date.now()}.gif`;

      const { error: uploadError } = await supabase.storage
        .from('pet-gifs')
        .upload(fileName, gifBuffer, { contentType: 'image/gif', upsert: true });

      if (uploadError) {
        console.error('pet-gifs upload error (emoji->gif):', uploadError);
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Ошибка загрузки, попробуйте ещё раз.' });
        return res.status(200).send('ok');
      }

      const { data: publicUrlData } = supabase.storage.from('pet-gifs').getPublicUrl(fileName);

      // Пишем в то же gif_url, что и обычные GIF — клиенту не нужно
      // знать, что исходником было custom emoji.
      const { error: dbError } = await supabase
        .from('pets')
        .update({ gif_url: publicUrlData.publicUrl, emoji: null, custom_emoji_url: null, custom_emoji_type: null })
        .eq('id', pending.pet_id);

      if (dbError) {
        console.error('pets update error (emoji->gif):', dbError);
        await tgApi('sendMessage', { chat_id: telegramId, text: 'Файл загрузился, но не удалось сохранить его в базе. Попробуйте ещё раз.' });
        return res.status(200).send('ok');
      }

      await supabase.from('pending_uploads').delete().eq('telegram_id', telegramId);
      await tgApi('sendMessage', { chat_id: telegramId, text: 'Готово! Эмодзи поставлено питомцу 🎉' });
      return res.status(200).send('ok');
    }

    // Ничего не подошло: текст, но не GIF/документ и без custom_emoji entity.
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
