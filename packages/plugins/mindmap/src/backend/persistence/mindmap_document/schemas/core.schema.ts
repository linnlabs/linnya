/**
 * @file mindmap_document/schemas/core.schema.ts
 * @description 定义 MindMap 文档类型的核心表结构。
 */

export const MINDMAP_DOCUMENT_SCHEMAS = [
    // MindMap 文档内容版本表
    `CREATE TABLE IF NOT EXISTS mindmap_versions (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      
      -- 完整数据
      content_json TEXT NOT NULL,   -- 存储完整的 MindMapData (包含 nodeData, arrows, summaries 等)
      
      -- 元数据缓存 (提取关键信息，避免解析整个 JSON)
      root_topic TEXT,              -- 根节点文本 (用于列表展示或搜索)
      theme_name TEXT,              -- 使用的主题名称
      layout_type INTEGER,          -- 布局方向/类型 (0, 1, 2 等)
      node_count INTEGER DEFAULT 0, -- 节点总数 (用于统计)
      -- 文本统计：缓存所有节点 topic 文本的总字符数
      char_count INTEGER NOT NULL DEFAULT 0,
      
      -- 视图状态 (保存最后一次的查看位置，提升用户体验)
      viewport_x REAL DEFAULT 0,
      viewport_y REAL DEFAULT 0,
      viewport_scale REAL DEFAULT 1,
      
      -- 审计与扩展
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      author_id TEXT,
      metadata_json TEXT,           -- 预留扩展字段 (存储未来可能需要的其他元数据)
      
      UNIQUE(node_id, version_number),
      FOREIGN KEY(node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
    )`,
  
    // 索引优化
    `CREATE INDEX IF NOT EXISTS idx_mindmap_versions_node ON mindmap_versions(node_id, version_number DESC)`
  ];