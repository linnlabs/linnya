import { describe, expect, it } from 'vitest';
import {
  createAuditEnvelopeEvent,
  createToolCallDecisionEvent,
  createToolOutputEvent,
  routeRuntimeEvent,
  type RoutedRuntimeEvent,
} from '@linnlabs/linnkit/contracts';

import {
  CommandExecutionIdentitySchema,
  CommandExecutionTerminalV1Schema,
} from '@app/schemas/commands';
import { projectCommandExecutionAuditEnvelope } from 'src/domains/audit/features/command-execution-audit';
import type { IEventStore } from '../../event-store/event-store.interface';
import {
  createEventStoreExecutionAuditEventPort,
  projectExecutionAuditEventFacts,
} from '..';

const conversationId = 'conversation-execution-audit-events';
const runId = 'run-execution-audit-events';
const turnId = 'turn-execution-audit-events';
const routeIdentity = {
  run_id: runId,
  lane: 'foreground' as const,
  visibility: 'conversation' as const,
};

function decisionEvent(): RoutedRuntimeEvent {
  return routeRuntimeEvent(createToolCallDecisionEvent(
    'event-decision',
    conversationId,
    turnId,
    'read_file',
    'call-read',
    {
      timestamp: 100,
      payload: {
        tool_calls: [
          {
            id: 'call-read',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
          },
          {
            id: 'call-shell',
            type: 'function',
            function: { name: 'shell', arguments: '{"command":"false"}' },
          },
        ],
      },
    },
  ), routeIdentity);
}

function commandTerminalEvent(): RoutedRuntimeEvent {
  const identity = CommandExecutionIdentitySchema.parse({
    conversation_id: conversationId,
    agent_run_id: runId,
    origin_tool_call_id: 'call-shell',
    command_execution_id: 'command_execution_118f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a',
    owner_generation_id: 'command_owner_118f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
    created_at_ms: 90,
  });
  const terminal = CommandExecutionTerminalV1Schema.parse({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity,
    settled_at_ms: 130,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: { status: 'observed', exit_code: 2, signal: null },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'succeeded' },
    resource_release: { status: 'succeeded' },
  });
  const envelope = projectCommandExecutionAuditEnvelope({
    event: { kind: 'execution_terminal', occurred_at_ms: 131, terminal },
  });
  return routeRuntimeEvent(createAuditEnvelopeEvent(
    'event-command-terminal',
    conversationId,
    turnId,
    envelope,
  ), routeIdentity);
}

describe('EventStore execution audit event adapter', () => {
  it('从批次决策展开每个 canonical tool call，并复用命令终态审计事实', () => {
    expect(projectExecutionAuditEventFacts(decisionEvent())).toEqual([
      expect.objectContaining({ kind: 'tool_decision', toolCallId: 'call-read', toolName: 'read_file' }),
      expect.objectContaining({ kind: 'tool_decision', toolCallId: 'call-shell', toolName: 'shell' }),
    ]);
    expect(projectExecutionAuditEventFacts(commandTerminalEvent())).toEqual([
      expect.objectContaining({
        kind: 'command_terminal',
        toolCallId: 'call-shell',
        outcome: 'execution_ended',
        processExit: { status: 'observed', exitCode: 2, signal: null },
      }),
    ]);
  });

  it('跨页读取完整事实窗口，不导出工具参数和输出正文', async () => {
    const terminal = routeRuntimeEvent(createToolOutputEvent(
      'event-output',
      conversationId,
      turnId,
      'read_file',
      'call-read',
      { status: 'success', observation: 'secret output', data: { secret: true } },
      { timestamp: 120 },
    ), routeIdentity);
    const pages: readonly (readonly RoutedRuntimeEvent[])[] = [
      [decisionEvent()],
      [terminal, commandTerminalEvent()],
    ];
    const eventStore: Pick<IEventStore, 'readEvents'> = {
      async readEvents(_requestedConversationId, options) {
        const pageIndex = options?.cursor ?? 0;
        return {
          events: [...(pages[pageIndex] ?? [])],
          ...(pageIndex === 0 ? { nextCursor: 1 } : {}),
          hasMore: pageIndex === 0,
        };
      },
    };
    const facts = await createEventStoreExecutionAuditEventPort(eventStore)
      .listByConversation(conversationId);

    expect(facts).toHaveLength(4);
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tool_terminal', toolCallId: 'call-read' }),
      expect.objectContaining({ kind: 'command_terminal', toolCallId: 'call-shell' }),
    ]));
    expect(JSON.stringify(facts)).not.toContain('secret');
  });
});
