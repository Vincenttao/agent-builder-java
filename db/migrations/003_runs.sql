CREATE TABLE runs (
    id uuid PRIMARY KEY, snapshot_id uuid NOT NULL REFERENCES snapshots(id), client_request_id uuid NOT NULL,
    input_digest text NOT NULL, record jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    lease_owner uuid, lease_until timestamptz, UNIQUE(snapshot_id,client_request_id)
);
CREATE INDEX runs_work_idx ON runs((record->>'status'), created_at);
CREATE TABLE run_events (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id),
    source text NOT NULL, source_key text NOT NULL, type text NOT NULL, data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(run_id,source,source_key)
);
CREATE INDEX run_events_run_idx ON run_events(run_id,seq);
CREATE FUNCTION protect_run_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.snapshot_id <> OLD.snapshot_id OR NEW.client_request_id <> OLD.client_request_id
     OR NEW.input_digest <> OLD.input_digest
     OR NEW.record->'artifactDigest' <> OLD.record->'artifactDigest'
     OR NEW.record->'snapshotDigest' <> OLD.record->'snapshotDigest'
     OR NEW.record->'environmentId' <> OLD.record->'environmentId'
     OR NEW.record->'actorId' <> OLD.record->'actorId'
     OR NEW.record->'input' <> OLD.record->'input'
     OR NEW.record->'deploymentId' <> OLD.record->'deploymentId' THEN
    RAISE EXCEPTION 'Run target is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_run_target BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION protect_run_target();
CREATE FUNCTION reject_run_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Run events are immutable'; END;
$$;
CREATE TRIGGER immutable_run_events BEFORE UPDATE OR DELETE ON run_events FOR EACH ROW EXECUTE FUNCTION reject_run_event_mutation();
