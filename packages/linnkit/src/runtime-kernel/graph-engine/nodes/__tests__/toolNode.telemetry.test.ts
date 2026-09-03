import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolNode } from '../toolNode';
import { ENGINE_STATE_SCHEMA_VERSION } from '../../types';
import type { EngineState, StandardToolCall } from '../../types';
import type { TelemetryPort } from '../../../telemetry/telemetryPort';
import type { ToolExecutionResult } from '../../../tools/ports';
import { createRuntimeEventAdmissionSink } from './runtimeEventAdmissionFixture';
import { RunIdSchema } from '../../../../contracts';

function buildCall(overrides: Partial<StandardToolCall> = {}): StandardToolCall {
  return {
    id: 'call_1',
    type: 'function',
    function: {
      name: 'echo',
      arguments: '{"text":"hi"}',
    },
    ...overrides,
  } as StandardToolCall;
}

function buildState(call: StandardToolCall): EngineState {
  return {
    nodeId: 'tool',
    schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
    local: {
      pendingToolCalls: [call],
      conversationId: 'conv_telemetry',
      turnId: 'turn_telemetry',
      history: [],
      runtimeEventSink: createRuntimeEventAdmissionSink('conv_telemetry', 'run_telemetry'),
      toolContext: {
        runId: RunIdSchema.parse('run_telemetry'),
        parentRunId: RunIdSchema.parse('parent_run_telemetry'),
      },
    },
  };
}

function buildTelemetry(): TelemetryPort & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn() };
}

const observationPreview = {
  truncateObservation: vi.fn().mockResolvedValue({ truncated: false }),
};

describe('ToolNode B2-engine Batch 2: TelemetryPort emit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits tool_call event with ok=true on successful execution', async () => {
    const telemetry = buildTelemetry();
    const exec: ToolExecutionResult = {
      success: true,
      result: '{"data":{},"observation":"ok"}',
      durationMs: 42,
    };
    const toolRuntime = {
      getToolDefinition: vi.fn().mockReturnValue(undefined),
      executeTool: vi.fn().mockResolvedValue(exec),
    };

    const node = new ToolNode({ toolRuntime, observationPreview, telemetryPort: telemetry });
    await node.run(buildState(buildCall()));

    expect(telemetry.emit).toHaveBeenCalledTimes(1);
    expect(telemetry.emit).toHaveBeenCalledWith({
      kind: 'tool_call',
      toolName: 'echo',
      durationMs: 42,
      ok: true,
      errorCode: undefined,
      scope: {
        conversationId: 'conv_telemetry',
        runId: 'run_telemetry',
        parentRunId: 'parent_run_telemetry',
        turnId: 'turn_telemetry',
      },
    });
  });

  it('emits tool_call event with ok=false + errorCode on execution failure', async () => {
    const telemetry = buildTelemetry();
    const exec: ToolExecutionResult = {
      success: false,
      error: 'tool blew up',
      errorKind: 'execution',
      durationMs: 17,
    };
    const toolRuntime = {
      getToolDefinition: vi.fn().mockReturnValue(undefined),
      executeTool: vi.fn().mockResolvedValue(exec),
    };

    const node = new ToolNode({ toolRuntime, observationPreview, telemetryPort: telemetry });
    await node.run(buildState(buildCall()));

    expect(telemetry.emit).toHaveBeenCalledTimes(1);
    expect(telemetry.emit).toHaveBeenCalledWith({
      kind: 'tool_call',
      toolName: 'echo',
      durationMs: 17,
      ok: false,
      errorCode: 'execution',
      scope: {
        conversationId: 'conv_telemetry',
        runId: 'run_telemetry',
        parentRunId: 'parent_run_telemetry',
        turnId: 'turn_telemetry',
      },
    });
  });

  it('emits tool_call event with errorCode=protocol when args are malformed', async () => {
    const telemetry = buildTelemetry();
    const toolRuntime = {
      getToolDefinition: vi.fn().mockReturnValue(undefined),
      // executeTool 不应被调用，因为 protocol error 早期短路
      executeTool: vi.fn(),
    };

    const badCall = buildCall({
      function: { name: 'echo', arguments: 'not-json' },
    });

    const node = new ToolNode({ toolRuntime, observationPreview, telemetryPort: telemetry });
    await node.run(buildState(badCall));

    expect(toolRuntime.executeTool).not.toHaveBeenCalled();
    expect(telemetry.emit).toHaveBeenCalledTimes(1);
    const event = telemetry.emit.mock.calls[0]![0] as {
      kind: string;
      ok: boolean;
      errorCode?: string;
      durationMs: number;
    };
    expect(event.kind).toBe('tool_call');
    expect(event.ok).toBe(false);
    expect(event.errorCode).toBe('protocol');
    expect(event.durationMs).toBe(0);
  });

  it('omits emit when there are no pending tool calls', async () => {
    const telemetry = buildTelemetry();
    const toolRuntime = {
      getToolDefinition: vi.fn(),
      executeTool: vi.fn(),
    };
    const state: EngineState = {
      nodeId: 'tool',
      schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
      local: {
        pendingToolCalls: [],
        conversationId: 'conv',
        turnId: 'turn',
        history: [],
        runtimeEventSink: createRuntimeEventAdmissionSink('conv', 'run_telemetry_empty'),
      },
    };

    const node = new ToolNode({ toolRuntime, observationPreview, telemetryPort: telemetry });
    await node.run(state);

    expect(telemetry.emit).not.toHaveBeenCalled();
  });

  it('uses noopTelemetry when telemetryPort is omitted (no crash, no emit observable)', async () => {
    const exec: ToolExecutionResult = {
      success: true,
      result: '{"data":{},"observation":"ok"}',
      durationMs: 5,
    };
    const toolRuntime = {
      getToolDefinition: vi.fn().mockReturnValue(undefined),
      executeTool: vi.fn().mockResolvedValue(exec),
    };

    const node = new ToolNode({ toolRuntime, observationPreview });
    await expect(node.run(buildState(buildCall()))).resolves.toBeDefined();
  });
});
