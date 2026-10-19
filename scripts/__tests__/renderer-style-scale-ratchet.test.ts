import { describe, expect, it } from 'vitest';

import {
  analyzeStyleScaleDeclaration,
  analyzeStyleScaleSource,
  compareStyleScale,
  formatStyleScaleBaseline,
  parseStyleScaleBaseline,
  runStyleScaleRatchet,
} from '../guards/renderer-style-scale-ratchet';

describe('Renderer style scale ratchet', () => {
  // 需要遍历全部 Renderer CSS，完整测试并行时不应受 5 秒默认值限制。
  it('当前刻度债务与 baseline 精确一致', () => {
    expect(runStyleScaleRatchet()).toEqual({ expanded: [], reduced: [] });
  }, 30_000);

  it('token 引用不计数，写死值按规则计数', () => {
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('font-size', 'var(--font-size-body)'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('font-size', '13px'))).toEqual({ 'SCALE-01-font-size': 1 });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('padding', 'var(--space-1-5) var(--space-3)'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('padding', '6px 12px 1px'))).toEqual({ 'SCALE-05-spacing': 2 });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('margin', 'var(--spacing-sm)'))).toEqual({
      'SCALE-09-legacy-alias': 1,
    });
  });

  it('只统计跨组件层级与非零动效，保留几何与单行对齐的合理写法', () => {
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('z-index', '2'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('z-index', '1000'))).toEqual({ 'SCALE-06-z-index': 1 });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('border-radius', '50%'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('line-height', '1'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('transition', 'opacity 0s linear'))).toEqual({});
    expect(
      Object.fromEntries(analyzeStyleScaleDeclaration('transition', 'opacity var(--duration-short) var(--ease-enter)')),
    ).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('transition', 'opacity 0.2s ease, color 150ms ease-out'))).toEqual({
      'SCALE-07-duration': 2,
      'SCALE-08-easing': 2,
    });
  });

  it('基础色阶在属性与自定义属性中都计数，语义 token 与黑白遮罩不计数', () => {
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('color', 'var(--color-red-400)'))).toEqual({
      'COLOR-01-base-palette': 1,
    });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('--local-bg', 'var(--color-gray-850)'))).toEqual({
      'COLOR-01-base-palette': 1,
    });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('color', 'var(--color-error-text)'))).toEqual({});
    expect(
      Object.fromEntries(analyzeStyleScaleDeclaration('background', 'color-mix(in srgb, var(--color-black) 50%, transparent)')),
    ).toEqual({});
  });

  it('transition 列表里的 all 计数，具体属性与 all 前缀的属性名不计数', () => {
    expect(
      Object.fromEntries(analyzeStyleScaleDeclaration('transition', 'all var(--duration-short) var(--ease-standard)')),
    ).toEqual({ 'MOTION-01-transition-all': 1 });
    expect(
      Object.fromEntries(analyzeStyleScaleDeclaration('transition', 'opacity var(--duration-short), all var(--duration-long)')),
    ).toEqual({ 'MOTION-01-transition-all': 1 });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('transition-property', 'all'))).toEqual({
      'MOTION-01-transition-all': 1,
    });
    expect(
      Object.fromEntries(analyzeStyleScaleDeclaration('transition', 'background-color var(--duration-short) var(--ease-standard)')),
    ).toEqual({});
  });

  it('自定义属性、选择器与注释不参与刻度统计', () => {
    const source = [
      '/* font-size: 99px */',
      '.a:hover { --local-gap: 12px; color: var(--color-text-primary); }',
      '@media (max-width: 600px) { .b { font-weight: 600 !important; } }',
    ].join('\n');
    expect(Object.fromEntries(analyzeStyleScaleSource(source))).toEqual({ 'SCALE-02-font-weight': 1 });
  });

  it('同一文件新增写死值形成扩张，减少则要求收紧 baseline', () => {
    const file = 'apps/renderer/example.css';
    const baseline = [{ ruleId: 'SCALE-05-spacing' as const, file, count: 2 }];
    expect(compareStyleScale([{ ruleId: 'SCALE-05-spacing', file, count: 3 }], baseline).expanded).toEqual([
      { ruleId: 'SCALE-05-spacing', file, count: 1 },
    ]);
    expect(compareStyleScale([{ ruleId: 'SCALE-05-spacing', file, count: 1 }], baseline).reduced).toEqual([
      { ruleId: 'SCALE-05-spacing', file, count: 1 },
    ]);
  });

  it('baseline 往返稳定并拒绝未知规则', () => {
    const entries = [{ ruleId: 'SCALE-01-font-size' as const, file: 'apps/renderer/a.css', count: 4 }];
    expect(parseStyleScaleBaseline(formatStyleScaleBaseline(entries))).toEqual(entries);
    expect(() => parseStyleScaleBaseline('1\tSCALE-99-unknown\tapps/renderer/a.css')).toThrow('无效 baseline rule');
  });

  it('有意取值不计入债务：相对字号、循环动画、版面尺寸、居中行高与 scale-exempt 标注', () => {
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('font-size', '0.85em'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('font-size', '0.75rem'))).toEqual({ 'SCALE-01-font-size': 1 });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('animation', 'spin 1s linear infinite'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('animation', 'fade-in 0.4s ease-out'))).toEqual({
      'SCALE-07-duration': 1,
      'SCALE-08-easing': 1,
    });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('padding', '56px var(--space-4)'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('padding', '36px'))).toEqual({ 'SCALE-05-spacing': 1 });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('margin', '1.4em 0 0.4em'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('margin', '2rem'))).toEqual({ 'SCALE-05-spacing': 1 });
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('line-height', '28px'))).toEqual({});
    expect(Object.fromEntries(analyzeStyleScaleDeclaration('line-height', '1.4'))).toEqual({ 'SCALE-03-line-height': 1 });
    const source = '.a { font-size: 20px; /* scale-exempt: 图标字形尺寸 */ padding: 7px; }';
    expect(Object.fromEntries(analyzeStyleScaleSource(source))).toEqual({ 'SCALE-05-spacing': 1 });
  });
});
