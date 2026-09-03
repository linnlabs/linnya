/**
 * parseContext —— Doc 26 P0 plumbing 锁死测试
 *
 * 这套测试钉死 `ParseWarning` / `ParseContext` 的核心契约，避免后续 P1/P2
 * 在重构 parser 时无声漂移：
 *
 * 1. path 拼接：根/子 ctx 的 `field` / `index` 派生路径
 * 2. push / collected：子 ctx push 的 warning 必须冒泡到根 ctx
 * 3. format / dedupe：observation 输出格式 + (path,code) 去重 + 全局 cap
 * 4. pushParseWarning ctx 缺失静默：兼容 P0 阶段下游不接 ctx 的旧路径
 */

import { describe, expect, it } from 'vitest';
import {
  createParseContext,
  dedupeParseWarnings,
  formatParseWarnings,
  pushParseWarning,
  type ParseWarning,
} from '../parseContext.js';

describe('parseContext / path 派生', () => {
  it('根 ctx 的 path 默认为空字符串', () => {
    const ctx = createParseContext();
    expect(ctx.path).toBe('');
  });

  it('createParseContext 接受自定义 rootPath', () => {
    const ctx = createParseContext('edits');
    expect(ctx.path).toBe('edits');
  });

  it('field 在根 ctx 不加前导点，在子 ctx 加点', () => {
    const root = createParseContext();
    expect(root.field('title').path).toBe('title');
    expect(root.field('title').field('subtitle').path).toBe('title.subtitle');
  });

  it('index 始终包裹在 [n] 中', () => {
    const root = createParseContext();
    expect(root.index(0).path).toBe('[0]');
    expect(root.field('slides').index(2).field('elements').index(7).path).toBe(
      'slides[2].elements[7]',
    );
  });
});

describe('parseContext / push & collected', () => {
  it('子 ctx push 的 warning 必须冒泡到根 ctx 的 collected()', () => {
    const root = createParseContext('edits');
    const child = root.index(2).field('operations').index(0);
    child.push({
      code: 'unknown_field',
      severity: 'warn',
      message: 'foo not recognized',
    });
    const collected = root.collected();
    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual({
      path: 'edits[2].operations[0]',
      code: 'unknown_field',
      severity: 'warn',
      message: 'foo not recognized',
    });
  });

  it('warning 顺序按 push 顺序保留', () => {
    const root = createParseContext();
    root.field('a').push({ code: 'c1', severity: 'warn', message: 'm1' });
    root.field('b').push({ code: 'c2', severity: 'info', message: 'm2' });
    const collected = root.collected();
    expect(collected.map((w) => w.code)).toEqual(['c1', 'c2']);
  });

  it('collected() 返回副本，外部修改不影响后续 push', () => {
    const root = createParseContext();
    root.push({ code: 'c1', severity: 'warn', message: 'm1' });
    const snapshot = root.collected();
    snapshot.push({ path: 'fake', code: 'c-fake', severity: 'warn', message: 'fake' });
    root.push({ code: 'c2', severity: 'warn', message: 'm2' });
    expect(root.collected()).toHaveLength(2);
    expect(root.collected().map((w) => w.code)).toEqual(['c1', 'c2']);
  });
});

describe('pushParseWarning / ctx 缺失兼容', () => {
  it('ctx 为 undefined 时静默跳过，不抛错', () => {
    expect(() => {
      pushParseWarning(undefined, {
        code: 'x',
        severity: 'warn',
        message: 'should be ignored',
      });
    }).not.toThrow();
  });

  it('ctx 存在时与 ctx.push 行为一致', () => {
    const ctx = createParseContext('root');
    pushParseWarning(ctx, { code: 'c1', severity: 'warn', message: 'm1' });
    expect(ctx.collected()).toEqual([
      { path: 'root', code: 'c1', severity: 'warn', message: 'm1' },
    ]);
  });
});

describe('formatParseWarnings', () => {
  it('warn / info 用不同 icon，path 与 hint 可选拼接', () => {
    const warnings: ParseWarning[] = [
      { path: 'edits[0]', code: 'invalid_edit_type', severity: 'warn', message: 'type missing' },
      { path: '', code: 'note', severity: 'info', message: 'fyi', hint: 'do x' },
    ];
    expect(formatParseWarnings(warnings)).toEqual([
      '⚠ invalid_edit_type edits[0]: type missing',
      'ℹ note: fyi（do x）',
    ]);
  });
});

describe('dedupeParseWarnings', () => {
  it('同一 (path,code) 默认只保留 1 条', () => {
    const warnings: ParseWarning[] = [
      { path: 'a', code: 'c', severity: 'warn', message: 'first' },
      { path: 'a', code: 'c', severity: 'warn', message: 'second' },
      { path: 'a', code: 'd', severity: 'warn', message: 'other code' },
    ];
    const result = dedupeParseWarnings(warnings);
    expect(result.map((w) => w.message)).toEqual(['first', 'other code']);
  });

  it('maxPerPathCode 自定义后允许保留更多同对 warning', () => {
    const warnings: ParseWarning[] = [
      { path: 'a', code: 'c', severity: 'warn', message: '1' },
      { path: 'a', code: 'c', severity: 'warn', message: '2' },
      { path: 'a', code: 'c', severity: 'warn', message: '3' },
    ];
    const result = dedupeParseWarnings(warnings, { maxPerPathCode: 2 });
    expect(result.map((w) => w.message)).toEqual(['1', '2']);
  });

  it('maxTotal 切断尾部多余条目', () => {
    const warnings: ParseWarning[] = Array.from({ length: 5 }, (_, i) => ({
      path: `p${i}`,
      code: 'c',
      severity: 'warn' as const,
      message: `msg${i}`,
    }));
    const result = dedupeParseWarnings(warnings, { maxTotal: 3 });
    expect(result.map((w) => w.path)).toEqual(['p0', 'p1', 'p2']);
  });

  it('不同 path 即使 code 相同也各自保留', () => {
    const warnings: ParseWarning[] = [
      { path: 'a', code: 'c', severity: 'warn', message: '1' },
      { path: 'b', code: 'c', severity: 'warn', message: '2' },
    ];
    expect(dedupeParseWarnings(warnings)).toHaveLength(2);
  });
});
