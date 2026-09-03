/** Slides SVG Graphic 源身份与 presentation-owned asset 的不可变绑定。 */
export const PRESENTATION_SVG_GRAPHIC_BINDING_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS presentation_svg_graphic_bindings (
    presentation_id TEXT NOT NULL,
    source_identity TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    viewbox_width REAL NOT NULL,
    viewbox_height REAL NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (presentation_id, source_identity),
    FOREIGN KEY (presentation_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_presentation_svg_graphic_bindings_asset
    ON presentation_svg_graphic_bindings(asset_id)`,
] as const;
