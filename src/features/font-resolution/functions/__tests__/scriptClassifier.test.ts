import { describe, expect, it } from 'vitest';
import { classifyDominantScript } from '../scriptClassifier.js';

describe('classifyDominantScript', () => {
  it('纯中文文本归类为 eastAsian', () => {
    expect(classifyDominantScript('纯中文文本')).toBe('eastAsian');
  });

  it('纯 latin 文本归类为 latin', () => {
    expect(classifyDominantScript('Hello world')).toBe('latin');
  });

  it('CJK 字符占比超过 30% 的混排文本优先归类为 eastAsian', () => {
    expect(classifyDominantScript('中文字 mixed')).toBe('eastAsian');
  });

  it('阿拉伯、希伯来、泰文和天城文样例归类为 complex', () => {
    expect(classifyDominantScript('مرحبا بالعالم')).toBe('complex');
    expect(classifyDominantScript('שלום עולם')).toBe('complex');
    expect(classifyDominantScript('สวัสดีโลก')).toBe('complex');
    expect(classifyDominantScript('नमस्ते दुनिया')).toBe('complex');
  });

  it('空白或无可分类字符时归类为 latin', () => {
    expect(classifyDominantScript('')).toBe('latin');
    expect(classifyDominantScript('  123 !?  ')).toBe('latin');
  });
});
