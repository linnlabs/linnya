import { parseArgs } from 'node:util';
import { SEMANTIC_QUERY_MAX_LIMIT, SEMANTIC_VALUE_TYPES, type SemanticQueryOperator, type SemanticValueType } from 'src/domains/semantic-layer';

export const SCHEMA_USAGE = [
  'linnya schema [list] [--json]',
  'linnya schema add-field 名称 --type text|number|date|datetime|checkbox|select|multi_select|url [--option 选项,...] [--allow-similar]',
  'linnya schema add-tag 名称 [--field 字段[=默认值]]... [--allow-similar]',
  'linnya schema set-fields 标签 [--field 字段[=默认值]]...   整体替换标签带的字段',
].join('\n');

export const PROPS_USAGE = [
  'linnya props get 路径 [--json]',
  'linnya props tag 路径... --tag 标签,... [--rev 版本,...]',
  'linnya props untag 路径... --tag 标签,... [--rev 版本,...]',
  'linnya props set 路径... 字段=值... [--rev 版本,...]   值留空即清除；多选用逗号分隔',
  'linnya props restore 路径 --to 版本 [--rev 版本]',
  '路径是 workspace:/ 开头的文档路径。不给 --rev 时只预览，列出当前版本和将要发生的变化，不写入；',
  '确认后按路径顺序给出各自的当前版本再执行。',
].join('\n');

export const QUERY_USAGE = [
  'linnya query [--tag 标签]... [--where 条件]... [--sort [-]字段]... [--group 字段] [--limit 1..200] [--json]',
  '  条件：字段=值 字段!=值 字段>值 字段>=值 字段<值 字段<=值 字段~值（包含） 字段!~值（不包含）',
  '        字段= 为空，字段!= 不为空；多选的 ~ 可给多个选项（逗号分隔），命中任一即算',
  '  内建字段：name type created updated；--sort -年份 表示降序',
].join('\n');

export const LINKS_USAGE = 'linnya links 路径 [--limit 1..200]   列出引用这份文档的文档和它引用的文档';

export type SchemaCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'list'; readonly json: boolean }
  | {
    readonly kind: 'add-field'; readonly name: string; readonly valueType: SemanticValueType;
    readonly options: readonly string[]; readonly allowSimilar: boolean;
  }
  | { readonly kind: 'add-tag'; readonly name: string; readonly fields: readonly RawTagField[]; readonly allowSimilar: boolean }
  | { readonly kind: 'set-fields'; readonly tag: string; readonly fields: readonly RawTagField[] };

/** 字段默认值的原文；按字段类型转换要等读到定义后才能做。 */
export interface RawTagField {
  readonly field: string;
  readonly defaultValue: string | null;
}

export type PropsChange =
  | { readonly action: 'tag' | 'untag'; readonly tags: readonly string[] }
  | { readonly action: 'set'; readonly assignments: readonly (readonly [string, string])[] }
  | { readonly action: 'restore'; readonly toRevision: number };

export type PropsCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'get'; readonly path: string; readonly json: boolean }
  | {
    readonly kind: 'write'; readonly paths: readonly string[]; readonly change: PropsChange;
    /** 与路径一一对应的期望版本；为空时只预览。 */
    readonly revisions: readonly number[] | null;
  };

export interface RawQueryFilter {
  readonly field: string;
  readonly op: SemanticQueryOperator;
  /** 原文；`empty`、`not_empty` 为空。 */
  readonly raw: string | null;
}

export type QueryCommand =
  | { readonly kind: 'help' }
  | {
    readonly kind: 'query'; readonly tags: readonly string[]; readonly where: readonly RawQueryFilter[];
    readonly sort: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
    readonly groupBy: string | null; readonly limit: number; readonly json: boolean;
  };

export type LinksCommand = { readonly kind: 'help' } | { readonly kind: 'links'; readonly path: string; readonly limit: number };

const isHelp = (argv: readonly string[]) => argv.length === 1 && (argv[0] === '--help' || argv[0] === 'help');

/** 名称列表：可重复给，也可用逗号（含全角）分隔。 */
function names(values: readonly string[] | undefined): string[] {
  return (values ?? []).flatMap(value => value.split(/[,，]/u)).map(value => value.trim()).filter(Boolean);
}

