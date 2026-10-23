CREATE INDEX run_events_retention_idx ON run_events(created_at, run_id, seq);

CREATE OR REPLACE FUNCTION reject_run_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('agent_builder.allow_run_event_retention', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Run events are immutable outside retention cleanup';
END;
$$;
