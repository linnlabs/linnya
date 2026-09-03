import { describe, expect, it } from 'vitest';
import { resolveToolTitleDescriptor } from './resolveToolTitleDescriptor';

describe('resolveToolTitleDescriptor', () => {
  it('每次展示都通过当前 resolver 解析标题，而不是复用 admission 时的语言字符串', () => {
    const descriptor = {
      text: {
        key: 'conversation.tool.todo.readCount',
        fallback: '读取 ToDo · {count} 条',
        params: { count: 2 },
      },
    } as const;

    expect(resolveToolTitleDescriptor(
      descriptor,
      text => `${text.key}:zh:${String(text.params?.count)}`,
    ).text).toBe('conversation.tool.todo.readCount:zh:2');
    expect(resolveToolTitleDescriptor(
      descriptor,
      text => `${text.key}:en:${String(text.params?.count)}`,
    ).text).toBe('conversation.tool.todo.readCount:en:2');
  });
});
