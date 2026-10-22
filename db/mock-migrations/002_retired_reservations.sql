-- A cancellation may arrive before environment creation; no environment foreign key is intentional.
CREATE TABLE mock_retired_reservations (
  environment_id uuid NOT NULL, run_id uuid NOT NULL, retired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(environment_id,run_id)
);
CREATE TRIGGER immutable_retired_reservations BEFORE UPDATE OR DELETE ON mock_retired_reservations FOR EACH ROW EXECUTE FUNCTION reject_mock_evidence_mutation();
