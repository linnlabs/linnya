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
  segmentation: 'resolved' | 'indeterminate';
  reasons: string[];
  inkBounds: Rect | null;
}
interface ChartMetrics {
  plot: Rect | null;
  bars: Rect[][];
  series: Rect[][];
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
  indeterminate: string[];
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
function textMetrics(image: Pixels, region: Region, source: 'preview' | 'office'): TextMetrics {
  const ink = points(image, region.probe, isDark);
  const vertical = region.kind === 'vertical';
  const coordinates = [...new Set(ink.map(([x, y]) => (vertical ? x : y)))].sort((a, b) => a - b);
  const ranges: { start: number; end: number }[] = [];
  for (const value of coordinates) {
    const last = ranges[ranges.length - 1];
    // 完整空白行就是可观察的分隔，不能跨过小字号文字仅有的两三行间隙。
    if (!last || value - last.end > 1) ranges.push({ start: value, end: value });
    else last.end = value;
  }
  const reasons: string[] = [];
  const sizes = ranges.map(range => range.end - range.start + 1).sort((a, b) => a - b);
  const typical = sizes[Math.floor(sizes.length / 2)] ?? 0;
  const detached = new Set<number>();
  // 竖排标点会在正文列外留下窄带；只吸附到唯一、足够近的完整列，不合并两条正文带。
  for (const [index, range] of ranges.entries()) {
    if (range.end - range.start + 1 >= typical / 2) continue;
    const neighbors = ranges
      .flatMap((candidate, target) => {
        if (target === index || candidate.end - candidate.start + 1 < typical / 2) return [];
        return [
          { target, distance: Math.max(candidate.start - range.end, range.start - candidate.end) },
        ];
      })
      .sort((a, b) => a.distance - b.distance);
    const nearest = neighbors[0];
    if (!nearest || nearest.distance > typical / 2 || nearest.distance === neighbors[1]?.distance) {
      reasons.push('detached-ink');
      continue;
    }
    const target = ranges[nearest.target];
    target.start = Math.min(target.start, range.start);
    target.end = Math.max(target.end, range.end);
    detached.add(index);
  }
  const bands = ranges
    .filter((_, index) => !detached.has(index))
    .map(range => {
      const inline = ink
        .filter(([x, y]) => (vertical ? x : y) >= range.start && (vertical ? x : y) <= range.end)
        .map(([x, y]) => (vertical ? y : x));
      return { ...range, inkStart: Math.min(...inline), inkEnd: Math.max(...inline) };
    });
  if (vertical) bands.reverse();
  const expected = region.previewLines?.length;
  // 作者排版事实只用于发现预览测量失真，不用它强行把 Office 切成相同行数。
  if (
    expected &&
    ((source === 'preview' && bands.length !== expected) || (expected > 1 && bands.length === 1))
  )
    reasons.push('merged-or-fragmented-ink');
  const inkBounds = bounds(ink);
  if (
    inkBounds &&
    (inkBounds.x <= Math.floor(region.probe.x) ||
      inkBounds.y <= Math.floor(region.probe.y) ||
      inkBounds.x + inkBounds.w >= Math.ceil(region.probe.x + region.probe.w) ||
      inkBounds.y + inkBounds.h >= Math.ceil(region.probe.y + region.probe.h))
  )
    reasons.push('probe-clipped');
  const box = region.box;
  return {
    bands,
    inkBounds,
    segmentation: reasons.length ? 'indeterminate' : 'resolved',
    reasons,
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
  const [red, green, blue] = [1, 3, 5].map(start =>
    parseInt(PLOT_COLOR.slice(start, start + 2), 16)
  );
  // 无损 PNG 样稿的专色内区必须精确匹配；宽松匹配会把刻度和图例的浅色抗锯齿也算成底色。
  // 此处测内区，不把坐标轴边框算入绘图区；两端沿用同一个 3px 几何比较标准。
  const plot = bounds(
    points(image, region.box, (r, g, b) => r === red && g === green && b === blue)
  );
  const series = SERIES_COLORS.map(color => (plot ? components(image, plot, color) : []));
  const position = region.chart?.legendPosition ?? 'bottom';
  const type = region.chart?.type ?? 'column'; // 首版 manifest 只有底部图例的纵向柱图。
  const intersects = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const legendArea: Rect | null =
    !plot || position === 'none'
      ? null
      : position === 'bottom'
        ? {
            x: region.box.x,
            y: plot.y + plot.h,
            w: region.box.w,
            h: region.box.y + region.box.h - plot.y - plot.h,
          }
        : position === 'top'
          ? { x: region.box.x, y: region.box.y, w: region.box.w, h: plot.y - region.box.y }
          : position === 'right'
            ? {
                x: plot.x + plot.w,
                y: region.box.y,
                w: region.box.x + region.box.w - plot.x - plot.w,
                h: region.box.h,
              }
            : { x: region.box.x, y: region.box.y, w: plot.x - region.box.x, h: region.box.h };
  // 先识别完整色块再排除与绘图区相交的对象，避免把柱底的一像素残边当作图例。
  const legend =
    plot && legendArea
      ? SERIES_COLORS.flatMap(color =>
          components(image, region.box, color).filter(
            rect => !intersects(rect, plot) && intersects(rect, legendArea)
          )
        )
      : [];
  const markers = bounds(
    legend.flatMap(
      rect =>
        [
          [rect.x, rect.y],
          [rect.x + rect.w - 1, rect.y + rect.h - 1],
        ] satisfies [number, number][]
    )
  );
  let legendText: Rect | null = null;
  if (markers && legendArea) {
    const horizontal = position === 'top' || position === 'bottom';
    const padding = Math.max(...legend.map(rect => rect.h));
    const left = horizontal ? legendArea.x : Math.max(legendArea.x, markers.x);
    const top = Math.max(legendArea.y, markers.y - padding);
    const right = legendArea.x + legendArea.w;
    const bottom = Math.min(legendArea.y + legendArea.h, markers.y + markers.h + padding);
    legendText = bounds(
      points(image, { x: left, y: top, w: right - left, h: bottom - top }, isDark)
    );
  }
  return {
    plot,
    bars: type === 'column' || type === 'bar' ? series : [],
    series,
    legend,
    legendText,
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
  const indeterminate: string[] = [];
  if (region.kind === 'chart') {
    const preview = chartMetrics(a, region),
      office = chartMetrics(b, region);
    if (
      !preview.plot ||
      !office.plot ||
      preview.series.some(series => series.length === 0) ||
      office.series.some(series => series.length === 0)
    )
      differences.push('missing-chart');
    if (rectDiff(preview.plot, office.plot)) differences.push('plot-area');
    if (
      preview.bars.some(
        (bars, i) =>
          bars.length !== office.bars[i].length ||
          bars.some((bar, j) =>
            region.chart?.type === 'bar'
              ? far(bar.h, office.bars[i][j].h)
              : far(bar.w, office.bars[i][j].w)
          )
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
      !preview.bars.length &&
      preview.series.some(
        (series, index) =>
          series.length !== office.series[index].length ||
          series.some((rect, j) => rectDiff(rect, office.series[index][j]))
      )
    )
      differences.push('series-geometry');
    if (
      region.chart?.legendPosition !== 'none' &&
      (preview.legend.length !== SERIES_COLORS.length ||
        office.legend.length !== SERIES_COLORS.length ||
        !preview.legendText ||
        !office.legendText)
    )
      differences.push('missing-legend');
    if (
      preview.legend.length !== office.legend.length ||
      preview.legend.some((rect, i) => rectDiff(rect, office.legend[i])) ||
      rectDiff(preview.legendText, office.legendText)
    )
      differences.push('legend');
    return { preview: { chart: preview }, office: { chart: office }, differences, indeterminate };
  }
  const preview = textMetrics(a, region, 'preview'),
    office = textMetrics(b, region, 'office');
  if (!preview.bands.length || !office.bands.length) differences.push('missing-text');
  const resolved = preview.segmentation === 'resolved' && office.segmentation === 'resolved';
  if (!resolved) indeterminate.push('line-segmentation');
  if (
    preview.inkBounds &&
    office.inkBounds &&
    (region.kind === 'vertical'
      ? far(preview.bands[0].start, office.bands[0].start)
      : far(preview.inkBounds.y, office.inkBounds.y))
  )
    differences.push('text-position');
  if (resolved && preview.bands.length !== office.bands.length) differences.push('line-count');
  if (
    resolved &&
    preview.bands.some(
      (band, i) =>
        office.bands[i] &&
        (far(band.inkStart, office.bands[i].inkStart) || far(band.inkEnd, office.bands[i].inkEnd))
    )
  ) {
    differences.push('line-extent');
    indeterminate.push('word-breaks');
  }
  if (
    resolved &&
    preview.bands.length === office.bands.length &&
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
  return { preview: { text: preview }, office: { text: office }, differences, indeterminate };
}
