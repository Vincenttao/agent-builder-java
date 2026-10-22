CREATE TABLE drafts (
    id uuid PRIMARY KEY,
    revision integer NOT NULL CHECK (revision >= 1),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    brief jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE TABLE draft_revisions (
    draft_id uuid NOT NULL REFERENCES drafts(id),
    revision integer NOT NULL CHECK (revision >= 1),
    content jsonb NOT NULL,
    recorded_at timestamptz NOT NULL,
    PRIMARY KEY (draft_id, revision)
);
