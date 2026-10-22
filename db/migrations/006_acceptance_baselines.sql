CREATE TABLE acceptance_baselines (
    id uuid PRIMARY KEY, draft_id uuid NOT NULL, draft_revision integer NOT NULL,
    digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), record jsonb NOT NULL,
    FOREIGN KEY (draft_id,draft_revision) REFERENCES draft_revisions(draft_id,revision), UNIQUE(draft_id,digest)
);
CREATE TRIGGER immutable_acceptance_baselines BEFORE UPDATE OR DELETE ON acceptance_baselines
FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
