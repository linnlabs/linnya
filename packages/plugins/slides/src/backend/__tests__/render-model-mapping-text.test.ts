/** DeckSpec → RenderModel 文本映射完整性测试。 */

import { describe, expect, it } from 'vitest';
import type { TextStyle } from '@plugin/slides/shared';
import { BOX, getNode, renderDeck } from './helpers/render-model-mapping-harness.js';

// ─── 第一部分：文本类元素映射 ──────────────────────────────────────────────

describe('文本映射完整性', () => {
  describe('基础字段映射', () => {
    const fullStyle: TextStyle = {
      fontSize: 16,
      fontFamily: 'Georgia',
      bold: true,
      italic: true,
      underline: true,
      color: '#FF0000',
      align: 'center',
      valign: 'middle',
      lineSpacing: { kind: 'exactPt', value: 24 },
    };

    it('title: 所有 TextStyle 字段均正确映射到 RenderTextRun', () => {
      const node = getNode<'text'>([{
        type: 'title',
        content: 'Test Title',
        style: fullStyle,
        position: BOX,
      }], 'text');

      const run = node.paragraphs[0]!.runs[0]!;
      expect(run.text).toBe('Test Title');
      expect(run.fontFamily).toBe('Georgia');
      expect(run.fontSize).toBe(16);
      expect(run.fontWeight).toBe('bold');
      expect(run.fontStyle).toBe('italic');
      expect(run.underline).toBe(true);
      expect(run.color).toBe('#FF0000');
      expect(node.paragraphs[0]!.lineSpacing).toEqual({ kind: 'exactPt', value: 24 });
    });

    it('text: 所有 TextStyle 字段均正确映射', () => {
      const node = getNode<'text'>([{
        type: 'text',
        content: 'Body text',
        style: fullStyle,
        position: BOX,
      }], 'text');

      const run = node.paragraphs[0]!.runs[0]!;
      expect(run.fontSize).toBe(16);
      expect(run.fontWeight).toBe('bold');
      expect(node.paragraphs[0]!.lineSpacing).toEqual({ kind: 'exactPt', value: 24 });
    });

    it('text 文本框级属性：valign → verticalAlign, align → paragraph.align', () => {
      const node = getNode<'text'>([{
        type: 'text',
        content: 'Aligned',
        style: { align: 'right', valign: 'bottom' },
        position: BOX,
      }], 'text');

      expect(node.verticalAlign).toBe('bottom');
      expect(node.paragraphs[0]!.align).toBe('right');
    });

    it('text 无 style 时使用合理默认值', () => {
      const node = getNode<'text'>([{
        type: 'text',
        content: 'Default',
        position: BOX,
      }], 'text');

      const run = node.paragraphs[0]!.runs[0]!;
      // fontFamily 回退到 theme.minor
      expect(run.fontFamily).toBeTruthy();
      expect(node.paragraphs[0]!.lineSpacing).toBeUndefined();
    });
  });

  describe('lineSpacing 段落语义映射（关键回归）', () => {
    const cases = [
      { fontSize: 14, lineSpacing: { kind: 'exactPt' as const, value: 18 } },
      { fontSize: 7, lineSpacing: { kind: 'exactPt' as const, value: 10 } },
      { fontSize: 5, lineSpacing: { kind: 'exactPt' as const, value: 7 } },
      { fontSize: 24, lineSpacing: { kind: 'exactPt' as const, value: 30 } },
      { fontSize: 10, lineSpacing: { kind: 'exactPt' as const, value: 12 } },
    ];

    for (const { fontSize, lineSpacing } of cases) {
      it(`fontSize=${fontSize} + lineSpacing=${lineSpacing.value} → paragraph exactPt`, () => {
        const node = getNode<'text'>([{
          type: 'text',
          content: 'Line spacing test',
          style: { fontSize, lineSpacing },
          position: BOX,
        }], 'text');

        expect(node.paragraphs[0]!.runs[0]!.fontSize).toBe(fontSize);
        expect(node.paragraphs[0]!.lineSpacing).toEqual(lineSpacing);
      });
    }

    it('lineSpacing 为 undefined 时 paragraph lineSpacing 也为 undefined', () => {
      const node = getNode<'text'>([{
        type: 'text',
        content: 'No spacing',
        style: { fontSize: 14 },
        position: BOX,
      }], 'text');

      expect(node.paragraphs[0]!.lineSpacing).toBeUndefined();
    });
  });

  describe('bulletList / numberedList 映射', () => {
    it('bulletList: items 映射为带 bullet 的段落', () => {
      const node = getNode<'text'>([{
        type: 'bulletList',
        items: [
          { text: 'First point' },
          { text: 'Second point', level: 1 },
        ],
        style: { fontSize: 12, color: '#333333', lineSpacing: { kind: 'exactPt', value: 15 } },
        position: BOX,
      }], 'text');

      expect(node.paragraphs.length).toBeGreaterThanOrEqual(2);
      // 每段有 bullet
      for (const para of node.paragraphs) {
        if (para.runs[0]?.text) {
          expect(para.bullet).toBeDefined();
        }
      }
      // lineSpacing 正确保留为段落级语义
      expect(node.paragraphs.find((p) => p.runs[0]?.text === 'First point')?.lineSpacing)
        .toEqual({ kind: 'exactPt', value: 15 });
    });

    it('numberedList: items 映射为带数字 bullet 的段落', () => {
      const node = getNode<'text'>([{
        type: 'numberedList',
        items: [
          { text: 'Step one' },
          { text: 'Step two' },
        ],
        style: { fontSize: 11 },
        position: BOX,
      }], 'text');

      expect(node.paragraphs.length).toBeGreaterThanOrEqual(2);
      const numberedPara = node.paragraphs.find((p) => p.runs[0]?.text === 'Step one');
      expect(numberedPara?.bullet).toBeDefined();
      expect(numberedPara?.bullet?.type).toBe('decimal');
    });
  });

  describe('autoFitPolicy 在 compose 路径的行为', () => {
    it('structured text 默认启用 resize-shape', () => {
      const node = getNode<'text'>([{
        type: 'text',
        content: 'Resize test',
        style: { fontSize: 14 },
        position: BOX,
      }], 'text');

      expect(node.autoFitPolicy).toBe('resize-shape');
    });

    it('mapper 保留 source box，最终扩框由 finalization 唯一负责', () => {
      const node = getNode<'text'>([{
        type: 'text',
        content: 'A very long text that would normally cause the box to expand in height if normalizeGeneratedTextBox were applied without shrink-text policy',
        style: { fontSize: 14 },
        position: { x: 1, y: 1, w: 2, h: 0.3 },
      }], 'text');

      expect(node.box.h).toBe(0.3);
    });
  });

  describe('作者层文本宽度语义', () => {
    it('structured text 将无横向约束语义映射为不自动换行', () => {
      const node = getNode<'text'>([{
        type: 'text',
        content: '01',
        position: { x: 8.8, y: 0.3, w: 0.37, h: 0.24 },
        textWrap: 'none',
      }], 'text');

      expect(node.wrap).toBe('none');
    });

    it('freeform text 将无横向约束语义映射为不自动换行', () => {
      const model = renderDeck({
        title: 'Intrinsic text box',
        slides: [{
          slideNumber: 1,
          spec: {
            type: 'freeform',
            elements: [{
              type: 'text',
              content: '01',
              position: { x: 8.8, y: 0.3, w: 0.37, h: 0.24 },
              textWrap: 'none',
            }],
          },
        }],
      });

      expect(model.slides[0]?.elements[0]?.kind).toBe('text');
      expect(model.slides[0]?.elements[0]).toMatchObject({ wrap: 'none' });
    });
  });
});
