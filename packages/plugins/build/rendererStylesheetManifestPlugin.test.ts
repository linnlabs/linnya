import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readRendererStylesheetSourceOrder } from './rendererStylesheetManifestPlugin';

const pluginsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('renderer stylesheet source order', () => {
  it.each([
  ['mindmap', 2],
  ['slides', 15],
] as const)('从 %s contribution 读取唯一顺序', (pluginId, expectedCount) => {
    const sources = readRendererStylesheetSourceOrder(
      path.join(pluginsRoot, pluginId, 'src/renderer/index.ts'),
    );
    expect(sources).toHaveLength(expectedCount);
    expect(new Set(sources).size).toBe(expectedCount);
  });

  it('Slides 顺序以 contribution tuple 为准，而不是 import 或目录枚举顺序', () => {
    const sources = readRendererStylesheetSourceOrder(
      path.join(pluginsRoot, 'slides/src/renderer/index.ts'),
    );
    expect(sources[0]).toMatch(/\/styles\/index\.css$/u);
    expect(sources[1]).toMatch(/\/SlidesDraftFailureLog\.css$/u);
    expect(sources[2]).toMatch(/\/SourceSelectionPromptPopover\.css$/u);
    expect(sources.at(-1)).toMatch(/\/PptPlanApprovalCard\.css$/u);
  });
});
