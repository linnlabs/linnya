import { afterEach, describe, expect, it } from 'vitest';

import { runAgentScenario, type AgentScenarioResult } from '../runAgentScenario';
import { BaseTool, type ToolContext, type ToolParameterSchema } from 'src/tools/types';

class ScenarioEchoTool extends BaseTool {
  readonly name = 'scenario_echo';
  readonly description = '测试场景 echo 工具。';
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'echo 文本',
      },
    },
    required: ['text'],
  };

  async run(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
    return JSON.stringify({
      observation: `echo:${String(args.text ?? '')}`,
    });
  }
}

describe('runAgentScenario', () => {
  const usage = (inputTokens: number, outputTokens: number) => ({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    source: 'provider-response-usage' as const,
    confidence: 'actual' as const,
    rawUsage: { inputTokens, outputTokens },
  });
  let result: AgentScenarioResult | undefined;

  afterEach(() => {
    result?.restore();
    result = undefined;
  });

  it('用真实 graphLoop 装配跑完一次 run，并自动校验 run/audit/telemetry 不变量', async () => {
    result = await runAgentScenario({
      query: '请给一个极短回答',
      turns: [
        {
          contentChunks: ['这是测试回答。'],
          canonicalUsage: usage(11, 7),
        },
      ],
    });

    expect(result.runRecord.status).toBe('completed');
    expect(result.invariantsReport.ok).toBe(true);
    expect(result.auditEnvelopes.some((envelope) => envelope.action === 'model.select')).toBe(true);
    expect(result.cost.tokensInput).toBeGreaterThan(0);
    expect(result.cost.tokensOutput).toBe(7);
    expect(result.events.some((event) => event.type === 'final_answer_chunk')).toBe(true);
  });

  it('支持 tool_throw 注入，并仍然校验 ToolCall/ToolOutput 配对不变量', async () => {
    result = await runAgentScenario({
      query: '请调用工具然后解释错误',
      tools: [new ScenarioEchoTool()],
      failureInjection: {
        kind: 'tool_throw',
        toolName: 'scenario_echo',
        atCall: 1,
        message: 'scenario tool failed',
      },
      turns: [
        {
          toolCalls: [
            {
              id: 'call_echo_1',
              name: 'scenario_echo',
              argumentsJson: '{"text":"hello"}',
            },
          ],
          canonicalUsage: usage(10, 2),
        },
        {
          contentChunks: ['工具失败已被协议化处理。'],
          canonicalUsage: usage(12, 4),
        },
      ],
    });

    expect(result.runRecord.status).toBe('completed');
    expect(result.invariantsReport.ok).toBe(true);
    expect(result.events.some((event) => event.type === 'tool_output' && event.status === 'error')).toBe(true);
  });

  it('支持 llm_throw 注入，并把 run 标记为 failed', async () => {
    result = await runAgentScenario({
      query: '请触发 LLM 失败',
      failureInjection: {
        kind: 'llm_throw',
        atCall: 1,
        message: 'scenario llm failed',
      },
      turns: [
        {
          contentChunks: ['这段不会产出。'],
          canonicalUsage: usage(8, 1),
        },
      ],
    });

    expect(result.runRecord.status).toBe('failed');
    expect(result.runRecord.errorIfAny?.errorCode).toBe('RUN_FAILED');
    expect(result.invariantsReport.ok).toBe(true);
  });

  it('支持 cancel_mid_llm 注入，并把 signal 与 RunRecord 状态保持一致', async () => {
    result = await runAgentScenario({
      query: '请触发取消',
      failureInjection: {
        kind: 'cancel_mid_llm',
        atCall: 1,
        reason: 'scenario user cancelled',
      },
      turns: [
        {
          contentChunks: ['这段不会产出。'],
          canonicalUsage: usage(8, 1),
        },
      ],
    });

    expect(result.runRecord.status).toBe('cancelled');
    expect(result.runRecord.errorIfAny?.message).toBe('scenario user cancelled');
    expect(result.handle.signal.aborted).toBe(true);
    expect(result.invariantsReport.ok).toBe(true);
  });
});
