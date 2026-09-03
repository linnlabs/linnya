import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { COMMAND_APPROVAL_SCHEMAS } from './commandApprovals.schema';

export class CommandApprovalsSchemaProvider implements ISchemaProvider {
  readonly name = 'command-approvals';

  getSchema(): string[] {
    return COMMAND_APPROVAL_SCHEMAS;
  }
}
