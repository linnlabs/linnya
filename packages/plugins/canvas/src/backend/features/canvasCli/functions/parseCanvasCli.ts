import { parseArgs } from 'node:util';
import { CanvasArrangeOptionsSchema } from '../../../../shared/cli/definitions/canvasCli';
import { CanvasCliFailure, type CanvasCliCommand } from '../definitions/canvasCliCommand';

export const CANVAS_CLI_HELP = {
  version: 1, command: 'linnya-canvas',
  usage: ['read <workspace:path>', 'show <workspace:path> <cN>', 'find <workspace:path> <text>',
    'neighbors <workspace:path> <cN> [--depth 1]', 'region <workspace:path> <方位>', 'check <workspace:path>', 'groups <workspace:path>',
    'apply <workspace:path> --ops-file batch.json --request-id stable-id [--dry-run]',
    'arrange <workspace:path> --request-id stable-id [--algorithm tree|grid|layered] [--scope c1,c2] [--direction right|down] [--columns 3] [--dry-run]',
    'render <workspace:path> [--format png|jpeg] [--width 1440] [--height 900] [--theme light|dark]'],
  note: '不是 JSON Canvas。先读取 Skill canvas；修改命令需要 requires_write_access。',
};
export function parseCanvasCli(argv: readonly string[]): CanvasCliCommand {
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') return { kind: 'help' };
  const kind = argv[0];
  const optionTypes = kind === 'apply' ? { 'ops-file': 'string', 'request-id': 'string', 'dry-run': 'boolean' }
    : kind === 'arrange' ? { 'request-id': 'string', 'dry-run': 'boolean', algorithm: 'string', scope: 'string', direction: 'string', columns: 'string' }
      : kind === 'render' ? { format: 'string', width: 'string', height: 'string', theme: 'string' }
        : kind === 'neighbors' ? { depth: 'string' } : {};
  const options: Record<string, { type: 'string' | 'boolean' }> = {};
  for (const [key, type] of Object.entries(optionTypes)) {
    if (type !== 'string' && type !== 'boolean') throw new Error('Invalid internal CLI option definition');
    options[key] = { type };
  }
  const parsed = parseArgs({ args: [...argv.slice(1)], options, allowPositionals: true, strict: true });
  const path = parsed.positionals[0];
  if (!path?.startsWith('workspace:')) throw new CanvasCliFailure('invalid_path', '请使用 workspace:/目录/画布.canvas；不接受磁盘路径。');
  const value = parsed.positionals[1];
  const required = (key: string): string => {
    const result = parsed.values[key];
    if (typeof result !== 'string' || !result.trim()) throw new CanvasCliFailure('missing_argument', `缺少 --${key}；重试同一动作必须复用 request-id。`);
    return result;
  };
  const string = (key: string, fallback: string): string => { const result = parsed.values[key]; return typeof result === 'string' ? result : fallback; };
  const limit = ['show', 'find', 'neighbors', 'region'].includes(kind) ? 2 : 1;
  if (parsed.positionals.length !== limit) throw new CanvasCliFailure('invalid_arguments', `参数数量不正确；请运行 linnya-canvas help 查看 ${kind} 用法。`);
  if (kind === 'read' || kind === 'check' || kind === 'groups') return { kind, path };
  if (kind === 'apply') return { kind, path, file: required('ops-file'), requestId: required('request-id'), dryRun: parsed.values['dry-run'] === true };
  if (kind === 'arrange') return { kind, path, requestId: required('request-id'), dryRun: parsed.values['dry-run'] === true,
    options: CanvasArrangeOptionsSchema.parse({ algorithm: string('algorithm', 'tree'), direction: string('direction', 'right'), elementIds: typeof parsed.values.scope === 'string' ? parsed.values.scope.split(',') : undefined,
      columns: parsed.values.columns === undefined ? undefined : Number(parsed.values.columns) }) };
  if (kind === 'show' || kind === 'find' || kind === 'neighbors' || kind === 'region') {
    if (!value) throw new CanvasCliFailure('missing_argument', '缺少卡片编号、搜索词或方位。');
    const depth = Number(string('depth', '1'));
    if (!Number.isInteger(depth) || depth < 1 || depth > 8) throw new CanvasCliFailure('invalid_depth', '--depth 必须是 1–8 的整数。');
    return { kind, path, value, depth };
  }
  if (kind === 'render') {
    const format = string('format', 'png'), theme = string('theme', 'light');
    const width = Number(string('width', '1440')), height = Number(string('height', '900'));
    if (format !== 'png' && format !== 'jpeg') throw new CanvasCliFailure('invalid_format', '--format 只支持 png/jpeg。');
    if (theme !== 'light' && theme !== 'dark') throw new CanvasCliFailure('invalid_theme', '--theme 只支持 light/dark。');
    if (![width, height].every(size => Number.isInteger(size) && size >= 1 && size <= 4096) || width * height > 16_777_216) throw new CanvasCliFailure('invalid_size', '输出尺寸须在 1–4096，且总像素不超过 16777216。');
    return { kind, path, format, theme, width, height };
  }
  throw new CanvasCliFailure('unknown_command', `未知子命令 ${kind}；运行 linnya-canvas help。`);
}
