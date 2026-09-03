/**
 * LayoutPrimitives 工厂函数行为测试。
 *
 * 这些工厂函数最终通过沙箱注入用户代码运行，所以这里直接 eval 源码字符串后
 * 调用，确保：
 * 1. 兼容历史"3 阶段（创建 → 配置 → 组装）"调用方式；
 * 2. 接受 React/Konva 风格的 plain config 对象（避免静默吞参的幽灵 bug）；
 * 3. 传非 plain object（如 number / Array / class 实例）时**显式抛错**，
 *    把"createShape({...}) 字段被丢弃"这类历史 bug 一次性堵掉。
 */
import { describe, expect, it } from 'vitest';
import { LAYOUT_PRIMITIVES_SOURCE } from '../LayoutPrimitives.js';

interface PrimitiveBindings {
  createSlide: (config?: unknown) => Record<string, unknown>;
  createFrame: (config?: unknown) => Record<string, unknown>;
  createText: (content?: unknown) => Record<string, unknown>;
  createShape: (config?: unknown) => Record<string, unknown>;
  createChart: (preset?: unknown) => Record<string, unknown>;
  createBrushArtwork: (config: unknown) => Record<string, unknown>;
  createTable: (config?: unknown) => Record<string, unknown>;
  createImage: (src?: unknown) => Record<string, unknown>;
  createSvgGraphic: (source?: unknown) => Record<string, unknown>;
  createSpacer: (config?: unknown) => Record<string, unknown>;
}

function loadPrimitives(): PrimitiveBindings {
  const factory = new Function(
    `${LAYOUT_PRIMITIVES_SOURCE}\nreturn { createSlide, createFrame, createText, createShape, createChart, createBrushArtwork, createTable, createImage, createSvgGraphic, createSpacer };`,
  );
  return factory() as PrimitiveBindings;
}

