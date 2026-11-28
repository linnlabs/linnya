import type { PluginCliToolResultData } from '@app/schemas';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandOriginToolCallIdSchema,
} from '@app/schemas/commands';

import {
  BaseTool,
  type StructuredToolResult,
  type ToolContext,
  type ToolParameterSchema,
} from '../../types';
import {
  PLUGIN_CLI_MAX_ARG_COUNT,
  PLUGIN_CLI_MAX_ARG_LENGTH,
} from 'src/app-hosts/linnya/application/plugin-cli-shell-bridge';
import { parsePluginCliToolArguments, type PluginCliToolArguments } from './functions/parsePluginCliToolArguments';

function formatObservation(args: PluginCliToolArguments, data: PluginCliToolResultData): string {
  const lines = [data.stdout.trimEnd()];
  if (data.stderr.trim()) lines.push(`stderr:\n${data.stderr.trimEnd()}`);
  return lines.filter(line => line.length > 0).join('\n\n') || `linnya-${args.plugin_id} exited with code 0.`;
}

/**
 * 外部命令行调用已启用插件自己的命令。它和 Linnya Agent 在 Shell 里运行 `linnya-<plugin>`
 * 是同一份插件合同与权限规则，只是不经过系统 Shell，也不调用 Linnya 的模型。
 *
 * 只给外部命令行的无模型运行使用；Linnya 自己的 Agent 继续用 shell 调插件命令，
 * 不要把它加进 Agent 工具白名单，否则两条入口会给模型两种调用同一能力的方式。
 */
export class PluginCliTool extends BaseTool {
  readonly name = 'plugin_cli';

  readonly description = `Run an enabled Linnya plugin's own command without Linnya models.

This is the same command Linnya's agents run as linnya-<plugin> in their shell. Pass the plugin id
and the argument list exactly as the plugin CLI expects; Linnya does not interpret the arguments.
Start with argv ["--help"] to list the plugin's commands. Example: plugin_id "slides",
argv ["render", "--presentation", "<presentation-id>"].

Files the command writes (screenshots, exports) are stored in this conversation's directory and
reported as conversation:/ locators. The linnya CLI lists them as local file paths under
conversation_files. Commands that need Linnya models are rejected here. A non-zero exit code is
reported as a tool error with the command's stderr.`;

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      plugin_id: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        description: 'Plugin id whose command to run, for example "slides" (lowercase letters, digits, ".", "_" or "-").',
      },
      argv: {
        type: 'array',
        maxItems: PLUGIN_CLI_MAX_ARG_COUNT,
        items: { type: 'string', maxLength: PLUGIN_CLI_MAX_ARG_LENGTH, description: 'One command argument.' },
        description: 'Command arguments after linnya-<plugin>, one array item per argument.',
      },
    },
    required: ['plugin_id', 'argv'],
    additionalProperties: false,
  };

  protected override validateArguments(args: Record<string, unknown>): {
    success: boolean;
    error?: string;
  } {
    const parsed = parsePluginCliToolArguments(args);
    return parsed.success ? { success: true } : { success: false, error: parsed.error };
  }

  async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const runtime = context.pluginCliToolRuntime;
    if (!runtime) throw new Error('plugin_cli 工具宿主运行时未配置');
    const permission = context.commandRunPermission;
    if (permission?.status !== 'available') {
      throw new Error('Command permission is unavailable for this run; plugin commands cannot start.');
    }
    const parsed = parsePluginCliToolArguments(args);
    if (!parsed.success) throw new Error(parsed.error);
    const request = parsed.value;
    const result = await runtime.invoke({
      conversationId: CommandConversationIdSchema.parse(context.conversationId),
      agentRunId: CommandAgentRunIdSchema.parse(context.runId),
      toolCallId: CommandOriginToolCallIdSchema.parse(context.parentToolCallId),
      pluginId: request.plugin_id,
      argv: request.argv,
      permission: permission.snapshot,
      ...(context.abortSignal ? { signal: context.abortSignal } : {}),
    });
    if (result.status === 'rejected') {
      throw new Error(`linnya-${request.plugin_id}: ${result.code} (exit ${result.exitCode}): ${result.message}`);
    }
    if (result.exitCode !== 0) {
      const detail = [result.stderr.trimEnd(), result.stdout.trimEnd()].filter(text => text.length > 0).join('\n');
      throw new Error(`linnya-${request.plugin_id} exited with code ${result.exitCode}${detail ? `:\n${detail}` : '.'}`);
    }
    const data: PluginCliToolResultData = {
      plugin_id: request.plugin_id,
      argv: request.argv,
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    const structured: StructuredToolResult<PluginCliToolResultData> = {
      data,
      observation: formatObservation(request, data),
    };
    return JSON.stringify(structured);
  }
}
