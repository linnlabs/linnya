import { parseArgs, type ParseArgsConfig } from 'node:util';
import { ConversationFileLocatorSchema } from '@app/schemas';
import type { KnowledgeCliCommand, KnowledgeCliParseResult } from '../definitions/knowledgeCliCommand';
import { KnowledgeCliUsageError } from '../definitions/knowledgeCliErrors';

export { KNOWLEDGE_CLI_HELP } from '../definitions/knowledgeCliCommand';

type Flags = ReturnType<typeof parseArgs>['values'];

function parseAction(argv: readonly string[]): { action: KnowledgeCliCommand['action']; args: readonly string[] } {
  const [command, operation] = argv;
  if (command === 'list' || command === 'unlink') return { action: command, args: argv.slice(1) };
  if (command === 'documents') {
    if (operation === 'list' || operation === 'import' || operation === 'delete') {
      return { action: `documents.${operation}`, args: argv.slice(2) };
    }
  }
  if (command === 'index') {
    if (operation === 'status' || operation === 'rebuild') {
      return { action: `index.${operation}`, args: argv.slice(2) };
    }
  }
  throw new KnowledgeCliUsageError('未知知识库命令。');
}

function parseFlags(action: KnowledgeCliCommand['action'], args: readonly string[]): Flags {
  const options: NonNullable<ParseArgsConfig['options']> = {
    help: { type: 'boolean', short: 'h' },
  };
  if (action !== 'list') options.kb = { type: 'string' };
  if (action === 'documents.import') options.source = { type: 'string' };
  if (action === 'documents.delete') options.document = { type: 'string' };

  let parsed;
  try {
    parsed = parseArgs({ args: [...args], options, strict: true, allowPositionals: false, tokens: true });
  } catch (error) {
    throw new KnowledgeCliUsageError(error instanceof Error ? error.message : '参数格式不正确。');
  }
  // Node 默认接纳重复选项的最后一个值；这里不能让第二个 --kb 悄悄改变操作对象。
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new KnowledgeCliUsageError(`选项 --${token.name} 不能重复。`);
    seen.add(token.name);
  }
  return parsed.values;
}

function requiredFlag(flags: Flags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new KnowledgeCliUsageError(`缺少非空的 --${name}。`);
  }
  return value;
}

/** prepare 阶段只解释参数，不触及库、文件、模型或运行时。 */
export function parseKnowledgeCli(argv: readonly string[]): KnowledgeCliParseResult {
  if (argv.length === 0 || (argv.length === 1 && ['help', '--help', '-h'].includes(argv[0]))) {
    return { kind: 'help' };
  }
  const { action, args } = parseAction(argv);
  const flags = parseFlags(action, args);
  if (flags.help === true) return { kind: 'help' };
  if (action === 'list') return { kind: 'command', command: { action } };
  const kbId = requiredFlag(flags, 'kb').trim();
  if (action === 'documents.import') {
    const source = ConversationFileLocatorSchema.safeParse(requiredFlag(flags, 'source'));
    if (!source.success) {
      throw new KnowledgeCliUsageError('--source 必须是当前对话的 conversation:/ 文件地址，不接受磁盘路径或 workspace: 地址。');
    }
    return { kind: 'command', command: { action, kbId, source: source.data } };
  }
  if (action === 'documents.delete') {
    return { kind: 'command', command: { action, kbId, documentId: requiredFlag(flags, 'document').trim() } };
  }
  return { kind: 'command', command: { action, kbId } };
}
