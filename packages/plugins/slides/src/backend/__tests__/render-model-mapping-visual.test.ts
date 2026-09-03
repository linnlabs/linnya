/** DeckSpec → RenderModel 视觉元素、主题与混合页映射完整性测试。 */

import { describe, expect, it } from 'vitest';
import type { DeckSpec, ShapeStyle } from '@plugin/slides/shared';
import { BOX, getNode, renderDeck, renderSlide } from './helpers/render-model-mapping-harness.js';

const TINY_PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ─── 第二部分：位置映射 ──────────────────────────────────────────────────

describe('位置映射完整性', () => {
  it('Box → RenderBox 精确传递，单位标记为 in', () => {
    const position = { x: 0.5, y: 1.2, w: 8.4, h: 3.6 };
    const node = getNode<'text'>([{
      type: 'text',
      content: 'Position test',
      position,
    }], 'text');

    expect(node.box).toEqual({
      x: position.x,
      y: position.y,
      w: position.w,
      h: position.h,
      unit: 'in',
    });
  });

  it('zIndex 按元素顺序递增', () => {
    const slide = renderSlide([
      { type: 'text', content: 'A', position: { x: 0, y: 0, w: 1, h: 1 } },
      { type: 'text', content: 'B', position: { x: 1, y: 0, w: 1, h: 1 } },
      { type: 'text', content: 'C', position: { x: 2, y: 0, w: 1, h: 1 } },
    ]);

    const zIndices = slide.elements.map((e) => e.zIndex);
    expect(zIndices).toEqual([0, 1, 2]);
  });
});

// ─── 第三部分：形状映射 ──────────────────────────────────────────────────

describe('形状映射完整性', () => {
  it('所有 ShapeStyle 字段完整映射', () => {
    const style: ShapeStyle = {
      fill: '#4CAF50',
      border: { color: '#333333', width: 2, dash: 'dash' },
      borderRadius: 8,
      shadow: { color: '#000000', blur: 4, offsetX: 2, offsetY: 2, opacity: 0.5 },
      opacity: 0.8,
      rotate: 45,
    };

    const node = getNode<'shape'>([{
      type: 'shape',
      geometry: 'roundRect',
      position: BOX,
      style,
    }], 'shape');

    expect(node.geometry).toEqual({ type: 'preset', name: 'roundRect' });
    expect(node.fill).toEqual({ type: 'solid', color: '#4CAF50' });
    expect(node.stroke).toEqual({
      paint: { type: 'solid', color: '#333333' },
      width: 2,
      dash: 'dash',
    });
    expect(node.cornerRadius).toBe(8);
    expect(node.shadow).toEqual({ color: '#000000', blur: 4, offsetX: 2, offsetY: 2, opacity: 0.5 });
    expect(node.opacity).toBe(0.8);
    expect(node.rotation).toBe(45);
  });

  it('所有支持的 preset geometry 映射', () => {
    const shapes = [
      'rect', 'roundRect', 'ellipse', 'triangle', 'rightTriangle', 'diamond',
      'pentagon', 'hexagon', 'star5', 'rightArrow', 'line', 'callout',
      'parallelogram', 'trapezoid', 'nonIsoscelesTrapezoid', 'chevron',
    ] as const;

    for (const shape of shapes) {
      const node = getNode<'shape'>([{
        type: 'shape',
        geometry: shape,
        position: BOX,
      }], 'shape');
      expect(node.geometry).toEqual({ type: 'preset', name: shape });
    }
  });

  it('参数化 geometry 在 mapper 出口归一为 path', () => {
    const node = getNode<'shape'>([{
      type: 'shape',
      geometry: { type: 'regularPolygon', sides: 5 },
      position: BOX,
    }], 'shape');
    expect(node.geometry).toMatchObject({ type: 'path', closed: true });
    if (node.geometry.type === 'path') {
      expect(node.geometry.commands).toHaveLength(6);
    }
  });

  it('shape 带文本时生成 innerText 节点', () => {
    const node = getNode<'shape'>([{
      type: 'shape',
      geometry: 'rect',
      position: BOX,
      text: 'Label',
    }], 'shape');

    expect(node.innerText).toBeDefined();
    expect(node.innerText!.kind).toBe('text');
    expect(node.innerText!.paragraphs[0]!.runs[0]!.text).toBe('Label');
  });

  it('shape 无 style 时各样式字段为 undefined', () => {
    const node = getNode<'shape'>([{
      type: 'shape',
      geometry: 'rect',
      position: BOX,
    }], 'shape');

    expect(node.fill).toBeUndefined();
    expect(node.stroke).toBeUndefined();
    expect(node.shadow).toBeUndefined();
    expect(node.opacity).toBeUndefined();
    expect(node.rotation).toBeUndefined();
  });

  it('border.dash 各种值正确映射', () => {
    for (const dash of ['solid', 'dash', 'dot'] as const) {
      const node = getNode<'shape'>([{
        type: 'shape',
        geometry: 'rect',
        position: BOX,
        style: { border: { color: '#000', width: 1, dash } },
      }], 'shape');
      expect(node.stroke?.dash).toBe(dash);
    }
  });
});

// ─── 第四部分：图片映射 ──────────────────────────────────────────────────

