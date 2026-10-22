CREATE TABLE snapshots (
    id uuid PRIMARY KEY,
    draft_id uuid NOT NULL REFERENCES drafts(id),
    draft_revision integer NOT NULL,
    digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
    content jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (draft_id, draft_revision) REFERENCES draft_revisions(draft_id, revision)
);
CREATE INDEX snapshots_draft_created_idx ON snapshots(draft_id, created_at DESC);
CREATE FUNCTION reject_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Snapshots are immutable';
END;
$$;
CREATE TRIGGER immutable_snapshots BEFORE UPDATE OR DELETE ON snapshots
FOR EACH ROW EXECUTE FUNCTION reject_snapshot_mutation();
