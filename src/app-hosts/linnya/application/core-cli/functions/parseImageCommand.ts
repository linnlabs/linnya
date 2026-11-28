import { parseArgs } from 'node:util';
import type { CutoutMethod, ImageQuad, ImageRegion, RgbColor, SheetKeyMode, TextureKind } from 'src/domains/image-processing';

export const IMAGE_USAGE = [
  'linnya image trim <图片> [--tolerance 1-100] [--save]   量出四周的白边、黑边或水印条，给出裁剪比例；--save 才另存裁好的图',
  'linnya image cutout <图片> [--method auto|vision|edge]   去掉照片背景、裁到主体，另出品红底检查图；macOS 14+ 默认用系统 Vision，其他平台按边缘颜色抠',
  'linnya image ink <图片> [--color HEX]   白纸上的书法、拓片、印章转成单色加透明，裁到有墨的范围',
  'linnya image frost <图片> --region 左,上,宽,高 [--aspect 宽:高] [--blur 1-100] [--radius 0-0.5]   磨砂卡：预先模糊背景图上卡片所在的一块；--aspect 先按页面比例居中裁，区域按页面比例写；圆角按区域短边的比例',
  'linnya image perspective <图片> --to x1,y1,x2,y2,x3,y3,x4,y4 [--size 宽x高]   投影进四边形（左上、右上、右下、左下），四边形外透明',
  'linnya image grid <图片> [--n 2-26]   叠坐标网格（列 0 起、行 A 起），看图后按格子换算裁剪或焦点比例',
  'linnya image texture paper|grain --size 宽x高 [--color HEX]   程序生成纸纹（不透明）或颗粒（透明叠加层）',
  'linnya image slice <图片> [--key auto|magenta|green|flood] [--grid 列x行]   把纯色底的宫格切成透明小图（默认按连通块，粘连时按格子），另出带序号的检查图',
  '图片是当前对话工作目录里的相对路径或 conversation:/...；位置和区域都按宽高的 0–1 写，与裁剪、焦点同一种量法。',
  '结果写进工作目录的 assets/，输出 conversation:/ 路径；写文件的子命令需要 Shell 写权限（requires_write_access），trim 不带 --save 只读。',
  '只想裁取景、调色、加形状遮罩或投影时，先看文档类型自己能不能做：原生的裁剪与调色导出后仍可修改。',
].join('\n');

/** 墨色默认取偏暖的近黑，比纯黑更像墨。 */
const DEFAULT_INK: RgbColor = [31, 26, 23];
const DEFAULT_TRIM_TOLERANCE = 16;
const DEFAULT_FROST_BLUR = 18;
const DEFAULT_GRID_DIVISIONS = 10;

export type ImageCommand =
  | { readonly kind: 'help'; readonly text: string }
  | { readonly kind: 'trim'; readonly image: string; readonly tolerance: number; readonly save: boolean }
  | { readonly kind: 'cutout'; readonly image: string; readonly method: CutoutMethod }
  | { readonly kind: 'ink'; readonly image: string; readonly color: RgbColor }
  | { readonly kind: 'frost'; readonly image: string; readonly region: ImageRegion; readonly blur: number; readonly radius: number; readonly aspect?: number }
  | { readonly kind: 'perspective'; readonly image: string; readonly quad: ImageQuad; readonly width?: number; readonly height?: number }
  | { readonly kind: 'grid'; readonly image: string; readonly divisions: number }
  | { readonly kind: 'texture'; readonly texture: TextureKind; readonly width: number; readonly height: number; readonly color?: RgbColor }
  | { readonly kind: 'slice'; readonly image: string; readonly key: SheetKeyMode | 'auto'; readonly grid?: { readonly columns: number; readonly rows: number } };

type Subcommand = Exclude<ImageCommand['kind'], 'help'>;

function usageOf(subcommand: Subcommand): string {
  return IMAGE_USAGE.split('\n').find(line => line.startsWith(`linnya image ${subcommand} `)) ?? IMAGE_USAGE;
}

/** 颜色可以不带 #：Shell 会把未加引号的 # 后面当注释。 */
function rgb(value: string): RgbColor {
  const match = /^#?([0-9a-f]{6})$/iu.exec(value.trim());
  if (!match?.[1]) throw new Error(`颜色须为 6 位 HEX：${value}`);
  const hex = match[1];
  return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
}

function numbers(value: string, count: number, name: string): number[] {
  const parts = value.split(',').map(part => part.trim());
  const parsed = parts.map(Number);
  if (parts.length !== count || parts.some(part => part === '') || parsed.some(item => !Number.isFinite(item))) {
    throw new Error(`--${name} 须为 ${count} 个用逗号分隔的数`);
  }
  return parsed;
}

function number(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (value.trim() === '' || !Number.isFinite(parsed)) throw new Error(`--${name} 须为数字`);
  return parsed;
}

function aspect(value: string): number {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(value.trim());
  const ratio = Number(match?.[1]) / Number(match?.[2]);
  if (!match || !Number.isFinite(ratio) || ratio <= 0) throw new Error('--aspect 须写成 宽:高，如 16:9');
  return ratio;
}

