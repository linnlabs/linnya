import { describe, expect, it } from 'vitest';
import { isBlankAnswerContent } from './answerContent';

describe('isBlankAnswerContent', () => {
  it('空串与纯标准空白视为空白', () => {
    expect(isBlankAnswerContent('')).toBe(true);
    expect(isBlankAnswerContent('   ')).toBe(true);
    expect(isBlankAnswerContent('\n\t  \r\n')).toBe(true);
    expect(isBlankAnswerContent('\u00a0')).toBe(true); // NBSP
    expect(isBlankAnswerContent('\ufeff')).toBe(true); // BOM
  });

  it('仅由零宽/不可见字符构成的内容视为空白（根因场景）', () => {
    expect(isBlankAnswerContent('\u200b')).toBe(true); // 零宽空格
    expect(isBlankAnswerContent('\u200c')).toBe(true);
    expect(isBlankAnswerContent('\u200d')).toBe(true);
    expect(isBlankAnswerContent('\u2060')).toBe(true); // Word Joiner
    expect(isBlankAnswerContent('\u00ad')).toBe(true); // 软连字符
    expect(isBlankAnswerContent('  \u200b \n')).toBe(true); // 空白+零宽混合
  });

  it('包含真实可见内容时不算空白', () => {
    expect(isBlankAnswerContent('hello')).toBe(false);
    expect(isBlankAnswerContent('\u200bhello')).toBe(false);
    expect(isBlankAnswerContent(' 你好 ')).toBe(false);
  });
});
