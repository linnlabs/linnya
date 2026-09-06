import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readRendererStylesheetSourceOrder } from './rendererStylesheetManifestPlugin';

const pluginsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('renderer stylesheet source order', () => {
  it.each(['mindmap', 'slides'])('从 %s contribution 接纳无重复、无遗漏的样式声明', (pluginId) => {
    const sources = readRendererStylesheetSourceOrder(
      path.join(pluginsRoot, pluginId, 'src/renderer/index.ts'),
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('输出顺序以 contribution tuple 为准，而不是 import 或目录枚举顺序', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-stylesheet-order-'));
    try {
      fs.writeFileSync(path.join(root, 'a.css'), '');
      fs.writeFileSync(path.join(root, 'b.css'), '');
      const entry = path.join(root, 'index.ts');
      fs.writeFileSync(entry, [
        "import first from './a.css?url';",
        "import second from './b.css?url';",
        'const orderedStyles = [second, first] as const;',
        'export const contribution = { stylesheets: orderedStyles };',
      ].join('\n'));

      const sources = readRendererStylesheetSourceOrder(entry);
      expect(sources.map(source => path.basename(source))).toEqual(['b.css', 'a.css']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
