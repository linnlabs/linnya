import { afterEach, describe, expect, it, beforeAll } from 'vitest';
import {
  configureDefaultTextMeasureService,
  resetDefaultTextMeasureServiceForTests,
  type NormalizedTextMeasureInput,
  type TextMeasureAdapter,
} from 'src/features/text-measurement';
import { compileFlexInput, compileSlide } from '../FlexLayoutCompiler.js';
import { initYoga } from '../YogaAdapter.js';
import { isFlexComposeInput } from '../LayoutTypes.js';
import type {
  FlexComposeInput,
  LayoutSlideNode,
  LayoutViewNode,
  LayoutTextNode,
  LayoutShapeNode,
  LayoutChartNode,
  LayoutTableNode,
  LayoutSpacerNode,
  LayoutImageNode,
} from '../LayoutTypes.js';

// ─── 辅助：构造布局节点（模拟场景图 DSL 的输出） ──────────────────────

function makeSlide(children: LayoutSlideNode['children'], extra?: Partial<LayoutSlideNode>): LayoutSlideNode {
  return { _type: 'Slide', children, ...extra };
}
function makeView(children: LayoutViewNode['children'], extra?: Partial<LayoutViewNode>): LayoutViewNode {
  return { _type: 'View', children, ...extra } as LayoutViewNode;
}
function makeText(content: string, extra?: Partial<LayoutTextNode>): LayoutTextNode {
  return { _type: 'Text', content, ...extra };
}
function makeShape(extra?: Partial<LayoutShapeNode>): LayoutShapeNode {
  return { _type: 'Shape', ...extra } as LayoutShapeNode;
}
function makeImage(src: LayoutImageNode['src'], extra?: Partial<Omit<LayoutImageNode, '_type' | 'src'>>): LayoutImageNode {
  return { _type: 'Image', src, ...extra };
}
function makeSpacer(extra?: Partial<LayoutSpacerNode>): LayoutSpacerNode {
  return { _type: 'Spacer', ...extra } as LayoutSpacerNode;
}

// ─── 画布常量 ────────────────────────────────────────────────────────────

const SLIDE_W = 10;
const SLIDE_H = 5.625;

class RecordingTextMeasureAdapter implements TextMeasureAdapter {
  readonly kind = 'recording-flex-layout';
  readonly inputs: NormalizedTextMeasureInput[] = [];

  measure(input: NormalizedTextMeasureInput) {
    this.inputs.push(input);
    return {
      lineCount: 1,
      contentHeightInches: 0.2,
      totalHeightInches: 0.2,
      maxLineWidthInches: input.box.usableWidthInches,
      usedFallback: false,
      warnings: [],
      fitsWidth: true,
      fitsHeight: true,
    };
  }
}

function approxBox(el: { position: { x: number; y: number; w: number; h: number } }, x: number, y: number, w: number, h: number) {
  expect(el.position.x).toBeCloseTo(x, 1);
  expect(el.position.y).toBeCloseTo(y, 1);
  expect(el.position.w).toBeCloseTo(w, 1);
  expect(el.position.h).toBeCloseTo(h, 1);
}

// ─── 测试 ────────────────────────────────────────────────────────────────

