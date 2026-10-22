CREATE TABLE candidates (
  id uuid PRIMARY KEY, snapshot_id uuid NOT NULL REFERENCES snapshots(id), bundle_digest text NOT NULL UNIQUE, record jsonb NOT NULL
);
CREATE TRIGGER immutable_candidate BEFORE UPDATE OR DELETE ON candidates FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
CREATE TABLE test_deployments (
  id uuid PRIMARY KEY, candidate_id uuid NOT NULL REFERENCES candidates(id), baseline_id uuid NOT NULL REFERENCES acceptance_baselines(id),
  client_request_id uuid NOT NULL UNIQUE, record jsonb NOT NULL,
  lease_owner uuid, lease_until timestamptz, next_poll_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_test_deployment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Test deployment history is immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['record','lease_owner','lease_until','next_poll_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['record','lease_owner','lease_until','next_poll_at'])
    OR (NEW.record - ARRAY['status','failure','diagnostic','updatedAt']) IS DISTINCT FROM (OLD.record - ARRAY['status','failure','diagnostic','updatedAt'])
    OR (OLD.record->>'status' IN ('stopped','failed') AND NEW.record IS DISTINCT FROM OLD.record) THEN
    RAISE EXCEPTION 'Test deployment target and terminal result are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_test_deployment BEFORE UPDATE OR DELETE ON test_deployments FOR EACH ROW EXECUTE FUNCTION protect_test_deployment();
ALTER TABLE conversations ALTER COLUMN version_id DROP NOT NULL;
ALTER TABLE conversations ADD COLUMN test_deployment_id uuid REFERENCES test_deployments(id);
ALTER TABLE conversations ADD CONSTRAINT conversation_one_target CHECK ((version_id IS NULL) <> (test_deployment_id IS NULL));
ALTER TABLE invocations ALTER COLUMN version_id DROP NOT NULL;
ALTER TABLE invocations ADD COLUMN test_deployment_id uuid REFERENCES test_deployments(id);
ALTER TABLE invocations ADD CONSTRAINT invocation_one_target CHECK ((version_id IS NULL) <> (test_deployment_id IS NULL));
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint WHERE conrelid='invocations'::regclass
    AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (agent_id, environment_id, actor_id, client_request_id)';
  EXECUTE format('ALTER TABLE invocations DROP CONSTRAINT %I',constraint_name);
END;
$$;
CREATE UNIQUE INDEX published_request_key ON invocations(agent_id,environment_id,actor_id,client_request_id) WHERE test_deployment_id IS NULL;
CREATE UNIQUE INDEX test_request_key ON invocations(test_deployment_id,environment_id,actor_id,client_request_id) WHERE test_deployment_id IS NOT NULL;
CREATE INDEX test_deployment_requests ON invocations(test_deployment_id);
