-- migration_add_pet_created_at.sql
-- Выполнить в Supabase SQL Editor, ПОСЛЕ migration_add_pet_custom_emoji.sql.
--
-- Добавляет created_at (момент "рождения" питомца), чтобы фронтенд мог
-- считать возраст питомца как разницу между сейчас и created_at.
-- Если колонка уже была (Supabase часто добавляет created_at по
-- умолчанию при создании таблицы) — "add column if not exists" ничего
-- не сломает, просто пропустит.

alter table pets
  add column if not exists created_at timestamptz not null default now();

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
  p.created_at,
  p.updated_at,
  pl.id as owner_id,
  pl.telegram_id,
  pl.nickname,
  pl.city,
  pl.upgrade,
  pl.money
from pets p
join players pl on pl.id = p.owner_id;
