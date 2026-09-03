/**
 * parseTableCell 合同护栏测试
 *
 * 锁定 TableCell 的字段兼容矩阵，避免未来重构时悄悄改坏 AI 友好的别名映射。
 *
 * 兼容层级：
 *   - text 别名：text / content / value（已有，line 142-144 实现）
 *   - fill 别名：fill / bgColor / backgroundColor（本测试覆盖）
 *
 * 严格性：所有别名遇到非字符串值都必须返回 null，不允许静默降级。
 */

import { describe, it, expect } from 'vitest';
import { parseTableCell } from '../dataParsers.js';

describe('parseTableCell — 单元格背景色字段兼容', () => {
  it('原生 fill 字段正常工作', () => {
    const cell = parseTableCell({ text: 'hello', fill: '#FF0000' });
    expect(cell).toEqual({ text: 'hello', fill: '#FF0000' });
  });

  it('bgColor 别名映射到 cell.fill（兼容 HTML 老 table 写法）', () => {
    const cell = parseTableCell({ text: 'hello', bgColor: '#FF0000' });
    expect(cell).toEqual({ text: 'hello', fill: '#FF0000' });
    expect(cell).not.toHaveProperty('bgColor');
  });

  it('backgroundColor 别名映射到 cell.fill（兼容 CSS 写法）', () => {
    const cell = parseTableCell({ text: 'hello', backgroundColor: '#00FF00' });
    expect(cell).toEqual({ text: 'hello', fill: '#00FF00' });
    expect(cell).not.toHaveProperty('backgroundColor');
  });

  it('fill 优先级高于 bgColor / backgroundColor', () => {
    const cell = parseTableCell({
      text: 'hello',
      fill: '#FF0000',
      bgColor: '#00FF00',
      backgroundColor: '#0000FF',
    });
    expect(cell?.fill).toBe('#FF0000');
  });

  it('bgColor 优先级高于 backgroundColor', () => {
    const cell = parseTableCell({
      text: 'hello',
      bgColor: '#00FF00',
      backgroundColor: '#0000FF',
    });
    expect(cell?.fill).toBe('#00FF00');
  });

  it('bgColor 是数字（非字符串）必须返回 null，不能静默 drop', () => {
    const cell = parseTableCell({ text: 'hello', bgColor: 123 });
    expect(cell).toBeNull();
  });

  it('backgroundColor 是空字符串必须返回 null', () => {
    const cell = parseTableCell({ text: 'hello', backgroundColor: '' });
    expect(cell).toBeNull();
  });

  it('text 别名 content / value 仍然有效（回归保护）', () => {
    expect(parseTableCell({ content: 'hi' })).toEqual({ text: 'hi' });
    expect(parseTableCell({ value: 'hi' })).toEqual({ text: 'hi' });
  });

  it('style 字段照常透传（不受兼容改动影响）', () => {
    const cell = parseTableCell({
      text: 'hello',
      bgColor: '#FF0000',
      style: { color: '#FFFFFF', bold: true },
    });
    expect(cell).toEqual({
      text: 'hello',
      fill: '#FF0000',
      style: { color: '#FFFFFF', bold: true },
    });
  });
});

describe('parseTableCell — TextStyle 顶层短手字段 promote 到 cell.style', () => {
  it('color / bold / align 写在 cell 顶层会自动 promote 到 cell.style（PptxGenJS 平铺写法兼容）', () => {
    const cell = parseTableCell({
      text: 'hello',
      color: '#FFFFFF',
      bold: true,
      align: 'center',
    });
    expect(cell).toEqual({
      text: 'hello',
      style: { color: '#FFFFFF', bold: true, align: 'center' },
    });
  });

  it('全部 KNOWN_TEXT_STYLE_KEYS 字段都支持顶层短手', () => {
    const cell = parseTableCell({
      text: 'hello',
      fontSize: 14,
      fontFamily: 'Arial',
      bold: true,
      italic: true,
      underline: true,
      color: '#111111',
      align: 'right',
      valign: 'middle',
      lineSpacing: 1.4,
      letterSpacing: 0.5,
    });
    expect(cell?.style).toEqual({
      fontSize: 14,
      fontFamily: 'Arial',
      bold: true,
      italic: true,
      underline: true,
      color: '#111111',
      align: 'right',
      valign: 'middle',
      lineSpacing: { kind: 'multiple', value: 1.4 },
      letterSpacing: 0.5,
    });
  });

  it('cell.style 显式字段优先于顶层短手（与 splitElementStyleInput 合并语义一致）', () => {
    const cell = parseTableCell({
      text: 'hello',
      color: '#FF0000',
      bold: true,
      style: { color: '#0000FF' },
    });
    // explicit style.color 覆盖顶层 color；顶层 bold 仍然合并进来
    expect(cell?.style).toEqual({ color: '#0000FF', bold: true });
  });

  it('顶层短手 + cell.fill / bgColor 共存时正确归类', () => {
    const cell = parseTableCell({
      text: 'hello',
      bgColor: '#333333',
      color: '#FFFFFF',
      bold: true,
    });
    expect(cell).toEqual({
      text: 'hello',
      fill: '#333333',
      style: { color: '#FFFFFF', bold: true },
    });
  });

  it('类型不对的顶层短手字段被静默丢弃（与 parseTextStyle 行为一致）', () => {
    const cell = parseTableCell({
      text: 'hello',
      color: 123,        // 非字符串 → 丢
      fontSize: 'big',   // 非数字 → 丢
      bold: true,        // 合法 → 保留
    });
    expect(cell).toEqual({
      text: 'hello',
      style: { bold: true },
    });
  });
});
