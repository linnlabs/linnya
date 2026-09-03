/**
 * @file blocks/audio.schema.ts
 * @description 定义 AudioBlock 的所有卫星表结构。
 * 
 * AudioBlock 是一个复杂块，包含：
 * - 核心元数据（audio_blocks）
 * - 转录内容（audio_block_transcripts）- 一个内嵌的 Tiptap 编辑器
 * - 笔记内容（audio_block_notes）
 * - 摘要内容（audio_block_summaries）
 */

export const AUDIO_BLOCK_SCHEMAS = [
  // AudioBlock 核心表
  `CREATE TABLE IF NOT EXISTS audio_blocks (
    id TEXT PRIMARY KEY,
    document_node_id TEXT NOT NULL,
    asset_id TEXT,
    duration_seconds REAL,
    mime_type TEXT,
    recorded_at INTEGER,
    is_finalized INTEGER NOT NULL DEFAULT 0,
    is_temp_src INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
  )`,

  // 转录内容表 (内嵌的 Tiptap 编辑器)
  `CREATE TABLE IF NOT EXISTS audio_block_transcripts (
    audio_block_id TEXT PRIMARY KEY,
    content_json TEXT NOT NULL,
    translation_language TEXT,
    translation_visible INTEGER NOT NULL DEFAULT 0,
    text_column_width REAL DEFAULT 50,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(audio_block_id) REFERENCES audio_blocks(id) ON DELETE CASCADE
  )`,

  // 笔记内容表
  `CREATE TABLE IF NOT EXISTS audio_block_notes (
    audio_block_id TEXT PRIMARY KEY,
    content_text TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(audio_block_id) REFERENCES audio_blocks(id) ON DELETE CASCADE
  )`,

  // 摘要内容表
  `CREATE TABLE IF NOT EXISTS audio_block_summaries (
    audio_block_id TEXT PRIMARY KEY,
    content_text TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(audio_block_id) REFERENCES audio_blocks(id) ON DELETE CASCADE
  )`,

  // 索引优化
  `CREATE INDEX IF NOT EXISTS idx_audio_blocks_document ON audio_blocks(document_node_id)`,
];

