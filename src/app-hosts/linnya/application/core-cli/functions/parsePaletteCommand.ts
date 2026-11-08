import { parseArgs } from 'node:util';
import type {
  ColorPaletteBase,
  ColorPaletteCheckInput,
  ColorPaletteHueRange,
  ColorPaletteSuggestOptions,
} from '@app/schemas/color-palette';

export const PALETTE_USAGE = [
  'linnya palette suggest <图片>... [--seed HEX]... [--color HEX]... [--accents 1-6] [--n 1-5] [--base light|tint|dark] [--avoid HEX]... [--rng 编号] [--preview] [--json]',
  'linnya palette check --bg HEX --sf HEX --ink HEX --mu HEX --ac HEX,... --ch HEX,... [--excluded 起-止]... [--color HEX]... [--json]',
  '图片是当前对话工作目录里的相对路径或 conversation:/...，第一张是主图，最多 20 张。HEX 写 6 位、不带 #，否则 Shell 会把 # 后面当注释。',
].join('\n');

export type PaletteCommand =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'suggest';
      readonly images: readonly string[];
      readonly options: ColorPaletteSuggestOptions;
      readonly preview: boolean;
      readonly json: boolean;
    }
  | { readonly kind: 'check'; readonly input: ColorPaletteCheckInput; readonly json: boolean };

function hex(value: string): string {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value.trim());
  if (!match?.[1]) throw new Error(`颜色无效：${value}`);
  return `#${match[1].toLowerCase()}`;
}

function hexList(values: readonly string[] | undefined): string[] {
  return (values ?? []).flatMap(value => value.split(',')).map(hex);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`缺少 --${name}`);
  return value;
}

function integer(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw new Error(`--${name} 须为整数`);
  return Number(value);
}

function base(value: string | undefined): ColorPaletteBase | undefined {
  if (value === undefined || value === 'light' || value === 'tint' || value === 'dark') return value;
  throw new Error('--base 须为 light、tint 或 dark');
}

function hueRange(value: string): ColorPaletteHueRange {
  const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/u.exec(value.replace(/°/gu, ''));
  const from = Number(match?.[1]);
  const to = Number(match?.[2]);
  if (!match || from > 360 || to > 360) throw new Error(`--excluded 须为 起-止 的色相度数，如 315-15：${value}`);
  return [from, to];
}

function nonEmpty<T>(key: string, values: readonly T[]): Record<string, T[]> {
  return values.length > 0 ? { [key]: [...values] } : {};
}

function parseSuggest(argv: readonly string[]): PaletteCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      seed: { type: 'string', multiple: true },
      color: { type: 'string', multiple: true },
      avoid: { type: 'string', multiple: true },
      accents: { type: 'string' },
      n: { type: 'string' },
      base: { type: 'string' },
      rng: { type: 'string' },
      preview: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { kind: 'help' };
  const seedColors = hexList(values.seed);
  const pinnedColors = hexList(values.color);
  if (positionals.length === 0 && seedColors.length === 0 && pinnedColors.length === 0) {
    throw new Error('需要图片、--seed 或 --color 至少一项');
  }
  const accentCount = integer(values.accents, 'accents');
  const count = integer(values.n, 'n');
  const requestedBase = base(values.base);
  return {
    kind: 'suggest',
    images: positionals,
    preview: values.preview,
    json: values.json,
    options: {
      ...nonEmpty('seedColors', seedColors),
      ...nonEmpty('pinnedColors', pinnedColors),
      ...nonEmpty('avoidColors', hexList(values.avoid)),
      ...(accentCount === undefined ? {} : { accentCount }),
      ...(count === undefined ? {} : { count }),
      ...(requestedBase === undefined ? {} : { base: requestedBase }),
      // 模型常把单套编号（pl8f2a-1）整段传回来；复现按整组编号。
      ...(values.rng === undefined ? {} : { rng: values.rng.replace(/-\d+$/u, '') }),
    },
  };
}

function parseCheck(argv: readonly string[]): PaletteCommand {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      bg: { type: 'string' },
      sf: { type: 'string' },
      ink: { type: 'string' },
      mu: { type: 'string' },
      ac: { type: 'string', multiple: true },
      ch: { type: 'string', multiple: true },
      excluded: { type: 'string', multiple: true },
      color: { type: 'string', multiple: true },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { kind: 'help' };
  const excludedHues = (values.excluded ?? []).flatMap(value => value.split(',')).map(hueRange);
  const pinnedColors = hexList(values.color);
  return {
    kind: 'check',
    json: values.json,
    input: {
      palette: {
        bg: hex(required(values.bg, 'bg')),
        surface: hex(required(values.sf, 'sf')),
        ink: hex(required(values.ink, 'ink')),
        muted: hex(required(values.mu, 'mu')),
        accent: hexList([required(values.ac?.join(','), 'ac')]),
        chart: hexList([required(values.ch?.join(','), 'ch')]),
      },
      ...(excludedHues.length > 0 ? { excludedHues } : {}),
      ...nonEmpty('pinnedColors', pinnedColors),
    },
  };
}

/** argv 不含前面的 `palette`。 */
export function parsePaletteCommand(argv: readonly string[]): PaletteCommand {
  const [command, ...args] = argv;
  if (command === undefined || command === '--help') return { kind: 'help' };
  if (command === 'suggest') return parseSuggest(args);
  if (command === 'check') return parseCheck(args);
  throw new Error(`未知子命令：${command}`);
}
