import { parseArgs } from 'node:util';

export const CONVERSATIONS_USAGE = [
  'linnya conversations list [--query TEXT] [--limit 1..200]',
  'linnya conversations read CONVERSATION_ID [--after SEQ] [--limit 1..200]',
].join('\n');

export const CONVERSATIONS_MAX_LIMIT = 200;

export type ConversationsCommand =
  | { readonly kind: 'list'; readonly query: string | null; readonly limit: number }
  | { readonly kind: 'read'; readonly conversationId: string; readonly afterSeq: number | null; readonly limit: number };

function parseLimit(value: string): number {
  const limit = Number(value);
  if (!/^\d+$/u.test(value) || limit < 1 || limit > CONVERSATIONS_MAX_LIMIT) throw new Error('limit 须为 1–200 的整数');
  return limit;
}

export function parseConversationsCommand(argv: readonly string[]): ConversationsCommand {
  const [subcommand, ...rest] = argv;
  if (subcommand === 'list') {
    const { values } = parseArgs({
      args: rest,
      options: { query: { type: 'string' }, limit: { type: 'string', default: '30' } },
    });
    const query = values.query?.trim() ?? '';
    if (values.query !== undefined && !query) throw new Error('query 不能为空');
    if (query.length > 200) throw new Error('query 最多 200 个字符');
    return { kind: 'list', query: query || null, limit: parseLimit(values.limit) };
  }
  if (subcommand === 'read') {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { after: { type: 'string' }, limit: { type: 'string', default: '50' } },
    });
    const conversationId = positionals[0]?.trim();
    if (!conversationId || positionals.length !== 1) throw new Error('需要一个对话 ID');
    if (values.after !== undefined && !/^-?\d+$/u.test(values.after)) throw new Error('after 须为整数');
    return {
      kind: 'read',
      conversationId,
      afterSeq: values.after === undefined ? null : Number(values.after),
      limit: parseLimit(values.limit),
    };
  }
  throw new Error('子命令须为 list 或 read');
}
