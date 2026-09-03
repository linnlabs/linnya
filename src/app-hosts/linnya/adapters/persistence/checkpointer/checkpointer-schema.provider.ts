/**
 * @file src/app-hosts/linnya/adapters/persistence/checkpointer/checkpointer-schema.provider.ts
 * @description Linnya backend SqliteCheckpointer 的 schema provider。
 */

import { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { ENGINE_CHECKPOINTS_SCHEMA } from './checkpointer.schema';

export class CheckpointerSchemaProvider implements ISchemaProvider {
  readonly name = 'engine_checkpoints';

  getSchema(): string[] {
    return ENGINE_CHECKPOINTS_SCHEMA;
  }
}
