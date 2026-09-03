import type { AuditPort } from '../../../ports';
import {
  createRequiresUserInteractionEvent,
  generateInteractionId,
  generateResumeToken,
  generateRuntimeEventId,
  RunIdSchema,
  ToolCallIdSchema,
  toSerializableJsonValue,
} from '../../../contracts';
import { emitAuditEnvelope } from '../../audit/emitAudit';
import { noopAudit } from '../../audit/noopAudit';
import type { EngineState, GraphNode, NodeResult } from '../types';
import { requireRuntimeEventSink } from '../graphLocal';

export interface WaitUserNodeDependencies {
  auditPort?: AuditPort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`WaitUserNode requires ${field}`);
  }
  return value.trim();
}

export class WaitUserNode implements GraphNode {
  id = 'wait_user';
  private readonly auditPort: AuditPort;

  constructor(dependencies: WaitUserNodeDependencies = {}) {
    this.auditPort = dependencies.auditPort ?? noopAudit;
  }

  async run(state: EngineState): Promise<NodeResult> {
    const local = state.local ?? {};
    const spec = isRecord(local.pendingInteractionSpec) ? local.pendingInteractionSpec : {};
    const conversationId = requireNonEmptyString(local.conversationId, 'conversationId');
    const turnId = requireNonEmptyString(local.turnId, 'turnId');
    const toolContext = isRecord(local.toolContext) ? local.toolContext : {};
    const runId = RunIdSchema.parse(requireNonEmptyString(toolContext.runId, 'toolContext.runId'));
    const parentRunId =
      toolContext.parentRunId === undefined
        ? undefined
        : RunIdSchema.parse(toolContext.parentRunId);
    const toolCallId = ToolCallIdSchema.parse(
      requireNonEmptyString(spec.toolCallId, 'pendingInteractionSpec.toolCallId')
    );
    const toolName = requireNonEmptyString(spec.toolName, 'pendingInteractionSpec.toolName');
    const id = generateRuntimeEventId();
    const interactionId = generateInteractionId();
    const runtimeEvent = createRequiresUserInteractionEvent(id, conversationId, turnId, {
      timestamp: Date.now(),
      form: toSerializableJsonValue(spec.form) ?? {},
      interaction_type: toolName,
      interaction_id: interactionId,
      run_id: runId,
      tool_call_id: toolCallId,
      checkpoint_revision: (state.revision ?? 0) + 1,
      resume_token: generateResumeToken(),
      interaction_status: 'pending',
    });
    const publishedEvent = requireRuntimeEventSink(state.local)(
      runtimeEvent,
      'WaitUserNode.requires_user_interaction'
    );

    await emitAuditEnvelope(this.auditPort, {
      action: 'wait_user.request',
      actor: { kind: 'system' },
      decision: { outcome: 'requested', reason: 'graph paused for user interaction' },
      evidence: [
        {
          kind: 'requires_user_interaction',
          ref: interactionId,
          summary:
            typeof spec.prompt === 'string' && spec.prompt.trim().length > 0
              ? spec.prompt.trim()
              : 'requires user interaction',
        },
      ],
      scope: {
        conversationId,
        turnId,
        runId,
        parentRunId,
      },
    });

    state.local = {
      ...local,
      pendingInteractionSpec: undefined,
      lastToolResult: undefined,
      conversationId,
      turnId,
    };
    return { kind: 'pause', events: [publishedEvent] };
  }
}