describe('LayoutPrimitives 工厂函数', () => {
  describe('3 阶段调用（向后兼容）', () => {
    it('createShape() 无参数时返回最小 Shape 节点', () => {
      const { createShape } = loadPrimitives();
      const shape = createShape();
      expect(shape).toEqual({ _type: 'Shape' });
    });

    it('createSlide() 返回带 children 与 add 方法的 Slide', () => {
      const { createSlide, createShape } = loadPrimitives();
      const slide = createSlide();
      expect(slide._type).toBe('Slide');
      expect(slide.children).toEqual([]);
      expect(typeof slide.add).toBe('function');
      const child = createShape();
      (slide.add as (...args: unknown[]) => void)(child);
      expect(slide.children).toEqual([child]);
    });

    it('createImage(src) 接受字符串 src（与历史用法一致）', () => {
      const { createImage } = loadPrimitives();
      const image = createImage('/abs/path/to.png');
      expect(image).toEqual({ _type: 'Image', src: '/abs/path/to.png' });
    });

    it('createSvgGraphic(svg) 把字符串明确归一为 inline SVG 来源', () => {
      const { createSvgGraphic } = loadPrimitives();
      expect(createSvgGraphic('<svg viewBox="0 0 10 10"></svg>')).toEqual({
        _type: 'SvgGraphic',
        source: { kind: 'inline_svg', svg: '<svg viewBox="0 0 10 10"></svg>' },
      });
    });

    it('createChart(preset) 接受字符串 preset（与历史用法一致）', () => {
      const { createChart } = loadPrimitives();
      const chart = createChart('clean-column');
      expect(chart).toEqual({ _type: 'Chart', preset: 'clean-column' });
    });

    it('createText 接受字符串以及文字/公式 run 数组', () => {
      const { createText } = loadPrimitives();
      expect(createText('hello')).toEqual({ _type: 'Text', content: 'hello' });
      const rich = createText([
        'plain',
        { text: 'bold', style: { bold: true } },
        {
          formula: { latex: 'E=mc^2', altText: '质能方程' },
          style: { fontSize: 24, color: '#173B57' },
        },
      ]);
      expect(rich).toEqual({
        _type: 'Text',
        content: [
          { text: 'plain' },
          { text: 'bold', style: { bold: true } },
          {
            formula: { latex: 'E=mc^2', altText: '质能方程' },
            style: { fontSize: 24, color: '#173B57' },
          },
        ],
      });
    });
  });

  describe('config 对象一行写法（修复"静默吞参"幽灵 bug）', () => {
    it('createShape({...}) 字段会被实际写到节点上，而不是被丢弃', () => {
      const { createShape } = loadPrimitives();
      const shape = createShape({
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: 0.04,
        fill: '#0B2545',
      });
      expect(shape).toMatchObject({
        _type: 'Shape',
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: 0.04,
        fill: '#0B2545',
      });
    });

    it('createShape({ position: { x, y, w, h } }) 保留旧输入兼容', () => {
      const { createShape } = loadPrimitives();
      const shape = createShape({
        position: { x: 0.5, y: 0.3, w: 9, h: 0.5 },
        fill: '#0B2545',
      });
      expect(shape).toMatchObject({
        _type: 'Shape',
        position: { x: 0.5, y: 0.3, w: 9, h: 0.5 },
        fill: '#0B2545',
      });
    });

    it('createImage({ src, ...其他字段 }) 正常生效', () => {
      const { createImage } = loadPrimitives();
      const image = createImage({ src: '/foo.png', width: '100%', opacity: 0.4 });
      expect(image).toMatchObject({
        _type: 'Image',
        src: '/foo.png',
        width: '100%',
        opacity: 0.4,
      });
    });

    it('createImage({ kind, assetId }) 会作为正式图片来源写入 src', () => {
      const { createImage } = loadPrimitives();
      const image = createImage({
        kind: 'generated_asset',
        assetId: '/abs/generated.png',
        fitMode: 'cover',
      });
      expect(image).toMatchObject({
        _type: 'Image',
        src: { kind: 'generated_asset', assetId: '/abs/generated.png' },
        fitMode: 'cover',
      });
      expect(image.kind).toBeUndefined();
      expect(image.assetId).toBeUndefined();
    });

    it('createBrushArtwork 把作者意图封装为普通 Image 来源', () => {
      const { createBrushArtwork } = loadPrimitives();
      expect(createBrushArtwork({
        seed: 12,
        backgroundColor: '#FFF7E6',
        quality: 'high',
        layers: [{
          stroke: { brush: 'HB', color: '#7C2D12', weight: 0.8 },
          marks: [{ type: 'rect', x: 8, y: 10, width: 84, height: 80 }],
        }],
        width: 8,
        height: 4,
        alt: '手绘边框',
      })).toEqual({
        _type: 'Image',
        src: {
          kind: 'brush_artwork',
          seed: 12,
          backgroundColor: '#FFF7E6',
          quality: 'high',
          layers: [{
            stroke: { brush: 'HB', color: '#7C2D12', weight: 0.8 },
            marks: [{ type: 'rect', x: 8, y: 10, width: 84, height: 80 }],
          }],
        },
        width: 8,
        height: 4,
        alt: '手绘边框',
      });
    });

    it('createImage 复制正式 Brush source 时保留 layers，不泄漏作者字段到 Image', () => {
      const { createImage } = loadPrimitives();
      const image = createImage({
        kind: 'brush_artwork',
        seed: 27,
        backgroundColor: '#FFF7E6',
        layers: [{
          stroke: { brush: 'pen', color: '#223344' },
          marks: [{ type: 'line', from: [10, 50], to: [90, 50] }],
        }],
        width: 6,
        height: 2,
      });
      expect(image.src).toEqual({
        kind: 'brush_artwork',
        seed: 27,
        backgroundColor: '#FFF7E6',
        quality: undefined,
        layers: [{
          stroke: { brush: 'pen', color: '#223344' },
          marks: [{ type: 'line', from: [10, 50], to: [90, 50] }],
        }],
      });
      expect(image.layers).toBeUndefined();
    });

    it('createChart({ preset, ... }) 接受 config', () => {
      const { createChart } = loadPrimitives();
      const chart = createChart({ preset: 'pie', flex: 1 });
      expect(chart).toMatchObject({ _type: 'Chart', preset: 'pie', flex: 1 });
    });

    it('createSlide({ background, ... }) 接受 config 且仍可 add() 子节点', () => {
      const { createSlide, createShape } = loadPrimitives();
      const slide = createSlide({ background: { color: '#FFF' } });
      expect(slide.background).toEqual({ color: '#FFF' });
      expect(typeof slide.add).toBe('function');
      const child = createShape();
      (slide.add as (...args: unknown[]) => void)(child);
      expect(slide.children).toEqual([child]);
    });

    it('createText({ content, ... }) 接受 config 写法', () => {
      const { createText } = loadPrimitives();
      const text = createText({ content: 'hi', fontSize: 24, color: '#000' });
      expect(text).toMatchObject({
        _type: 'Text',
        content: 'hi',
        fontSize: 24,
        color: '#000',
      });
    });

    it('保护 _type / children / add 不被 config 覆盖', () => {
      const { createSlide } = loadPrimitives();
      const slide = createSlide({ _type: 'EvilType', children: ['malicious'], add: 'no' });
      expect(slide._type).toBe('Slide');
      expect(slide.children).toEqual([]);
      expect(typeof slide.add).toBe('function');
    });
  });

  describe('静默吞参防御：传非 plain object 时显式抛错', () => {
    it('createShape(数字) 抛带提示的错误', () => {
      const { createShape } = loadPrimitives();
      expect(() => createShape(42)).toThrow(/createShape.*plain config 对象/);
    });

    it('createShape(数组) 抛带提示的错误', () => {
      const { createShape } = loadPrimitives();
      expect(() => createShape([1, 2, 3])).toThrow(/Array/);
    });

    it('createImage(数字) 抛带提示的错误（数字不是合法 src）', () => {
      const { createImage } = loadPrimitives();
      expect(() => createImage(42)).toThrow(/createImage/);
    });
  });
});
