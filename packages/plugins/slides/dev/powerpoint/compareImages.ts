import sharp from 'sharp';
import { PLOT_COLOR, SERIES_COLORS, type Rect, type Region } from './definitions';

interface Pixels {
  data: Buffer;
  width: number;
  height: number;
}
interface Band {
  start: number;
  end: number;
  inkStart: number;
  inkEnd: number;
}
interface TextMetrics {
  bands: Band[];
  overflowPixels: number;
}
interface ChartMetrics {
  plot: Rect | null;
  bars: Rect[][];
  legend: Rect[];
  legendText: Rect | null;
}
export interface ImageMetrics {
  text?: TextMetrics;
  chart?: ChartMetrics;
}
export interface RegionComparison {
  preview: ImageMetrics;
  office: ImageMetrics;
  differences: string[];
}
// 960px 画幅下容许边缘抗锯齿造成的 3px 偏移，不做自动对齐或缩放。
const EDGE_TOLERANCE = 3;

async function decode(bytes: Uint8Array): Promise<Pixels> {
  const { data, info } = await sharp(bytes)
    .flatten({ background: '#FFFFFF' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
const isDark = (r: number, g: number, b: number) => r < 110 && g < 110 && b < 110;
function nearColor(hex: string): (r: number, g: number, b: number) => boolean {
  const color = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  return (r, g, b) =>
    Math.abs(r - color[0]) < 24 && Math.abs(g - color[1]) < 24 && Math.abs(b - color[2]) < 24;
}
function points(
  image: Pixels,
  box: Rect,
  predicate: (r: number, g: number, b: number) => boolean
): [number, number][] {
  const result: [number, number][] = [];
  for (
    let y = Math.max(0, Math.floor(box.y));
    y < Math.min(image.height, Math.ceil(box.y + box.h));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(box.x));
      x < Math.min(image.width, Math.ceil(box.x + box.w));
      x++
    ) {
      const offset = (y * image.width + x) * 3;
      if (predicate(image.data[offset], image.data[offset + 1], image.data[offset + 2]))
        result.push([x, y]);
    }
  }
  return result;
}
function bounds(points: readonly [number, number][]): Rect | null {
  if (!points.length) return null;
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
function textMetrics(image: Pixels, region: Region): TextMetrics {
  const ink = points(image, region.probe, isDark);
  const vertical = region.kind === 'vertical';
  const coordinates = [...new Set(ink.map(([x, y]) => (vertical ? x : y)))].sort((a, b) => a - b);
  const ranges: { start: number; end: number }[] = [];
  for (const value of coordinates) {
    const last = ranges[ranges.length - 1];
    if (!last || value - last.end > 4) ranges.push({ start: value, end: value });
    else last.end = value;
  }
  const bands = ranges.map(range => {
    const inline = ink
      .filter(([x, y]) => (vertical ? x : y) >= range.start && (vertical ? x : y) <= range.end)
      .map(([x, y]) => (vertical ? y : x));
    return { ...range, inkStart: Math.min(...inline), inkEnd: Math.max(...inline) };
  });
  if (vertical) bands.reverse();
  const box = region.box;
  return {
    bands,
    overflowPixels: ink.filter(
      ([x, y]) =>
        x < box.x - EDGE_TOLERANCE ||
        x >= box.x + box.w + EDGE_TOLERANCE ||
        y < box.y - EDGE_TOLERANCE ||
        y >= box.y + box.h + EDGE_TOLERANCE
    ).length,
  };
}

/** 系列纯色连通块，避开字体抗锯齿；保留每根柱的矩形，不能用总面积掩盖宽度漂移。 */
function components(image: Pixels, box: Rect, color: string): Rect[] {
  const pending = new Set(
    points(image, box, nearColor(color)).map(([x, y]) => y * image.width + x)
  );
  const result: Rect[] = [];
  while (pending.size) {
    const first = pending.values().next().value;
    if (first === undefined) break;
    const queue = [first];
    pending.delete(first);
    const pixels: [number, number][] = [];
    for (let index = 0; index < queue.length; index++) {
      const pixel = queue[index];
      const x = pixel % image.width,
        y = Math.floor(pixel / image.width);
      pixels.push([x, y]);
      for (const neighbor of [
        pixel - image.width,
        pixel + image.width,
        ...(x > 0 ? [pixel - 1] : []),
        ...(x + 1 < image.width ? [pixel + 1] : []),
      ]) {
        if (pending.delete(neighbor)) queue.push(neighbor);
      }
    }
    const rect = bounds(pixels);
    if (rect && pixels.length >= 12) result.push(rect);
  }
  return result.sort((a, b) => a.x - b.x || a.y - b.y);
}
function chartMetrics(image: Pixels, region: Region): ChartMetrics {
  const plot = bounds(points(image, region.box, nearColor(PLOT_COLOR)));
  const bottom = plot ? plot.y + plot.h : region.box.y + region.box.h;
  const series = SERIES_COLORS.map(color => components(image, region.box, color));
  const legend = series.flatMap(rects => rects.filter(rect => rect.y >= bottom));
  const legendBox = {
    x: region.box.x,
    y: bottom,
    w: region.box.w,
    h: Math.max(0, region.box.y + region.box.h - bottom),
  };
  return {
    plot,
    bars: series.map(rects => rects.filter(rect => rect.y < bottom && rect.h >= 8)),
    legend,
    legendText: bounds(points(image, legendBox, isDark)),
  };
}
const far = (a: number, b: number) => Math.abs(a - b) > EDGE_TOLERANCE;
function rectDiff(a: Rect | null, b: Rect | null): boolean {
  return !a || !b ? a !== b : far(a.x, b.x) || far(a.y, b.y) || far(a.w, b.w) || far(a.h, b.h);
}
export async function compareRegionImages(
  previewBytes: Uint8Array,
  officeBytes: Uint8Array,
  region: Region
): Promise<RegionComparison> {
  const [a, b] = await Promise.all([decode(previewBytes), decode(officeBytes)]);
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`Image dimensions differ: ${a.width}x${a.height} / ${b.width}x${b.height}`);
  const differences: string[] = [];
  if (region.kind === 'chart') {
    const preview = chartMetrics(a, region),
      office = chartMetrics(b, region);
    if (
      !preview.plot ||
      !office.plot ||
      preview.bars.some(bars => bars.length === 0) ||
      office.bars.some(bars => bars.length === 0)
    )
      differences.push('missing-chart');
    if (rectDiff(preview.plot, office.plot)) differences.push('plot-area');
    if (
      preview.bars.some(
        (bars, i) =>
          bars.length !== office.bars[i].length ||
          bars.some((bar, j) => far(bar.w, office.bars[i][j].w))
      )
    )
      differences.push('bar-width');
    if (
      preview.bars.some(
        (bars, i) =>
          bars.length !== office.bars[i].length ||
          bars.some((bar, j) => rectDiff(bar, office.bars[i][j]))
      )
    )
      differences.push('bar-geometry');
    if (
      preview.legend.length !== office.legend.length ||
      preview.legend.some((rect, i) => rectDiff(rect, office.legend[i])) ||
      rectDiff(preview.legendText, office.legendText)
    )
      differences.push('legend');
    return { preview: { chart: preview }, office: { chart: office }, differences };
  }
  const preview = textMetrics(a, region),
    office = textMetrics(b, region);
  if (!preview.bands.length || !office.bands.length) differences.push('missing-text');
  if (preview.bands.length !== office.bands.length) differences.push('line-count');
  if (
    preview.bands.some(
      (band, i) =>
        office.bands[i] &&
        (far(band.inkStart, office.bands[i].inkStart) || far(band.inkEnd, office.bands[i].inkEnd))
    )
  )
    differences.push('line-break');
  if (
    preview.bands.some(
      (band, i) =>
        i > 0 &&
        office.bands[i] &&
        far(
          band.start - preview.bands[i - 1].start,
          office.bands[i].start - office.bands[i - 1].start
        )
    )
  )
    differences.push('line-spacing');
  if (preview.overflowPixels > 0 || office.overflowPixels > 0) differences.push('overflow');
  return { preview: { text: preview }, office: { text: office }, differences };
}
