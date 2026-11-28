import { gridRowLabel, type CutoutEngine, type EncodedImage, type ImageCrop, type SheetKeyMode } from 'src/domains/image-processing';

/** 一行写清产物：路径、像素尺寸、格式和大小，模型照抄路径引用即可。 */
export function formatWrittenImage(locator: string, image: EncodedImage): string {
  return `${locator} ${image.width}×${image.height} ${image.format} ${Math.max(1, Math.round(image.bytes.byteLength / 1024))}KB\n`;
}

/** 只列要裁的边，可以直接抄进文档的裁剪参数；四边都不裁时明说。 */
export function formatTrim(input: {
  readonly crop: ImageCrop;
  readonly width: number;
  readonly height: number;
  readonly saved: { readonly locator: string; readonly image: EncodedImage } | null;
}): string {
  const sides = Object.entries(input.crop).filter(([, value]) => value > 0);
  const head = sides.length === 0
    ? `没有可裁的边（量的图 ${input.width}×${input.height}）\n`
    : `crop ${JSON.stringify(Object.fromEntries(sides))}（按原图比例；量的图 ${input.width}×${input.height}）\n`;
  return head + (input.saved ? formatWrittenImage(input.saved.locator, input.saved.image) : '');
}

/** 网格的读法：格子名换算成比例，例子用中间偏左上的一格，免得模型把行列弄反。 */
export function formatGrid(locator: string, image: EncodedImage, divisions: number): string {
  const step = 1 / divisions;
  const column = Math.min(divisions - 1, 3);
  const row = Math.min(divisions - 1, 2);
  const span = (index: number) => `${(index * step).toFixed(2)}–${((index + 1) * step).toFixed(2)}`;
  return formatWrittenImage(locator, image)
    + `第 i 列横向 i/${divisions}–(i+1)/${divisions}，第 k 行（A 起）纵向 k/${divisions}–(k+1)/${divisions}；`
    + `例如 ${gridRowLabel(row)}${column} = x ${span(column)}, y ${span(row)}\n`;
}

const KEY_NAMES: Record<SheetKeyMode, string> = { magenta: '品红', green: '绿', flood: '纯色（从边框去底）' };

/** 首行写实测底色、块数和残留，之后一块一行（带序号，与检查图上的序号对应），最后一行是检查图。 */
export function formatSlice(input: {
  readonly mode: SheetKeyMode;
  readonly background: readonly number[];
  readonly residual: number;
  readonly pieces: readonly { readonly locator: string; readonly image: EncodedImage }[];
  readonly check: { readonly locator: string; readonly image: EncodedImage };
}): string {
  const hex = `#${input.background.map(value => value.toString(16).padStart(2, '0')).join('')}`;
  const residual = input.mode === 'flood' ? '' : ` · 残留键色 ${(input.residual * 100).toFixed(2)}%`;
  return `底色 ${KEY_NAMES[input.mode]} ${hex}（实测）· ${input.pieces.length} 块${residual}\n`
    + input.pieces.map((piece, index) => `${index + 1} ${formatWrittenImage(piece.locator, piece.image)}`).join('')
    + `检查图 ${formatWrittenImage(input.check.locator, input.check.image)}`;
}

const ENGINE_NAMES: Record<CutoutEngine, string> = { vision: 'Vision（系统前景遮罩）', edge: '边缘抠图' };

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** 首行写用了哪种方法和两个判别数，可疑时多一行提示；然后是结果图和检查图。 */
export function formatCutout(input: {
  readonly engine: CutoutEngine;
  readonly visionFoundNothing: boolean;
  readonly foregroundRatio: number;
  readonly borderForeground: number;
  readonly suspicious: boolean;
  readonly image: { readonly locator: string; readonly image: EncodedImage };
  readonly check: { readonly locator: string; readonly image: EncodedImage };
}): string {
  const fallback = input.visionFoundNothing ? '（Vision 没找到前景）' : '';
  const warning = input.suspicious
    ? `提示：前景占 ${percent(input.foregroundRatio)}、贴边 ${percent(input.borderForeground)}，超出常见范围，背景多半没去干净或主体被抠掉了；读检查图确认\n`
    : '';
  return `方法 ${ENGINE_NAMES[input.engine]}${fallback} · 前景占 ${percent(input.foregroundRatio)} · 贴边 ${percent(input.borderForeground)}\n`
    + warning
    + formatWrittenImage(input.image.locator, input.image.image)
    + `检查图 ${formatWrittenImage(input.check.locator, input.check.image)}`;
}
