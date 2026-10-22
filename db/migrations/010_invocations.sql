CREATE TABLE conversations (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES drafts(id), actor_id text NOT NULL,
  environment_id uuid NOT NULL, version_id uuid NOT NULL REFERENCES release_versions(id), record jsonb NOT NULL
);
CREATE TRIGGER immutable_conversation BEFORE UPDATE OR DELETE ON conversations FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
CREATE TABLE invocations (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES drafts(id), actor_id text NOT NULL,
  environment_id uuid NOT NULL, client_request_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations(id), version_id uuid NOT NULL REFERENCES release_versions(id),
  run_id uuid NOT NULL UNIQUE, record jsonb NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), last_polled_at timestamptz NOT NULL DEFAULT 'epoch',
  UNIQUE(agent_id,environment_id,actor_id,client_request_id)
);
CREATE INDEX invocations_pending ON invocations(next_attempt_at,last_polled_at) WHERE record->>'status' IN ('reserved','blocked');
CREATE INDEX invocations_conversation ON invocations(conversation_id);
CREATE FUNCTION protect_invocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['record','next_attempt_at','last_polled_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['record','next_attempt_at','last_polled_at'])
     OR (NEW.record - ARRAY['status','updatedAt','diagnostic']) IS DISTINCT FROM (OLD.record - ARRAY['status','updatedAt','diagnostic'])
     OR (OLD.record->>'status' IN ('admitted','cancelled') AND NEW.record IS DISTINCT FROM OLD.record) THEN
    RAISE EXCEPTION 'Invocation target and admission result are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_invocation BEFORE UPDATE ON invocations FOR EACH ROW EXECUTE FUNCTION protect_invocation();
