import { describe, expect, it } from 'vitest';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import {
  formatAnnotationTime,
  resolveAnnotationAuthorName,
} from './annotationPresentation';

const testMessage: EditorMessageResolver = (key) => {
  const messages = {
    'editor.annotation.author.user': 'User',
    'editor.annotation.time.yesterday': 'Yesterday',
  } satisfies Partial<Record<Parameters<EditorMessageResolver>[0], string>>;

  return messages[key] ?? key;
};

describe('annotationPresentation', () => {
  it('把历史默认作者解析为当前语言展示名', () => {
    expect(resolveAnnotationAuthorName(undefined, testMessage)).toBe('User');
    expect(resolveAnnotationAuthorName('', testMessage)).toBe('User');
    expect(resolveAnnotationAuthorName('用户', testMessage)).toBe('User');
    expect(resolveAnnotationAuthorName('User', testMessage)).toBe('User');
    expect(resolveAnnotationAuthorName('Alice', testMessage)).toBe('Alice');
  });

  it('相对日期文案通过 Editor message resolver 解析', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    expect(formatAnnotationTime(yesterday.toISOString(), testMessage)).toBe('Yesterday');
  });
});