describe('图片映射完整性', () => {
  it('拒绝绕过文稿资产接管的 HTTP URL', () => {
    expect(() => getNode<'image'>([{
      type: 'image',
      src: 'https://example.com/photo.jpg',
      position: BOX,
      alt: 'Test image',
    }], 'image')).toThrow('Download the image to a local file first');
  });

  it('data URI 映射为 data assetRef', () => {
    const dataUri = TINY_PNG_DATA_URI;
    const node = getNode<'image'>([{
      type: 'image',
      src: dataUri,
      position: BOX,
    }], 'image');

    expect(node.assetRef).toEqual({ type: 'data', dataUri });
  });

  it('本地路径映射为 embedded assetRef', () => {
    const node = getNode<'image'>([{
      type: 'image',
      src: '/tmp/image1.png',
      position: BOX,
    }], 'image');

    expect(node.assetRef).toEqual({ type: 'embedded', partPath: '/tmp/image1.png' });
  });

  it('crop 在 render-model 中归一化为 cover，并映射 maskShape/flip', () => {
    const node = getNode<'image'>([{
      type: 'image',
      src: TINY_PNG_DATA_URI,
      position: BOX,
      fitMode: 'crop',
      maskShape: 'circle',
      flipH: true,
      flipV: false,
    }], 'image');

    expect(node.fitMode).toBe('cover');
    expect(node.maskShape).toBe('circle');
    expect(node.flipH).toBe(true);
    expect(node.flipV).toBe(false);
  });
});

// ─── 第七部分：背景映射 ──────────────────────────────────────────────────

describe('背景映射完整性', () => {
  it('background.color 正确映射', () => {
    const slide = renderSlide([
      { type: 'text', content: 'BG test', position: BOX },
    ]);
    // 默认白色
    expect(slide.background.paint).toEqual({ type: 'solid', color: '#FFFFFF' });
  });

  it('自定义 background.color', () => {
    const deckSpec: DeckSpec = {
      title: 'BG Test',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          background: { color: '#1A1A2E' },
          elements: [{ type: 'text', content: 'Dark', position: BOX }],
        },
      }],
    };
    const model = renderDeck(deckSpec);
    expect(model.slides[0]!.background.paint).toEqual({ type: 'solid', color: '#1A1A2E' });
  });
});

// ─── 第八部分：主题影响映射 ──────────────────────────────────────────────

describe('主题影响映射', () => {
  const theme: DeckSpec['theme'] = {
    fonts: { major: 'Playfair Display', minor: 'Source Sans Pro' },
    colors: { accent1: '#E74C3C' },
    chart: {
      palette: ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C'] as [string, ...string[]],
    },
  };

  it('title 使用 theme major font 作为默认字体', () => {
    const node = getNode<'text'>([{
      type: 'title',
      content: 'Theme Title',
      position: BOX,
    }], 'text', theme);

    expect(node.paragraphs[0]!.runs[0]!.fontFamily).toBe('Playfair Display');
  });

  it('text 使用 theme minor font 作为默认字体', () => {
    const node = getNode<'text'>([{
      type: 'text',
      content: 'Theme Body',
      position: BOX,
    }], 'text', theme);

    expect(node.paragraphs[0]!.runs[0]!.fontFamily).toBe('Source Sans Pro');
  });

  it('显式 fontFamily 覆盖 theme 默认', () => {
    const node = getNode<'text'>([{
      type: 'text',
      content: 'Custom Font',
      style: { fontFamily: 'Georgia' },
      position: BOX,
    }], 'text', theme);

    expect(node.paragraphs[0]!.runs[0]!.fontFamily).toBe('Georgia');
  });

  it('chart series color 来自 theme chart palette', () => {
    const node = getNode<'chart'>([{
      type: 'chart',
      chartType: 'bar',
      data: {
        categories: ['A'],
        series: [{ name: 'S1', labels: ['A'], values: [1] }],
      },
      position: BOX,
    }], 'chart', theme);

    expect(node.series[0]!.color).toBe('#E74C3C');
    expect(node.palette[0]).toBe('#E74C3C');
  });
});

// ─── 第九部分：混合 slide 多元素 ────────────────────────────────────────

describe('混合 slide 映射完整性', () => {
  it('一页包含所有元素类型，每种正确映射', () => {
    const slide = renderSlide([
      { type: 'title', content: 'Title', position: { x: 0, y: 0, w: 10, h: 0.8 } },
      { type: 'text', content: 'Body', position: { x: 0, y: 1, w: 5, h: 1 } },
      { type: 'bulletList', items: [{ text: 'A' }], position: { x: 0, y: 2, w: 5, h: 1 } },
      { type: 'numberedList', items: [{ text: 'B' }], position: { x: 5, y: 2, w: 5, h: 1 } },
      { type: 'shape', geometry: 'rect', position: { x: 5, y: 1, w: 2, h: 1 }, style: { fill: '#CCC' } },
      {
        type: 'chart',
        chartType: 'pie',
        data: { categories: ['A', 'B'], series: [{ name: 'S', labels: ['A', 'B'], values: [60, 40] }] },
        position: { x: 7, y: 1, w: 3, h: 2 },
      },
      {
        type: 'table',
        rows: [[{ text: 'X' }]],
        position: { x: 0, y: 3.5, w: 5, h: 1 },
      },
      {
        type: 'image',
        src: TINY_PNG_DATA_URI,
        position: { x: 5, y: 3.5, w: 2, h: 1 },
      },
    ]);

    expect(slide.elements).toHaveLength(8);

    const kinds = slide.elements.map((e) => e.kind);
    // title/text/bulletList/numberedList 都映射为 'text'
    expect(kinds.filter((k) => k === 'text')).toHaveLength(4);
    expect(kinds).toContain('shape');
    expect(kinds).toContain('chart');
    expect(kinds).toContain('table');
    expect(kinds).toContain('image');
  });
});