describe('FlexLayoutCompiler', () => {

  beforeAll(async () => {
    await initYoga();
  });

  afterEach(() => {
    resetDefaultTextMeasureServiceForTests();
  });

  describe('基本 column flex 分配（Slide 默认 column）', () => {
    it('两个等权重子节点平分高度', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: '#AAA' }),
        makeShape({ flex: 1, fill: '#BBB' }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H / 2);
      approxBox(result.elements[1], 0, SLIDE_H / 2, SLIDE_W, SLIDE_H / 2);
    });

    it('flex 权重 1:3 分配', () => {
      const slide = makeSlide([
        makeShape({ flex: 1 }),
        makeShape({ flex: 3 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H * 0.25);
      approxBox(result.elements[1], 0, SLIDE_H * 0.25, SLIDE_W, SLIDE_H * 0.75);
    });
  });

  describe('View flexDirection: row 分配', () => {
    it('三等分水平布局', () => {
      const slide = makeSlide([
        makeView([
          makeShape({ flex: 1 }),
          makeShape({ flex: 1 }),
          makeShape({ flex: 1 }),
        ], { flex: 1, flexDirection: 'row' }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(3);
      const thirdW = SLIDE_W / 3;
      approxBox(result.elements[0], 0, 0, thirdW, SLIDE_H);
      approxBox(result.elements[1], thirdW, 0, thirdW, SLIDE_H);
      approxBox(result.elements[2], thirdW * 2, 0, thirdW, SLIDE_H);
    });

    it('保留数值声明、Yoga 最终尺寸和父容器身份，不复制布局节点', () => {
      const slide = makeSlide([
        makeView([
          makeShape({ width: 8, height: 1 }),
          makeShape({ width: 8, height: 1 }),
        ], { flexDirection: 'row' }),
      ]);

      const result = compileSlide(slide, SLIDE_W, SLIDE_H, 3);
      const evidence = result.elements[0]?._layoutConstraintEvidence;

      expect(evidence).toEqual({
        layoutNodeId: 'layout:s3:root.0.0',
        positionMode: 'flow',
        declared: { widthInches: 8, heightInches: 1 },
        finalBox: { x: 0, y: 0, w: 5, h: 1, unit: 'in' },
        computedRatios: { widthToDeclared: 0.625, heightToDeclared: 1 },
        parent: {
          nodeId: 'layout:s3:root.0',
          kind: 'layout_container',
          label: 'View',
          finalBox: { x: 0, y: 0, w: 10, h: 1, unit: 'in' },
          zIndex: -1,
          parentNodeId: 'layout:s3:root',
        },
        parentConstraint: {
          positionMode: 'flow',
          declared: {},
          computedRatios: {},
          parent: {
            nodeId: 'layout:s3:root',
            kind: 'slide',
            label: 'Slide',
            finalBox: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
            zIndex: -1,
          },
        },
        clipSemantics: 'visible',
      });
      expect(evidence).not.toHaveProperty('node');
      expect(evidence).not.toHaveProperty('style');
      expect(evidence).not.toHaveProperty('children');
    });
  });

  describe('View 默认 flexDirection: column', () => {
    it('不指定 flexDirection 时默认垂直布局', () => {
      const slide = makeSlide([
        makeView([
          makeShape({ flex: 1 }),
          makeShape({ flex: 1 }),
        ], { flex: 1 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H / 2);
      approxBox(result.elements[1], 0, SLIDE_H / 2, SLIDE_W, SLIDE_H / 2);
    });
  });

  describe('gap', () => {
    it('row View gap 正确影响子元素位置', () => {
      const gap = 0.3;
      const slide = makeSlide([
        makeView([
          makeShape({ flex: 1 }),
          makeShape({ flex: 1 }),
        ], { flex: 1, flexDirection: 'row', gap }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      const childW = (SLIDE_W - gap) / 2;
      approxBox(result.elements[0], 0, 0, childW, SLIDE_H);
      approxBox(result.elements[1], childW + gap, 0, childW, SLIDE_H);
    });
  });

  describe('padding', () => {
    it('View padding 缩减可用区域', () => {
      const pad = 0.5;
      const slide = makeSlide([
        makeView([
          makeShape({ flex: 1 }),
        ], { flex: 1, padding: pad }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(1);
      approxBox(result.elements[0], pad, pad, SLIDE_W - 2 * pad, SLIDE_H - 2 * pad);
    });
  });

  describe('百分比 width/height', () => {
    it('width: "60%" 正确解析', () => {
      const slide = makeSlide([
        makeView([
          makeShape({ width: '60%', flex: undefined }),
          makeShape({ flex: 1 }),
        ], { flex: 1, flexDirection: 'row' }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      expect(result.elements[0].position.w).toBeCloseTo(6, 1);
    });
  });

  describe('position: absolute', () => {
    it('absolute 子节点脱离文档流', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: '#AAA' }),
        makeShape({
          position: 'absolute',
          top: 0.1,
          left: 0.2,
          width: 2,
          height: 0.5,
          fill: '#FF0000',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H);
      approxBox(result.elements[1], 0.2, 0.1, 2, 0.5);
    });

    it('x/y 是 left/top 的别名', () => {
      const slide = makeSlide([
        makeShape({
          position: 'absolute',
          x: 0.6,
          y: 0.15,
          width: 8.8,
          height: 0.45,
          fill: '#1E40AF',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      approxBox(result.elements[0], 0.6, 0.15, 8.8, 0.45);
    });

    it('position 兼容 PPTX/Canvas 风格的完整坐标盒', () => {
      const slide = makeSlide([
        makeShape({
          position: { x: 0.7, y: 0.25, w: 3.4, h: 0.8 },
          fill: '#16A34A',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      approxBox(result.elements[0], 0.7, 0.25, 3.4, 0.8);
    });

    it('left/top 优先于 x/y', () => {
      const slide = makeSlide([
        makeShape({
          position: 'absolute',
          left: 1.0,
          top: 2.0,
          x: 0.5,
          y: 0.5,
          width: 3,
          height: 1,
          fill: '#000',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      // left/top 优先
      approxBox(result.elements[0], 1.0, 2.0, 3, 1);
    });

    it('散字段优先于 position 坐标盒，便于局部覆盖', () => {
      const slide = makeSlide([
        makeShape({
          position: { x: 0.7, y: 0.25, w: 3.4, h: 0.8 },
          x: 1.2,
          y: 0.5,
          width: 4.1,
          height: 1.1,
          fill: '#000',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      approxBox(result.elements[0], 1.2, 0.5, 4.1, 1.1);
    });

    it('未显式声明 position 时，x/y 会隐式触发 absolute 定位', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: '#AAA' }),
        makeShape({
          x: 0.6,
          y: 0.15,
          width: 2.2,
          height: 0.45,
          fill: '#1E40AF',
        } as LayoutShapeNode),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H);
      approxBox(result.elements[1], 0.6, 0.15, 2.2, 0.45);
    });

    it('未显式声明 position 时，left/top 也会隐式触发 absolute 定位', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: '#DDD' }),
        makeShape({
          left: 1.25,
          top: 0.4,
          width: 3,
          height: 0.8,
          fill: '#000',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H);
      approxBox(result.elements[1], 1.25, 0.4, 3, 0.8);
    });

    it('w/h 是 width/height 的别名（PPTX 风格短名）', () => {
      const slide = makeSlide([
        makeShape({
          x: 0.62,
          y: 0.48,
          w: 9.2,
          h: 0.26,
          fill: '#1E40AF',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      approxBox(result.elements[0], 0.62, 0.48, 9.2, 0.26);
    });

    it('width/height 优先于 w/h（正名优先）', () => {
      const slide = makeSlide([
        makeShape({
          x: 0.5,
          y: 0.5,
          width: 3,
          height: 1,
          w: 9,
          h: 5,
          fill: '#000',
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      approxBox(result.elements[0], 0.5, 0.5, 3, 1);
    });

    it('文本节点也支持 w/h 别名（防止文本框被撑满 slide）', () => {
      const textNode: LayoutTextNode = {
        _type: 'Text',
        content: '下一代储能技术深度投研报告 · 核心结论',
        x: 0.62,
        y: 0.48,
        w: 9.2,
        h: 0.26,
        fontSize: 7,
      };
      const slide = makeSlide([
        textNode,
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      // 关键回归：之前 .w 被忽略后宽度被撑到 SLIDE_W=10，导致 right=10.62 越界
      approxBox(result.elements[0], 0.62, 0.48, 9.2, 0.26);
    });
  });

  describe('嵌套容器', () => {
    it('View > View > Shape 嵌套正确', () => {
      const slide = makeSlide([
        makeText('标题', { height: 1, fontSize: 24, fontWeight: 'bold' }),
        makeView([
          makeView([
            makeText('左上', { flex: 1 }),
            makeText('左下', { flex: 1 }),
          ], { flex: 1 }),
          makeView([
            makeText('右侧', { flex: 1 }),
          ], { flex: 1 }),
        ], { flex: 1, flexDirection: 'row' }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements.length).toBeGreaterThanOrEqual(3);
      expect(result.elements[0].type).toBe('text');
      expect(result.elements[0].position.y).toBeCloseTo(0, 1);
      expect(result.elements[0].position.h).toBeCloseTo(1, 1);
    });
  });

  describe('Spacer', () => {
    it('Spacer 参与 flex 分配但不生成元素', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: '#AAA' }),
        makeSpacer({ flex: 1 }),
        makeShape({ flex: 1, fill: '#BBB' }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      const thirdH = SLIDE_H / 3;
      approxBox(result.elements[0], 0, 0, SLIDE_W, thirdH);
      approxBox(result.elements[1], 0, thirdH * 2, SLIDE_W, thirdH);
    });
  });

  describe('容器 backgroundColor 生成背景 shape', () => {
    it('View 有 backgroundColor 时生成背景矩形', () => {
      const slide = makeSlide([
        makeView([
          makeText('卡片内容', { flex: 1 }),
        ], { flex: 1, backgroundColor: '#F0F0F0', padding: 0.3 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      expect(result.elements[0].type).toBe('shape');
      expect(result.elements[0].style?.paint).toEqual({ type: 'solid', color: '#F0F0F0' });
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H);
      expect(result.elements[1].type).toBe('text');
      expect(result.elements[1].position.x).toBeCloseTo(0.3, 1);
      expect(result.elements[1].position.y).toBeCloseTo(0.3, 1);
    });
  });

  describe('Chart/Table 叶子节点', () => {
    it('Chart 叶子节点坐标正确', () => {
      const slide = makeSlide([
        ({
          _type: 'Chart',
          flex: 1,
          preset: 'clean-column',
          categories: ['A', 'B', 'C'],
          series: [{ name: 'S1', labels: ['A', 'B', 'C'], values: [10, 20, 30] }],
        }) as LayoutChartNode,
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].type).toBe('chart');
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H);
    });

    it('Table 叶子节点坐标正确', () => {
      const slide = makeSlide([
        ({
          _type: 'Table',
          flex: 1,
          headers: ['列1', '列2'],
          rows: [['a', 'b'], ['c', 'd']],
        }) as LayoutTableNode,
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].type).toBe('table');
      approxBox(result.elements[0], 0, 0, SLIDE_W, SLIDE_H);
    });

    it('Table 通过 tableData 嵌套传入数据也能正确编译', () => {
      // 模拟 AI 常用写法：table.tableData = { headers, rows }
      const slide = makeSlide([
        ({
          _type: 'Table',
          flex: 1,
          tableData: {
            headers: ['指标', '2025年目标', '2030年目标'],
            rows: [
              ['系统成本', '$80/kW', '$60/kW'],
              ['效率', '68%', '72%'],
            ],
          },
        }) as LayoutTableNode,
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].type).toBe('table');
      expect(result.elements[0].headers).toEqual(['指标', '2025年目标', '2030年目标']);
      expect(result.elements[0].rows).toHaveLength(2);
    });

    it('Table 顶层 rows 优先于 tableData.rows', () => {
      const slide = makeSlide([
        ({
          _type: 'Table',
          flex: 1,
          headers: ['名称'],
          rows: [['顶层数据']],
          tableData: { rows: [['嵌套数据']] },
        }) as LayoutTableNode,
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].rows).toEqual([
        [{ text: '顶层数据' }],
      ]);
    });

    it('Table 字符串矩阵会归一化为 TableCell[][]，而不是静默强转', () => {
      const slide = makeSlide([
        ({
          _type: 'Table',
          flex: 1,
          headers: ['名称', '状态'],
          rows: [['项目A', '进行中'], ['项目B', '已完成']],
        }) as LayoutTableNode,
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      const table = result.elements[0];

      expect(table.type).toBe('table');
      expect(table.rows).toEqual([
        [{ text: '项目A' }, { text: '进行中' }],
        [{ text: '项目B' }, { text: '已完成' }],
      ]);
    });
  });

  describe('输入合同校验', () => {
    it('compileFlexInput 遇到非法 Table.rows 时返回明确错误', () => {
      const result = compileFlexInput({
        title: 'Bad table',
        slides: [
          makeSlide([
            ({
              _type: 'Table',
              flex: 1,
              headers: ['名称', '状态'],
              rows: [['项目A', { foo: 'bar' }]],
            }) as unknown as LayoutTableNode,
          ]),
        ],
      });

      expect(result.error).toContain('表格数据的 rows/body/data 必须是合法二维数组');
    });

    it('compileFlexInput 遇到非法 Chart.categories 时返回明确错误', () => {
      const result = compileFlexInput({
        title: 'Bad chart',
        slides: [
          makeSlide([
            ({
              _type: 'Chart',
              flex: 1,
              chartType: 'bar',
              categories: ['Q1', { quarter: 2 }] as unknown as string[],
              series: [{ name: '营收', values: [10, 20] }],
            }) as LayoutChartNode,
          ]),
        ],
      });

      expect(result.error).toContain('categories/labels/xLabels/xAxisLabels 必须是字符串、数字或布尔数组');
    });

    it('compileFlexInput 会接受 series.data 别名并归一化', () => {
      const result = compileFlexInput({
        title: 'Chart alias',
        slides: [
          makeSlide([
            ({
              _type: 'Chart',
              flex: 1,
              chartType: 'bar',
              categories: ['Q1', 'Q2'],
              series: [{ name: '营收', data: [10, 20] }] as unknown as LayoutChartNode['series'],
            }) as LayoutChartNode,
          ]),
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.input?.slides[0].elements[0]).toMatchObject({
        type: 'chart',
        categories: ['Q1', 'Q2'],
        series: [{ name: '营收', labels: [], values: [10, 20] }],
      });
    });

    it('compileFlexInput 遇到错误类型的 series.data 时返回明确错误', () => {
      const result = compileFlexInput({
        title: 'Bad chart series',
        slides: [
          makeSlide([
            ({
              _type: 'Chart',
              flex: 1,
              chartType: 'bar',
              categories: ['Q1', 'Q2'],
              series: [{ name: '营收', data: ['x', 'y'] }] as unknown as LayoutChartNode['series'],
            }) as LayoutChartNode,
          ]),
        ],
      });

      expect(result.error).toContain('series/datasets 必须是非空数组');
    });
  });

  describe('Text measureFunc 触发', () => {
    it('Text 无显式高度时通过 measureFunc 估算', () => {
      const slide = makeSlide([
        makeText('这是一段较长的文本，用于测试 measureFunc 是否能正确估算高度。', {
          fontSize: 14,
          lineHeight: 1.5,
        }),
        makeShape({ flex: 1, fill: '#EEE' }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(2);
      expect(result.elements[0].type).toBe('text');
      expect(result.elements[0].position.h).toBeGreaterThan(0);
      expect(result.elements[0].position.h).toBeLessThan(SLIDE_H);
    });

    it('无横向约束的绝对 Text 按内容定宽并保留单行语义', () => {
      const slide = makeSlide([
        makeText('01', {
          position: 'absolute',
          right: 0.5,
          y: 0.2,
          fontSize: 10,
        }),
      ]);

      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      const text = result.elements[0]!;

      expect(text.textWrap).toBe('none');
      expect(text.position.w).toBeCloseTo(0.372, 3);
      expect(text.position.x + text.position.w).toBeCloseTo(SLIDE_W - 0.5, 3);
    });

    it('显式 width 保持固定宽度和自动换行语义', () => {
      const slide = makeSlide([
        makeText('01', {
          position: 'absolute',
          x: 1,
          y: 1,
          width: 0.28,
          height: 0.2,
          fontSize: 10,
        }),
      ]);

      const text = compileSlide(slide, SLIDE_W, SLIDE_H).elements[0]!;
      expect(text.position.w).toBe(0.28);
      expect(text.textWrap).toBe('word');
    });

    it('自适应宽度 Text 只按作者换行并据此计算高度', () => {
      const slide = makeSlide([
        makeText('0\n12', {
          position: 'absolute',
          x: 1,
          y: 1,
          fontSize: 10,
        }),
      ]);

      const text = compileSlide(slide, SLIDE_W, SLIDE_H).elements[0]!;
      expect(text.textWrap).toBe('none');
      expect(text.position.w).toBeCloseTo(0.372, 3);
      expect(text.position.h).toBeCloseTo(0.378, 3);
    });
  });

  describe('CSS 属性名映射', () => {
    it('fontWeight: "bold" 映射为 style.bold: true', () => {
      const slide = makeSlide([
        makeText('粗体', { fontWeight: 'bold', height: 0.5 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].style?.bold).toBe(true);
    });

    it('fontStyle: "italic" 映射为 style.italic: true', () => {
      const slide = makeSlide([
        makeText('斜体', { fontStyle: 'italic', height: 0.5 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].style?.italic).toBe(true);
    });

    it('textDecoration: "underline" 映射为 style.underline: true', () => {
      const slide = makeSlide([
        makeText('下划线', { textDecoration: 'underline', height: 0.5 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].style?.underline).toBe(true);
    });

    it('textAlign 和 verticalAlign 正确映射', () => {
      const slide = makeSlide([
        makeText('居中', { textAlign: 'center', verticalAlign: 'middle', height: 0.5 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].style?.align).toBe('center');
      expect(result.elements[0].style?.valign).toBe('middle');
    });

    it('lineHeight 映射为 style.lineSpacing', () => {
      const slide = makeSlide([
        makeText('行高', { lineHeight: 1.5, height: 0.5 }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].style?.lineSpacing).toEqual({ kind: 'multiple', value: 1.5 });
    });
  });

  describe('compileFlexInput 完整管线', () => {
    it('使用自定义画布尺寸计算 Flex 根布局', () => {
      const result = compileFlexInput({
        title: '竖版报告',
        layout: { width: 5.625, height: 10, unit: 'in' },
        slides: [makeSlide([
          makeText('全宽标题', { width: '100%', height: 1 }),
        ])],
      });

      expect(result.error).toBeUndefined();
      expect(result.input?.layout).toEqual({ width: 5.625, height: 10, unit: 'in' });
      expect(result.input?.slides[0]?.elements[0]?.position.w).toBeCloseTo(5.625, 3);
    });

    it('成功编译多页布局树为 DirectComposeInput', () => {
      const input: FlexComposeInput = {
        title: '测试报告',
        layout: '16x9',
        slides: [
          makeSlide([
            makeText('第一页', { fontSize: 28, fontWeight: 'bold', height: 1 }),
            makeShape({ flex: 1, fill: '#DDD' }),
          ]),
          makeSlide([
            makeView([
              makeText('左侧', { flex: 1, fontSize: 14 }),
              makeText('右侧', { flex: 1, fontSize: 14 }),
            ], { flex: 1, flexDirection: 'row', gap: 0.5 }),
          ]),
        ],
      };

      const result = compileFlexInput(input);
      expect(result.error).toBeUndefined();
      expect(result.input).toBeDefined();
      expect(result.input!.title).toBe('测试报告');
      expect(result.input!.slides).toHaveLength(2);
      expect(result.input!.slides[0].elements.length).toBe(2);
      expect(result.input!.slides[1].elements.length).toBe(2);
    });

    it('title 为空时返回错误', () => {
      const result = compileFlexInput({
        title: '',
        slides: [makeSlide([])],
      });
      expect(result.error).toBeDefined();
    });

    it('slides 为空数组时返回错误', () => {
      const result = compileFlexInput({
        title: '测试',
        slides: [],
      });
      expect(result.error).toBeDefined();
    });

    it('部分 slide 编译失败时跳过坏 slide，返回 rejectedSlides', () => {
      const result = compileFlexInput({
        title: '部分成功',
        slides: [
          // slide 0：正常
          makeSlide([makeText('第一页', { height: 1 })]),
          // slide 1：非法 Table rows → 编译失败
          makeSlide([
            ({
              _type: 'Table',
              flex: 1,
              headers: ['名称'],
              rows: [[{ foo: 'bad' }]],
            }) as unknown as LayoutTableNode,
          ]),
          // slide 2：正常
          makeSlide([makeText('第三页', { height: 1 })]),
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.input).toBeDefined();
      expect(result.input!.slides).toHaveLength(2);
      expect(result.rejectedSlides).toBeDefined();
      expect(result.rejectedSlides).toHaveLength(1);
      expect(result.rejectedSlides![0].index).toBe(1);
      expect(result.rejectedSlides![0].reason).toContain('编译失败');
    });

    it('全部 slide 编译失败时返回整体 error', () => {
      const result = compileFlexInput({
        title: '全部失败',
        slides: [
          makeSlide([
            ({
              _type: 'Table',
              flex: 1,
              headers: ['名称'],
              rows: [[{ foo: 'bad' }]],
            }) as unknown as LayoutTableNode,
          ]),
        ],
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('所有 slide 编译失败');
      expect(result.input).toBeUndefined();
    });

    it('非 Slide 节点被跳过并记入 rejectedSlides', () => {
      const result = compileFlexInput({
        title: '非法节点',
        slides: [
          makeSlide([makeText('正常页', { height: 1 })]),
          { _type: 'NotSlide' } as unknown as LayoutSlideNode,
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.input!.slides).toHaveLength(1);
      expect(result.rejectedSlides).toHaveLength(1);
      expect(result.rejectedSlides![0].index).toBe(1);
      expect(result.rejectedSlides![0].reason).toContain('Slide');
    });

    it('全部成功时 rejectedSlides 为 undefined', () => {
      const result = compileFlexInput({
        title: '全部成功',
        slides: [
          makeSlide([makeText('第一页', { height: 1 })]),
          makeSlide([makeText('第二页', { height: 1 })]),
        ],
      });

      expect(result.error).toBeUndefined();
      expect(result.input!.slides).toHaveLength(2);
      expect(result.rejectedSlides).toBeUndefined();
    });

    it('正式图片来源对象会保留到 DirectComposeInput.src', () => {
      const result = compileFlexInput({
        title: '图片来源',
        slides: [
          makeSlide([
            makeImage({ kind: 'generated_asset', assetId: '/abs/generated.png' }, {
              width: 2,
              height: 1,
              fitMode: 'cover',
            }),
          ]),
        ],
      });

      expect(result.error).toBeUndefined();
      const image = result.input!.slides[0].elements[0];
      expect(image).toMatchObject({
        type: 'image',
        src: { kind: 'generated_asset', assetId: '/abs/generated.png' },
        fitMode: 'cover',
      });
    });

    it('Image 节点缺少 src 时返回明确编译错误', () => {
      const result = compileFlexInput({
        title: '坏图片',
        slides: [
          makeSlide([
            { _type: 'Image', width: 2, height: 1 } as unknown as LayoutImageNode,
          ]),
        ],
      });

      expect(result.error).toContain('Image 节点必须提供 src');
      expect(result.input).toBeUndefined();
    });
  });

  describe('向后兼容：新旧属性名产出一致', () => {
    it('Text.letterSpacing 会透传到 DirectElementInput text style', () => {
      const slide = makeSlide([
        makeText('TRACK', { height: 0.4, letterSpacing: 1.5 }),
      ]);

      const result = compileSlide(slide, SLIDE_W, SLIDE_H);

      expect(result.elements[0].style?.letterSpacing).toBe(1.5);
    });

    it('Text.letterSpacing 会参与 Yoga 文本测量输入', () => {
      const adapter = new RecordingTextMeasureAdapter();
      configureDefaultTextMeasureService({ primary: adapter, fallback: adapter });
      const slide = makeSlide([
        makeText('TRACKING LABEL', { width: 1.2, fontSize: 12, lineHeight: 1.1, letterSpacing: 1.75 }),
      ]);

      compileSlide(slide, SLIDE_W, SLIDE_H);

      expect(adapter.inputs.some((input) => input.style.letterSpacingPt === 1.75)).toBe(true);
    });

    it('fontWeight/lineHeight/textAlign 与 bold/lineSpacing/align 编译结果相同', () => {
      // 旧属性名（Gen 3 风格）
      const oldSlide = makeSlide([
        makeView([
          { _type: 'Text', content: '标题', bold: true, lineSpacing: 1.5, align: 'center', height: 0.8 } as LayoutTextNode,
          { _type: 'Text', content: '斜体', italic: true, height: 0.4 } as LayoutTextNode,
          { _type: 'Text', content: '下划线', underline: true, height: 0.4 } as LayoutTextNode,
        ], { padding: 0.5, flexDirection: 'row' }),
      ]);

      // 新 CSS 标准属性名（Gen 4 Scene Graph DSL 风格）
      const newSlide = makeSlide([
        makeView([
          makeText('标题', { fontWeight: 'bold', lineHeight: 1.5, textAlign: 'center', height: 0.8 }),
          makeText('斜体', { fontStyle: 'italic', height: 0.4 }),
          makeText('下划线', { textDecoration: 'underline', height: 0.4 }),
        ], { padding: 0.5, flexDirection: 'row' }),
      ]);

      const oldResult = compileSlide(oldSlide, SLIDE_W, SLIDE_H);
      const newResult = compileSlide(newSlide, SLIDE_W, SLIDE_H);

      expect(newResult.elements).toHaveLength(oldResult.elements.length);
      for (let i = 0; i < newResult.elements.length; i++) {
        expect(newResult.elements[i]).toEqual(oldResult.elements[i]);
      }
    });

    it('verticalAlign 与 valign 编译结果相同', () => {
      const oldSlide = makeSlide([
        { _type: 'Text', content: '对齐', valign: 'middle', align: 'right', height: 1 } as LayoutTextNode,
      ]);
      const newSlide = makeSlide([
        makeText('对齐', { verticalAlign: 'middle', textAlign: 'right', height: 1 }),
      ]);

      const oldResult = compileSlide(oldSlide, SLIDE_W, SLIDE_H);
      const newResult = compileSlide(newSlide, SLIDE_W, SLIDE_H);
      expect(newResult.elements[0]).toEqual(oldResult.elements[0]);
    });

    it('复杂嵌套布局新旧风格产出一致', () => {
      // 旧风格：模拟一个含标题 + 双栏 + 页脚的完整页面
      const oldSlide = makeSlide([
        { _type: 'Text', content: '报告标题', bold: true, fontSize: 24, lineSpacing: 1.2, height: 0.8 } as LayoutTextNode,
        makeView([
          makeView([
            { _type: 'Text', content: '左侧内容', italic: true, fontSize: 12, flex: 1 } as LayoutTextNode,
          ], { flex: 1 }),
          makeView([
            { _type: 'Text', content: '右侧内容', align: 'right', fontSize: 12, flex: 1 } as LayoutTextNode,
          ], { flex: 1 }),
        ], { flex: 1, flexDirection: 'row', gap: 0.3 }),
        { _type: 'Text', content: '页脚', italic: true, fontSize: 8, align: 'center', height: 0.3 } as LayoutTextNode,
      ]);

      // 新风格：同样的布局，CSS 标准属性名
      const newSlide = makeSlide([
        makeText('报告标题', { fontWeight: 'bold', fontSize: 24, lineHeight: 1.2, height: 0.8 }),
        makeView([
          makeView([
            makeText('左侧内容', { fontStyle: 'italic', fontSize: 12, flex: 1 }),
          ], { flex: 1 }),
          makeView([
            makeText('右侧内容', { textAlign: 'right', fontSize: 12, flex: 1 }),
          ], { flex: 1 }),
        ], { flex: 1, flexDirection: 'row', gap: 0.3 }),
        makeText('页脚', { fontStyle: 'italic', fontSize: 8, textAlign: 'center', height: 0.3 }),
      ]);

      const oldResult = compileSlide(oldSlide, SLIDE_W, SLIDE_H);
      const newResult = compileSlide(newSlide, SLIDE_W, SLIDE_H);

      expect(newResult.elements).toHaveLength(oldResult.elements.length);
      for (let i = 0; i < newResult.elements.length; i++) {
        expect(newResult.elements[i].position).toEqual(oldResult.elements[i].position);
        expect(newResult.elements[i].style).toEqual(oldResult.elements[i].style);
        expect(newResult.elements[i].type).toEqual(oldResult.elements[i].type);
      }
    });
  });

  describe('Shape.fill admission', () => {
    it('字符串 fill 正常编译', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: '#FF0000' }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].style?.paint).toEqual({ type: 'solid', color: '#FF0000' });
      expect(result.elements[0].style?.opacity).toBeUndefined();
    });

    it('{ color, transparency } 对象归一化为带 opacity 的 solid Paint', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: { color: '#1E5FAD', transparency: 70 } }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].style?.paint).toEqual({
        type: 'solid',
        color: '#1E5FAD',
        opacity: 0.3,
      });
      expect(result.elements[0].style?.opacity).toBeUndefined();
    });

    it('{ color } 对象（无 transparency）只提取颜色，不影响 opacity', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: { color: '#ABC123' } }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].style?.paint).toEqual({ type: 'solid', color: '#ABC123' });
      expect(result.elements[0].style?.opacity).toBeUndefined();
    });

    it('fill transparency 与节点 opacity 保持分层，由渲染端分别应用', () => {
      const slide = makeSlide([
        makeShape({
          flex: 1,
          fill: { color: '#000', transparency: 50 },
          opacity: 0.8,
        }),
      ]);
      const result = compileSlide(slide, SLIDE_W, SLIDE_H);
      expect(result.elements[0].style?.paint).toEqual({
        type: 'solid',
        color: '#000000',
        opacity: 0.5,
      });
      expect(result.elements[0].style?.opacity).toBe(0.8);
    });

    it('多 stop linear fill 与 linear border 都编译为 canonical Paint', () => {
      const slide = makeSlide([
        makeShape({
          flex: 1,
          fill: {
            type: 'linear',
            angle: 45,
            stops: [
              { color: '#000', position: 0 },
              { color: '#777', position: 0.4 },
              { color: '#FFF', position: 1 },
            ],
          },
          border: {
            width: 2,
            paint: {
              type: 'linear',
              angle: 90,
              stops: [
                { color: '#F00', position: 0 },
                { color: '#00F', position: 1 },
              ],
            },
          },
        }),
      ]);
      const style = compileSlide(slide, SLIDE_W, SLIDE_H).elements[0].style;
      expect(style?.paint?.type).toBe('linear');
      expect(style?.paint?.type === 'linear' ? style.paint.stops : []).toHaveLength(3);
      expect(style?.border?.paint?.type).toBe('linear');
    });

    it('非法 fill 值（如数字）仍然抛错', () => {
      const slide = makeSlide([
        makeShape({ flex: 1, fill: 12345 as unknown as string }),
      ]);
      expect(() => compileSlide(slide, SLIDE_W, SLIDE_H)).toThrow('Shape.fill');
    });
  });

  describe('格式检测', () => {
    it('isFlexComposeInput 对老格式返回 false', () => {
      const oldFormat = {
        title: '测试',
        slides: [{ elements: [{ type: 'text', position: { x: 1, y: 1, w: 8, h: 1 }, content: 'hi' }] }],
      };
      expect(isFlexComposeInput(oldFormat)).toBe(false);
    });

    it('isFlexComposeInput 对新格式返回 true', () => {
      const newFormat = {
        title: '测试',
        slides: [{ _type: 'Slide', children: [] }],
      };
      expect(isFlexComposeInput(newFormat)).toBe(true);
    });

    it('isFlexComposeInput 会检查全部 slide 根节点', () => {
      const mixedFormat = {
        title: '测试',
        slides: [
          { _type: 'Slide', children: [] },
          { elements: [] },
        ],
      };
      expect(isFlexComposeInput(mixedFormat)).toBe(false);
    });
  });
});
