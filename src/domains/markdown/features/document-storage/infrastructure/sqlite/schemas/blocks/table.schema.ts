/**
 * @file blocks/table.schema.ts
 * @description 定义 TableBlock 的卫星表结构。
 * 
 * TableBlock 是一个复杂块，我们采用务实的策略：
 * 将其完整的 Tiptap JSON 作为一个整体存储，而不是完全范式化为行和单元格。
 * 这既实现了懒加载，又将内部结构的复杂性留给了前端 ProseMirror 处理。
 * 
 * 注意：前端的 TableBlock 包含复杂的嵌套结构（tableRow, tableCell, tableCellContentBlock），
 * 以及丰富的属性（style, colspan, rowspan, colwidth）。
 * 所有这些都被完整保存在 content_json 中，确保无损存储。
 */

export const TABLE_BLOCK_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS table_blocks (
    id TEXT PRIMARY KEY,
    document_node_id TEXT NOT NULL,
    content_json TEXT NOT NULL,
    with_header_row INTEGER NOT NULL DEFAULT 0,
    row_count INTEGER,
    col_count INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_table_blocks_document ON table_blocks(document_node_id)`,
];

