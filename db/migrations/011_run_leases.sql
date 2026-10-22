ALTER TABLE runs ADD COLUMN worker_fencing_token bigint NOT NULL DEFAULT 0;
CREATE FUNCTION protect_run_terminal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.record->>'status' IN ('succeeded','failed','cancelled','interrupted') AND NEW.record IS DISTINCT FROM OLD.record THEN
    RAISE EXCEPTION 'Run terminal record is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_run_terminal BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION protect_run_terminal();
