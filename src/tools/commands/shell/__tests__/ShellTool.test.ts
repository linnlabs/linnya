import { describe, expect, it } from 'vitest';
import { RunIdSchema, ToolCallIdSchema } from '@linnlabs/linnkit/contracts';
import {
  CommandAgentRunIdSchema,
  CommandExecutionPresentationFactsV1Schema,
  CommandProcessHandleSchema,
  ProcessOutputCursorSchema,
  ShellAgentModelControlV1Schema,
  ShellToolStructuredResultSchema,
} from '@app/schemas/commands';

import { ShellTool } from '../ShellTool';
import type {
  ExecuteShellToolRequest,
  ShellToolRuntimePort,
} from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';
import { createCommandRunPermissionSnapshot } from 'src/domains/commands/features/permission-settings';
import { parseCommandToolModelControlLine } from 'src/domains/commands';
import type { ToolContext } from 'src/tools/types';

const PRESENTATION = CommandExecutionPresentationFactsV1Schema.parse({
  protocol_version: 1,
  kind: 'command_execution_presentation_facts',
  timing: { status: 'started', started_at_ms: 20 },
  permission: {
    base_level: 'standard',
    effective_level: 'standard',
    source: 'global_setting',
    internal_data_access: 'allowed',
  },
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
      rootAgentRunId: CommandAgentRunIdSchema.parse('run_shell_tool'),
      capturedAtMs: 10,
    }),
  } as const;
}

describe('ShellTool', () => {
  it('公开 schema 将可选 cwd 声明为非空字符串', () => {
    const cwd = new ShellTool().parameters.properties.cwd;

    expect(cwd).toMatchObject({
      type: 'string',
      minLength: 1,
    });
    expect(cwd.description).toContain('Omit');
    expect(cwd.description).toContain('relative');
    expect(cwd.description).not.toContain('Optional absolute');
    expect(cwd.description).toContain('empty string');
  });

  it('只向 host runtime 传递已校验参数和当前调用身份', async () => {
    const requests: ExecuteShellToolRequest[] = [];
    const runtime: ShellToolRuntimePort = {
      async executeShell(request) {
        requests.push(request);
        return {
          status: 'running',
          processHandle: CommandProcessHandleSchema.parse(
            'command_process_123e4567-e89b-42d3-a456-426614174000',
          ),
          nextCursor: ProcessOutputCursorSchema.parse(4),
          display: {
            mode: 'pipe',
            coverage: 'complete',
            outputPhase: 'open',
            textProjection: 'available',
          },
          presentation: PRESENTATION,
          observation: 'Command is still running.',
        };
      },
      async executeProcess() {
        throw new Error('unexpected process call');
      },
    };
    const permission = createPermissionContext();
    const abortController = new AbortController();
    const context: ToolContext = {
      conversationId: 'conv_shell_tool',
      runId: RunIdSchema.parse('run_shell_tool'),
      parentToolCallId: ToolCallIdSchema.parse('call_shell_tool'),
      commandRunPermission: permission,
      shellToolRuntime: runtime,
      abortSignal: abortController.signal,
    };

    const output = await new ShellTool().run({
      command: 'printf hello',
      cwd: '/tmp',
      interactive: false,
      requires_write_access: true,
      initial_wait_ms: 500,
      hard_timeout_seconds: 90,
    }, context);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      arguments: {
        command: 'printf hello',
        cwd: '/tmp',
        interactive: false,
        requires_write_access: true,
        initial_wait_ms: 500,
        hard_timeout_seconds: 90,
      },
      conversationId: 'conv_shell_tool',
      agentRunId: 'run_shell_tool',
      originToolCallId: 'call_shell_tool',
      toolOutputInstanceId: 'default',
      commandRunPermission: permission,
      abortSignal: abortController.signal,
    });
    const structured = ShellToolStructuredResultSchema.parse(JSON.parse(output));
    expect(structured.data).toEqual({
      status: 'running',
      presentationText: 'Command is still running.',
      processHandle: 'command_process_123e4567-e89b-42d3-a456-426614174000',
      nextCursor: 4,
      display: {
        mode: 'pipe',
        coverage: 'complete',
        outputPhase: 'open',
        textProjection: 'available',
      },
      presentation: PRESENTATION,
    });
    expect(ShellAgentModelControlV1Schema.parse(
      parseCommandToolModelControlLine(structured.observation),
    )).toEqual({
      protocol_version: 1,
      kind: 'shell_model_control',
      status: 'running',
      process_handle: 'command_process_123e4567-e89b-42d3-a456-426614174000',
      next_cursor: 4,
    });
    expect(structured.observation).toContain('\n\noutput:\nCommand is still running.');
  });

  it('内部身份字段不能越过 Agent schema 到达 runtime', async () => {
    let called = false;
    const runtime: ShellToolRuntimePort = {
      async executeShell() {
        called = true;
        return {
          status: 'rejected',
          code: 'invalid_arguments',
          observation: 'invalid',
        };
      },
      async executeProcess() {
        throw new Error('unexpected process call');
      },
    };

    await expect(new ShellTool().run({
      command: 'pwd',
      conversation_id: 'forged',
    }, {
      conversationId: 'conv_shell_reject',
      runId: RunIdSchema.parse('run_shell_reject'),
      parentToolCallId: ToolCallIdSchema.parse('call_shell_reject'),
      commandRunPermission: createPermissionContext(),
      shellToolRuntime: runtime,
    })).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('缺少 host runtime 时明确失败，不回退到 Plugin CLI', async () => {
    await expect(new ShellTool().run({ command: 'pwd' }, {
      conversationId: 'conv_shell_missing',
      runId: RunIdSchema.parse('run_shell_missing'),
      parentToolCallId: ToolCallIdSchema.parse('call_shell_missing'),
      commandRunPermission: createPermissionContext(),
    })).rejects.toThrow('shell 工具宿主运行时未配置');
  });

  it('runtime 误带内部进程事实时拒绝整个结果，不泄漏给 Agent', async () => {
    const leakedResult = {
      status: 'running' as const,
      processHandle: CommandProcessHandleSchema.parse(
        'command_process_123e4567-e89b-42d3-a456-426614174000',
      ),
      nextCursor: ProcessOutputCursorSchema.parse(0),
      display: {
        mode: 'pipe' as const,
        coverage: 'complete' as const,
        outputPhase: 'open' as const,
        textProjection: 'available' as const,
      },
      observation: 'running',
      presentation: PRESENTATION,
      pid: 42,
    };
    const runtime: ShellToolRuntimePort = {
      async executeShell() {
        return leakedResult;
      },
      async executeProcess() {
        throw new Error('unexpected process call');
      },
    };

    await expect(new ShellTool().run({ command: 'pwd' }, {
      conversationId: 'conv_shell_internal_result',
      runId: RunIdSchema.parse('run_shell_internal_result'),
      parentToolCallId: ToolCallIdSchema.parse('call_shell_internal_result'),
      commandRunPermission: createPermissionContext(),
      shellToolRuntime: runtime,
    })).rejects.toThrow();
  });
});
