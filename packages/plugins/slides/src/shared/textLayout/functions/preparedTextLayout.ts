import type { TextRenderNode } from '../../renderModel';
import type { PreparedTextLayout } from '../definitions/preparedTextLayout';
import type { FontMetricsProvider, RunAdvanceProvider, RunMeasureStyle } from '../definitions/types';
import { shapeTextMeasurementVariants } from './shapeTextResizeInput';
import { layoutParagraph } from './layoutParagraph';
import { resolveTextLayoutContractFromNode } from './resolveTextLayoutContract';
import { layoutTextNode, resolveTextLayoutFontScaleCandidates } from '../orchestration/layoutTextNode';

/** 预先覆盖每个字号档位；宽度变化只影响断行，不能在拖拽时访问平台字体服务。 */
export function prepareTextLayout(
  node: TextRenderNode,
  sourceKind: PreparedTextLayout['sourceKind'],
  defaultFontFamily: string,
  provider: RunAdvanceProvider,
  fontMetricsProvider: FontMetricsProvider,
): PreparedTextLayout {
  const keys: string[] = [];
  const keyIndexes = new Map<string, number>();
  const widths: number[] = [];
  const widthIndexes = new Map<number, number>();
  const advances = new Map<string, PreparedTextLayout['advances'][number]>();
  const metrics = new Map<string, PreparedTextLayout['metrics'][number]>();
  function internKey(key: string): number {
    const existing = keyIndexes.get(key);
    if (existing !== undefined) return existing;
    const index = keys.length;
    keys.push(key);
    keyIndexes.set(key, index);
    return index;
  }
  function internWidth(width: number): number {
    const existing = widthIndexes.get(width);
    if (existing !== undefined) return existing;
    const index = widths.length;
    widths.push(width);
    widthIndexes.set(width, index);
    return index;
  }
  const recordingAdvances: RunAdvanceProvider = {
    getClusterAdvances(clusters, style) {
      const baseKey = advanceKey(clusters, style);
      const key = measurementKey(baseKey, style.fontSizePt);
      const existing = advances.get(key);
      if (existing) return { advances: existing.widthIndexes.map(index => widths[index]!), source: existing.source };
      const measured = provider.getClusterAdvances(clusters, style);
      // 完整 shaping 序列保留位置相关 kerning；字宽用无损字典编码，避免跨字号重复 JSON 浮点和正文。
      advances.set(key, { key: internKey(baseKey), fontSizePt: style.fontSizePt,
        widthIndexes: measured.advances.map(internWidth), source: measured.source });
      return measured;
    },
  };
  const recordingMetrics: FontMetricsProvider = {
    getMetrics(style) {
      const baseKey = styleKey(style);
      const key = measurementKey(baseKey, style.fontSizePt);
      const existing = metrics.get(key);
      if (existing) return existing.value ?? undefined;
      const value = fontMetricsProvider.getMetrics(style);
      metrics.set(key, { key: internKey(baseKey), fontSizePt: style.fontSizePt, value: value ?? null });
      return value;
    },
  };
  const contract = resolveTextLayoutContractFromNode(node, { sourceKind, profile: 'shape-inner-text' });
  for (const variant of shapeTextMeasurementVariants(node)) {
    for (const fontScale of resolveTextLayoutFontScaleCandidates(contract.autoFitPolicy, contract.profile)) {
      variant.paragraphs.forEach((paragraph, paragraphIndex) => {
        // 无约束宽度让每个 run 的字体 metrics 都被记录，包含空行和 bullet 的正式规则。
        layoutParagraph({ paragraph, paragraphIndex, usableWidthInches: Number.MAX_SAFE_INTEGER,
          wrap: contract.wrap, provider: recordingAdvances, fontMetricsProvider: recordingMetrics,
          startY: 0, fontScale, defaultFontFamily });
      });
    }
  }
  return { sourceKind, defaultFontFamily, keys, widths, advances: [...advances.values()], metrics: [...metrics.values()] };
}

const providers = new WeakMap<PreparedTextLayout, { advances: RunAdvanceProvider; metrics: FontMetricsProvider }>();

/** 只用后端测量事实运行同一排版器；缺失事实是合同错误，禁止换成 Canvas 近似测量。 */
export function layoutPreparedText(node: TextRenderNode, prepared: PreparedTextLayout) {
  let cached = providers.get(prepared);
  if (!cached) {
    const advances = new Map(prepared.advances.map(entry => [measurementKey(prepared.keys[entry.key]!, entry.fontSizePt), {
      source: entry.source, widths: entry.widthIndexes.map(index => prepared.widths[index]!),
    }]));
    const metrics = new Map(prepared.metrics.map(entry => [measurementKey(prepared.keys[entry.key]!, entry.fontSizePt), entry.value]));
    cached = {
      advances: { getClusterAdvances(clusters, style) {
        const entry = advances.get(measurementKey(advanceKey(clusters, style), style.fontSizePt));
        if (!entry) throw new Error('Missing prepared text advances.');
        return { source: entry.source, advances: entry.widths };
      } },
      metrics: { getMetrics(style) {
        const key = measurementKey(styleKey(style), style.fontSizePt);
        if (!metrics.has(key)) throw new Error('Missing prepared font metrics.');
        return metrics.get(key) ?? undefined;
      } },
    };
    providers.set(prepared, cached);
  }
  return layoutTextNode({ paragraphs: node.paragraphs, defaultFontFamily: prepared.defaultFontFamily,
    contract: resolveTextLayoutContractFromNode(node, { sourceKind: prepared.sourceKind, profile: 'shape-inner-text' }),
  }, cached.advances, cached.metrics);
}

function styleKey(style: RunMeasureStyle): string {
  return JSON.stringify([style.fontFamily, style.bold, style.italic,
    style.text, style.letterSpacingPt, style.script]);
}

function advanceKey(clusters: readonly string[], style: RunMeasureStyle): string {
  return JSON.stringify([styleKey(style), clusters]);
}

function measurementKey(key: string, fontSizePt: number): string {
  return JSON.stringify([fontSizePt, key]);
}
