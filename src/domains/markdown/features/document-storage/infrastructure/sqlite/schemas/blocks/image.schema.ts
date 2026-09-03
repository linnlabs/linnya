/**
 * @file blocks/image.schema.ts
 * @description 定义 ImageBlock 的卫星表结构。
 * 
 * 前端 ImageBlock 是一个 atom 节点，包含：
 * - id (blockId)
 * - blockType = 'image'
 * - src (图片源地址，可能是 data URL 或文件路径)
 * - alt, title (图片的替代文本和标题)
 * - width, height (图片尺寸)
 * - alignment (对齐方式: 'left' | 'center' | 'right')
 * - uploadedAt (上传时间戳)
 * 
 * 注意：
 * - src 可能指向 assets 表中的资源，也可能是外部 URL
 * - 通过 document_asset_links 表维护与 assets 的关联关系
 * - 该表主要存储图片的显示元数据，实际文件由 assets 表管理
 */

export const IMAGE_BLOCK_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS image_blocks (
    id TEXT PRIMARY KEY,
    document_node_id TEXT NOT NULL,
    asset_id TEXT,
    src TEXT NOT NULL,
    alt TEXT,
    title TEXT,
    width INTEGER,
    height INTEGER,
    alignment TEXT DEFAULT 'center',
    block_type TEXT DEFAULT 'image',
    uploaded_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_image_blocks_document ON image_blocks(document_node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_image_blocks_asset ON image_blocks(asset_id)`,
];

