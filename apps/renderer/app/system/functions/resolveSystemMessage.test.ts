import { describe, expect, it } from 'vitest';
import { resolveSystemMessage } from './resolveSystemMessage';

describe('resolveSystemMessage', () => {
  it('resolves media user-facing messages through the app system catalog', () => {
    const text = resolveSystemMessage(
      'system.media.image.loadFailed',
      (key, fallback) => `${key}:${fallback}`,
    );

    expect(text).toBe('system.media.image.loadFailed:无法加载图片，请确认文件仍可访问。');
  });

  it('resolves export user-facing messages through the app system catalog', () => {
    const text = resolveSystemMessage(
      'system.export.pdf.saveFailed',
      (key, fallback) => `${key}:${fallback}`,
    );

    expect(text).toBe('system.export.pdf.saveFailed:生成或保存 PDF 失败。');
  });

  it('resolves shell user-facing messages through the app system catalog', () => {
    const text = resolveSystemMessage(
      'system.shell.external.unsupportedProtocol',
      (key, fallback) => `${key}:${fallback}`,
    );

    expect(text).toBe('system.shell.external.unsupportedProtocol:只能打开 http 或 https 链接。');
  });

  it('resolves quota user-facing messages through the app system catalog', () => {
    const text = resolveSystemMessage(
      'system.quota.policyNotFound',
      (key, fallback) => `${key}:${fallback}`,
    );

    expect(text).toBe('system.quota.policyNotFound:当前功能的配额规则未配置。');
  });

  it('resolves transcription user-facing messages through the app system catalog', () => {
    const text = resolveSystemMessage(
      'system.transcription.modelUnavailable',
      (key, fallback) => `${key}:${fallback}`,
    );

    expect(text).toBe('system.transcription.modelUnavailable:没有可用的音频转录模型，请先在设置中添加或启用一个。');
  });
});
