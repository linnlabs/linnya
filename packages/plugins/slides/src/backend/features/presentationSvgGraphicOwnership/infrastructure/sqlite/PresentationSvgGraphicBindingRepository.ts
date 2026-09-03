import type Database from 'better-sqlite3';
import type {
  PresentationSvgGraphicBinding,
  PresentationSvgGraphicBindingRepositoryPort,
} from '../../definitions/presentationSvgGraphicBinding';

interface PresentationSvgGraphicBindingRow {
  readonly presentation_id: string;
  readonly source_identity: string;
  readonly asset_id: string;
  readonly content_hash: string;
  readonly byte_length: number;
  readonly viewbox_width: number;
  readonly viewbox_height: number;
  readonly created_at: number;
}

function toBinding(row: PresentationSvgGraphicBindingRow): PresentationSvgGraphicBinding {
  if (
    !Number.isSafeInteger(row.byte_length) ||
    row.byte_length <= 0 ||
    !Number.isFinite(row.viewbox_width) ||
    row.viewbox_width <= 0 ||
    !Number.isFinite(row.viewbox_height) ||
    row.viewbox_height <= 0
  ) {
    throw new Error('Slides SVG Graphic binding facts are invalid.');
  }
  return {
    presentationId: row.presentation_id,
    sourceIdentity: row.source_identity,
    assetId: row.asset_id,
    contentHash: row.content_hash,
    byteLength: row.byte_length,
    viewBox: { width: row.viewbox_width, height: row.viewbox_height },
    createdAt: row.created_at,
  };
}

export class PresentationSvgGraphicBindingRepository
  implements PresentationSvgGraphicBindingRepositoryPort
{
  private readonly insertStatement;
  private readonly findStatement;

  constructor(private readonly db: Database.Database) {
    this.insertStatement = db.prepare(`
      INSERT OR IGNORE INTO presentation_svg_graphic_bindings (
        presentation_id, source_identity, asset_id, content_hash, byte_length,
        viewbox_width, viewbox_height, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.findStatement = db.prepare<[string, string], PresentationSvgGraphicBindingRow>(`
      SELECT presentation_id, source_identity, asset_id, content_hash, byte_length,
             viewbox_width, viewbox_height, created_at
      FROM presentation_svg_graphic_bindings
      WHERE presentation_id = ? AND source_identity = ?
    `);
  }

  find(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
  }): PresentationSvgGraphicBinding | null {
    const row = this.findStatement.get(input.presentationId, input.sourceIdentity);
    return row ? toBinding(row) : null;
  }

  bind(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
    readonly assetId: string;
    readonly contentHash: string;
    readonly byteLength: number;
    readonly viewBox: { readonly width: number; readonly height: number };
    readonly createdAt?: number;
  }): PresentationSvgGraphicBinding {
    return this.db
      .transaction((): PresentationSvgGraphicBinding => {
        this.insertStatement.run(
          input.presentationId,
          input.sourceIdentity,
          input.assetId,
          input.contentHash,
          input.byteLength,
          input.viewBox.width,
          input.viewBox.height,
          input.createdAt ?? Date.now()
        );
        const binding = this.find(input);
        if (!binding) throw new Error('Slides SVG Graphic binding could not be committed.');
        return binding;
      })
      .immediate();
  }
}
