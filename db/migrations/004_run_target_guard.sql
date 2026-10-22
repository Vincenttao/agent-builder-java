CREATE OR REPLACE FUNCTION protect_run_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id
     OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id OR NEW.input_digest IS DISTINCT FROM OLD.input_digest
     OR (NEW.record - ARRAY['status','result','updatedAt','cancelRequested','started','externalEvidence','diagnostic','dependencyFailures'])
        IS DISTINCT FROM
        (OLD.record - ARRAY['status','result','updatedAt','cancelRequested','started','externalEvidence','diagnostic','dependencyFailures']) THEN
    RAISE EXCEPTION 'Run target is immutable';
  END IF;
  RETURN NEW;
END;
$$;
