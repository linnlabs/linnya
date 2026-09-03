/**
 * @file image-block.service.ts
 * @description ImageBlock 专职服务
 */

import Database from 'better-sqlite3';

export interface ImageBlock {
  id: string;
  document_node_id: string;
  asset_id: string | null;
  src: string;
  alt: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  alignment: string | null;
  uploaded_at: number | null;
  created_at: number;
  updated_at: number;
}

export class ImageBlockService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 创建 ImageBlock
   */
  createImageBlock(params: {
    id: string;
    documentNodeId: string;
    assetId?: string | null;
    src: string;
    alt?: string;
    title?: string;
    width?: number;
    height?: number;
    alignment?: string;
    uploadedAt?: number;
  }): ImageBlock {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO image_blocks (
        id, document_node_id, asset_id, src, alt, title, 
        width, height, alignment, uploaded_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      params.id,
      params.documentNodeId,
      params.assetId ?? null,
      params.src,
      params.alt || null,
      params.title || null,
      params.width || null,
      params.height || null,
      params.alignment || null,
      params.uploadedAt || now,
      now,
      now
    );

    return this.getImageBlock(params.id)!;
  }

  /**
   * 获取 ImageBlock
   */
  getImageBlock(imageBlockId: string): ImageBlock | null {
    const stmt = this.db.prepare(`SELECT * FROM image_blocks WHERE id = ?`);
    return stmt.get(imageBlockId) as ImageBlock | null;
  }

  /**
   * 更新 ImageBlock
   */
  updateImageBlock(imageBlockId: string, updates: Partial<Omit<ImageBlock, 'id' | 'document_node_id' | 'created_at'>>): void {
    const now = Date.now();
    const fields: string[] = [];
    const values: Array<string | number | null> = [];

    if (updates.asset_id !== undefined) {
      fields.push('asset_id = ?');
      values.push(updates.asset_id);
    }
    if (updates.src !== undefined) {
      fields.push('src = ?');
      values.push(updates.src);
    }
    if (updates.alt !== undefined) {
      fields.push('alt = ?');
      values.push(updates.alt);
    }
    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.width !== undefined) {
      fields.push('width = ?');
      values.push(updates.width);
    }
    if (updates.height !== undefined) {
      fields.push('height = ?');
      values.push(updates.height);
    }
    if (updates.alignment !== undefined) {
      fields.push('alignment = ?');
      values.push(updates.alignment);
    }

    if (fields.length === 0) return;

    fields.push('updated_at = ?');
    values.push(now);
    values.push(imageBlockId);

    const stmt = this.db.prepare(`UPDATE image_blocks SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * 删除 ImageBlock
   */
  deleteImageBlock(imageBlockId: string): void {
    const stmt = this.db.prepare(`DELETE FROM image_blocks WHERE id = ?`);
    stmt.run(imageBlockId);
  }
}
