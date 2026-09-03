/**
 * @file latex-block.service.ts
 * @description LatexBlock 专职服务
 */

import Database from 'better-sqlite3';

export interface LatexBlock {
  id: string;
  document_node_id: string;
  latex_source: string;
  block_type: string;
  created_at: number;
  updated_at: number;
}

export class LatexBlockService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 创建 LatexBlock
   */
  createLatexBlock(params: {
    id: string;
    documentNodeId: string;
    latexSource: string;
    blockType?: string;
  }): LatexBlock {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO latex_blocks (id, document_node_id, latex_source, block_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.documentNodeId,
      params.latexSource,
      params.blockType || 'latex',
      now,
      now
    );

    return this.getLatexBlock(params.id)!;
  }

  /**
   * 获取 LatexBlock
   */
  getLatexBlock(latexBlockId: string): LatexBlock | null {
    const stmt = this.db.prepare(`SELECT * FROM latex_blocks WHERE id = ?`);
    return stmt.get(latexBlockId) as LatexBlock | null;
  }

  /**
   * 更新 LatexBlock
   */
  updateLatexBlock(latexBlockId: string, latexSource: string): void {
    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE latex_blocks SET latex_source = ?, updated_at = ? WHERE id = ?
    `);

    stmt.run(latexSource, now, latexBlockId);
  }

  /**
   * 删除 LatexBlock
   */
  deleteLatexBlock(latexBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM latex_blocks WHERE id = ?`);
    stmt.run(latexBlockId);
  }
}

