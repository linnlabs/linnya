import { describe, expect, it } from 'vitest';
import { LayoutLint } from '../engine/quality/LayoutLint.js';
import type {
  GeneratedLayoutConstraintEvidence,
  PresentationInfo,
  TextLayoutResult,
} from '@plugin/slides/shared';

const lint = new LayoutLint();

function makeTextLayout(lines: readonly string[]): TextLayoutResult {
  return {
    lines: lines.map((text, index) => ({
      paragraphIndex: 0,
      slices: [{
        paragraphIndex: 0,
        runIndex: 0,
        text,
        x: 0,
        width: 0.1,
        textY: index * 0.15,
      }],
      y: index * 0.15,
      baseline: 0.1,
      height: 0.15,
      width: 0.1,
      align: 'left',
    })),
    contentHeightInches: lines.length * 0.15,
    appliedFontScale: 1,
    appliedLineSpacingReduction: 0,
    advanceSource: 'heuristic',
    overflow: { horizontal: false, vertical: false, hiddenLineCount: 0 },
  };
}

function makeInfo(overrides?: Partial<PresentationInfo>): PresentationInfo {
  return {
    slideCount: 1,
    slideSize: { width: 10, height: 5.625 },
    slides: [
      {
        number: 1,
        elements: [
          {
            name: 'Text 0',
            type: 'text',
            text: 'Typical Title',
            position: { x: 0.7, y: 0.45, w: 5.4, h: 0.65 },
          },
          {
            name: 'Text 1',
            type: 'text',
            text: 'Footer note',
            position: { x: 0.7, y: 5.0, w: 4.5, h: 0.35 },
          },
        ],
      },
    ],
    theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } },
    masters: [],
    ...overrides,
  };
}

function makeConstraintEvidence(input: {
  layoutNodeId: string;
  positionMode: 'flow' | 'absolute';
  finalBox: { x: number; y: number; w: number; h: number };
  parentId: string;
  parentKind: 'slide' | 'layout_container';
  parentBox: { x: number; y: number; w: number; h: number };
  declaredWidth?: number;
}): GeneratedLayoutConstraintEvidence {
  return {
    layoutNodeId: input.layoutNodeId,
    positionMode: input.positionMode,
    declared: input.declaredWidth === undefined
      ? {}
      : { widthInches: input.declaredWidth },
    finalBox: { ...input.finalBox, unit: 'in' },
    computedRatios: input.declaredWidth === undefined
      ? {}
      : { widthToDeclared: input.finalBox.w / input.declaredWidth },
    parent: {
      nodeId: input.parentId,
      kind: input.parentKind,
      label: input.parentKind === 'slide' ? 'Slide' : 'View',
      finalBox: { ...input.parentBox, unit: 'in' },
      zIndex: -1,
    },
    clipSemantics: 'visible',
  };
}

