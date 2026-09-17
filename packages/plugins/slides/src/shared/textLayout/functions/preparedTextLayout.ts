import { projectFontUnitAdvances, type FontUnitAdvances } from '@linnya/text-measurement-core';
import type { TextRenderNode } from '../../renderModel';
import type { PreparedTextLayout } from '../definitions/preparedTextLayout';
import type { FontLineMetrics, FontMetricsProvider, RunAdvanceProvider, RunMeasureStyle } from '../definitions/types';
import { shapeTextMeasurementVariants } from './shapeTextResizeInput';
import { layoutParagraph } from './layoutParagraph';
import { resolveTextLayoutContractFromNode } from './resolveTextLayoutContract';
import { layoutTextNode, resolveTextLayoutFontScaleCandidates } from '../orchestration/layoutTextNode';

/** 字体事实与当前修订绑定；HarfBuzz 原始单位覆盖任意字号，不枚举工具栏的字号范围。 */
export function prepareTextLayout(
  node: TextRenderNode,
  sourceKind: PreparedTextLayout['sourceKind'],
  defaultFontFamily: string,
  provider: RunAdvanceProvider,
  fontMetricsProvider: FontMetricsProvider,
  profile: PreparedTextLayout['profile'] = 'shape-inner-text',
): PreparedTextLayout {
  const keys: string[] = [];
  const keyIndexes = new Map<string, number>();
  const widths: number[] = [];
  const widthIndexes = new Map<number, number>();
  const advances = new Map<string, PreparedTextLayout['advances'][number]>();
  const metrics = new Map<string, PreparedTextLayout['metrics'][number]>();
  const fontUnits = new Map<string, PreparedTextLayout['fontUnits'][number]>();
  const metricsInEm = new Map<string, PreparedTextLayout['metricsInEm'][number]>();
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
      const scalableKey = advanceKey(clusters, style, true);
      const scalable = fontUnits.get(scalableKey);
      if (scalable) return projectAdvances(scalable.value, style, scalable.source);
      const baseKey = advanceKey(clusters, style);
      const key = measurementKey(baseKey, style.fontSizePt);
      const existing = advances.get(key);
      if (existing) return { advances: existing.widthIndexes.map(index => widths[index]!), source: existing.source };
      const measured = provider.getClusterAdvances(clusters, style);
      if (measured.fontUnits) {
        fontUnits.set(scalableKey, { key: internKey(scalableKey), value: measured.fontUnits, source: measured.source });
      } else {
        // 非线性 provider 只保存实际测量值，不能把已舍入宽度冒充可缩放的字体单位。
        advances.set(key, { key: internKey(baseKey), fontSizePt: style.fontSizePt,
          widthIndexes: measured.advances.map(internWidth), source: measured.source });
      }
      return measured;
    },
  };
  const recordingMetrics: FontMetricsProvider = {
    getMetrics(style) {
      const scalableKey = styleKey(style, true);
      if (fontMetricsProvider.getMetricsInEm) {
        let entry = metricsInEm.get(scalableKey);
        if (!entry) {
          entry = { key: internKey(scalableKey), value: fontMetricsProvider.getMetricsInEm(style) ?? null };
          metricsInEm.set(scalableKey, entry);
        }
        return projectMetrics(entry.value, style.fontSizePt);
      }
      const baseKey = styleKey(style);
      const key = measurementKey(baseKey, style.fontSizePt);
      const existing = metrics.get(key);
      if (existing) return existing.value ?? undefined;
      const value = fontMetricsProvider.getMetrics(style);
      metrics.set(key, { key: internKey(baseKey), fontSizePt: style.fontSizePt, value: value ?? null });
      return value;
    },
  };
  const contract = resolveTextLayoutContractFromNode(node, { sourceKind, profile });
  preparation: for (const variant of profile === 'shape-inner-text' ? shapeTextMeasurementVariants(node) : [node]) {
    for (const fontScale of resolveTextLayoutFontScaleCandidates(contract.autoFitPolicy, contract.profile)) {
      variant.paragraphs.forEach((paragraph, paragraphIndex) => {
        // 无约束宽度记录完整 shaping 序列和每个 run 的 metrics，包含空行与 bullet。
        layoutParagraph({ paragraph, paragraphIndex, usableWidthInches: Number.MAX_SAFE_INTEGER,
          wrap: contract.wrap, provider: recordingAdvances, fontMetricsProvider: recordingMetrics,
          startY: 0, fontScale, defaultFontFamily });
      });
      if (advances.size === 0 && metrics.size === 0) break preparation;
    }
  }
  return { sourceKind, defaultFontFamily, profile, inputBox: { ...node.box }, keys, widths,
    advances: [...advances.values()], metrics: [...metrics.values()],
    fontUnits: [...fontUnits.values()], metricsInEm: [...metricsInEm.values()] };
}

