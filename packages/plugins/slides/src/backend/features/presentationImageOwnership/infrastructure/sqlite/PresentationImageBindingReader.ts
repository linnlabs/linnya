import type Database from 'better-sqlite3';
import type {
  PresentationImageBinding,
  PresentationImageBindingReaderPort,
} from '../../definitions/presentationImageBinding';

interface PresentationImageBindingRow {
  readonly presentation_id: string;
  readonly source_identity: string;
  readonly asset_id: string;
  readonly created_at: number;
}

function toBinding(row: PresentationImageBindingRow): PresentationImageBinding {
  return {
    presentationId: row.presentation_id,
    sourceIdentity: row.source_identity,
    assetId: row.asset_id,
    createdAt: row.created_at,
  };
}

/** 只暴露历史重放需要的查询能力，避免只读命令意外获得绑定写权限。 */
export class PresentationImageBindingReader implements PresentationImageBindingReaderPort {
  private readonly findStatement;

  constructor(db: Database.Database) {
    this.findStatement = db.prepare<[string, string], PresentationImageBindingRow>(`
      SELECT presentation_id, source_identity, asset_id, created_at
      FROM presentation_image_bindings
      WHERE presentation_id = ? AND source_identity = ?
    `);
  }

  find(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
  }): PresentationImageBinding | null {
    const row = this.findStatement.get(input.presentationId, input.sourceIdentity);
    return row ? toBinding(row) : null;
  }
}
