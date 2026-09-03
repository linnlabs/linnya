import { describe, expect, it, vi } from 'vitest';
import type { AuditPort } from '../../../../ports';
import type { EngineState, StandardToolCall } from '../../types';
import { ENGINE_STATE_SCHEMA_VERSION } from '../../types';
import type { ToolExecutionResult, ToolRuntimeDefinition } from '../../../tools/ports';
import { ToolNode } from '../toolNode';
import {
  MODEL_INPUT_ERROR_CODES,
  ModelInputCapabilityError,
} from '../../../llm/input-capabilities';
import { createRuntimeEventAdmissionSink } from './runtimeEventAdmissionFixture';
import { RunIdSchema, ToolCallIdSchema } from '../../../../contracts';
import { setLlmAuditRecorder } from '../../../../shared/llmAuditRecorder';

function buildCall(overrides: Partial<StandardToolCall> = {}): StandardToolCall {
  return {
    id: ToolCallIdSchema.parse('call_1'),
    type: 'function',
    function: {
      name: 'echo',
      arguments: '{"text":"hi"}',
    },
    ...overrides,
  };
}

function buildState(call: StandardToolCall): EngineState {
  return {
    nodeId: 'tool',
    schemaVersion: ENGINE_STATE_SCHEMA_VERSION,
    local: {
      pendingToolCalls: [call],
      conversationId: 'conv-audit',
      turnId: 'turn-audit',
      history: [],
      runtimeEventSink: createRuntimeEventAdmissionSink('conv-audit', 'run-audit'),
      toolContext: {
        conversationId: 'conv-audit',
        turnId: 'turn-audit',
        runId: RunIdSchema.parse('run-audit'),
      },
    },
  };
}

const toolResultImageRequirement = {
  requires_image_input: true,
  placements: ['tool_result_image'] as const,
};

function buildAuditPort(): AuditPort & { emit: ReturnType<typeof vi.fn> } {
  return { emit: vi.fn() };
}

const observationPreview = {
  truncateObservation: vi.fn().mockResolvedValue({ truncated: false }),
};

