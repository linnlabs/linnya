/**
 * parseTableDataLike — headers 双形态合同护栏
 *
 * 锁定 headers 字段在两种形态下的解析行为：
 *   - plain headers（string[] / number[] / boolean[]）→ 走原 PptxGenJS 默认表头
 *   - styled headers（含 TableCell-like 对象）→ 整行 promote 为带样式的 rows[0]，
 *     headers 设为 undefined；下游 compiler / Konva 以普通行渲染但完整保留样式
 *
 * 设计目的：替代 showcase 里"headers 留空 + rows[0] 充当 styled header"的 hack。
 */

import { describe, it, expect } from 'vitest';
import { parseTableDataLike } from '../dataParsers.js';

describe('parseTableDataLike — plain headers（原行为回归保护）', () => {
  it('string[] headers 直接作为 NormalizedTableData.headers 输出，rows 不变', () => {
    const result = parseTableDataLike({
      headers: ['项目', 'Q1', 'Q2'],
      rows: [['达人投放', '20', '30']],
    });
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({
      headers: ['项目', 'Q1', 'Q2'],
      rows: [
        [{ text: '达人投放' }, { text: '20' }, { text: '30' }],
      ],
    });
  });

  it('数字 / 布尔 headers 也作为 plain 处理', () => {
    const result = parseTableDataLike({
      headers: [2025, 2026, true],
      rows: [['rev', '100', '120']],
    });
    expect(result.data?.headers).toEqual(['2025', '2026', 'true']);
  });

  it('headers / header / columns / cols 别名都识别', () => {
    for (const key of ['headers', 'header', 'columns', 'cols']) {
      const result = parseTableDataLike({ [key]: ['A', 'B'], rows: [['1', '2']] });
      expect(result.data?.headers, `key=${key}`).toEqual(['A', 'B']);
    }
  });
});

describe('parseTableDataLike — styled headers promote 到 rows[0]', () => {
  it('headers 含一项对象 → 整行 promote 到 rows[0]，data.headers 置为 undefined', () => {
    const result = parseTableDataLike({
      headers: [
        { text: '项目', fill: '#333333', style: { color: '#FFFFFF', bold: true } },
        { text: 'Q1',   fill: '#333333', style: { color: '#FFFFFF', bold: true } },
        { text: 'Q2',   fill: '#333333', style: { color: '#FFFFFF', bold: true } },
      ],
      rows: [['达人投放', '20', '30']],
    });
    expect(result.error).toBeUndefined();
    expect(result.data?.headers).toBeUndefined();
    expect(result.data?.rows).toHaveLength(2);
    // promote 后第一行就是带样式的 header
    expect(result.data?.rows[0]).toEqual([
      { text: '项目', fill: '#333333', style: { color: '#FFFFFF', bold: true } },
      { text: 'Q1',   fill: '#333333', style: { color: '#FFFFFF', bold: true } },
      { text: 'Q2',   fill: '#333333', style: { color: '#FFFFFF', bold: true } },
    ]);
    // 第二行是原 rows
    expect(result.data?.rows[1]).toEqual([
      { text: '达人投放' }, { text: '20' }, { text: '30' },
    ]);
  });

  it('混合形态 headers（部分 string + 部分 cell）也走 promote 路径', () => {
    const result = parseTableDataLike({
      headers: [
        '项目',  // plain，promote 后是 { text: '项目' }
        { text: 'Q1', fill: '#333333' },
      ],
      rows: [['达人投放', '20']],
    });
    expect(result.data?.headers).toBeUndefined();
    expect(result.data?.rows[0]).toEqual([
      { text: '项目' },
      { text: 'Q1', fill: '#333333' },
    ]);
  });

  it('styled headers 兼容 bgColor / 顶层短手字段（与 parseTableCell 合并）', () => {
    const result = parseTableCellHeaderRow();
    expect(result.data?.rows[0]).toEqual([
      { text: '项目', fill: '#333333', style: { color: '#FFFFFF', bold: true, align: 'center' } },
    ]);
  });

  function parseTableCellHeaderRow() {
    return parseTableDataLike({
      headers: [
        { text: '项目', bgColor: '#333333', color: '#FFFFFF', bold: true, align: 'center' },
      ],
      rows: [['x']],
    });
  }

  it('styled headers 中任一 cell 非法 → 整体返回 error，不允许部分静默 drop', () => {
    const result = parseTableDataLike({
      headers: [
        { text: '项目', fill: '#333333' },
        { /* 缺 text */ fill: '#333333' },
      ],
      rows: [['x', 'y']],
    });
    expect(result.error).toMatch(/带样式的表头/);
    expect(result.data).toBeUndefined();
  });
});

describe('parseTableDataLike — headers 字段非法形态拒绝', () => {
  it('headers 是字符串而非数组 → error', () => {
    const result = parseTableDataLike({ headers: 'A,B', rows: [['x']] });
    expect(result.error).toMatch(/表头必须是数组/);
  });

  it('plain headers 含 null / 对象之外的非法值 → error', () => {
    const result = parseTableDataLike({ headers: ['A', null], rows: [['x', 'y']] });
    expect(result.error).toMatch(/表头必须是字符串/);
  });
});
