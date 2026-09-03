import type { MarkdownReadDatabase } from '../../../../definitions/markdownReadDatabase';

export interface MarkdownDocumentImage {
  readonly blockId: string;
  readonly locator: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}

interface ImageBlockReadRow {
  readonly id: string;
  readonly src: string;
  readonly alt: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseImageBlockReadRow(value: unknown): ImageBlockReadRow {
  if (!isRecord(value)) throw new Error('image_blocks returned a non-object row');
  const { id, src, alt, width, height } = value;
  if (
    typeof id !== 'string'
    || typeof src !== 'string'
    || (alt !== null && typeof alt !== 'string')
    || (width !== null && typeof width !== 'number')
    || (height !== null && typeof height !== 'number')
  ) {
    throw new Error('image_blocks returned an invalid Markdown image row');
  }
  return { id, src, alt, width, height };
}

/** Markdown DocumentView 所需的图片事实只读边界。 */
export class MarkdownImageBlockReader {
  constructor(private readonly readDb: MarkdownReadDatabase) {}

  listForDocument(documentId: string): MarkdownDocumentImage[] {
    const rows = this.readDb.all(`
      SELECT id, src, alt, width, height
      FROM image_blocks
      WHERE document_node_id = ?
      ORDER BY created_at ASC
    `, [documentId]).map(parseImageBlockReadRow);

    return rows.map((row) => ({
      blockId: row.id,
      locator: row.src,
      ...(row.alt ? { alt: row.alt } : {}),
      ...(row.width !== null && row.height !== null
        ? { width: row.width, height: row.height }
        : {}),
    }));
  }
}
