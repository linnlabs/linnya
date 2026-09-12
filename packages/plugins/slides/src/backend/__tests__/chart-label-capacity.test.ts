import { init } from 'echarts';
import { describe, expect, it } from 'vitest';
import type { ChartRenderNode } from '@plugin/slides/shared';
import {
  admitDiagnosticFinding,
  classifyDiagnosticPriority,
} from '../engine/quality/definitions';
import { renderModelToLintInfo } from '../engine/quality/renderModelToLintInfo';
import { collectFindings, evaluateQualityAnalysis } from '../tools/inspectFeedback/diagnostics';
import { buildSceneGraph } from '../tools/inspectFeedback/sceneGraph';
import { mapChartNodeToEChartsOption } from '../../renderer/features/konvaPreview/functions/echartsMapper';
import { renderDeck } from './helpers/render-model-mapping-harness';

/** 合成等长类别隔离标签几何，不携带被审计稿的数据或版式。 */
function buildChartCase(
  labelRotation: number | undefined,
  chartType: 'line' | 'bar' = 'line',
  width = 6,
) {
  const categories = Array.from({ length: 24 }, (_, index) =>
    `Sample ${String(index + 1).padStart(2, '0')}`);
  const model = renderDeck({
    title: 'Category label capacity',
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements: [{
          type: 'chart',
          chartType,
          position: { x: 0.5, y: 0.5, w: width, h: 4 },
          categoryAxis: { labelRotation },
          chartStyle: { fontFamily: 'Arial', axisLabelFontSize: 8, legendFontSize: 10 },
          data: {
            categories,
            series: [{ name: 'Samples', values: categories.map((_, index) => index + 1) }],
          },
          options: { showLegend: true, legendPos: 'b', ...(chartType === 'bar' ? { barDir: 'bar' } : {}) },
        }],
      },
    }],
  });
  const node = model.slides[0]?.elements.find(element => element.kind === 'chart');
  if (!node || node.kind !== 'chart') throw new Error('Generated chart is missing');
  const findings = collectFindings(evaluateQualityAnalysis(model), buildSceneGraph(model), []);
  const capacity = findings.find(finding => finding.code === 'chart_label_capacity_exceeded');
  return { model, node, capacity };
}

/** 真实 ECharts 自动间隔输出；不请求图片、DOM 或磁盘，也不代替 Office 像素验收。 */
function visibleCategoryCount(node: ChartRenderNode): number {
  const chart = init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: Math.round(node.box.w * 96),
    height: Math.round(node.box.h * 96),
  });
  try {
    chart.setOption(mapChartNodeToEChartsOption(node));
    const svg = chart.renderToSVGString();
    return node.categories.filter(label => svg.includes(`>${label}</text>`)).length;
  } finally {
    chart.dispose();
  }
}

describe('rotated category label capacity', () => {
  it('从 generated mapper 到严格 finding 区分水平跳标、旋转全量和旋转后仍拥挤', () => {
    for (const rotation of [undefined, 0, 45, -45, 90, -90]) {
      const { model, node, capacity } = buildChartCase(rotation);
      expect(renderModelToLintInfo(model).slides[0]?.elements[0]?.chartInfo?.categoryAxis)
        .toMatchObject({ labelRotationDegrees: rotation ?? 0 });
      if (rotation == null || rotation === 0) {
        expect(visibleCategoryCount(node)).toBeLessThan(node.categories.length);
        expect(capacity).toMatchObject({
          confidence: 'medium',
          evidence: { channel: 'category_axis', direction: 'horizontal', labelRotationDegrees: 0, thresholdRatio: 1.35 },
        });
        if (!capacity) throw new Error('Unrotated capacity finding is missing');
        expect(classifyDiagnosticPriority(capacity)).toBe('P1');
        expect(() => admitDiagnosticFinding({
          ...capacity, evidence: { ...capacity.evidence, labelRotationDegrees: Number.NaN },
        })).toThrow();
      } else {
        expect(visibleCategoryCount(node)).toBe(node.categories.length);
        expect(capacity).toBeUndefined();
      }
    }

    for (const rotation of [45, -45]) {
      const { node, capacity } = buildChartCase(rotation, 'line', 3);
      expect(visibleCategoryCount(node)).toBeLessThan(node.categories.length);
      expect(capacity).toMatchObject({
        confidence: 'medium',
        evidence: { labelRotationDegrees: rotation, thresholdRatio: 1.35 },
      });
      if (!capacity) throw new Error('Narrow rotated capacity finding is missing');
      expect(capacity.evidence.capacityRatio).toBeGreaterThan(capacity.evidence.thresholdRatio);
      expect(classifyDiagnosticPriority(capacity)).toBe('P1');
    }
  });

  it('横向柱的类目轴读取 y 轴角度，旋转至竖排不能仍按单行高度放行', () => {
    const horizontalLabels = buildChartCase(undefined, 'bar');
    expect(horizontalLabels.capacity).toBeUndefined();
    expect(renderModelToLintInfo(horizontalLabels.model).slides[0]?.elements[0]?.chartInfo?.categoryAxis)
      .toMatchObject({ labelRotationDegrees: 0 });
    for (const rotation of [90, -90]) {
      const { model, node, capacity } = buildChartCase(rotation, 'bar');
      expect(node.axes?.y?.labelRotation).toBe(rotation);
      expect(renderModelToLintInfo(model).slides[0]?.elements[0]?.chartInfo?.categoryAxis)
        .toMatchObject({ labelRotationDegrees: rotation });
      expect(visibleCategoryCount(node)).toBeLessThan(node.categories.length);
      expect(capacity).toMatchObject({
        confidence: 'medium',
        evidence: { channel: 'category_axis', direction: 'vertical', labelRotationDegrees: rotation, thresholdRatio: 1.35 },
      });
      if (!capacity) throw new Error('Vertical capacity finding is missing');
      expect(classifyDiagnosticPriority(capacity)).toBe('P1');
    }
  });
});
