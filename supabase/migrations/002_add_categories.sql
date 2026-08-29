ALTER TABLE articles ADD COLUMN IF NOT EXISTS wp_category_id integer;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS wp_category_id integer;
