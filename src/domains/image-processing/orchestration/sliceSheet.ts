import sharp from 'sharp';
import {
  MAX_SHEET_PIECES,
  PROCESSING_MAX_EDGE,
  type EncodedImage,
  type ImageProcessingOutcome,
  type PixelBox,
  type SheetKeyMode,
  type SheetSlice,
} from '../definitions/imageProcessing';
import { MAX_BACKGROUND_DEVIATION, measureSheetBackground, sheetKeyModeOf } from '../functions/sheetBackground';
import { chromaKeyMatte, floodMatte } from '../functions/sheetMatte';
import { opaqueBounds } from '../functions/opaqueBounds';
import { connectedPieceBoxes, gridPieceBoxes } from '../functions/sheetPieces';
import { decode, encode, failure, isFailure, ok, raw, toPixels, type RgbaImage } from '../shared/pixelCodec';

/** 找连通块时把透明度图缩到这么大：元素间距在生图宫格里通常有几十像素，缩小后仍分得开，速度快一个量级。 */
const COMPONENT_MAX_EDGE = 600;
const MAX_GRID_SIDE = 12;
/** 检查图每格的边长，整张最多约 1600px 宽，看图模型一眼看完。 */
const CHECK_CELL = 260;

const KEY_NAMES: Record<SheetKeyMode, string> = { magenta: '品红', green: '绿', flood: '纯色' };

function hex(color: readonly number[]): string {
  return `#${color.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

async function findBoxes(matte: RgbaImage): Promise<PixelBox[]> {
  const alpha = await raw(matte).extractChannel(3)
    .resize(COMPONENT_MAX_EDGE, COMPONENT_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .raw().toBuffer({ resolveWithObject: true });
  return connectedPieceBoxes(new Uint8Array(alpha.data), alpha.info.width, alpha.info.height, alpha.info.width / matte.width, matte.width, matte.height);
}

/**
 * 检查图：每块放在灰色棋盘格上并标序号。灰底上残留的品红、绿边和白边都看得出来，
 * 一张图看完所有元素，省得逐张读图。
 */
async function contactSheet(pieces: readonly EncodedImage[]): Promise<EncodedImage> {
  const columns = Math.min(6, Math.ceil(Math.sqrt(pieces.length)));
  const rows = Math.ceil(pieces.length / columns);
  const width = columns * CHECK_CELL;
  const height = rows * CHECK_CELL;
  const squares: string[] = [];
  for (let y = 0; y < height; y += 20) {
    for (let x = 0; x < width; x += 20) if (((x + y) / 20) % 2 === 1) squares.push(`<rect x="${x}" y="${y}" width="20" height="20"/>`);
  }
  const labels = pieces.map((_, index) => {
    const left = (index % columns) * CHECK_CELL;
    const top = Math.floor(index / columns) * CHECK_CELL;
    return `<text x="${left + 8}" y="${top + 24}">${index + 1}</text>`;
  });
  const background = Buffer.from([
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    '<rect width="100%" height="100%" fill="#8c8c8c"/>',
    `<g fill="#a6a6a6">${squares.join('')}</g>`,
    '</svg>',
  ].join(''));
  const overlay = Buffer.from([
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<g font-family="sans-serif" font-size="20" font-weight="bold" fill="#ffffff" stroke="#000000" stroke-width="3" paint-order="stroke">${labels.join('')}</g>`,
    '</svg>',
  ].join(''));
  const tiles = await Promise.all(pieces.map(async (piece, index) => {
    // 小图标也放大到占满一格，残边才看得出；放大用最近邻，显示的是真实像素，不被插值抹平
    const enlarging = Math.max(piece.width, piece.height) < CHECK_CELL - 24;
    const { data, info } = await sharp(Buffer.from(piece.bytes))
      .resize(CHECK_CELL - 24, CHECK_CELL - 24, { fit: 'inside', kernel: enlarging ? 'nearest' : 'lanczos3' })
      .png().toBuffer({ resolveWithObject: true });
    return {
      input: data,
      left: (index % columns) * CHECK_CELL + Math.round((CHECK_CELL - info.width) / 2),
      top: Math.floor(index / columns) * CHECK_CELL + Math.round((CHECK_CELL - info.height) / 2),
    };
  }));
  return await encode(await toPixels(sharp(background).composite([...tiles, { input: overlay }])));
}

/**
 * 把纯色底的宫格图（生图模型一次出的多个小元素、图标表）切成一张张透明 PNG。
 * - 底色从边框实测；边框颜色不一致就拒绝，不硬切（模型被要求“透明底”时常画出假的棋盘格）。
 * - 品红、绿底按键色通道超出量去底并去溢色；其余纯色底从边框泛洪，保住元素内部和底色相近的部分。
 * - 默认按连通块切；元素挨得太近粘成一块、或想保留格子里的留白时，按 `grid` 等分。
 */
export async function sliceSheet(input: {
  readonly bytes: Uint8Array;
  readonly key: SheetKeyMode | 'auto';
  readonly grid?: { readonly columns: number; readonly rows: number };
}): Promise<ImageProcessingOutcome<SheetSlice>> {
  if (input.grid) {
    const { columns, rows } = input.grid;
    if (![columns, rows].every(side => Number.isInteger(side) && side >= 1 && side <= MAX_GRID_SIDE)) {
      return failure('invalid_options', `网格的列数和行数须为 1–${MAX_GRID_SIDE} 的整数`);
    }
  }
  const source = await decode(input.bytes, PROCESSING_MAX_EDGE);
  if (isFailure(source)) return source;
  const { width, height } = source;
  const background = measureSheetBackground(source.data, width, height);
  if (background.deviation > MAX_BACKGROUND_DEVIATION) {
    return failure('background_not_uniform', `边框颜色不一致（偏差 ${background.deviation}），不是纯色底；画出来的棋盘格不是透明，要重新生成纯色底的图`);
  }
  const measured = sheetKeyModeOf(background.color);
  if (input.key !== 'auto' && input.key !== 'flood' && input.key !== measured) {
    return failure('invalid_options', `底色实测是 ${hex(background.color)}，不是${KEY_NAMES[input.key]}`);
  }
  const mode = input.key === 'auto' ? measured : input.key;
  const matte = mode === 'flood'
    ? floodMatte(source.data, width, height, background.color)
    : chromaKeyMatte(source.data, width, height, background.color, mode === 'green');
  const matteImage = { width, height, data: matte.rgba };
  const boxes = input.grid ? gridPieceBoxes(width, height, input.grid.columns, input.grid.rows) : await findBoxes(matteImage);
  // 每块收紧到不透明的范围；网格切时格子里的留白一并去掉，空格子不出
  const filled = boxes.flatMap(box => opaqueBounds(matte.rgba, width, box, 1) ?? []);
  if (filled.length === 0) return failure('no_pieces', '图上没有找到元素');
  if (filled.length > MAX_SHEET_PIECES) {
    return failure('too_many_pieces', `找到 ${filled.length} 块，超过 ${MAX_SHEET_PIECES} 块；元素粘连或底上有杂点时改用按格子切`);
  }
  const pieces: EncodedImage[] = [];
  for (const box of filled) pieces.push(await encode(await toPixels(raw(matteImage).extract(box)), true));
  return ok({ background: background.color, mode, residual: matte.residual, pieces, check: await contactSheet(pieces) });
}
