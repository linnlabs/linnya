import { create, type FontKitCollection, type FontKitFont } from 'fontkit';
import sharp from 'sharp';
import {
  TITLE_MAX_CHARACTERS,
  TITLE_MAX_EDGE,
  type ImageProcessingOutcome,
  type RgbColor,
  type TitleDirection,
  type TitleRendering,
} from '../definitions/imageProcessing';
import { missingGlyphs, titleOutline } from '../functions/titleOutline';
import { failure, ok } from '../shared/pixelCodec';

const MIN_SIZE = 32;
const MAX_SIZE = 2000;
/** 加粗是在轮廓外描一圈同色的边，最多到一个 em 的 5%：再粗笔画就糊成一团。 */
const MAX_THICKEN = 0.05;
/** 四周留出描边的一半再加 2px 给抗锯齿，免得边缘被 viewBox 切掉。 */
const EDGE_PADDING = 2;
/**
 * name 表里的许可说明只留开头。常见写法是先写版权行、再写许可名（Google Fonts 约 150 字，KaTeX 约 290 字），
 * 嵌入整份许可全文的字体开头就是许可名；400 字够把许可名留住，又不会把几 KB 的全文塞进输出。
 */
const MAX_LICENSE_CHARACTERS = 400;

function isCollection(font: FontKitFont | FontKitCollection): font is FontKitCollection {
  return 'fonts' in font;
}

function hex(color: RgbColor): string {
  return `#${color.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

/** name 表的文字常带换行，折成一行，命令输出才是一条记录一行。 */
function nameRecord(font: FontKitFont, key: string): string | null {
  const value = font.getName(key)?.replace(/\s+/gu, ' ').trim();
  return value ? value.slice(0, MAX_LICENSE_CHARACTERS) : null;
}

/** fontkit 对认不出的格式和损坏的表直接抛错，这里是解析边界，转成可预期的失败。 */
function parseFont(bytes: Uint8Array): FontKitFont | FontKitCollection | null {
  try {
    return create(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    return null;
  }
}

/**
 * 用下载的书法、展示字体渲染标题：取字形轮廓拼成 SVG path，再用 sharp 栅格化成透明 PNG。
 * 不走系统字体查找和 sharp 自带的文字渲染（Pango 在 macOS 上不认指定的字体文件，书法字会落成黑体）。
 * 字体缺字时直接报错并列出缺的字，不画方块，也不拿别的字体补：一个标题混两种书体比缺字更难看出来。
 */
export async function renderTitle(input: {
  readonly fontBytes: Uint8Array;
  readonly text: string;
  readonly color: RgbColor;
  readonly size: number;
  readonly direction: TitleDirection;
  /** 加粗的描边宽度，按 em 的比例。 */
  readonly thicken: number;
}): Promise<ImageProcessingOutcome<TitleRendering>> {
  const characters = [...input.text].length;
  if (input.text.trim() === '' || characters > TITLE_MAX_CHARACTERS) {
    return failure('invalid_options', `标题须为 1–${TITLE_MAX_CHARACTERS} 个字`);
  }
  if (!Number.isInteger(input.size) || input.size < MIN_SIZE || input.size > MAX_SIZE) {
    return failure('invalid_options', `字号须为 ${MIN_SIZE}–${MAX_SIZE} 的整数（一个字的像素数）`);
  }
  if (!Number.isFinite(input.thicken) || input.thicken < 0 || input.thicken > MAX_THICKEN) {
    return failure('invalid_options', `加粗须在 0–${MAX_THICKEN} 之间（按字号的比例）`);
  }
  const font = parseFont(input.fontBytes);
  if (font === null) return failure('font_unreadable', '不是能读的字体文件（TTF、OTF、WOFF、WOFF2）');
  if (isCollection(font)) return failure('font_unreadable', '这是字体集合（.ttc），请换成单个字体文件');

  const missing = missingGlyphs(font, input.text);
  if (missing.length > 0) {
    return failure('missing_glyphs', `字体里没有这些字：${missing.join('、')}；改用字体里有的写法（例如繁体），或整份换一款字体`);
  }
  const strokeWidth = input.thicken * input.size;
  const outline = titleOutline(font, input.text, input.size, input.direction, strokeWidth / 2 + EDGE_PADDING);
  if (outline.width > TITLE_MAX_EDGE || outline.height > TITLE_MAX_EDGE) {
    return failure('invalid_options', `渲染出来 ${outline.width}×${outline.height}，超过 ${TITLE_MAX_EDGE}px；调小字号或拆成几行`);
  }
  const color = hex(input.color);
  const stroke = strokeWidth > 0 ? ` stroke="${color}" stroke-width="${Math.round(strokeWidth * 10) / 10}" stroke-linejoin="round"` : '';
  // 根节点只写 viewBox：文档按外框缩放矢量图，再写 width/height 会多一层缩放
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${outline.width} ${outline.height}"><path d="${outline.d}" fill="${color}"${stroke}/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true });
  return ok({
    fontName: font.fullName,
    license: nameRecord(font, 'license'),
    licenseUrl: nameRecord(font, 'licenseURL'),
    // 文档对矢量图形有路径段数上限（Slides 为 2048），把段数交给调用方判断用 SVG 还是 PNG
    svg: { text: svg, width: outline.width, height: outline.height, pathCommands: outline.d.match(/[A-Za-z]/gu)?.length ?? 0 },
    image: { bytes: new Uint8Array(png.data), format: 'png', width: png.info.width, height: png.info.height },
  });
}
