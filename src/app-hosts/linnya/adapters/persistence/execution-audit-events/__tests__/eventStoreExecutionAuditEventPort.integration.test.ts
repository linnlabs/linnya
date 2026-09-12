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
import { projectCommandExecutionAuditEnvelope } from 'src/domains/audit';
import {
  ConversationControlAuditResponseSchema,
  WorkspaceEditFileResultSchema,
  WorkspaceWriteFileResultSchema,
} from '@app/schemas';
import { createExecutionAuditExportUseCase } from 'src/app-hosts/linnya/application/execution-audit-export';
import { projectExecutionAuditResponse } from 'src/app-hosts/linnya/application/conversation-control/functions/projectExecutionAudit';
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
  it('真实文档成功结果带 error 时独立审计，root/child 范围正确且不泄露任何诊断正文或 code', async () => {
    const data = {
      source_kind: 'workspace_vfs', locator: 'workspace:/private-document.md',
      inode: 'workspace:document-private', documentId: 'document-private',
      node: { name: 'private-title', locator: 'workspace:/private-document.md',
        inode: 'workspace:document-private', type: 'document', source: 'workspace_node',
        is_virtual: false, parent_id: null, updated_at: 100 },
    };
    const write = WorkspaceWriteFileResultSchema.parse({ data: { ...data, operation: 'create',
      diagnostics: [
        { severity: 'error', code: 'private-code-with-body / secret', message: 'private-diagnostic', target: 'private-source' },
        { severity: 'error', code: 'E_COMPILE', message: 'private-second-diagnostic' },
        { severity: 'warning', code: 'W_LAYOUT', message: 'private-warning' },
      ], diagnosticsTruncatedCount: 5 }, observation: 'private-model-observation' });
    const edit = WorkspaceEditFileResultSchema.parse({ data: { ...data, replaced: 1,
      diff: 'private-source-diff', diagnostics: [{ severity: 'info', code: 'I_DONE', message: 'private-info' }] },
    observation: 'private-edit-observation' });
    const events = [
      routeRuntimeEvent(createToolOutputEvent('output-write', conversationId, turnId, 'write_file', 'call-write',
        { status: 'success', data: write.data, observation: write.observation }, { timestamp: 101 }), routeIdentity),
      routeRuntimeEvent(createToolOutputEvent('output-edit', conversationId, turnId, 'edit_file', 'call-edit',
        { status: 'success', data: edit.data, observation: edit.observation }, { timestamp: 102 }),
      { ...routeIdentity, run_id: 'child-run', parent_run_id: runId }),
      routeRuntimeEvent(createToolOutputEvent('output-other', conversationId, turnId, 'write_file', 'call-other',
        { status: 'success', data: write.data, observation: write.observation }, { timestamp: 103 }),
      { ...routeIdentity, run_id: 'unrelated-run' }),
    ];
    const eventStore: Pick<IEventStore, 'readEvents'> = {
      async readEvents() { return { events, hasMore: false }; },
    };
    const useCase = createExecutionAuditExportUseCase({
      events: createEventStoreExecutionAuditEventPort(eventStore),
      runs: { async listByConversation() { return [
        { runId, status: 'completed', startedAt: 90, updatedAt: 110 },
        { runId: 'child-run', parentRunId: runId, status: 'completed', startedAt: 100, updatedAt: 105 },
        { runId: 'unrelated-run', status: 'completed', startedAt: 100, updatedAt: 105 },
      ]; } },
      telemetry: { async listByConversation() { return [
        { kind: 'tool_call', runId, toolName: 'write_file', ok: true, durationMs: 5, emittedAt: 101 },
        { kind: 'tool_call', runId: 'child-run', parentRunId: runId, toolName: 'edit_file', ok: true, durationMs: 5, emittedAt: 102 },
      ]; } },
      now: () => 115,
    });
    const audit = await useCase.export({ conversationId, runId });
    expect(audit).not.toBeNull();
    if (!audit) throw new Error('Missing audit');
    const response = ConversationControlAuditResponseSchema.parse(
      projectExecutionAuditResponse({ conversationId, requestedRunId: runId, audit }),
    );
    expect(response.tools).toMatchObject({ calls: 2, failed_calls: 0 });
    expect(response.workspace_documents).toEqual({
      observations: 2, observations_with_errors: 1, observations_with_warnings: 1,
      visible: { error: 2, warning: 1, info: 1 }, truncated_count: 5,
      by_observation: [
        { run_id: runId, tool_call_id: 'call-write', tool_name: 'write_file', emitted_at: 101,
          visible: { error: 2, warning: 1, info: 0 }, truncated_count: 5 },
        { run_id: 'child-run', parent_run_id: runId, tool_call_id: 'call-edit', tool_name: 'edit_file', emitted_at: 102,
          visible: { error: 0, warning: 0, info: 1 }, truncated_count: 0 },
      ],
    });
    expect(JSON.stringify(response)).not.toContain('private-');
    expect(JSON.stringify(response)).not.toContain('E_COMPILE');
    expect(JSON.stringify(response)).not.toContain('unrelated-run');
    expect(ConversationControlAuditResponseSchema.safeParse({ ...response,
      workspace_documents: { ...response.workspace_documents, code: 'must-not-export' },
    }).success).toBe(false);
  });

  it('不扫描其它工具同名字段；成功 Workspace 结果不符合合同则明确失败而不是零问题', () => {
    const result = { status: 'success' as const, data: { diagnostics: [{ severity: 'error' }] }, observation: 'not a Workspace result' };
    const unrelated = routeRuntimeEvent(createToolOutputEvent('other', conversationId, turnId, 'custom_tool', 'custom-call', result), routeIdentity);
    expect(projectExecutionAuditEventFacts(unrelated)[0]).not.toHaveProperty('workspaceDocument', expect.anything());
    const invalid = routeRuntimeEvent(createToolOutputEvent('bad-write', conversationId, turnId, 'write_file', 'bad-call', result), routeIdentity);
    expect(() => projectExecutionAuditEventFacts(invalid)).toThrow();
  });

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
