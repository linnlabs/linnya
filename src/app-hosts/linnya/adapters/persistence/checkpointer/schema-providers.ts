/**
 * @file src/app-hosts/linnya/adapters/persistence/checkpointer/schema-providers.ts
 * @description Linnya backend SqliteCheckpointer 的 schema provider 聚合入口。
 */

import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { CheckpointerSchemaProvider } from './checkpointer-schema.provider';

export function getCheckpointerSchemaProviders(): ISchemaProvider[] {
  return [new CheckpointerSchemaProvider()];
}
