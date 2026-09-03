import { describe, expect, it } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import {
  CommandAgentRunIdSchema,
  CommandExecutionPresentationFactsV1Schema,
  ProcessAgentModelControlV1Schema,
  ProcessOutputCursorSchema,
  ProcessToolStructuredResultSchema,
  parseProcessToolArguments,
} from '@app/schemas/commands';

import { ProcessTool } from '../ProcessTool';
import type {
  ExecuteProcessToolRequest,
  ShellToolRuntimePort,
} from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';
import { createCommandRunPermissionSnapshot } from 'src/domains/commands/features/permission-settings';
import { parseCommandToolModelControlLine } from 'src/domains/commands';
import type { ToolContext } from 'src/tools/types';

const PROCESS_HANDLE = 'command_process_123e4567-e89b-42d3-a456-426614174000';
const PRESENTATION = CommandExecutionPresentationFactsV1Schema.parse({
  protocol_version: 1,
  kind: 'command_execution_presentation_facts',
  timing: { status: 'started', started_at_ms: 20 },
});

function createPermissionContext() {
  return {
    status: 'available',
    snapshot: createCommandRunPermissionSnapshot({
      settings: {
        schema_version: 1,
        kind: 'command_permission_settings',
        revision: 2,
        permission_level: 'standard',
        internal_data_access: 'allowed',
        gui_control: 'denied',
        local_ipc_control: 'denied',
        process_lifecycle: 'terminate_with_run',
      },
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_process_tool'),
      capturedAtMs: 10,
    }),
  } as const;
}

