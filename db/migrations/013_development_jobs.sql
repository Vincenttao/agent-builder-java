CREATE TABLE development_jobs (
 id uuid PRIMARY KEY,
 draft_id uuid NOT NULL REFERENCES drafts(id),
 snapshot_id uuid NOT NULL REFERENCES snapshots(id),
 baseline_id uuid NOT NULL REFERENCES acceptance_baselines(id),
 client_request_id uuid NOT NULL,
 input_digest text NOT NULL,
 task_input jsonb NOT NULL,
 record jsonb NOT NULL,
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(snapshot_id,client_request_id)
);
CREATE INDEX development_active ON development_jobs ((record->>'status'));
CREATE FUNCTION preserve_development_input() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Development evidence is immutable'; END IF;
 IF ROW(NEW.id,NEW.draft_id,NEW.snapshot_id,NEW.baseline_id,NEW.client_request_id,NEW.input_digest,NEW.task_input)
 IS DISTINCT FROM ROW(OLD.id,OLD.draft_id,OLD.snapshot_id,OLD.baseline_id,OLD.client_request_id,OLD.input_digest,OLD.task_input)
 OR (NEW.record - ARRAY['status','updatedAt','roles','bundle','diagnostic']) IS DISTINCT FROM (OLD.record - ARRAY['status','updatedAt','roles','bundle','diagnostic'])
 OR (OLD.record->>'status' IN ('built','failed','cancelled') AND NEW.record IS DISTINCT FROM OLD.record)
 THEN RAISE EXCEPTION 'Development inputs and terminal evidence are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER development_immutable BEFORE UPDATE OR DELETE ON development_jobs FOR EACH ROW EXECUTE FUNCTION preserve_development_input();
CREATE TABLE development_events (
 job_id uuid NOT NULL REFERENCES development_jobs(id),
 seq integer NOT NULL CHECK(seq>0),
 record jsonb NOT NULL,
 PRIMARY KEY(job_id,seq)
);