function size(value: string, name: string): { readonly width: number; readonly height: number } {
  const match = /^(\d+)[x×*](\d+)$/u.exec(value.trim());
  if (!match?.[1] || !match[2]) throw new Error(name === 'grid' ? '--grid 须写成 列x行，如 3x3' : `--${name} 须写成 宽x高，如 1920x1080`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function oneImage(positionals: readonly string[], subcommand: Subcommand): string {
  const [image, ...extra] = positionals;
  if (image === undefined || extra.length > 0) throw new Error(`${subcommand} 只接受一张图片`);
  return image;
}

function parseSubcommand(subcommand: Subcommand, argv: readonly string[]): ImageCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      tolerance: { type: 'string' },
      save: { type: 'boolean', default: false },
      color: { type: 'string' },
      region: { type: 'string' },
      aspect: { type: 'string' },
      blur: { type: 'string' },
      radius: { type: 'string' },
      to: { type: 'string' },
      size: { type: 'string' },
      n: { type: 'string' },
      key: { type: 'string' },
      grid: { type: 'string' },
      method: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { kind: 'help', text: usageOf(subcommand) };
  // 各子命令不认的选项直接拒绝：模型把 frost 的 --region 写到 grid 上时，静默忽略会让它以为生效了。
  const allowed: Record<Subcommand, readonly string[]> = {
    trim: ['tolerance', 'save'],
    cutout: ['method'],
    ink: ['color'],
    frost: ['region', 'aspect', 'blur', 'radius'],
    perspective: ['to', 'size'],
    grid: ['n'],
    texture: ['size', 'color'],
    slice: ['key', 'grid'],
  };
  const extra = Object.entries(values)
    .filter(([key, value]) => key !== 'help' && value !== undefined && value !== false && !allowed[subcommand].includes(key));
  if (extra.length > 0) throw new Error(`${subcommand} 不接受 ${extra.map(([key]) => `--${key}`).join('、')}`);

  switch (subcommand) {
    case 'trim':
      return {
        kind: 'trim', image: oneImage(positionals, subcommand),
        tolerance: number(values.tolerance, 'tolerance', DEFAULT_TRIM_TOLERANCE), save: values.save,
      };
    case 'cutout': {
      const method = values.method ?? 'auto';
      if (method !== 'auto' && method !== 'vision' && method !== 'edge') throw new Error('--method 须为 auto、vision 或 edge');
      return { kind: 'cutout', image: oneImage(positionals, subcommand), method };
    }
    case 'ink':
      return { kind: 'ink', image: oneImage(positionals, subcommand), color: values.color === undefined ? DEFAULT_INK : rgb(values.color) };
    case 'frost': {
      if (values.region === undefined) throw new Error('frost 需要 --region 左,上,宽,高');
      const [left, top, width, height] = numbers(values.region, 4, 'region');
      return {
        kind: 'frost', image: oneImage(positionals, subcommand),
        region: { left, top, width, height },
        blur: number(values.blur, 'blur', DEFAULT_FROST_BLUR),
        radius: number(values.radius, 'radius', 0),
        ...(values.aspect === undefined ? {} : { aspect: aspect(values.aspect) }),
      };
    }
    case 'perspective': {
      if (values.to === undefined) throw new Error('perspective 需要 --to x1,y1,x2,y2,x3,y3,x4,y4');
      const p = numbers(values.to, 8, 'to');
      const canvas = values.size === undefined ? {} : size(values.size, 'size');
      return {
        kind: 'perspective', image: oneImage(positionals, subcommand),
        quad: [[p[0], p[1]], [p[2], p[3]], [p[4], p[5]], [p[6], p[7]]],
        ...canvas,
      };
    }
    case 'grid':
      return { kind: 'grid', image: oneImage(positionals, subcommand), divisions: number(values.n, 'n', DEFAULT_GRID_DIVISIONS) };
    case 'slice': {
      const key = values.key ?? 'auto';
      if (key !== 'auto' && key !== 'magenta' && key !== 'green' && key !== 'flood') throw new Error('--key 须为 auto、magenta、green 或 flood');
      const grid = values.grid === undefined ? undefined : size(values.grid, 'grid');
      return {
        kind: 'slice', image: oneImage(positionals, subcommand), key,
        ...(grid === undefined ? {} : { grid: { columns: grid.width, rows: grid.height } }),
      };
    }
    case 'texture': {
      const [texture, ...rest] = positionals;
      if ((texture !== 'paper' && texture !== 'grain') || rest.length > 0) throw new Error('texture 须为 paper 或 grain');
      if (values.size === undefined) throw new Error('texture 需要 --size 宽x高');
      return {
        kind: 'texture', texture, ...size(values.size, 'size'),
        ...(values.color === undefined ? {} : { color: rgb(values.color) }),
      };
    }
  }
}

const SUBCOMMANDS: readonly Subcommand[] = ['trim', 'cutout', 'ink', 'frost', 'perspective', 'grid', 'texture', 'slice'];

function isSubcommand(value: string): value is Subcommand {
  return SUBCOMMANDS.some(subcommand => subcommand === value);
}

/** 参数写错时只给出那一个子命令的用法；子命令本身不认识时给全部。 */
export function imageUsageFor(argv: readonly string[]): string {
  const [subcommand] = argv;
  return subcommand !== undefined && isSubcommand(subcommand) ? usageOf(subcommand) : IMAGE_USAGE;
}

/** argv 不含前面的 `image`。 */
export function parseImageCommand(argv: readonly string[]): ImageCommand {
  const [subcommand, ...args] = argv;
  if (subcommand === undefined || subcommand === '--help') return { kind: 'help', text: IMAGE_USAGE };
  if (!isSubcommand(subcommand)) throw new Error(`未知子命令：${subcommand}`);
  return parseSubcommand(subcommand, args);
}
