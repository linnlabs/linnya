import {
  PluginCliToolDisplayArgsSchema,
  PluginCliToolStructuredResultSchema,
  type PluginCliToolDisplayArgs,
} from '@app/schemas';

import type {
  ToolCompactStepProjector,
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import {
  createConversationToolLocalizedTextDescriptor,
  createConversationToolTitleDescriptor,
} from '../../functions/createConversationToolTitleDescriptor';
import type { PluginCliPresentationData } from '../definitions/pluginCliPresentation';

export function projectPluginCliPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<PluginCliPresentationData> {
  if (input.status !== 'success') {
    const args = readDisplayArgs(input.args);
    return {
      data: { kind: 'lifecycle', ...(args ? { commandLine: formatCommandLine(args) } : {}) },
      title: args
        ? createConversationToolTitleDescriptor('conversation.tool.pluginCli.running', { command: formatCommandName(args) })
        : createConversationToolTitleDescriptor('conversation.tool.pluginCli.runningUnknown'),
    };
  }
  const { data } = PluginCliToolStructuredResultSchema.parse(input.result);
  return {
    data: {
      kind: 'completed',
      commandLine: formatCommandLine(data),
      output: formatOutput(data.stdout, data.stderr),
    },
    title: createConversationToolTitleDescriptor('conversation.tool.pluginCli.completed', {
      command: formatCommandName(data),
    }),
  };
}

export const projectPluginCliCompactStep: ToolCompactStepProjector = input => {
  const args = readDisplayArgs(input.args);
  return {
    title: args
      ? createConversationToolLocalizedTextDescriptor('conversation.tool.pluginCli.compact', { command: formatCommandName(args) })
      : createConversationToolLocalizedTextDescriptor('conversation.tool.pluginCli.runningUnknown'),
  };
};

function readDisplayArgs(value: unknown): PluginCliToolDisplayArgs | undefined {
  const parsed = PluginCliToolDisplayArgsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** 标题只放插件命令与子命令（遇到第一个选项为止），完整参数在卡片内容里，避免长 ID 挤掉标题。 */
function formatCommandName(args: PluginCliToolDisplayArgs): string {
  const firstOption = args.argv.findIndex(token => token.startsWith('-'));
  const subcommand = firstOption === -1 ? args.argv : args.argv.slice(0, firstOption);
  return [`linnya-${args.plugin_id}`, ...subcommand].join(' ');
}

function formatCommandLine(args: PluginCliToolDisplayArgs): string {
  return [`linnya-${args.plugin_id}`, ...args.argv.map(quoteArgument)].join(' ');
}

// 只为显示：带空白、引号等字符的参数加引号，让命令行能看出参数边界。
function quoteArgument(token: string): string {
  return token === '' || /[\s"'\\$`]/u.test(token) ? JSON.stringify(token) : token;
}

/**
 * 官方插件的 stdout 是单行紧凑 JSON 报告，直接显示是一整段长串；能解析时缩进成多行。
 * 说明文字（例如 --help）原样显示。
 */
function formatOutput(stdout: string, stderr: string): string {
  const report = parseJson(stdout);
  const formatted = report === undefined ? stdout.trimEnd() : JSON.stringify(report, null, 2);
  return [formatted, stderr.trimEnd()].filter(text => text.length > 0).join('\n\n');
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
