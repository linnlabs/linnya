export const PRESENTATION_HISTORY_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS presentation_revision_contexts (
    revision_id TEXT PRIMARY KEY REFERENCES presentation_revisions(id) ON DELETE CASCADE,
    theme_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS presentation_revision_assets (
    revision_id TEXT NOT NULL REFERENCES presentation_revision_contexts(revision_id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    asset_kind TEXT NOT NULL CHECK(asset_kind IN ('image', 'svg')),
    PRIMARY KEY(revision_id, asset_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_revision_assets_asset ON presentation_revision_assets(asset_id)`,
  `CREATE TABLE IF NOT EXISTS presentation_asset_releases (
    node_id TEXT NOT NULL REFERENCES presentation_documents(node_id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL,
    PRIMARY KEY(node_id, asset_id)
  )`,
] as const;
