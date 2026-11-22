import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listOnDemandPluginDeclarations } from './readPluginDeclarations';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function declare(root: string, directory: string, manifest: Record<string, unknown> | string, onDemand = true): void {
  const target = path.join(root, directory);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (onDemand) fs.writeFileSync(path.join(target, '.install-on-demand'), '');
}

const manifest = (id: string) => ({
  id, version: '0.1.0', name: id, description: id, developer: 'Linnya', details: [id], entry: { backend: './dist/backend/index.cjs' },
});

describe('安装包内的远程插件声明', () => {
  it('只列出按需安装、可解析且目录名与 id 一致的声明', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-declarations-'));
    roots.push(root);
    declare(root, 'knowledge', manifest('knowledge'));
    declare(root, 'always', manifest('always'), false);
    declare(root, 'mismatch', manifest('other'));
    declare(root, 'broken', '{ not json');
    fs.writeFileSync(path.join(root, 'stray-file'), '');
    expect(listOnDemandPluginDeclarations(root)).toEqual(['knowledge']);
  });

  it('目录不存在或未配置时为空', () => {
    expect(listOnDemandPluginDeclarations(undefined)).toEqual([]);
    expect(listOnDemandPluginDeclarations(path.join(os.tmpdir(), 'linnya-no-such-declarations'))).toEqual([]);
  });
});
