/**
 * @file blocks/latex.schema.ts
 * @description 定义 LatexBlock 的卫星表结构。
 * 
 * 前端 LatexBlock 是一个 atom 节点，包含：
 * - id (blockId)
 * - blockType = 'latex'
 * - latexSource (LaTeX 源码，如 'E = mc^2')
 * 
 * 特性：
 * - atom: true (原子节点，不可编辑内部结构)
 * - draggable: true
 * - isolating: true
 * 
 * 前端使用 Vue NodeView (LatexBlockView.vue) 渲染，
 * 提供源码编辑器和渲染预览的双视图。
 */

export const LATEX_BLOCK_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS latex_blocks (
    id TEXT PRIMARY KEY,
    document_node_id TEXT NOT NULL,
    latex_source TEXT NOT NULL,
    block_type TEXT DEFAULT 'latex',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(document_node_id) REFERENCES workspace_nodes(id) ON DELETE CASCADE
  )`,

  `CREATE INDEX IF NOT EXISTS idx_latex_blocks_document ON latex_blocks(document_node_id)`,
];

