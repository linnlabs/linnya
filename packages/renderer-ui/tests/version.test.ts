import { describe, expect, it } from 'vitest';

import { RENDERER_UI_VERSION } from '../src/version.js';

describe('Renderer UI version contract', () => {
  it('提供有效且无预发布标记的首版 SemVer', () => {
    expect(RENDERER_UI_VERSION).toMatch(/^[1-9]\d*\.\d+\.\d+$/u);
  });
});
