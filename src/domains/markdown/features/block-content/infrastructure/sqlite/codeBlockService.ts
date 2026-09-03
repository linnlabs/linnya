/**
 * @file code-block.service.ts
 * @description CodeBlock 专职服务
 */

import Database from 'better-sqlite3';

export interface CodeBlock {
  id: string;
  document_node_id: string;
  language: string | null;
  code_content: string;
  block_type: string;
  created_at: number;
  updated_at: number;
}

export class CodeBlockService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 创建 CodeBlock
   */
  createCodeBlock(params: {
    id: string;
    documentNodeId: string;
    language?: string;
    codeContent: string;
    blockType?: string;
  }): CodeBlock {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO code_blocks (id, document_node_id, language, code_content, block_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.documentNodeId,
      params.language || null,
      params.codeContent,
      params.blockType || 'code',
      now,
      now
    );

    return this.getCodeBlock(params.id)!;
  }

  /**
   * 获取 CodeBlock
   */
  getCodeBlock(codeBlockId: string): CodeBlock | null {
    const stmt = this.db.prepare(`SELECT * FROM code_blocks WHERE id = ?`);
    return stmt.get(codeBlockId) as CodeBlock | null;
  }

  /**
   * 更新 CodeBlock
   */
  updateCodeBlock(codeBlockId: string, updates: { language?: string; codeContent?: string }): void {
    const now = Date.now();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.language !== undefined) {
      fields.push('language = ?');
      values.push(updates.language);
    }
    if (updates.codeContent !== undefined) {
      fields.push('code_content = ?');
      values.push(updates.codeContent);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(codeBlockId);

    const stmt = this.db.prepare(`UPDATE code_blocks SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * 删除 CodeBlock
   */
  deleteCodeBlock(codeBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM code_blocks WHERE id = ?`);
    stmt.run(codeBlockId);
  }
}