function limitOf(raw: string): number {
  const limit = Number(raw);
  if (!/^\d+$/u.test(raw) || limit < 1 || limit > SEMANTIC_QUERY_MAX_LIMIT) throw new Error(`limit 须为 1–${SEMANTIC_QUERY_MAX_LIMIT} 的整数`);
  return limit;
}

function revisionOf(raw: string, label: string): number {
  if (!/^\d+$/u.test(raw.trim())) throw new Error(`${label}须为非负整数：${raw}`);
  return Number(raw.trim());
}

export function isWorkspacePath(value: string): boolean {
  return value.startsWith('workspace:/');
}

function tagFields(values: readonly string[] | undefined): RawTagField[] {
  return (values ?? []).map(value => {
    const index = value.indexOf('=');
    const field = (index < 0 ? value : value.slice(0, index)).trim();
    if (!field) throw new Error(`字段不能为空：${value}`);
    return { field, defaultValue: index < 0 ? null : value.slice(index + 1) };
  });
}

function single(positionals: readonly string[], label: string): string {
  if (positionals.length !== 1 || !positionals[0]?.trim()) throw new Error(`需要一个${label}`);
  return positionals[0].trim();
}

export function parseSchemaCommand(argv: readonly string[]): SchemaCommand {
  if (isHelp(argv)) return { kind: 'help' };
  const [sub = 'list', ...rest] = argv[0]?.startsWith('-') ? ['list', ...argv] : argv;
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true, options: {
      json: { type: 'boolean', default: false }, type: { type: 'string' }, option: { type: 'string', multiple: true },
      field: { type: 'string', multiple: true }, 'allow-similar': { type: 'boolean', default: false },
    },
  });
  switch (sub) {
    case 'list':
      if (positionals.length) throw new Error('list 不带参数');
      return { kind: 'list', json: values.json };
    case 'add-field': {
      const valueType = SEMANTIC_VALUE_TYPES.find(type => type === values.type);
      if (!valueType) throw new Error(`--type 须为 ${SEMANTIC_VALUE_TYPES.join('|')}`);
      const options = names(values.option);
      if ((valueType === 'select' || valueType === 'multi_select') !== (options.length > 0)) {
        throw new Error('单选、多选须给 --option，其他类型不能给');
      }
      return { kind: 'add-field', name: single(positionals, '字段名'), valueType, options, allowSimilar: values['allow-similar'] };
    }
    case 'add-tag':
      return { kind: 'add-tag', name: single(positionals, '标签名'), fields: tagFields(values.field), allowSimilar: values['allow-similar'] };
    case 'set-fields':
      return { kind: 'set-fields', tag: single(positionals, '标签名'), fields: tagFields(values.field) };
    default:
      throw new Error(`未知子命令：${sub}`);
  }
}

export function parsePropsCommand(argv: readonly string[]): PropsCommand {
  if (isHelp(argv) || argv.length === 0) return { kind: 'help' };
  const [sub, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true, options: {
      json: { type: 'boolean', default: false }, tag: { type: 'string', multiple: true },
      rev: { type: 'string' }, to: { type: 'string' },
    },
  });
  if (sub === 'get') {
    const path = single(positionals, '文档路径');
    if (!isWorkspacePath(path)) throw new Error(`路径须以 workspace:/ 开头：${path}`);
    return { kind: 'get', path, json: values.json };
  }
  const paths = positionals.filter(isWorkspacePath);
  const others = positionals.filter(value => !isWorkspacePath(value));
  if (!paths.length) throw new Error('需要至少一个 workspace:/ 开头的文档路径');
  if (new Set(paths).size !== paths.length) throw new Error('同一路径给了多次');
  let change: PropsChange;
  if (sub === 'tag' || sub === 'untag') {
    if (others.length) throw new Error(`无法识别的参数：${others.join(' ')}`);
    const tags = names(values.tag);
    if (!tags.length) throw new Error('需要 --tag');
    change = { action: sub, tags };
  } else if (sub === 'set') {
    const assignments = others.map(value => {
      const index = value.indexOf('=');
      if (index <= 0) throw new Error(`字段值须写成 字段=值：${value}`);
      return [value.slice(0, index).trim(), value.slice(index + 1)] as const;
    });
    if (!assignments.length) throw new Error('需要至少一个 字段=值');
    change = { action: 'set', assignments };
  } else if (sub === 'restore') {
    if (others.length) throw new Error(`无法识别的参数：${others.join(' ')}`);
    if (paths.length !== 1) throw new Error('restore 一次只恢复一份文档');
    if (values.to === undefined) throw new Error('需要 --to 版本');
    change = { action: 'restore', toRevision: revisionOf(values.to, '--to ') };
  } else {
    throw new Error(`未知子命令：${sub}`);
  }
  let revisions: number[] | null = null;
  if (values.rev !== undefined) {
    revisions = values.rev.split(/[,，]/u).map(value => revisionOf(value, '--rev '));
    if (revisions.length !== paths.length) throw new Error(`--rev 给了 ${revisions.length} 个版本，路径有 ${paths.length} 个`);
  }
  return { kind: 'write', paths, change, revisions };
}

