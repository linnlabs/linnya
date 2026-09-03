import { describe, expect, it, vi } from 'vitest';

import type { AuditPort } from 'linnkit/ports';

import {
  CommandExecutionIdentitySchema,
  CommandPermissionSnapshotV1Schema,
  ShellCommandProposalV1Schema,
} from '@app/schemas/commands';

import { createEventStoreCommandExecutionAuditPort } from '..';

const identity = CommandExecutionIdentitySchema.parse({
  conversation_id: 'conversation-adapter-contract',
  agent_run_id: 'run-adapter-contract',
  origin_tool_call_id: 'call-adapter-shell',
  command_execution_id: 'command_execution_118f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a',
  owner_generation_id: 'command_owner_118f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
  created_at_ms: 2_000,
});
const permission = CommandPermissionSnapshotV1Schema.parse({
  protocol_version: 1,
  kind: 'command_permission_snapshot',
  identity,
  base_level: 'standard',
  effective_level: 'standard',
  grant_source: 'global_setting',
  internal_data_access: 'denied',
});
const proposal = ShellCommandProposalV1Schema.parse({
  protocol_version: 1,
  kind: 'shell_command_proposal',
  identity,
  command: 'printf adapter-contract',
  cwd: '/tmp/linnya-adapter-contract',
  permission,
});

describe('event store command execution audit adapter', () => {
  it('把一个领域事实交给既有 AuditPort', async () => {
    const emit = vi.fn<AuditPort['emit']>();
    const port = createEventStoreCommandExecutionAuditPort({
      auditPort: { emit },
    });

    await port.record({
      kind: 'proposal_created',
      occurred_at_ms: 2_010,
      proposal,
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      envelopeId: `audit-command:${identity.command_execution_id}:proposal_created`,
      action: 'command.proposal.created',
      ts: 2_010,
    }));
  });

  it('原样向调用方暴露 sink 失败，不伪造已持久化', async () => {
    const persistenceFailure = new Error('audit sink unavailable');
    const auditPort: AuditPort = {
      emit: vi.fn().mockRejectedValue(persistenceFailure),
    };
    const port = createEventStoreCommandExecutionAuditPort({
      auditPort,
    });

    await expect(port.record({
      kind: 'proposal_created',
      occurred_at_ms: 2_010,
      proposal,
    })).rejects.toBe(persistenceFailure);
  });
});
