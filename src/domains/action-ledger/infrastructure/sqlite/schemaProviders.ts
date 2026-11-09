import type { ISchemaProvider } from '../../../../shared/database/schema-provider';

import { ACTION_LEDGER_SCHEMAS } from './actionLedger.schema';

export function getActionLedgerSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'action-ledger', getSchema: () => [...ACTION_LEDGER_SCHEMAS] }];
}
