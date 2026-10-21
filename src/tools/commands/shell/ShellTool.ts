import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandOriginToolCallIdSchema,
  SHELL_COMMAND_MAX_LENGTH,
  SHELL_HARD_TIMEOUT_DEFAULT_SECONDS,
  SHELL_HARD_TIMEOUT_MAX_SECONDS,
  SHELL_HARD_TIMEOUT_MIN_SECONDS,
  SHELL_INITIAL_WAIT_MAX_MS,
  SHELL_INITIAL_WAIT_MIN_MS,
  ShellToolArgumentsV1Schema,
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
import { shellProtocolViolationMessage } from './functions/shellProtocolViolationMessage';

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

  /** 与 process 一样，参数拒绝是启动前的协议事实，不是命令运行失败。 */
  readonly argumentValidationErrorCode = 'shell_protocol_violation';

  readonly description = `Run a command in a new temporary shell process.

Use this tool for local CLI programs and file-processing commands. Each call starts a new shell;
changing directory or environment variables does not persist into the next call. A short command
returns its final result. A command still running after the initial wait returns a process handle
for the process tool. Set interactive only when the command requires a real terminal. Set
requires_write_access when the command may create, modify, install, move, or delete files.

The default working directory is this conversation's physical work directory. Use relative OS
paths for temporary and derived files. workspace:/ documents live in Linnya's database VFS,
not as ordinary files on disk; use formal document tools to read or change them. conversation:/
maps to the current conversation directory; file:/// identifies an absolute host file. These
spaces do not synchronize automatically. Do not search application storage or databases for
Workspace documents. /tmp is shared across conversations and is outside Linnya's conversation
cleanup; prefer the current directory unless the user requests another permitted location.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        minLength: 1,
        maxLength: SHELL_COMMAND_MAX_LENGTH,
        description: `The exact shell command to run, at most ${SHELL_COMMAND_MAX_LENGTH} Unicode characters. Pass paths to existing input files instead of embedding entire documents in the command.`,
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
        type: 'integer',
        description: `Initial wait only, at most ${SHELL_INITIAL_WAIT_MAX_MS} ms; this is not the total command runtime. Longer commands return a handle: use process with action.type="wait" and action.wait_timeout_ms to continue waiting. Do not increase this value for long commands.`,
        minimum: SHELL_INITIAL_WAIT_MIN_MS,
        maximum: SHELL_INITIAL_WAIT_MAX_MS,
      },
      hard_timeout_seconds: {
        type: 'integer',
        description: `Maximum total runtime for this command. Omit it to use ${SHELL_HARD_TIMEOUT_DEFAULT_SECONDS} seconds.`,
        minimum: SHELL_HARD_TIMEOUT_MIN_SECONDS,
        maximum: SHELL_HARD_TIMEOUT_MAX_SECONDS,
      },
    },
    required: ['command'],
    additionalProperties: false,
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = ShellToolArgumentsV1Schema.safeParse(args);
    return parsed.success
      ? { success: true }
      : { success: false, error: shellProtocolViolationMessage(parsed.error) };
  }

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
