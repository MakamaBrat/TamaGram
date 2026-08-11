-- migration_add_pet_emoji.sql
-- Выполнить в Supabase SQL Editor.
--
-- Добавляет колонку emoji: декоративное "лицо" питомца, которое игрок
-- может выбрать в приложении без похода к боту за GIF. Если у питомца
-- задан gif_url, он имеет приоритет в отображении (см. App.jsx).

alter table pets
  add column if not exists emoji text;

-- обновляем вьюху, чтобы emoji тоже отдавался
drop view if exists pets_with_owner;

create view pets_with_owner as
select
  p.id,
  p.name,
  p.gif_url,
  p.emoji,
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
