ALTER TABLE release_operations ADD COLUMN last_polled_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z';
