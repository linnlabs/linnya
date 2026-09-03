import { describe, expect, it, vi } from 'vitest';
import type { AuditPort } from '../../../../ports';
import type { EngineState } from '../../types';
import { ENGINE_STATE_SCHEMA_VERSION } from '../../types';
import { routeRuntimeEvent, type RuntimeEvent, RunIdSchema } from '../../../../contracts';
import { WaitUserNode } from '../waitUserNode';

function buildAuditPort(): AuditPort & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn() };
}

describe('WaitUserNode audit', () => {
  it('缺少稳定 runId 时拒绝创建可恢复 interaction', async () => {
    const node = new WaitUserNode();
    const state: EngineState = {
      nodeId: 'wait_user',
      schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
      local: {
        conversationId: 'conv-wait',
        turnId: 'turn-wait',
        pendingInteractionSpec: {
          prompt: '需要用户确认',
          toolCallId: 'tool-wait',
          toolName: 'interactive_form',
        },
      },
    };

    await expect(node.run(state)).rejects.toThrow('WaitUserNode requires toolContext.runId');
  });

  it('进入 wait_user 时发 wait_user.request envelope', async () => {
    const auditPort = buildAuditPort();
    const node = new WaitUserNode({ auditPort });
    const published: RuntimeEvent[] = [];
    const identity = {
      run_id: 'run-wait',
      lane: 'foreground' as const,
      visibility: 'conversation' as const,
    };
    const state: EngineState = {
      nodeId: 'wait_user',
      schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
      local: {
        conversationId: 'conv-wait',
        turnId: 'turn-wait',
        pendingInteractionSpec: {
          prompt: '需要用户确认',
          toolCallId: 'tool-wait',
          toolName: 'interactive_form',
          form: { data: { questionnaireId: 'questionnaire-1' } },
        },
        toolContext: {
          runId: RunIdSchema.parse('run-wait'),
        },
        runtimeEventSink: event => {
          const routed = routeRuntimeEvent(event, identity);
          published.push(routed);
          return routed;
        },
      },
    };

    const result = await node.run(state);

    expect(result.kind).toBe('pause');
    expect(result.events).toEqual([
      expect.objectContaining({
        type: 'requires_user_interaction',
        id: expect.any(String),
        run_id: 'run-wait',
        lane: 'foreground',
        visibility: 'conversation',
        interaction_type: 'interactive_form',
        form: { data: { questionnaireId: 'questionnaire-1' } },
      }),
    ]);
    expect(published).toHaveLength(1);
    expect(result.events?.[0]).toBe(published[0]);
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'wait_user.request',
        runId: 'run-wait',
        decision: expect.objectContaining({ outcome: 'requested' }),
        scope: expect.objectContaining({
          conversationId: 'conv-wait',
          turnId: 'turn-wait',
          runId: 'run-wait',
        }),
      })
    );
  });
});
