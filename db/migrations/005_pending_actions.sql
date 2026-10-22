CREATE TABLE pending_actions (
    id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id), tool_call_id text NOT NULL,
    record jsonb NOT NULL, UNIQUE(run_id,tool_call_id)
);
CREATE TABLE action_attempts (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, action_id uuid NOT NULL REFERENCES pending_actions(id),
    type text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_action_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Action target is immutable'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.tool_call_id IS DISTINCT FROM OLD.tool_call_id
     OR (NEW.record - ARRAY['status','updatedAt','decisionId','decision','decidedAt','response'])
        IS DISTINCT FROM (OLD.record - ARRAY['status','updatedAt','decisionId','decision','decidedAt','response']) THEN
    RAISE EXCEPTION 'Action target is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_action_target BEFORE UPDATE OR DELETE ON pending_actions FOR EACH ROW EXECUTE FUNCTION protect_action_target();
CREATE TRIGGER immutable_action_attempts BEFORE UPDATE OR DELETE ON action_attempts FOR EACH ROW EXECUTE FUNCTION reject_run_event_mutation();
