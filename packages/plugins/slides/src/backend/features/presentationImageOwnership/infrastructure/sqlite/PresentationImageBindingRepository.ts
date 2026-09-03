import type Database from 'better-sqlite3';
import type {
  PresentationImageBinding,
  PresentationImageBindingRepositoryPort,
} from '../../definitions/presentationImageBinding';
import { PresentationImageBindingReader } from './PresentationImageBindingReader';

export class PresentationImageBindingRepository
  extends PresentationImageBindingReader
  implements PresentationImageBindingRepositoryPort
{
  private readonly insertStatement;

  constructor(private readonly db: Database.Database) {
    super(db);
    this.insertStatement = db.prepare(`
      INSERT OR IGNORE INTO presentation_image_bindings (
        presentation_id, source_identity, asset_id, created_at
      ) VALUES (?, ?, ?, ?)
    `);
  }

  bind(input: {
    readonly presentationId: string;
    readonly sourceIdentity: string;
    readonly assetId: string;
    readonly createdAt?: number;
  }): PresentationImageBinding {
    const createdAt = input.createdAt ?? Date.now();
    return this.db
      .transaction((): PresentationImageBinding => {
        this.insertStatement.run(
          input.presentationId,
          input.sourceIdentity,
          input.assetId,
          createdAt
        );
        const binding = this.find(input);
        if (!binding) {
          throw new Error(
            `Slides 图片绑定写入失败：${input.presentationId}/${input.sourceIdentity}`
          );
        }
        return binding;
      })
      .immediate();
  }
}
