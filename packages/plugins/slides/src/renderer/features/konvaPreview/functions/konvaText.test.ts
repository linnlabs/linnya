import { describe, expect, it } from 'vitest';
import {
  resolveRenderableFontFamily,
} from './konvaText';

describe('konvaText', () => {
  it('builds an explicit Office fallback stack for renderer fonts', () => {
    expect(resolveRenderableFontFamily('Calibri Light')).toBe(
      '"Calibri Light", Calibri, "Helvetica Neue", Helvetica, Arial, sans-serif',
    );
    expect(resolveRenderableFontFamily('PingFang SC')).toBe(
      '"PingFang SC", "Helvetica Neue", Helvetica, Arial, sans-serif',
    );
  });
});
