/** Slides 源码图片身份与 presentation-owned asset 的不可变绑定。 */
export const PRESENTATION_IMAGE_BINDING_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS presentation_image_bindings (
    presentation_id TEXT NOT NULL,
    source_identity TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (presentation_id, source_identity),
    FOREIGN KEY (presentation_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_image_bindings_asset
    ON presentation_image_bindings(asset_id)`,
] as const;
