import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginManifestDataStorage } from '@app/schemas';

import { resolvePluginDataRoot } from './pluginDataRoot';

const roots: string[] = [];
const storage = (legacyRoots: readonly string[] = []): PluginManifestDataStorage => ({
  legacyRoots: [...legacyRoots],
  directories: { source: ['source'], derived: [], runtime: [] },
  userDataTables: ['kb_documents'],
});
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('plugin data root', () => {
  it('uses the generic Plugins/<id> root for new data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-root-'));
    roots.push(root);
    expect(resolvePluginDataRoot({ workspaceRoot: root, pluginId: 'demo', dataStorage: storage() }))
      .toBe(path.join(root, 'Plugins', 'demo'));
  });

  it('adopts a legacy root only when the manifest declares it and it exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-root-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'KnowledgeBase'));
    expect(resolvePluginDataRoot({ workspaceRoot: root, pluginId: 'demo', dataStorage: storage(['KnowledgeBase']) }))
      .toBe(path.join(root, 'KnowledgeBase'));
    expect(resolvePluginDataRoot({ workspaceRoot: root, pluginId: 'demo', dataStorage: storage() }))
      .toBe(path.join(root, 'Plugins', 'demo'));
  });

  it('rejects traversal and absolute legacy roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-root-'));
    roots.push(root);
    expect(() => resolvePluginDataRoot({ workspaceRoot: root, pluginId: 'demo', dataStorage: storage(['../outside']) }))
      .toThrow('旧数据根声明非法');
    expect(() => resolvePluginDataRoot({ workspaceRoot: root, pluginId: 'demo', dataStorage: storage(['/outside']) }))
      .toThrow('旧数据根声明非法');
  });

  it('rejects simultaneous legacy and new roots instead of guessing which one to delete', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-root-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'KnowledgeBase'));
    fs.mkdirSync(path.join(root, 'Plugins', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'KnowledgeBase', 'old.json'), 'old');
    fs.writeFileSync(path.join(root, 'Plugins', 'demo', 'new.json'), 'new');
    expect(() => resolvePluginDataRoot({ workspaceRoot: root, pluginId: 'demo', dataStorage: storage(['KnowledgeBase']) }))
      .toThrow('存在多个候选位置');
  });
});
