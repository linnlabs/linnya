import { describe, expect, it } from 'vitest';
import { resolveRendererFont, resolveRendererFontFamily } from './fontResolution';

describe('fontResolution', () => {
  it('keeps the requested Office font as primary when runtime detection is unavailable', () => {
    const resolution = resolveRendererFont('Calibri Light');

    expect(resolution).toMatchObject({
      requestedFamily: 'Calibri Light',
      primaryFamily: 'Calibri Light',
      requestedAvailable: true,
      resolvedPrimaryAvailable: true,
    });
    expect(resolution.resolvedFamily).toBe(
      '"Calibri Light", Calibri, "Helvetica Neue", Helvetica, Arial, sans-serif',
    );
  });

  it('adds CJK-oriented system fallbacks for Chinese sample text', () => {
    expect(resolveRendererFontFamily('Calibri', { sampleText: '前装生态伙伴关系' })).toBe(
      'Calibri, "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif',
    );
  });
});
