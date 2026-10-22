CREATE TABLE release_pointers (
  agent_id uuid PRIMARY KEY REFERENCES drafts(id), record jsonb NOT NULL
);
CREATE TABLE release_operations (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES drafts(id), client_request_id uuid NOT NULL,
  record jsonb NOT NULL, lease_owner uuid, lease_until timestamptz, fencing_token bigint NOT NULL DEFAULT 0, cleanup_pending boolean NOT NULL DEFAULT false,
  UNIQUE(agent_id,client_request_id)
);
CREATE UNIQUE INDEX one_active_release ON release_operations(agent_id) WHERE record->>'status' IN ('queued','preparing','smoking');
CREATE TABLE release_versions (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES drafts(id), operation_id uuid NOT NULL UNIQUE REFERENCES release_operations(id),
  record jsonb NOT NULL
);
CREATE TRIGGER immutable_release_version BEFORE UPDATE OR DELETE ON release_versions FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
CREATE FUNCTION protect_release_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.agent_id IS DISTINCT FROM OLD.agent_id OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
    OR (NEW.record - ARRAY['status','updatedAt','diagnostic']) IS DISTINCT FROM (OLD.record - ARRAY['status','updatedAt','diagnostic'])
    OR (OLD.record->>'status' IN ('succeeded','failed') AND NEW.record IS DISTINCT FROM OLD.record) THEN
    RAISE EXCEPTION 'Release operation target and terminal record are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_release_operation BEFORE UPDATE ON release_operations FOR EACH ROW EXECUTE FUNCTION protect_release_operation();