describe('ToolNode audit', () => {
  it('工具通过协议校验后、执行前发 tool.allow envelope', async () => {
    const auditPort = buildAuditPort();
    const exec: ToolExecutionResult = {
      success: true,
      result: '{"data":{},"observation":"ok"}',
      durationMs: 10,
    };
    const executeTool = vi.fn().mockImplementation(async () => {
      expect(auditPort.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tool.allow',
          decision: expect.objectContaining({
            outcome: 'allowed',
            reason: 'tool call passed protocol validation',
          }),
        })
      );
      return exec;
    });
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: vi.fn().mockReturnValue(undefined),
        executeTool,
      },
      observationPreview,
      auditPort,
    });

    await node.run(buildState(buildCall()));

    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.allow',
        runId: 'run-audit',
        decision: expect.objectContaining({ outcome: 'allowed' }),
        evidence: [
          expect.objectContaining({
            kind: 'tool_call',
            ref: 'call_1',
          }),
        ],
        scope: expect.objectContaining({
          conversationId: 'conv-audit',
          turnId: 'turn-audit',
          runId: 'run-audit',
          toolName: 'echo',
          toolCallId: 'call_1',
        }),
      })
    );
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          metadata: expect.not.objectContaining({ toolCallId: 'call_1' }),
        }),
      })
    );
    expect(executeTool).toHaveBeenCalledOnce();
  });

  it('工具执行失败时保留 allow 的协议语义，不把执行错误写进 decision reason', async () => {
    const auditPort = buildAuditPort();
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: vi.fn().mockReturnValue(undefined),
        executeTool: vi.fn().mockResolvedValue({
          success: false,
          error: 'SQLITE_CONSTRAINT: foreign key failed',
          errorKind: 'execution',
          durationMs: 4,
        } satisfies ToolExecutionResult),
      },
      observationPreview,
      auditPort,
    });

    await node.run(buildState(buildCall()));

    expect(auditPort.emit).toHaveBeenCalledTimes(1);
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.allow',
        decision: expect.objectContaining({
          outcome: 'allowed',
          reason: 'tool call passed protocol validation',
        }),
      })
    );
    expect(auditPort.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ reason: expect.stringContaining('SQLITE_CONSTRAINT') }),
      })
    );
  });

  it('协议错误时发 tool.deny envelope 且不执行工具', async () => {
    const auditPort = buildAuditPort();
    const executeTool = vi.fn();
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: vi.fn().mockReturnValue(undefined),
        executeTool,
      },
      observationPreview,
      auditPort,
    });

    await node.run(
      buildState(
        buildCall({
          function: { name: 'echo', arguments: 'not-json' },
        })
      )
    );

    expect(executeTool).not.toHaveBeenCalled();
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.deny',
        decision: expect.objectContaining({
          outcome: 'denied',
          metadata: expect.objectContaining({ errorKind: 'protocol' }),
        }),
        evidence: [expect.objectContaining({ ref: 'call_1' })],
        scope: expect.objectContaining({ toolCallId: 'call_1' }),
      })
    );
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.protocol_error',
        decision: expect.objectContaining({
          metadata: expect.not.objectContaining({ toolCallId: 'call_1' }),
        }),
        evidence: [expect.objectContaining({ ref: 'call_1' })],
        scope: expect.objectContaining({ toolCallId: 'call_1' }),
      })
    );
  });

  it('协议错误同时进入专用 LLM 审计 recorder', async () => {
    const recordToolProtocolError = vi.fn();
    setLlmAuditRecorder({ recordToolProtocolError });

    try {
      const node = new ToolNode({
        toolRuntime: {
          getToolDefinition: vi.fn().mockReturnValue(undefined),
          executeTool: vi.fn(),
        },
        observationPreview,
      });

      await node.run(
        buildState(
          buildCall({
            function: { name: 'ask', arguments: '{"questions":' },
          })
        )
      );

      expect(recordToolProtocolError).toHaveBeenCalledWith({
        toolName: 'ask',
        toolCallId: 'call_1',
        rawArguments: '{"questions":',
        parsedArguments: {},
        error: expect.stringContaining('Tool arguments are not valid JSON'),
      });
    } finally {
      setLlmAuditRecorder(null);
    }
  });

  it('owner 参数 admission 失败时不发布 tool_process，并配对 error output', async () => {
    const executeTool = vi.fn();
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: vi.fn().mockReturnValue({
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'path' },
              inode: { type: 'string', description: 'inode' },
            },
          },
          validateArguments: () => ({
            success: false,
            error: 'read_file 参数不符合正式合同',
          }),
        } satisfies ToolRuntimeDefinition),
        executeTool,
      },
      observationPreview,
    });

    const result = await node.run(
      buildState(
        buildCall({
          function: { name: 'read_file', arguments: '{"path":"/x","inode":""}' },
        })
      )
    );

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.events?.filter(event => event.type === 'tool_process')).toHaveLength(0);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_output',
          tool_call_id: 'call_1',
          status: 'error',
          error: 'read_file 参数不符合正式合同',
        }),
      ])
    );
  });

  it('静态图片工具在执行前按最近成功模型二次校验', async () => {
    const state = buildState(buildCall());
    if (state.local?.executorLocal) {
      state.local.executorLocal.lastSuccessfulLlmModelId = 'active-fallback-model';
    } else if (state.local) {
      state.local.executorLocal = {
        stepCount: 1,
        lastSuccessfulLlmModelId: 'active-fallback-model',
      };
    }
    const assertCompatible = vi.fn();
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      result: '{"data":{},"observation":"ok"}',
      durationMs: 1,
    } satisfies ToolExecutionResult);
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: vi.fn().mockReturnValue({
          parameters: { type: 'object', properties: {} },
          modelInputRequirement: toolResultImageRequirement,
        }),
        executeTool,
      },
      observationPreview,
      modelInputCapabilityValidator: {
        evaluate: vi.fn(() => ({ compatible: true as const })),
        assertCompatible,
      },
    });

    await node.run(state);

    expect(assertCompatible).toHaveBeenCalledWith({
      activeModelId: 'active-fallback-model',
      requirement: toolResultImageRequirement,
    });
    expect(executeTool).toHaveBeenCalledOnce();
  });

  it('host-forced 静态图片工具能力拒绝时不执行副作用，并产出 deny audit', async () => {
    const auditPort = buildAuditPort();
    const executeTool = vi.fn();
    const state = buildState(buildCall());
    if (state.local) {
      state.local.executorLocal = {
        stepCount: 1,
        lastSuccessfulLlmModelId: 'text-model',
      };
    }
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: vi.fn().mockReturnValue({
          parameters: { type: 'object', properties: {} },
          modelInputRequirement: toolResultImageRequirement,
        }),
        executeTool,
      },
      observationPreview,
      auditPort,
      modelInputCapabilityValidator: {
        evaluate() {
          return {
            compatible: false,
            reason: 'placement_unsupported',
            missing_placements: ['tool_result_image'],
          };
        },
        assertCompatible() {
          throw new ModelInputCapabilityError(
            MODEL_INPUT_ERROR_CODES.PLACEMENT_UNSUPPORTED,
            '当前模型连接不支持请求中的图片来源',
            {
              active_model_id: 'text-model',
              required_placements: ['tool_result_image'],
            }
          );
        },
      },
    });

    const result = await node.run(state);

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_output',
          status: 'error',
          error: expect.stringContaining(MODEL_INPUT_ERROR_CODES.PLACEMENT_UNSUPPORTED),
        }),
      ])
    );
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.deny',
        decision: expect.objectContaining({
          outcome: 'denied',
          metadata: expect.objectContaining({ errorKind: 'capability' }),
        }),
      })
    );
  });

  it('动态 requirement resolver 异常时配对失败输出并继续同批 sibling call', async () => {
    const auditPort = buildAuditPort();
    const firstCall = buildCall({
      id: ToolCallIdSchema.parse('call-requirement-error'),
      function: { name: 'dynamic_image_tool', arguments: '{}' },
    });
    const secondCall = buildCall({
      id: ToolCallIdSchema.parse('call-sibling'),
      function: { name: 'echo', arguments: '{"text":"still runs"}' },
    });
    const state = buildState(firstCall);
    if (state.local) {
      state.local.pendingToolCalls = [firstCall, secondCall];
    }
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      result: '{"data":{},"observation":"ok"}',
      durationMs: 1,
    } satisfies ToolExecutionResult);
    const dynamicImageToolDefinition = {
      parameters: { type: 'object', properties: {} },
      resolveModelInputRequirement() {
        throw new Error('resolver implementation detail');
      },
    } satisfies ToolRuntimeDefinition;
    const node = new ToolNode({
      toolRuntime: {
        getToolDefinition: vi.fn((toolName: string) =>
          toolName === 'dynamic_image_tool' ? dynamicImageToolDefinition : undefined
        ),
        executeTool,
      },
      observationPreview,
      auditPort,
    });

    const result = await node.run(state);
    const outputs = result.events?.filter(event => event.type === 'tool_output') ?? [];

    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({
      tool_call_id: 'call-requirement-error',
      status: 'error',
      error: expect.stringContaining('tool.model_input.requirement_resolution_failed'),
    });
    expect(outputs[1]).toMatchObject({
      tool_call_id: 'call-sibling',
      status: 'success',
    });
    expect(JSON.stringify(outputs[0])).not.toContain('resolver implementation detail');
    expect(executeTool).toHaveBeenCalledOnce();
    expect(executeTool).toHaveBeenCalledWith('echo', { text: 'still runs' }, expect.any(Object));
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.deny',
        decision: expect.objectContaining({
          metadata: expect.objectContaining({ errorKind: 'capability' }),
        }),
        scope: expect.objectContaining({ toolCallId: 'call-requirement-error' }),
      })
    );
    expect(auditPort.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tool.allow',
        scope: expect.objectContaining({ toolCallId: 'call-sibling' }),
      })
    );
  });
});