// 两字符的运算符先试，避免 `>=` 被拆成 `>`。
const OPERATORS: readonly (readonly [string, SemanticQueryOperator, SemanticQueryOperator | null])[] = [
  ['!=', 'neq', 'not_empty'], ['!~', 'not_contains', null], ['>=', 'gte', null], ['<=', 'lte', null],
  ['=', 'eq', 'empty'], ['~', 'contains', null], ['>', 'gt', null], ['<', 'lt', null],
];

export function parseQueryFilter(text: string): RawQueryFilter {
  let best: { index: number; token: string; op: SemanticQueryOperator; emptyOp: SemanticQueryOperator | null } | null = null;
  for (const [token, op, emptyOp] of OPERATORS) {
    const index = text.indexOf(token);
    if (index > 0 && (best === null || index < best.index)) best = { index, token, op, emptyOp };
  }
  if (!best) throw new Error(`条件须写成 字段 运算符 值：${text}`);
  const field = text.slice(0, best.index).trim();
  const raw = text.slice(best.index + best.token.length).trim();
  if (!raw) {
    if (!best.emptyOp) throw new Error(`条件缺少值：${text}`);
    return { field, op: best.emptyOp, raw: null };
  }
  return { field, op: best.op, raw };
}

/** `--sort -年份` 的值以 `-` 开头，parseArgs 会当成缺参；先合成 `--sort=-年份`。 */
function joinDashValues(argv: readonly string[], option: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const next = argv[index + 1];
    if (argv[index] === option && next !== undefined && /^-[^-]/u.test(next)) {
      result.push(`${option}=${next}`);
      index += 1;
    } else {
      result.push(argv[index]);
    }
  }
  return result;
}

export function parseQueryCommand(argv: readonly string[]): QueryCommand {
  if (isHelp(argv)) return { kind: 'help' };
  const { values, positionals } = parseArgs({
    args: joinDashValues(argv, '--sort'), allowPositionals: true, options: {
      tag: { type: 'string', multiple: true }, where: { type: 'string', multiple: true },
      sort: { type: 'string', multiple: true }, group: { type: 'string' },
      limit: { type: 'string', default: '50' }, json: { type: 'boolean', default: false },
    },
  });
  if (positionals.length) throw new Error(`无法识别的参数：${positionals.join(' ')}（条件用 --where）`);
  return {
    kind: 'query',
    tags: names(values.tag),
    where: (values.where ?? []).map(parseQueryFilter),
    sort: (values.sort ?? []).map(value => {
      const field = value.replace(/^[-+]/u, '').trim();
      if (!field) throw new Error(`排序字段不能为空：${value}`);
      return { field, direction: value.startsWith('-') ? 'desc' as const : 'asc' as const };
    }),
    groupBy: values.group?.trim() || null,
    limit: limitOf(values.limit),
    json: values.json,
  };
}

export function parseLinksCommand(argv: readonly string[]): LinksCommand {
  if (isHelp(argv)) return { kind: 'help' };
  const { values, positionals } = parseArgs({
    args: [...argv], allowPositionals: true, options: { limit: { type: 'string', default: '50' } },
  });
  const path = single(positionals, '文档路径');
  if (!isWorkspacePath(path)) throw new Error(`路径须以 workspace:/ 开头：${path}`);
  return { kind: 'links', path, limit: limitOf(values.limit) };
}