describe('ProcessTool', () => {
  it('向模型公开与正式 parser 同构的七个封闭 action 分支', () => {
    const branches = new ProcessTool().parameters.properties.action.oneOf ?? [];
    const expected = [
      ['poll', ['type', 'cursor']],
      ['wait', ['type', 'cursor', 'wait_timeout_ms']],
      ['cancel', ['type']],
      ['write', ['type', 'input']],
      ['submit', ['type', 'input']],
      ['eof', ['type']],
      ['resize', ['type', 'columns', 'rows']],
    ] as const;

    expect(branches).toHaveLength(expected.length);
    for (const [index, [actionType, fields]] of expected.entries()) {
      const branch = branches[index];
      expect(branch?.properties?.type.enum).toEqual([actionType]);
      expect(Object.keys(branch?.properties ?? {})).toEqual([...fields]);
      expect(branch?.required).toEqual([...fields]);
      expect(branch?.additionalProperties).toBe(false);

      const values: Record<string, unknown> = {
        type: actionType,
        cursor: 0,
        wait_timeout_ms: 1,
        input: actionType === 'write' ? 'x' : '',
        columns: 80,
        rows: 24,
      };
      expect(() => parseProcessToolArguments({
        process_handle: PROCESS_HANDLE,
        action: Object.fromEntries(fields.map(field => [field, values[field]])),
      })).not.toThrow();
    }
  });

  it('公开分支不把其它 action 字段伪装成合法参数', () => {
    const waitBranch = new ProcessTool().parameters.properties.action.oneOf?.[1];

    expect(waitBranch?.properties).not.toHaveProperty('input');
    expect(waitBranch?.properties).not.toHaveProperty('columns');
    expect(waitBranch?.properties).not.toHaveProperty('rows');
    expect(() => parseProcessToolArguments({
      process_handle: PROCESS_HANDLE,
      action: { type: 'wait', cursor: 0, wait_timeout_ms: 1, input: 'surplus' },
    })).toThrow();
  });

  it('用本次 tool call 补齐控制身份，不接受 Agent 提供 scope', async () => {
    const requests: ExecuteProcessToolRequest[] = [];
    const runtime: ShellToolRuntimePort = {
      async executeShell() {
        throw new Error('unexpected shell call');
      },
      async executeProcess(request) {
        requests.push(request);
        return {
          status: 'running',
          nextCursor: ProcessOutputCursorSchema.parse(8),
          display: {
            mode: 'pipe',
            coverage: 'complete',
            outputPhase: 'open',
            textProjection: 'available',
          },
          presentation: PRESENTATION,
          observation: 'No new output.',
        };
      },
    };
    const permission = createPermissionContext();
    const context: ToolContext = {
      conversationId: 'conv_process_tool',
      runId: RunIdSchema.parse('run_process_tool'),
      parentToolCallId: ToolCallIdSchema.parse('call_process_tool'),
      commandRunPermission: permission,
      shellToolRuntime: runtime,
    };

    const output = await new ProcessTool().run({
      process_handle: PROCESS_HANDLE,
      action: { type: 'wait', cursor: 4, wait_timeout_ms: 1_000 },
    }, context);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      arguments: {
        process_handle: PROCESS_HANDLE,
        action: { type: 'wait', cursor: 4, wait_timeout_ms: 1_000 },
      },
      conversationId: 'conv_process_tool',
      agentRunId: 'run_process_tool',
      controlToolCallId: 'call_process_tool',
      commandRunPermission: permission,
    });
    const structured = ProcessToolStructuredResultSchema.parse(JSON.parse(output));
    expect(structured.data).toEqual({
      status: 'running',
      presentationText: 'No new output.',
      nextCursor: 8,
      display: {
        mode: 'pipe',
        coverage: 'complete',
        outputPhase: 'open',
        textProjection: 'available',
      },
      presentation: PRESENTATION,
    });
    expect(ProcessAgentModelControlV1Schema.parse(
      parseCommandToolModelControlLine(structured.observation),
    )).toEqual({
      protocol_version: 1,
      kind: 'process_model_control',
      process_handle: PROCESS_HANDLE,
      status: 'running',
      next_cursor: 8,
    });
    expect(structured.observation).toContain('\n\noutput:\nNo new output.');
  });

  it('拒绝伪造 scope，且不会调用 runtime', async () => {
    let called = false;
    const runtime: ShellToolRuntimePort = {
      async executeShell() {
        throw new Error('unexpected shell call');
      },
      async executeProcess() {
        called = true;
        return { status: 'accepted', observation: 'accepted' };
      },
    };

    await expect(new ProcessTool().run({
      process_handle: PROCESS_HANDLE,
      action: { type: 'cancel' },
      scope: { conversation_id: 'forged' },
    }, {
      conversationId: 'conv_process_reject',
      runId: RunIdSchema.parse('run_process_reject'),
      parentToolCallId: ToolCallIdSchema.parse('call_process_reject'),
      commandRunPermission: createPermissionContext(),
      shellToolRuntime: runtime,
    })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('缺少当前 run 权限时明确失败', async () => {
    const runtime: ShellToolRuntimePort = {
      async executeShell() {
        throw new Error('unexpected shell call');
      },
      async executeProcess() {
        return { status: 'accepted', observation: 'accepted' };
      },
    };
    const context: ToolContext = {
      conversationId: 'conv_process_missing',
      runId: RunIdSchema.parse('run_process_missing'),
      parentToolCallId: ToolCallIdSchema.parse('call_process_missing'),
      shellToolRuntime: runtime,
    };

    await expect(new ProcessTool().run({
      process_handle: PROCESS_HANDLE,
      action: { type: 'cancel' },
    }, context)).rejects.toThrow('process 工具缺少当前 run 的权限快照');
  });

  it('保留控制动作的审计状态，供 renderer 合并回原命令卡片', async () => {
    const runtime: ShellToolRuntimePort = {
      async executeShell() {
        throw new Error('unexpected shell call');
      },
      async executeProcess() {
        return {
          status: 'accepted',
          audit_status: 'incomplete',
          observation: 'accepted',
        };
      },
    };

    const output = await new ProcessTool().run({
      process_handle: PROCESS_HANDLE,
      action: { type: 'submit', input: 'value' },
    }, {
      conversationId: 'conv_process_audit',
      runId: RunIdSchema.parse('run_process_audit'),
      parentToolCallId: ToolCallIdSchema.parse('call_process_audit'),
      commandRunPermission: createPermissionContext(),
      shellToolRuntime: runtime,
    });

    expect(ProcessToolStructuredResultSchema.parse(JSON.parse(output)).data).toMatchObject({
      status: 'accepted',
      audit_status: 'incomplete',
    });
  });

  it('runtime 误带 artifact 路径时拒绝整个结果，不泄漏给 Agent', async () => {
    const leakedResult = {
      status: 'running' as const,
      nextCursor: ProcessOutputCursorSchema.parse(9),
      display: {
        mode: 'pipe' as const,
        coverage: 'complete' as const,
        outputPhase: 'open' as const,
        textProjection: 'available' as const,
      },
      observation: 'running',
      presentation: PRESENTATION,
      artifactPath: '/private/command-output/stdout.bin',
    };
    const runtime: ShellToolRuntimePort = {
      async executeShell() {
        throw new Error('unexpected shell call');
      },
      async executeProcess() {
        return leakedResult;
      },
    };

    await expect(new ProcessTool().run({
      process_handle: PROCESS_HANDLE,
      action: { type: 'poll', cursor: 0 },
    }, {
      conversationId: 'conv_process_internal_result',
      runId: RunIdSchema.parse('run_process_internal_result'),
      parentToolCallId: ToolCallIdSchema.parse('call_process_internal_result'),
      commandRunPermission: createPermissionContext(),
      shellToolRuntime: runtime,
    })).rejects.toThrow();
  });
});