const providers = new WeakMap<PreparedTextLayout, { advances: RunAdvanceProvider; metrics: FontMetricsProvider }>();

/** 缺失事实意味着当前操作需要正式排版；调用者不得发布一半更新的节点。 */
export class PreparedTextMeasurementUnavailable extends Error {}

export function layoutPreparedText(node: TextRenderNode, prepared: PreparedTextLayout) {
  let cached = providers.get(prepared);
  if (!cached) {
    const advances = new Map(prepared.advances.map(entry => [measurementKey(prepared.keys[entry.key]!, entry.fontSizePt), {
      source: entry.source, widths: entry.widthIndexes.map(index => prepared.widths[index]!),
    }]));
    const metrics = new Map(prepared.metrics.map(entry => [measurementKey(prepared.keys[entry.key]!, entry.fontSizePt), entry.value]));
    const fontUnits = new Map(prepared.fontUnits.map(entry => [prepared.keys[entry.key]!, entry]));
    const metricsInEm = new Map(prepared.metricsInEm.map(entry => [prepared.keys[entry.key]!, entry.value]));
    cached = {
      advances: { getClusterAdvances(clusters, style) {
        const scalable = fontUnits.get(advanceKey(clusters, style, true));
        if (scalable) return projectAdvances(scalable.value, style, scalable.source);
        const entry = advances.get(measurementKey(advanceKey(clusters, style), style.fontSizePt));
        if (!entry) throw new PreparedTextMeasurementUnavailable('Missing prepared text advances.');
        return { source: entry.source, advances: entry.widths };
      } },
      metrics: { getMetrics(style) {
        const scalableKey = styleKey(style, true);
        if (metricsInEm.has(scalableKey)) return projectMetrics(metricsInEm.get(scalableKey)!, style.fontSizePt);
        const key = measurementKey(styleKey(style), style.fontSizePt);
        if (!metrics.has(key)) throw new PreparedTextMeasurementUnavailable('Missing prepared font metrics.');
        return metrics.get(key) ?? undefined;
      } },
    };
    providers.set(prepared, cached);
  }
  return layoutTextNode({ paragraphs: node.paragraphs, defaultFontFamily: prepared.defaultFontFamily,
    contract: resolveTextLayoutContractFromNode(node, { sourceKind: prepared.sourceKind, profile: prepared.profile }),
  }, cached.advances, cached.metrics);
}

function projectAdvances(value: FontUnitAdvances, style: RunMeasureStyle, source: PreparedTextLayout['fontUnits'][number]['source']) {
  return { source, advances: projectFontUnitAdvances(value, style.fontSizePt, style.letterSpacingPt) };
}

function projectMetrics(value: FontLineMetrics | null, fontSizePt: number): FontLineMetrics | undefined {
  const scale = fontSizePt / 72;
  return value ? { ascent: value.ascent * scale, descent: value.descent * scale, lineGap: value.lineGap * scale } : undefined;
}

function styleKey(style: RunMeasureStyle, scalable = false): string {
  return JSON.stringify([style.fontFamily, style.bold, style.italic,
    style.text, scalable ? null : style.letterSpacingPt, style.script]);
}

function advanceKey(clusters: readonly string[], style: RunMeasureStyle, scalable = false): string {
  return JSON.stringify([styleKey(style, scalable), clusters]);
}

function measurementKey(key: string, fontSizePt: number): string {
  return JSON.stringify([fontSizePt, key]);
}
