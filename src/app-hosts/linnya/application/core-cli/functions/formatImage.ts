import { gridRowLabel, type EncodedImage, type ImageCrop } from 'src/domains/image-processing';

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
