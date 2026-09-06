/** Slides 文稿当前物化、源码 revision、草稿与模板的最终空库结构。 */
export const PRESENTATION_DOCUMENT_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS presentation_documents (
    node_id TEXT PRIMARY KEY,
    current_revision_id TEXT NOT NULL,
    current_revision INTEGER NOT NULL CHECK (current_revision > 0),
    deck_source TEXT NOT NULL CHECK (LENGTH(TRIM(deck_source)) > 0),
    source_hash TEXT NOT NULL,
    deck_spec_json TEXT NOT NULL,
    pptx_buffer BLOB NOT NULL,
    title TEXT NOT NULL,
    slide_count INTEGER NOT NULL CHECK (slide_count >= 0),
    layout TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    author_id TEXT,

    FOREIGN KEY (node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (current_revision_id) REFERENCES presentation_revisions(id)
      DEFERRABLE INITIALLY DEFERRED
  )`,

  `CREATE TABLE IF NOT EXISTS presentation_revisions (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    parent_revision_id TEXT,
    base_source_hash TEXT,
    source_hash TEXT NOT NULL,
    storage_kind TEXT NOT NULL CHECK (storage_kind IN ('checkpoint', 'patch')),
    source_checkpoint TEXT,
    source_patch TEXT,
    patch_bytes INTEGER NOT NULL CHECK (patch_bytes >= 0),
    created_at INTEGER NOT NULL,
    author_id TEXT,
    origin TEXT NOT NULL CHECK (origin IN ('create', 'codegen', 'edit', 'relayout', 'repair', 'restore')),
    restored_from_version_id TEXT,
    restored_from_created_at INTEGER,

    FOREIGN KEY (node_id) REFERENCES presentation_documents(node_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_revision_id) REFERENCES presentation_revisions(id),
    UNIQUE (node_id, revision),
    CHECK (
      (storage_kind = 'checkpoint' AND source_checkpoint IS NOT NULL AND source_patch IS NULL AND patch_bytes = 0)
      OR
      (storage_kind = 'patch' AND source_checkpoint IS NULL AND source_patch IS NOT NULL AND base_source_hash IS NOT NULL)
    )
  )`,

  `CREATE INDEX IF NOT EXISTS idx_presentation_revisions_node_revision
    ON presentation_revisions(node_id, revision DESC)`,

  `CREATE TABLE IF NOT EXISTS presentation_drafts (
    node_id TEXT PRIMARY KEY,
    deck_source TEXT NOT NULL CHECK (LENGTH(TRIM(deck_source)) > 0),
    source_hash TEXT NOT NULL,
    base_revision_id TEXT NOT NULL,
    base_revision INTEGER NOT NULL CHECK (base_revision > 0),
    last_error_summary TEXT,
    last_error_kind TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,

    FOREIGN KEY (node_id) REFERENCES presentation_documents(node_id) ON DELETE CASCADE,
    FOREIGN KEY (base_revision_id) REFERENCES presentation_revisions(id)
  )`,

  `CREATE TABLE IF NOT EXISTS presentation_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    template_spec_json TEXT NOT NULL,
    source_pptx_buffer BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE INDEX IF NOT EXISTS idx_presentation_templates_name
    ON presentation_templates(name)`,
] as const;
