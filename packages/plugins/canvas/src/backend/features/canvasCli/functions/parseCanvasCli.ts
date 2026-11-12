import { CanvasCardIdSchema } from '../../../../shared/model/definitions/canvasElement';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { CanvasArrangeOptionsSchema } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasCliFailure, type CanvasCliCommand } from '../definitions/canvasCliCommand';

export const CANVAS_CLI_HELP = {
  version: 1,
  command: 'linnya-canvas',
  usage: [
    'read <workspace:path>',
    'show <workspace:path> <cN>',
    'find <workspace:path> [text] [--tag 标签名] [--status 标签名]',
    'neighbors <workspace:path> <cN> [--depth 1]',
    'region <workspace:path> <方位>',
    'check <workspace:path>',
    'groups <workspace:path>',
    'changes <workspace:path> --after <提交序号> | --since "2026-11-11 19:20"',
    'receipt <workspace:path> <request-id>',
    'apply <workspace:path> --ops-file batch.json --request-id stable-id [--dry-run]',
    'arrange <workspace:path> --request-id stable-id [--algorithm tree|grid|layered] [--scope c1,c2] [--direction right|down] [--columns 3] [--dry-run]',
    'render <workspace:path> [--format png|jpeg] [--width 1440] [--height 900] [--theme light|dark] [--scope c1,c2 | --region 方位]',
  ],
  note: '不是 JSON Canvas。先读取 Skill canvas；修改命令需要 requires_write_access。',
};
type Flags = ReturnType<typeof parseArgs>['values'];
interface CliArguments {
  readonly path: string;
  readonly value?: string;
  readonly flags: Flags;
}
interface CommandParser {
  readonly arity: number;
  /** 第二个位置参数可省（find 只按标签筛选时）。 */
  readonly optionalValue?: boolean;
  readonly options: NonNullable<ParseArgsConfig['options']>;
  parse(input: CliArguments): CanvasCliCommand;
}
const writeFlags = {
  'request-id': { type: 'string' },
  'dry-run': { type: 'boolean' },
} satisfies NonNullable<ParseArgsConfig['options']>;
const commands: Readonly<Record<string, CommandParser>> = {
  read: { arity: 1, options: {}, parse: ({ path }) => ({ kind: 'read', path }) },
  check: { arity: 1, options: {}, parse: ({ path }) => ({ kind: 'check', path }) },
  groups: { arity: 1, options: {}, parse: ({ path }) => ({ kind: 'groups', path }) },
  changes: {
    arity: 1,
    options: { after: { type: 'string' }, since: { type: 'string' } },
    parse: parseChanges,
  },
  receipt: {
    arity: 2,
    options: {},
    parse: ({ path, value }) => {
      if (!value?.trim()) throw new CanvasCliFailure('missing_argument', '缺少原始 request-id。');
      return { kind: 'receipt', path, requestId: value };
    },
  },
  show: { arity: 2, options: {}, parse: input => parseQuery('show', input) },
  find: {
    arity: 2,
    optionalValue: true,
    options: { tag: { type: 'string' }, status: { type: 'string' } },
    parse: parseFind,
  },
  region: { arity: 2, options: {}, parse: input => parseQuery('region', input) },
  neighbors: {
    arity: 2,
    options: { depth: { type: 'string' } },
    parse: input => parseQuery('neighbors', input),
  },
  apply: {
    arity: 1,
    options: { ...writeFlags, 'ops-file': { type: 'string' } },
    parse: ({ path, flags }) => ({
      kind: 'apply',
      path,
      file: requiredFlag(flags, 'ops-file'),
      requestId: requiredFlag(flags, 'request-id'),
      dryRun: flags['dry-run'] === true,
    }),
  },
  arrange: {
    arity: 1,
    options: {
      ...writeFlags,
      algorithm: { type: 'string' },
      scope: { type: 'string' },
      groups: { type: 'string' },
      direction: { type: 'string' },
      columns: { type: 'string' },
    },
    parse: parseArrangement,
  },
  render: {
    arity: 1,
    options: {
      format: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      theme: { type: 'string' },
      scope: { type: 'string' },
      region: { type: 'string' },
    },
    parse: parseRender,
  },
};
export function parseCanvasCli(argv: readonly string[]): CanvasCliCommand {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help')
    return { kind: 'help' };
  const kind = argv[0],
    definition = commands[kind];
  if (!Object.prototype.hasOwnProperty.call(commands, kind))
    throw new CanvasCliFailure('unknown_command', `未知子命令 ${kind}；运行 linnya-canvas help。`);
  const parsed = parseArgs({
    args: [...argv.slice(1)],
    options: { ...definition.options, help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
    strict: true,
  });
  if (parsed.values.help === true) return { kind: 'help' };
  const path = parsed.positionals[0];
  if (!path?.startsWith('workspace:'))
    throw new CanvasCliFailure(
      'invalid_path',
      '请使用 workspace:/目录/画布.canvas；不接受磁盘路径。'
    );
  const positionals = parsed.positionals.length;
  if (
    positionals !== definition.arity &&
    !(definition.optionalValue && positionals === definition.arity - 1)
  )
    throw new CanvasCliFailure(
      'invalid_arguments',
      `参数数量不正确；请运行 linnya-canvas help 查看 ${kind} 用法。`
    );
  return definition.parse({ path, value: parsed.positionals[1], flags: parsed.values });
}
function stringFlag(flags: Flags, key: string, fallback: string): string {
  const value = flags[key];
  return typeof value === 'string' ? value : fallback;
}
function requiredFlag(flags: Flags, key: string): string {
  const value = flags[key];
  if (typeof value !== 'string' || !value.trim())
    throw new CanvasCliFailure(
      'missing_argument',
      `缺少 --${key}；重试同一动作必须复用 request-id。`
    );
  return value;
}
function parseQuery(
  kind: 'show' | 'find' | 'neighbors' | 'region',
  input: CliArguments
): CanvasCliCommand {
  if (!input.value) throw new CanvasCliFailure('missing_argument', '缺少卡片编号、搜索词或方位。');
  const depth = Number(stringFlag(input.flags, 'depth', '1'));
  if (!Number.isInteger(depth) || depth < 1 || depth > 8)
    throw new CanvasCliFailure('invalid_depth', '--depth 必须是 1–8 的整数。');
  return { kind, path: input.path, value: input.value, depth };
}
function parseFind(input: CliArguments): CanvasCliCommand {
  const tag = typeof input.flags.tag === 'string' ? input.flags.tag.trim() : '',
    status = typeof input.flags.status === 'string' ? input.flags.status.trim() : '';
  if (!input.value?.trim() && !tag && !status)
    throw new CanvasCliFailure('missing_argument', '缺少搜索词，或用 --tag/--status 按标签找。');
  return {
    kind: 'find',
    path: input.path,
    value: input.value ?? '',
    depth: 1,
    ...(tag ? { tag } : {}),
    ...(status ? { status } : {}),
  };
}
function parseArrangement({ path, flags }: CliArguments): CanvasCliCommand {
  return {
    kind: 'arrange',
    path,
    requestId: requiredFlag(flags, 'request-id'),
    dryRun: flags['dry-run'] === true,
    options: CanvasArrangeOptionsSchema.parse({
      algorithm: stringFlag(flags, 'algorithm', 'tree'),
      direction: stringFlag(flags, 'direction', 'right'),
      ...(typeof flags.scope === 'string' ? { elementIds: flags.scope.split(',') } : {}),
      ...(typeof flags.columns === 'string' ? { columns: Number(flags.columns) } : {}),
      ...(typeof flags.groups === 'string'
        ? { groups: flags.groups.split(';').map(group => group.split(',')) }
        : {}),
    }),
  };
}
function parseRender({ path, flags }: CliArguments): CanvasCliCommand {
  const format = stringFlag(flags, 'format', 'jpeg'),
    theme = stringFlag(flags, 'theme', 'light');
  const width = Number(stringFlag(flags, 'width', '1440')),
    height = Number(stringFlag(flags, 'height', '900'));
  if (format !== 'png' && format !== 'jpeg')
    throw new CanvasCliFailure('invalid_format', '--format 只支持 png/jpeg。');
  if (theme !== 'light' && theme !== 'dark')
    throw new CanvasCliFailure('invalid_theme', '--theme 只支持 light/dark。');
  if (
    ![width, height].every(size => Number.isInteger(size) && size >= 1 && size <= 4096) ||
    width * height > 16_777_216
  )
    throw new CanvasCliFailure('invalid_size', '输出尺寸须在 1–4096，且总像素不超过 16777216。');
  const elementIds =
    typeof flags.scope === 'string'
      ? flags.scope.split(',').map(id => CanvasCardIdSchema.parse(id))
      : undefined;
  const region = typeof flags.region === 'string' ? flags.region : undefined;
  if (elementIds && region)
    throw new CanvasCliFailure('invalid_scope', '--scope与--region只能选一个。');
  if (
    region &&
    !['左上', '上方', '右上', '左侧', '正中', '右侧', '左下', '下方', '右下'].includes(region)
  )
    throw new CanvasCliFailure('invalid_region', '--region使用九宫格方位，如左上或正中。');
  return { kind: 'render', path, format, theme, width, height, elementIds, region };
}

/** read 给出的提交序号或 read/show 给出的本机时间；两者只能给一个。 */
function parseChanges({ path, flags }: CliArguments): CanvasCliCommand {
  const after = flags.after,
    since = flags.since;
  if ((typeof after === 'string') === (typeof since === 'string'))
    throw new CanvasCliFailure(
      'missing_argument',
      '需要且只能给一个 --after <提交序号> 或 --since "年-月-日 时:分"。'
    );
  if (typeof after === 'string') {
    const sequence = Number(after);
    if (!/^\d+$/.test(after.trim()) || !Number.isSafeInteger(sequence))
      throw new CanvasCliFailure('invalid_sequence', '--after 必须是 read 输出的提交序号。');
    return { kind: 'changes', path, after: sequence };
  }
  const time = new Date(String(since).trim()).getTime();
  if (!Number.isFinite(time))
    throw new CanvasCliFailure(
      'invalid_time',
      '--since 用 read/show 输出的时间格式，例如 "2026-11-11 19:20"。'
    );
  return { kind: 'changes', path, since: time };
}