describe('LayoutLint', () => {
  it('returns no findings for a conventional consulting slide', () => {
    const report = lint.lint(makeInfo());
    expect(report.issues).toEqual([]);
  });

  it('reports a high-confidence root when Yoga compresses an explicit flow width', () => {
    const finalBox = { x: 1, y: 1, w: 2, h: 1 };
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Compressed card',
          nodeId: 'card-bg',
          type: 'shape',
          position: finalBox,
          layoutConstraintEvidence: makeConstraintEvidence({
            layoutNodeId: 'layout:s1:root.0',
            positionMode: 'flow',
            finalBox,
            parentId: 'layout:s1:root',
            parentKind: 'slide',
            parentBox: { x: 0, y: 0, w: 10, h: 5.625 },
            declaredWidth: 4,
          }),
        }],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'layout_constraint_compressed')).toMatchObject({
      confidence: 'high',
      rootCauseKey: 'layout-constraint:layout:s1:root.0:horizontal',
      evidence: {
        kind: 'constraint_delta',
        node: { nodeId: 'card-bg' },
        parent: { nodeId: 'layout:s1:root' },
        declaredInches: 4,
        finalInches: 2,
        finalToDeclaredRatio: 0.5,
      },
    });
  });

  it('does not report ordinary small flex adjustment above the compression threshold', () => {
    const finalBox = { x: 1, y: 1, w: 3.4, h: 1 };
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Normal card',
          type: 'shape',
          position: finalBox,
          layoutConstraintEvidence: makeConstraintEvidence({
            layoutNodeId: 'layout:s1:root.0',
            positionMode: 'flow',
            finalBox,
            parentId: 'layout:s1:root',
            parentKind: 'slide',
            parentBox: { x: 0, y: 0, w: 10, h: 5.625 },
            declaredWidth: 4,
          }),
        }],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'layout_constraint_compressed')).toBe(false);
  });

  it('reports a compressed View even when the container has no rendered background node', () => {
    const childBox = { x: 1, y: 1, w: 2, h: 0.5 };
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Card content',
          nodeId: 'card-content',
          type: 'text',
          text: 'Content',
          position: childBox,
          layoutConstraintEvidence: {
            ...makeConstraintEvidence({
              layoutNodeId: 'layout:s1:root.0.0',
              positionMode: 'flow',
              finalBox: childBox,
              parentId: 'layout:s1:root.0',
              parentKind: 'layout_container',
              parentBox: { x: 1, y: 1, w: 2, h: 1 },
            }),
            parentConstraint: {
              positionMode: 'flow',
              declared: { widthInches: 4 },
              computedRatios: { widthToDeclared: 0.5 },
              parent: {
                nodeId: 'layout:s1:root',
                kind: 'slide',
                label: 'Slide',
                finalBox: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
                zIndex: -1,
              },
            },
          },
        }],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'layout_constraint_compressed')).toMatchObject({
      rootCauseKey: 'layout-constraint:layout:s1:root.0:horizontal',
      evidence: {
        kind: 'constraint_delta',
        node: { nodeId: 'layout:s1:root.0', kind: 'layout_container' },
        parent: { nodeId: 'layout:s1:root' },
        declaredInches: 4,
        finalInches: 2,
      },
    });
  });

  it('groups absolute text outside a compressed computed parent under the same root cause', () => {
    const parentBox = { x: 1, y: 1, w: 2, h: 1 };
    const childBox = { x: 2.7, y: 1.2, w: 0.8, h: 0.3 };
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Card background',
            nodeId: 'card-bg',
            type: 'shape',
            position: parentBox,
            layoutConstraintEvidence: makeConstraintEvidence({
              layoutNodeId: 'layout:s1:root.0',
              positionMode: 'flow',
              finalBox: parentBox,
              parentId: 'layout:s1:root',
              parentKind: 'slide',
              parentBox: { x: 0, y: 0, w: 10, h: 5.625 },
              declaredWidth: 4,
            }),
          },
          {
            name: 'Card note',
            nodeId: 'card-note',
            type: 'text',
            text: 'Capacity revenue',
            position: childBox,
            layoutConstraintEvidence: makeConstraintEvidence({
              layoutNodeId: 'layout:s1:root.0.0',
              positionMode: 'absolute',
              finalBox: childBox,
              parentId: 'layout:s1:root.0',
              parentKind: 'layout_container',
              parentBox,
            }),
          },
        ],
      }],
    }));

    const overflow = report.issues.find(
      (issue) => issue.code === 'descendant_outside_computed_parent',
    );
    expect(overflow).toMatchObject({
      rootCauseKey: 'layout-constraint:layout:s1:root.0:horizontal',
      evidence: {
        kind: 'parent_overflow',
        parent: { nodeId: 'layout:s1:root.0' },
        descendants: [{ nodeId: 'card-note' }],
        overflowSides: ['right'],
        clipSemantics: 'visible',
      },
    });
  });

  it('does not treat an overflowing decoration shape as broken content', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Accent bar',
          type: 'shape',
          position: { x: 2.8, y: 1, w: 1, h: 0.1 },
          layoutConstraintEvidence: makeConstraintEvidence({
            layoutNodeId: 'layout:s1:root.0.0',
            positionMode: 'absolute',
            finalBox: { x: 2.8, y: 1, w: 1, h: 0.1 },
            parentId: 'layout:s1:root.0',
            parentKind: 'layout_container',
            parentBox: { x: 1, y: 1, w: 2, h: 1 },
          }),
        }],
      }],
    }));

    expect(report.issues.some(
      (issue) => issue.code === 'descendant_outside_computed_parent',
    )).toBe(false);
  });

  it('reports the actual line count when a continuous numeric label wraps', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Section number',
          elementId: 'section-number',
          type: 'shape',
          text: '02',
          position: { x: 9.1, y: 0.4, w: 0.08, h: 0.4 },
          textLayout: makeTextLayout(['0', '2']),
        }],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'short_numeric_text_wrapped')).toMatchObject({
      evidence: {
        kind: 'text_layout',
        issue: 'short_numeric_wrap',
        actualLineCount: 2,
        node: { nodeId: 'section-number' },
      },
    });
  });

  it('does not diagnose a single-line number or a non-continuous page label', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Section number',
            type: 'text',
            text: '02',
            position: { x: 8.8, y: 0.4, w: 0.3, h: 0.2 },
            textLayout: makeTextLayout(['02']),
          },
          {
            name: 'Page label',
            type: 'text',
            text: '2/10',
            position: { x: 8.8, y: 5.1, w: 0.3, h: 0.3 },
            textLayout: makeTextLayout(['2/', '10']),
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'short_numeric_text_wrapped')).toBe(false);
  });

  it('reports a thin decoration crossing a finalized text line', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Caption',
            nodeId: 'caption',
            type: 'text',
            text: 'A',
            position: { x: 1, y: 1, w: 2, h: 0.8 },
            textBody: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
            textLayout: makeTextLayout(['A']),
          },
          {
            name: 'Divider',
            nodeId: 'divider',
            type: 'shape',
            position: { x: 0.9, y: 1.06, w: 0.5, h: 0.04 },
          },
        ],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'text_decoration_collision')).toMatchObject({
      severity: 'warning',
      confidence: 'high',
      evidence: {
        kind: 'node_overlap',
        nodes: [{ nodeId: 'caption' }, { nodeId: 'divider' }],
        overlapClass: 'forbidden',
        intent: { assessment: 'likely_unintentional' },
      },
    });
    expect(report.issues.some((issue) => issue.code === 'element_overlap')).toBe(false);
  });

  it('does not confuse empty text-box space with an occupied text line', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Caption',
            nodeId: 'caption',
            type: 'text',
            text: 'A',
            position: { x: 1, y: 1, w: 2, h: 0.8 },
            textBody: { padding: { top: 0, right: 0, bottom: 0, left: 0 } },
            textLayout: makeTextLayout(['A']),
          },
          {
            name: 'Underline',
            nodeId: 'underline',
            type: 'shape',
            position: { x: 0.9, y: 1.3, w: 0.5, h: 0.04 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_decoration_collision')).toBe(false);
  });

  it('reports a finalized paragraph whose automatic wrap leaves one glyph on the last line', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Deal mode',
          nodeId: 'deal-mode',
          type: 'text',
          text: '双向许可＋共同发现',
          position: { x: 1, y: 1, w: 1.4, h: 0.5 },
          paragraphs: [{ runs: [{ text: '双向许可＋共同发现' }] }],
          textLayout: makeTextLayout(['双向许可＋共同发', '现']),
        }],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'text_single_glyph_last_line')).toMatchObject({
      confidence: 'medium',
      evidence: {
        kind: 'text_layout',
        issue: 'single_glyph_last_line',
        paragraphIndex: 0,
        orphanText: '现',
        actualLineCount: 2,
        node: { nodeId: 'deal-mode' },
      },
    });
  });

  it('does not report an author-authored line break as an automatic orphan', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Authored label',
          type: 'text',
          text: '共同发\n现',
          position: { x: 1, y: 1, w: 1.4, h: 0.5 },
          paragraphs: [{ runs: [{ text: '共同发\n现' }] }],
          textLayout: makeTextLayout(['共同发', '现']),
        }],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_single_glyph_last_line')).toBe(false);
  });

  it('reports the exact table row and column without turning cells into render nodes', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Representative deals',
          nodeId: 'deals-table',
          type: 'table',
          position: { x: 0.4, y: 1.1, w: 9.2, h: 3.4 },
          tableInfo: {
            cells: [{
              rowIndex: 6,
              columnIndex: 3,
              position: { x: 6.7, y: 3.2, w: 1.4, h: 0.4 },
              text: '双向许可＋共同发现',
              paragraphs: [{ runs: [{ text: '双向许可＋共同发现' }] }],
              padding: { top: 0.08, right: 0.1, bottom: 0.08, left: 0.1 },
              textLayout: makeTextLayout(['双向许可＋共同发', '现']),
            }],
          },
        }],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'text_single_glyph_last_line')).toMatchObject({
      evidence: {
        node: { nodeId: 'deals-table', kind: 'table' },
        tableCell: { rowIndex: 6, columnIndex: 3 },
        contentWidthInches: 1.2,
        orphanText: '现',
      },
    });
  });

  it('no false positives for text at various positions', () => {
    // 文本放在页面中下方、右侧缩进等位置，不应产生任何语义误判
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Title 1',
            type: 'text',
            text: 'Centered Card Title',
            position: { x: 1.35, y: 0.82, w: 4.2, h: 0.7 },
          },
          {
            name: 'Footer 1',
            type: 'text',
            text: 'Footer candidate',
            position: { x: 0.8, y: 4.2, w: 5.2, h: 0.4 },
          },
        ],
      }],
    }));

    // 纯几何检查不应对这些正常位置的文本产生警告
    expect(report.issues).toEqual([]);
  });

  it('reports a warning when an element exceeds slide bounds', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Shape 0',
            type: 'shape',
            position: { x: 8.8, y: 4.9, w: 1.8, h: 1.1 },
          },
        ],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'out_of_bounds')).toMatchObject({
      severity: 'warning',
    });
  });

  it('warns when two elements overlap heavily', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Text 0',
            elementId: 'text-0',
            type: 'text',
            text: 'First block',
            position: { x: 1, y: 1.2, w: 3.2, h: 1.0 },
          },
          {
            name: 'Text 1',
            elementId: 'text-1',
            type: 'text',
            text: 'Second block',
            position: { x: 1.1, y: 1.35, w: 3.0, h: 0.95 },
          },
        ],
      }],
    }));

    const overlap = report.issues.find((issue) => issue.code === 'element_overlap');
    expect(overlap).toBeDefined();
    /* 与 SpatialSemantics 单一真值源对齐：独立 text 互压 = forbidden */
    expect(overlap?.evidence.overlapClass).toBe('forbidden');
    expect(overlap?.evidence.nodes.map((node) => node.nodeId)).toEqual(['text-0', 'text-1']);
  });

  it('normalizes floating-point coverage before producing strict overlap evidence', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Wide title',
            elementId: 'wide-title',
            type: 'text',
            text: 'Market outlook',
            position: { x: 0.7, y: 0.4, w: 2.9, h: 0.6 },
          },
          {
            name: 'Covered note',
            elementId: 'covered-note',
            type: 'text',
            text: 'Investment conclusion',
            position: { x: 0.7, y: 0.6, w: 2.9, h: 0.2 },
          },
        ],
      }],
    }));

    const overlap = report.issues.find((issue) => issue.code === 'element_overlap');
    expect(overlap?.evidence).toMatchObject({
      kind: 'node_overlap',
      smallerCoveredRatio: 1,
    });
  });

  it('does NOT report container overlap when a shape fully wraps a text (KPI card scenario)', () => {
    /**
     * 复刻 editorialBrownShowcase S10 KPI 卡：bg shape (1.71×1.20) 完整包住
     * lbl text (1.71×0.22)，是合法的"卡片背景包标签"叠放。
     *
     * 历史 bug：LayoutLint 私有的 isIntentionalContainerOverlap 与
     * SpatialSemantics.classifyOverlap 在某些 element-type 边界上不一致，
     * 导致这种场景仍报 element_overlap，给 Agent 错误的修复方向。
     *
     * 本 case 锁定：统一走 classifyOverlap 后必须 return 'container' → 不报。
     */
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'KPI bg',
            type: 'shape',
            position: { x: 0.40, y: 1.42, w: 1.71, h: 1.20 },
          },
          {
            name: 'KPI label',
            type: 'text',
            text: 'GMV',
            position: { x: 0.40, y: 2.12, w: 1.71, h: 0.22 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'element_overlap')).toBe(false);
  });

  it('marks origin_stacking when 3+ substantive elements share the same anchor (positioning bug)', () => {
    /**
     * 绝对定位失效的典型症状：多个有实质面积的元素都堆在 (0,0) / 同锚点。
     * 这类关系不能降维成若干 pair overlap，必须保留全部成员和共同锚点。
     */
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          { name: 'A', elementId: 'a', type: 'text', text: 'A', position: { x: 0.5, y: 0.5, w: 2.0, h: 0.5 } },
          { name: 'B', elementId: 'b', type: 'text', text: 'B', position: { x: 0.5, y: 0.5, w: 2.0, h: 0.5 } },
          { name: 'C', elementId: 'c', type: 'text', text: 'C', position: { x: 0.5, y: 0.5, w: 2.0, h: 0.5 } },
        ],
      }],
    }));

    const stacking = report.issues.find(
      (issue) => issue.code === 'origin_stacking',
    );
    expect(stacking).toBeDefined();
    expect(stacking?.evidence).toMatchObject({
      kind: 'origin_stacking',
      anchor: { x: 0.5, y: 0.5 },
    });
    expect(stacking?.evidence.nodes.map((node) => node.nodeId)).toEqual(['a', 'b', 'c']);
  });

  it('does NOT report element_overlap for thin decorative shapes overlapping content', () => {
    /**
     * 装饰性细条（宽 ≤ 0.12" 或高 ≤ 0.12"）跟其他内容重叠是常见设计语言
     * （金色细分隔线压在卡片标题上方）。SpatialSemantics 把这类归为
     * 'decorative'，LayoutLint 不应报 issue。
     */
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          { name: 'Card title', type: 'text', text: 'Title', position: { x: 0.5, y: 1.0, w: 4.0, h: 0.4 } },
          { name: 'Gold rule', type: 'shape', position: { x: 0.5, y: 1.20, w: 1.0, h: 0.018 } },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'element_overlap')).toBe(false);
  });

  it('does NOT report a timeline node attached to a thin line overlapping its label', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          { name: 'Timeline line', elementId: 'line', type: 'shape', position: { x: 2, y: 1, w: 0.02, h: 2 } },
          { name: 'Timeline node', elementId: 'node', type: 'shape', position: { x: 1.91, y: 1.8, w: 0.2, h: 0.2 } },
          { name: 'Timeline label', elementId: 'label', type: 'text', text: 'Gate', position: { x: 1.95, y: 1.82, w: 1, h: 0.18 } },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'element_overlap')).toBe(false);
  });

  it('does NOT report a chart contained by its lower-z panel shape', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Chart panel',
            elementId: 'panel',
            type: 'shape',
            zIndex: 4,
            position: { x: 0.58, y: 1.33, w: 5.55, h: 3.62 },
          },
          {
            name: 'Revenue chart',
            elementId: 'chart',
            type: 'chart',
            zIndex: 6,
            position: { x: 0.78, y: 1.78, w: 5.15, h: 2.97 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'element_overlap')).toBe(false);
  });

  it('does NOT report a lower-z full-slide image carrying foreground text', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Hero image',
            type: 'image',
            zIndex: 0,
            position: { x: 0, y: 0, w: 10, h: 5.625 },
          },
          {
            name: 'Hero title',
            type: 'text',
            text: 'A foreground title',
            zIndex: 2,
            position: { x: 0.8, y: 0.7, w: 4, h: 0.7 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'element_overlap')).toBe(false);
  });

  it('warns when a text box is likely too dense for its height', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Card body',
            type: 'text',
            text: 'Commercial engine and solution blueprint factory require sustained enablement across multiple workstreams and markets',
            position: { x: 1.2, y: 1.5, w: 1.6, h: 0.45 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(true);
  });

  it('detects large font overflowing a small box (KPI card scenario)', () => {
    // 18pt 字号在 0.28" 高的框里：单行需要约 0.35"，0.28" 放不下
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'KPI number',
            type: 'text',
            text: '15,500',
            fontSize: 18,
            position: { x: 0.5, y: 1.0, w: 2.7, h: 0.28 },
            textBody: {
              padding: { top: 0.05, right: 0.1, bottom: 0.05, left: 0.1 },
            },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(true);
  });

  it('passes when font size fits comfortably in the box', () => {
    // 10pt 在 0.5" 的框里，绰绰有余
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Normal text',
            type: 'text',
            text: 'Hello world',
            fontSize: 10,
            position: { x: 0.5, y: 1.0, w: 4.0, h: 0.5 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(false);
  });

  it('detects overflow for very large font even with short text', () => {
    // 36pt 标题在 0.4" 的框里：一行需要 0.7"，明显溢出
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Big title',
            type: 'text',
            text: 'Title',
            fontSize: 36,
            position: { x: 0.5, y: 0.5, w: 9.0, h: 0.4 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(true);
  });

  it('does NOT false-positive for 8pt text in a tight PptxGenJS box', () => {
    // PptxGenJS 结构编译器生成的列表项序号 box：0.194"×0.133"，8pt 字号。
    // 这是 PPT 中极其常见的紧凑布局，不应被标记为溢出。
    const report = lint.lint(makeInfo({
      slides: [{
        number: 2,
        elements: [
          {
            name: 'Text 4',
            type: 'text',
            text: '1.',
            fontSize: 8,
            position: { x: 0.4, y: 1.14, w: 0.194, h: 0.133 },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(false);
  });

  it('skips overflow warnings for explicit shrink-text autoFit boxes', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'AutoFit title',
            type: 'text',
            text: 'This title is intentionally long but PowerPoint is expected to shrink it.',
            position: { x: 0.6, y: 0.6, w: 2.2, h: 0.28 },
            textStyle: { fontSize: 20, fontFamily: 'Arial' },
            textBody: { autoFit: 'shrink-text', wrap: 'word' },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(false);
  });

  it('warns when wrap is disabled and a single line exceeds the box width', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Ticker',
            type: 'text',
            text: 'NorthAmericaOperatingModelReset',
            position: { x: 0.8, y: 1.2, w: 1.2, h: 0.3 },
            textStyle: { fontSize: 11, fontFamily: 'Arial' },
            textBody: { wrap: 'none', autoFit: 'none' },
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(true);
  });

  it('reports finalized text content width after subtracting horizontal padding', () => {
    const layout = makeTextLayout(['Padded title']);
    layout.lines[0]!.width = 0.95;
    layout.overflow.horizontal = true;
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [{
          name: 'Padded title',
          nodeId: 'padded-title',
          type: 'text',
          text: 'Padded title',
          position: { x: 0.8, y: 0.5, w: 1, h: 0.3 },
          textBody: {
            wrap: 'none',
            padding: { top: 0.02, right: 0.05, bottom: 0.02, left: 0.05 },
          },
          textLayout: layout,
        }],
      }],
    }));

    expect(report.issues.find((issue) => issue.code === 'text_overflow_risk')).toMatchObject({
      evidence: {
        kind: 'text_layout',
        contentWidthInches: 0.9,
        maxLineWidthInches: 0.95,
      },
    });
  });

  it('uses explicit padding and paragraph spacing when deciding overflow risk', () => {
    const report = lint.lint(makeInfo({
      slides: [{
        number: 1,
        elements: [
          {
            name: 'Imported textbox',
            type: 'text',
            text: 'Execution office\nPMO and workstream governance',
            position: { x: 0.9, y: 1.1, w: 1.8, h: 0.42 },
            textStyle: { fontSize: 12, fontFamily: 'Arial' },
            textBody: {
              wrap: 'word',
              autoFit: 'none',
              padding: { top: 0.08, right: 0.08, bottom: 0.08, left: 0.08 },
            },
            paragraphs: [
              {
                runs: [{ text: 'Execution office', fontSize: 12, fontFamily: 'Arial' }],
                spacingAfterPt: 12,
                lineSpacing: { kind: 'multiple', value: 1.2 },
              },
              {
                runs: [{ text: 'PMO and workstream governance', fontSize: 12, fontFamily: 'Arial' }],
                lineSpacing: { kind: 'multiple', value: 1.2 },
              },
            ],
          },
        ],
      }],
    }));

    expect(report.issues.some((issue) => issue.code === 'text_overflow_risk')).toBe(true);
  });
});
