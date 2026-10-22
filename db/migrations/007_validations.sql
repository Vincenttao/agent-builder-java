CREATE TABLE validation_executions (
    id uuid PRIMARY KEY, snapshot_id uuid NOT NULL REFERENCES snapshots(id), baseline_id uuid NOT NULL REFERENCES acceptance_baselines(id),
    client_request_id uuid NOT NULL, record jsonb NOT NULL, lease_owner uuid, lease_until timestamptz, fencing_token bigint NOT NULL DEFAULT 0,
    UNIQUE(snapshot_id,client_request_id)
);
CREATE TABLE validation_evidence (
    id uuid PRIMARY KEY, execution_id uuid NOT NULL REFERENCES validation_executions(id), case_id text NOT NULL,
    digest text NOT NULL, content jsonb NOT NULL, UNIQUE(execution_id,case_id)
);
CREATE TABLE validation_reports (
    execution_id uuid PRIMARY KEY REFERENCES validation_executions(id), digest text NOT NULL, record jsonb NOT NULL
);
CREATE TRIGGER immutable_validation_evidence BEFORE UPDATE OR DELETE ON validation_evidence FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
CREATE TRIGGER immutable_validation_reports BEFORE UPDATE OR DELETE ON validation_reports FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
CREATE FUNCTION protect_validation_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id OR NEW.baseline_id IS DISTINCT FROM OLD.baseline_id
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
     OR (NEW.record - ARRAY['status','updatedAt','cases','results','verdict']) IS DISTINCT FROM (OLD.record - ARRAY['status','updatedAt','cases','results','verdict'])
     OR (OLD.record->>'status'='completed' AND NEW.record IS DISTINCT FROM OLD.record) THEN
    RAISE EXCEPTION 'Validation target or completed record is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_validation_target BEFORE UPDATE ON validation_executions FOR EACH ROW EXECUTE FUNCTION protect_validation_target();
