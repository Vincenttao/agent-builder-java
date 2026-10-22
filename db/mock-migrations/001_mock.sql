CREATE TABLE mock_environments (
    id uuid PRIMARY KEY, config jsonb NOT NULL, revision integer NOT NULL CHECK (revision > 0),
    state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mock_reservations (
    environment_id uuid NOT NULL REFERENCES mock_environments(id), run_id uuid NOT NULL,
    active boolean NOT NULL DEFAULT true, PRIMARY KEY (environment_id, run_id)
);
CREATE TABLE mock_batches (
    environment_id uuid NOT NULL REFERENCES mock_environments(id), revision integer NOT NULL,
    state jsonb NOT NULL, archived_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (environment_id, revision)
);
CREATE TABLE mock_calls (
    seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, environment_id uuid NOT NULL REFERENCES mock_environments(id),
    state_revision integer NOT NULL, run_id uuid NOT NULL, actor_id text NOT NULL, operation text NOT NULL,
    input jsonb NOT NULL, status integer NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mock_calls_environment_idx ON mock_calls(environment_id, seq);
CREATE FUNCTION reject_mock_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Mock evidence is immutable'; END;
$$;
CREATE TRIGGER immutable_mock_calls BEFORE UPDATE OR DELETE ON mock_calls FOR EACH ROW EXECUTE FUNCTION reject_mock_evidence_mutation();
CREATE TRIGGER immutable_mock_batches BEFORE UPDATE OR DELETE ON mock_batches FOR EACH ROW EXECUTE FUNCTION reject_mock_evidence_mutation();
