import { CanvasCardIdSchema } from '../../../../shared/model/definitions/canvasElement';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { CanvasArrangeOptionsSchema } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasCliFailure, type CanvasCliCommand } from '../definitions/canvasCliCommand';

export const CANVAS_CLI_HELP = {
  version: 1, command: 'linnya-canvas',
  usage: ['read <workspace:path>', 'show <workspace:path> <cN>', 'find <workspace:path> <text>',
    'neighbors <workspace:path> <cN> [--depth 1]', 'region <workspace:path> <方位>', 'check <workspace:path>', 'groups <workspace:path>', 'receipt <workspace:path> <request-id>',
    'apply <workspace:path> --ops-file batch.json --request-id stable-id [--dry-run]',
    'arrange <workspace:path> --request-id stable-id [--algorithm tree|grid|layered] [--scope c1,c2] [--direction right|down] [--columns 3] [--dry-run]',
    'render <workspace:path> [--format png|jpeg] [--width 1440] [--height 900] [--theme light|dark] [--scope c1,c2 | --region 方位]'],
  note: '不是 JSON Canvas。先读取 Skill canvas；修改命令需要 requires_write_access。',
};
type Flags = ReturnType<typeof parseArgs>['values'];
interface CliArguments { readonly path: string; readonly value?: string; readonly flags: Flags }
interface CommandParser { readonly arity: number; readonly options: NonNullable<ParseArgsConfig['options']>; parse(input: CliArguments): CanvasCliCommand }
const writeFlags = { 'request-id': { type: 'string' }, 'dry-run': { type: 'boolean' } } satisfies NonNullable<ParseArgsConfig['options']>;
const commands: Readonly<Record<string, CommandParser>> = {
  read: { arity: 1, options: {}, parse: ({ path }) => ({ kind: 'read', path }) },
  check: { arity: 1, options: {}, parse: ({ path }) => ({ kind: 'check', path }) },
  groups: { arity: 1, options: {}, parse: ({ path }) => ({ kind: 'groups', path }) },
  receipt: { arity: 2, options: {}, parse: ({ path, value }) => { if (!value?.trim()) throw new CanvasCliFailure('missing_argument', '缺少原始 request-id。'); return { kind: 'receipt', path, requestId: value }; } },
  show: { arity: 2, options: {}, parse: input => parseQuery('show', input) },
  find: { arity: 2, options: {}, parse: input => parseQuery('find', input) },
  region: { arity: 2, options: {}, parse: input => parseQuery('region', input) },
  neighbors: { arity: 2, options: { depth: { type: 'string' } }, parse: input => parseQuery('neighbors', input) },
  apply: { arity: 1, options: { ...writeFlags, 'ops-file': { type: 'string' } }, parse: ({ path, flags }) => ({ kind: 'apply', path,
    file: requiredFlag(flags, 'ops-file'), requestId: requiredFlag(flags, 'request-id'), dryRun: flags['dry-run'] === true }) },
  arrange: { arity: 1, options: { ...writeFlags, algorithm: { type: 'string' }, scope: { type: 'string' }, groups: { type: 'string' }, direction: { type: 'string' }, columns: { type: 'string' } }, parse: parseArrangement },
  render: { arity: 1, options: { format: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' }, theme: { type: 'string' }, scope: { type: 'string' }, region: { type: 'string' } }, parse: parseRender },
};
export function parseCanvasCli(argv: readonly string[]): CanvasCliCommand {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') return { kind: 'help' };
  const kind = argv[0], definition = commands[kind];
  if (!Object.prototype.hasOwnProperty.call(commands, kind)) throw new CanvasCliFailure('unknown_command', `未知子命令 ${kind}；运行 linnya-canvas help。`);
  const parsed = parseArgs({ args: [...argv.slice(1)], options: { ...definition.options, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  if (parsed.values.help === true) return { kind: 'help' };
  const path = parsed.positionals[0];
  if (!path?.startsWith('workspace:')) throw new CanvasCliFailure('invalid_path', '请使用 workspace:/目录/画布.canvas；不接受磁盘路径。');
  if (parsed.positionals.length !== definition.arity) throw new CanvasCliFailure('invalid_arguments', `参数数量不正确；请运行 linnya-canvas help 查看 ${kind} 用法。`);
  return definition.parse({ path, value: parsed.positionals[1], flags: parsed.values });
}
function stringFlag(flags: Flags, key: string, fallback: string): string { const value = flags[key]; return typeof value === 'string' ? value : fallback; }
function requiredFlag(flags: Flags, key: string): string {
  const value = flags[key];
  if (typeof value !== 'string' || !value.trim()) throw new CanvasCliFailure('missing_argument', `缺少 --${key}；重试同一动作必须复用 request-id。`);
  return value;
}
function parseQuery(kind: 'show' | 'find' | 'neighbors' | 'region', input: CliArguments): CanvasCliCommand {
  if (!input.value) throw new CanvasCliFailure('missing_argument', '缺少卡片编号、搜索词或方位。');
  const depth = Number(stringFlag(input.flags, 'depth', '1'));
  if (!Number.isInteger(depth) || depth < 1 || depth > 8) throw new CanvasCliFailure('invalid_depth', '--depth 必须是 1–8 的整数。');
  return { kind, path: input.path, value: input.value, depth };
}
function parseArrangement({ path, flags }: CliArguments): CanvasCliCommand {
  return { kind: 'arrange', path, requestId: requiredFlag(flags, 'request-id'), dryRun: flags['dry-run'] === true,
    options: CanvasArrangeOptionsSchema.parse({ algorithm: stringFlag(flags, 'algorithm', 'tree'), direction: stringFlag(flags, 'direction', 'right'),
      ...(typeof flags.scope === 'string' ? { elementIds: flags.scope.split(',') } : {}),
      ...(typeof flags.columns === 'string' ? { columns: Number(flags.columns) } : {}),
      ...(typeof flags.groups === 'string' ? { groups: flags.groups.split(';').map(group => group.split(',')) } : {}) }) };
}
function parseRender({ path, flags }: CliArguments): CanvasCliCommand {
  const format = stringFlag(flags, 'format', 'jpeg'), theme = stringFlag(flags, 'theme', 'light');
  const width = Number(stringFlag(flags, 'width', '1440')), height = Number(stringFlag(flags, 'height', '900'));
  if (format !== 'png' && format !== 'jpeg') throw new CanvasCliFailure('invalid_format', '--format 只支持 png/jpeg。');
  if (theme !== 'light' && theme !== 'dark') throw new CanvasCliFailure('invalid_theme', '--theme 只支持 light/dark。');
  if (![width, height].every(size => Number.isInteger(size) && size >= 1 && size <= 4096) || width * height > 16_777_216) throw new CanvasCliFailure('invalid_size', '输出尺寸须在 1–4096，且总像素不超过 16777216。');
  const elementIds = typeof flags.scope === 'string' ? flags.scope.split(',').map(id => CanvasCardIdSchema.parse(id)) : undefined;
  const region = typeof flags.region === 'string' ? flags.region : undefined;
  if (elementIds && region) throw new CanvasCliFailure('invalid_scope', '--scope与--region只能选一个。');
  if (region && !['左上','上方','右上','左侧','正中','右侧','左下','下方','右下'].includes(region)) throw new CanvasCliFailure('invalid_region', '--region使用九宫格方位，如左上或正中。');
  return { kind: 'render', path, format, theme, width, height, elementIds, region };
}
