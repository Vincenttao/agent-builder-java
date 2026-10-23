CREATE TABLE imported_project_packages (
  draft_id uuid PRIMARY KEY REFERENCES drafts(id),
  source_project_id uuid NOT NULL,
  package_digest text NOT NULL CHECK (package_digest ~ '^[a-f0-9]{64}$'),
  package jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION preserve_imported_project_package() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Imported project recovery packages are immutable';
END $$;
CREATE TRIGGER imported_project_package_immutable
BEFORE UPDATE OR DELETE ON imported_project_packages
FOR EACH ROW EXECUTE FUNCTION preserve_imported_project_package();
