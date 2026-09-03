import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveAppServerBundleDirectory } from './resolveAppServerBundleDirectory';

const roots: string[] = [];

function createRuntimeDirectory(packaged: boolean): { root: string; main: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-app-server-bundle-'));
  roots.push(root);
  const main = packaged
    ? path.join(root, 'app.asar.unpacked', 'dist', 'main')
    : path.join(root, 'dist', 'main');
  fs.mkdirSync(main, { recursive: true });
  fs.writeFileSync(path.join(main, 'app-server-entry.cjs'), '');
  fs.writeFileSync(path.join(main, 'app-server-backend.cjs'), '');
  return { root, main };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveAppServerBundleDirectory', () => {
  it('发布态固定使用 app.asar.unpacked，避免 standalone Node 读取 asar', () => {
    const runtime = createRuntimeDirectory(true);
    expect(resolveAppServerBundleDirectory({
      packaged: true,
      resourcesPath: runtime.root,
      developmentMainBundleDirectory: '/ignored/dist/main',
    })).toBe(runtime.main);
  });

  it('开发态沿用真实 dist/main，并在缺少 sidecar 产物时阻断启动', () => {
    const runtime = createRuntimeDirectory(false);
    expect(resolveAppServerBundleDirectory({
      packaged: false,
      resourcesPath: runtime.root,
      developmentMainBundleDirectory: runtime.main,
    })).toBe(runtime.main);
    fs.rmSync(path.join(runtime.main, 'app-server-backend.cjs'));
    expect(() => resolveAppServerBundleDirectory({
      packaged: false,
      resourcesPath: runtime.root,
      developmentMainBundleDirectory: runtime.main,
    })).toThrow('app-server-backend.cjs');
  });
});
