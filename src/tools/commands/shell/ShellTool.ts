import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandOriginToolCallIdSchema,
  SHELL_HARD_TIMEOUT_DEFAULT_SECONDS,
  SHELL_HARD_TIMEOUT_MAX_SECONDS,
  SHELL_HARD_TIMEOUT_MIN_SECONDS,
  SHELL_INITIAL_WAIT_MAX_MS,
  SHELL_INITIAL_WAIT_MIN_MS,
  parseShellToolArguments,
  type ShellToolResultData,
  type ShellToolRuntimeResult,
} from '@app/schemas/commands';

import {
  BaseTool,
  type StructuredToolResult,
  type ToolContext,
  type ToolParameterSchema,
} from '../../types';
import { parseShellToolRuntimeResult } from 'src/app-hosts/linnya/adapters/commands/shell-runtime/definitions';
import { resolveToolConversationInstanceId } from 'src/app-hosts/linnya/adapters/tools/conversation-scope';
import { formatShellToolModelObservation } from 'src/domains/commands';

function projectShellToolResultData(result: ShellToolRuntimeResult): ShellToolResultData {
  if (result.status === 'running') {
    return {
      status: 'running',
      presentationText: result.observation,
      processHandle: result.processHandle,
      nextCursor: result.nextCursor,
      display: result.display,
      presentation: result.presentation,
    };
  }
  if (result.status === 'completed') {
    return {
      status: 'completed',
      presentationText: result.observation,
      terminal: result.terminal,
      command_output_store: result.command_output_store,
      presentation: result.presentation,
      ...(result.display ? { display: result.display } : {}),
    };
  }
  return {
    status: 'rejected',
    presentationText: result.observation,
    code: result.code,
  };
}

export class ShellTool extends BaseTool {
  readonly name = 'shell';

  readonly description = `Run a command in a new temporary shell process.

Use this tool for local CLI programs and file-processing commands. Each call starts a new shell;
changing directory or environment variables does not persist into the next call. A short command
returns its final result. A command still running after the initial wait returns a process handle
for the process tool. Set interactive only when the command requires a real terminal. Set
requires_write_access when the command may create, modify, install, move, or delete files.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The exact shell command to run.',
      },
      cwd: {
        type: 'string',
        minLength: 1,
        description: 'Optional OS working directory. Omit it to use the conversation directory; relative paths resolve from that directory. Prefer the conversation directory for temporary outputs unless the user requests another permitted location. Do not pass an empty string.',
      },
      interactive: {
        type: 'boolean',
        description: 'Request a temporary interactive terminal for this command only.',
      },
      requires_write_access: {
        type: 'boolean',
        description: 'Request approval for standard write access when the current mode is read-only. This does not grant full access or expand the standard writable boundary.',
      },
      initial_wait_ms: {
        type: 'number',
        description: 'How long to wait before returning a running process handle.',
        minimum: SHELL_INITIAL_WAIT_MIN_MS,
        maximum: SHELL_INITIAL_WAIT_MAX_MS,
      },
      hard_timeout_seconds: {
        type: 'number',
        description: `Maximum total runtime for this command. Omit it to use ${SHELL_HARD_TIMEOUT_DEFAULT_SECONDS} seconds.`,
        minimum: SHELL_HARD_TIMEOUT_MIN_SECONDS,
        maximum: SHELL_HARD_TIMEOUT_MAX_SECONDS,
      },
    },
    required: ['command'],
    additionalProperties: false,
  };

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const runtime = context.shellToolRuntime;
    if (!runtime) {
      throw new Error('shell 工具宿主运行时未配置');
    }
    if (!context.commandRunPermission) {
      throw new Error('shell 工具缺少当前 run 的权限快照');
    }

    // ToolContext 是受控注入边界，但 runtime 结果仍必须做运行时校验。否则 host 后续
    // 误带 PID、owner generation 或 artifact path 时，结构展开会把内部事实泄漏给 Agent。
    const result = parseShellToolRuntimeResult(await runtime.executeShell({
      arguments: parseShellToolArguments(args),
      conversationId: CommandConversationIdSchema.parse(context.conversationId),
      agentRunId: CommandAgentRunIdSchema.parse(context.runId),
      originToolCallId: CommandOriginToolCallIdSchema.parse(context.parentToolCallId),
      toolOutputInstanceId: resolveToolConversationInstanceId(context),
      commandRunPermission: context.commandRunPermission,
      ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
    }));
    // UI data 与模型 observation 都显式 allowlist；runtime 未来新增字段不能自动穿透。
    const data = projectShellToolResultData(result);
    const structured: StructuredToolResult<typeof data> = {
      data,
      observation: formatShellToolModelObservation(result),
    };
    return JSON.stringify(structured);
  }
}
