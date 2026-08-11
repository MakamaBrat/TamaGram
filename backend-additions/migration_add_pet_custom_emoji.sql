-- migration_add_pet_custom_emoji.sql
-- Выполнить в Supabase SQL Editor, ПОСЛЕ migration_add_pet_emoji.sql.
--
-- Добавляет поддержку настоящих Telegram custom emoji (те самые из
-- emoji-панели, часто premium, анимированные) как "лица" питомца — в
-- отличие от обычных юникод-эмодзи (колонка emoji), которые выбираются
-- прямо в приложении.
--
-- Custom emoji физически хранятся у Telegram либо как .webm (видео),
-- либо как .tgs (сжатый Lottie-JSON). Обе колонки нужны, чтобы фронтенд
-- знал, каким плеером их рендерить.

alter table pets
  add column if not exists custom_emoji_url text,
  add column if not exists custom_emoji_type text
    check (custom_emoji_type in ('webm', 'tgs'));

drop view if exists pets_with_owner;

create view pets_with_owner as
select
  p.id,
  p.name,
  p.gif_url,
  p.emoji,
  p.custom_emoji_url,
  p.custom_emoji_type,
  p.happiness,
  p.hunger,
  p.energy,
  p.cleanliness,
  p.level,
  p.updated_at,
  pl.id as owner_id,
  pl.telegram_id,
  pl.nickname,
  pl.city,
  pl.upgrade,
  pl.money
from pets p
join players pl on pl.id = p.owner_id;
