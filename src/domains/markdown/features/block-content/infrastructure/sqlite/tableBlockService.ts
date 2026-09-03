/**
 * @file table-block.service.ts
 * @description TableBlock 专职服务
 */

import Database from 'better-sqlite3';

export interface TableBlock {
  id: string;
  document_node_id: string;
  table_json: string;
  with_header_row: number;
  row_count: number | null;
  col_count: number | null;
  created_at: number;
  updated_at: number;
}

export class TableBlockService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 创建 TableBlock
   */
  createTableBlock(params: {
    id: string;
    documentNodeId: string;
    tableJson: string;
    withHeaderRow?: boolean;
    rowCount?: number;
    colCount?: number;
  }): TableBlock {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO table_blocks (
        id, document_node_id, table_json, with_header_row, 
        row_count, col_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.documentNodeId,
      params.tableJson,
      params.withHeaderRow ? 1 : 0,
      params.rowCount || null,
      params.colCount || null,
      now,
      now
    );

    return this.getTableBlock(params.id)!;
  }

  /**
   * 获取 TableBlock
   */
  getTableBlock(tableBlockId: string): TableBlock | null {
    const stmt = this.db.prepare(`SELECT * FROM table_blocks WHERE id = ?`);
    return stmt.get(tableBlockId) as TableBlock | null;
  }

  /**
   * 更新 TableBlock
   */
  updateTableBlock(tableBlockId: string, updates: {
    tableJson?: string;
    withHeaderRow?: boolean;
    rowCount?: number;
    colCount?: number;
  }): void {
    const now = Date.now();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.tableJson !== undefined) {
      fields.push('table_json = ?');
      values.push(updates.tableJson);
    }
    if (updates.withHeaderRow !== undefined) {
      fields.push('with_header_row = ?');
      values.push(updates.withHeaderRow ? 1 : 0);
    }
    if (updates.rowCount !== undefined) {
      fields.push('row_count = ?');
      values.push(updates.rowCount);
    }
    if (updates.colCount !== undefined) {
      fields.push('col_count = ?');
      values.push(updates.colCount);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(tableBlockId);

    const stmt = this.db.prepare(`UPDATE table_blocks SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * 删除 TableBlock
   */
  deleteTableBlock(tableBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM table_blocks WHERE id = ?`);
    stmt.run(tableBlockId);
  }
}

