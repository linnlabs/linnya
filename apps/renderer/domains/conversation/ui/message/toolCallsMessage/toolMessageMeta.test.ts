import { describe, expect, it } from 'vitest';
import { projectToolErrorMessage, readToolErrorDiagnostic } from './toolMessageMeta';

describe('toolMessageMeta', () => {
  it('读取 canonical tool_output.error', () => {
    const diagnostic = readToolErrorDiagnostic({
      error: 'Structured tool failure',
    });

    expect(diagnostic).toBe('Structured tool failure');
  });

  it('不兼容伪装到 data.error 的旧失败形状', () => {
    expect(readToolErrorDiagnostic({ data: { error: 'Legacy failure' } })).toBeUndefined();
  });

  it('优先展示真实错误，并在 observation 提供额外信息时一并展示', () => {
    expect(projectToolErrorMessage({
      toolResult: { error: 'Provider returned HTTP 429' },
      observation: '请稍后重试。',
      fallback: '未知错误',
    })).toBe('Provider returned HTTP 429\n\n请稍后重试。');
  });

  it('只有错误正文确实缺失时才使用 fallback', () => {
    expect(projectToolErrorMessage({
      toolResult: undefined,
      observation: '  ',
      fallback: '未知错误',
    })).toBe('未知错误');
  });
});
