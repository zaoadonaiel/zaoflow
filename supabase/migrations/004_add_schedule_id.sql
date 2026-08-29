ALTER TABLE articles ADD COLUMN IF NOT EXISTS schedule_id uuid REFERENCES schedules(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS articles_schedule_id_idx ON articles(schedule_id);
