import type Database from 'better-sqlite3';

interface ImageBlockProjection {
  readonly id: string;
  readonly src: string;
  readonly alt: string | null;
  readonly title: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly alignment: string | null;
  readonly uploadedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readTimestamp(value: unknown, fallback: number): number {
  const timestamp = readNumber(value);
  return timestamp && timestamp > 0 ? timestamp : fallback;
}

function collectImageBlocks(node: unknown, result: ImageBlockProjection[], fallbackUploadedAt: number): void {
  if (!isRecord(node)) return;

  if (node.type === 'imageBlock' && isRecord(node.attrs)) {
    const id = readString(node.attrs.id);
    const src = readString(node.attrs.src);
    if (id && src) {
      result.push({
        id,
        src,
        alt: readString(node.attrs.alt),
        title: readString(node.attrs.title),
        width: readNumber(node.attrs.width),
        height: readNumber(node.attrs.height),
        alignment: readString(node.attrs.alignment),
        uploadedAt: readTimestamp(node.attrs.uploadedAt, fallbackUploadedAt),
      });
    }
  }

  const content = node.content;
  if (Array.isArray(content)) {
    for (const child of content) {
      collectImageBlocks(child, result, fallbackUploadedAt);
    }
  }
}

export class ImageBlockProjectionService {
  constructor(private readonly db: Database.Database) {}

  /**
   * 将 content_json 中的 imageBlock 投影到 image_blocks 卫星表。
   *
   * 中文说明：
   * - content_json 仍是渲染真相，卫星表只做检索/AI 感知索引；
   * - 图片块 id 和 rootBlock id 不是同一个空间，因此不能复用 rootBlock 孤儿清理逻辑。
   */
  syncDocumentProjection(documentNodeId: string, documentContent: unknown): {
    upserted: number;
    removed: number;
  } {
    const now = Date.now();
    const projections: ImageBlockProjection[] = [];
    collectImageBlocks(documentContent, projections, now);

    const upsert = this.db.prepare(`
      INSERT INTO image_blocks (
        id,
        document_node_id,
        asset_id,
        src,
        alt,
        title,
        width,
        height,
        alignment,
        uploaded_at,
        created_at,
        updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        document_node_id = excluded.document_node_id,
        src = excluded.src,
        alt = excluded.alt,
        title = excluded.title,
        width = excluded.width,
        height = excluded.height,
        alignment = excluded.alignment,
        uploaded_at = excluded.uploaded_at,
        updated_at = excluded.updated_at
    `);

    let upserted = 0;
    const liveImageBlockIds = new Set<string>();
    for (const item of projections) {
      liveImageBlockIds.add(item.id);
      const result = upsert.run(
        item.id,
        documentNodeId,
        item.src,
        item.alt,
        item.title,
        item.width,
        item.height,
        item.alignment,
        item.uploadedAt,
        now,
        now,
      );
      upserted += result.changes ?? 0;
    }

    const existingRows = this.db.prepare<[string], { id: string }>(`
      SELECT id
      FROM image_blocks
      WHERE document_node_id = ?
    `).all(documentNodeId);
    const deleteStmt = this.db.prepare(`DELETE FROM image_blocks WHERE document_node_id = ? AND id = ?`);
    let removed = 0;
    for (const row of existingRows) {
      if (!liveImageBlockIds.has(row.id)) {
        const result = deleteStmt.run(documentNodeId, row.id);
        removed += result.changes ?? 0;
      }
    }

    return { upserted, removed };
  }
}
