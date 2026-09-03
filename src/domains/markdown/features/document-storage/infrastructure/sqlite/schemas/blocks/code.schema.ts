/**
 * @file blocks/code.schema.ts
 * @description 定义 CodeBlock 的卫星表结构。
 * 
 * 前端 CodeBlock 继承自 @tiptap/extension-code-block-lowlight，包含：
 * - id (blockId)
 * - blockType = 'code'
 * - language (代码语言，如 'javascript', 'python')
 * - content (代码内容，需要保留所有空白符和换行)
 * - isEmpty (UI 状态，可不持久化)
 * 
 * 注意：代码内容必须使用 preserveWhitespace: 'full' 来确保空白符不丢失。
 */

export const CODE_BLOCK_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS code_blocks (
    id TEXT PRIMARY KEY,
    document_node_id TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    block_type TEXT DEFAULT 'code',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_code_blocks_document ON code_blocks(document_node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_code_blocks_language ON code_blocks(language)`,
];

