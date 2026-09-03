import type { ISchemaProvider } from '../../../../../../shared/database/schema-provider';

import { ASSET_LEDGER_SCHEMAS } from './schemas/assetLedger.schema';

/** Asset domain 对 workspace.sqlite 的核心 schema contribution。 */
export class AssetLedgerSchemaProvider implements ISchemaProvider {
  readonly name = 'asset-ledger';

  getSchema(): string[] {
    return [...ASSET_LEDGER_SCHEMAS];
  }
}
