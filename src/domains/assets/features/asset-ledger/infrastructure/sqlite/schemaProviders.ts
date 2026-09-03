import type { ISchemaProvider } from '../../../../../../shared/database/schema-provider';

import { AssetLedgerSchemaProvider } from './assetLedgerSchemaProvider';

export function getAssetSchemaProviders(): ISchemaProvider[] {
  return [new AssetLedgerSchemaProvider()];
}
