import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { COMMAND_CARD_SETTLEMENT_SCHEMAS } from './commandCardSettlements.schema';

export class CommandCardSettlementsSchemaProvider implements ISchemaProvider {
  readonly name = 'command-card-settlements';
  getSchema(): string[] {
    return [...COMMAND_CARD_SETTLEMENT_SCHEMAS];
  }
}
