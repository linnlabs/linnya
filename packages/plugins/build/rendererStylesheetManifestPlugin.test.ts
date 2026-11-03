import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';

import { readRendererStylesheetSourceOrder, rendererStylesheetManifestPlugin } from './rendererStylesheetManifestPlugin';

const pluginsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('renderer stylesheet source order', () => {
  it('真实Vite抽取的迟发CSS也必须声明，不能生成遗漏样式的成功artifact', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-stylesheet-artifact-'));
    try {
      fs.writeFileSync(path.join(root, 'base.css'), '.base { color: black; }');
      fs.writeFileSync(path.join(root, 'late.css'), '.late { color: red; }');
      const entry = path.join(root, 'index.ts');
      fs.writeFileSync(entry, "import base from './base.css?url';\nimport './late.css';\nexport const rendererPlugin = { stylesheets: [base] };\n");
      await expect(build({ configFile: false, root, logLevel: 'silent', plugins: [rendererStylesheetManifestPlugin({ entryPath: entry })], build: { write: false, lib: { entry, formats: ['es'], fileName: () => 'index.js', cssFileName: 'runtime' } } })).rejects.toThrow('contribution 未声明的 CSS');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
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
