import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  execution,
  ToolNode,
  type EngineState,
} from '@linnlabs/linnkit/runtime-kernel';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import { ShellToolArgumentsV1Schema } from '@app/schemas/commands';
import * as builtin from 'src/app-hosts/linnya/plugin-registry/builtin';
import { ToolRegistry } from 'src/app-hosts/linnya/adapters/tools/toolRegistry';
import { defaultObservationPreviewPort } from 'src/app-hosts/linnya/adapters/tools/defaultPorts';
import type { ShellToolRuntimePort } from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';
import type { ToolContext } from 'src/tools/types';
import { ShellTool } from '../ShellTool';

function createRuntimeEventSink() {
  const sequencer = new execution.EventSequencer('conversation-shell-protocol');
  const eventBus = new execution.EventBus(sequencer.getExecutionId());
  const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
    run_id: RunIdSchema.parse('run-shell-protocol'),
    lane: 'foreground',
    visibility: 'conversation',
  });
  return (event: Parameters<typeof publisher.publish>[0], source: Parameters<typeof publisher.publish>[1]) =>
    publisher.publish(event, source);
}

beforeEach(() => {
  vi.spyOn(builtin, 'getRegisteredToolClasses').mockReturnValue([ShellTool]);
  vi.spyOn(builtin, 'getRegisteredHostOnlyToolNames').mockReturnValue([]);
  vi.spyOn(builtin, 'getRegisteredToolContextDecorators').mockReturnValue([]);
});

afterEach(() => vi.restoreAllMocks());

describe('ShellTool ToolNode admission', () => {
  it.each([
    { args: {}, field: 'command：缺少必需字段' },
    { args: { command: '' }, field: 'command：' },
    { args: { command: `private-command-${'x'.repeat(12_000)}` }, field: 'command：shell command must not exceed' },
    { args: { command: 'private-command\0' }, field: 'command：shell command must not contain NUL' },
    { args: { command: 'private-command', initial_wait_ms: 240_000 }, field: 'initial_wait_ms：' },
    { args: { command: 'private-command', initial_wait_ms: 249 }, field: 'initial_wait_ms：' },
    { args: { command: 'private-command', initial_wait_ms: 1_000.5 }, field: 'initial_wait_ms：' },
    { args: { command: 'private-command', hard_timeout_seconds: 601 }, field: 'hard_timeout_seconds：' },
    { args: { command: 'private-command', cwd: 'private-cwd\0' }, field: 'cwd：' },
    { args: { command: 'private-command', interactive: 'private-value' }, field: 'interactive：' },
    { args: { command: 'private-command', wait_timeout_ms: 60_000 }, field: 'wait_timeout_ms：不允许的字段' },
    { args: { command: 'private-command', env: { TOKEN: 'private-value' } }, field: 'env：不允许的字段' },
  ])('非法调用在执行/审批/启动入口前拒绝，并提供安全的修复示例：$field', async ({ args, field }) => {
    const registry = new ToolRegistry({ strictInitialization: true });
    const executeShell = vi.fn<ShellToolRuntimePort['executeShell']>();
    const executeProcess = vi.fn<ShellToolRuntimePort['executeProcess']>();
    const runtime: ShellToolRuntimePort = { executeShell, executeProcess };
    const context: ToolContext = { shellToolRuntime: runtime };
    const state: EngineState = {
      nodeId: 'tool',
      local: {
        conversationId: 'conversation-shell-protocol',
        turnId: 'turn-shell-protocol',
        runtimeEventSink: createRuntimeEventSink(),
        toolContext: context,
        pendingToolCalls: [{
          id: ToolCallIdSchema.parse('call-shell-invalid'),
          type: 'function',
          function: { name: 'shell', arguments: JSON.stringify(args) },
        }],
      },
    };
    const tool = registry.getTool('shell');
    if (!tool) throw new Error('Shell registration failed');
    const run = vi.spyOn(tool, 'run');

    await new ToolNode({
      toolRuntime: registry,
      observationPreview: defaultObservationPreviewPort,
    }).run(state);

    // owner runtime 尚未进入，目录准入、审批、reserve 与 spawn 都没有执行机会。
    expect(run).not.toHaveBeenCalled();
    expect(executeShell).not.toHaveBeenCalled();
    expect(executeProcess).not.toHaveBeenCalled();
    const history = state.local?.history ?? [];
    expect(history.filter(event => event.type === 'tool_process')).toEqual([]);
    const outputs = history.filter(event => event.type === 'tool_output');
    expect(outputs).toHaveLength(1);
    const message = outputs[0]?.error ?? '';
    expect(message).toContain('[shell_protocol_violation]');
    expect(message).toContain(field);
    expect(message).not.toContain('private-command');
    expect(message).not.toContain('private-cwd');
    expect(message).not.toContain('private-value');
    expect(message).not.toContain('"received"');
    if ('initial_wait_ms' in args || 'wait_timeout_ms' in args) {
      expect(message).toContain('action.wait_timeout_ms');
    }
    if ('wait_timeout_ms' in args || 'env' in args) {
      expect(message).toContain('Shell 合法字段：');
      expect(message).toContain('requires_write_access');
    }
    const exampleLine = message.split('最小结构示例：')[1]?.split('\n')[0];
    expect(exampleLine).toBeDefined();
    const example: unknown = JSON.parse(exampleLine ?? 'null');
    expect(ShellToolArgumentsV1Schema.safeParse(example).success).toBe(true);

    // 非 ToolNode 的正式 Registry 入口也使用同一 owner parser 和错误分类。
    const direct = await registry.executeTool('shell', args, context);
    expect(direct).toMatchObject({
      success: false,
      errorKind: 'protocol',
      errorCode: 'shell_protocol_violation',
      error: expect.stringContaining(field),
    });
    expect(run).not.toHaveBeenCalled();
  });
});
