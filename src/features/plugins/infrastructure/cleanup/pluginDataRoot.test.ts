import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginManifestDataStorage } from '@app/schemas';

import { resolvePluginDataRoot } from './pluginDataRoot';
import { describePluginData } from '../../../../app-hosts/linnya/plugin-registry/pluginDataRoot';

const roots: string[] = [];
const storage = (legacyRoots: readonly string[] = []): PluginManifestDataStorage => ({
  legacyRoots: [...legacyRoots],
  directories: { source: ['source'], derived: [], runtime: [] },
  userDataTables: ['kb_documents'],
});
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeManifest(directory: string, id: string, legacyRoots: readonly string[]): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'plugin.json'), JSON.stringify({
    id, version: '1.0.0', name: 'Fixture', description: 'Fixture', developer: 'Test', details: ['Fixture'],
    entry: { backend: 'backend.cjs' }, dataStorage: storage(legacyRoots),
  }));
}

function bundledFixture(id: string, legacyRoots: readonly string[]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-root-'));
  roots.push(root);
  const bundledRoot = path.join(root, 'bundled');
  writeManifest(path.join(bundledRoot, id), id, legacyRoots);
  return { pluginId: id, workspaceRoot: root, bundledRoot, forCleanup: true, bundledSourceTrusted: true };
}

describe('plugin data root', () => {
  it('uses the generic Plugins/<id> root for new data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-plugin-root-'));
    roots.push(root);
    expect(resolvePluginDataRoot({ workspaceRoot: root, pluginId: 'demo', dataStorage: storage() }))
      .toBe(path.join(root, 'Plugins', 'demo'));
  });

  it('adopts a legacy root only when the manifest declares it and it exists', () => {
    const options = bundledFixture('knowledge', ['KnowledgeBase']);
    expect(describePluginData(options)?.dataRoot).toBe(path.join(options.workspaceRoot, 'Plugins', 'knowledge'));
    fs.mkdirSync(path.join(options.workspaceRoot, 'KnowledgeBase'));
    expect(describePluginData(options)?.dataRoot).toBe(path.join(options.workspaceRoot, 'KnowledgeBase'));
  });

  it('rejects traversal and absolute legacy roots', () => {
    expect(() => describePluginData(bundledFixture('knowledge', ['../outside']))).toThrow();
    expect(() => describePluginData(bundledFixture('knowledge', ['/outside']))).toThrow();
  });

  it('rejects simultaneous legacy and new roots instead of guessing which one to delete', () => {
    const options = bundledFixture('knowledge', ['KnowledgeBase']);
    const root = options.workspaceRoot;
    fs.mkdirSync(path.join(root, 'KnowledgeBase'));
    fs.mkdirSync(path.join(root, 'Plugins', 'knowledge'), { recursive: true });
    fs.writeFileSync(path.join(root, 'KnowledgeBase', 'old.json'), 'old');
    fs.writeFileSync(path.join(root, 'Plugins', 'knowledge', 'new.json'), 'new');
    expect(() => describePluginData(options))
      .toThrow('存在多个候选位置');
  });

  it.each([
    'Documents', 'Audit', 'Models', 'Plugins/other', 'ConversationAttachments', 'ConversationWorkDirectories',
    'Artifacts', 'Uploads', 'DocumentMedia', 'AudioRecordings', 'ResourceLibrary', 'temp', 'logs', 'workspace', 'UnknownData',
  ])('rejects non-allowlisted root %s even for the bundled owner', legacyRoot => {
    const options = bundledFixture('knowledge', [legacyRoot]);
    const untouched = path.join(options.workspaceRoot, legacyRoot);
    fs.mkdirSync(untouched, { recursive: true });
    expect(() => describePluginData(options)).toThrow('白名单授权');
    expect(fs.existsSync(untouched)).toBe(true);
  });

  it('rejects a legacy root whose registered owner is another plugin', () => {
    expect(() => describePluginData(bundledFixture('another-plugin', ['KnowledgeBase']))).toThrow('白名单授权');
  });

  it('admits the installed copy but not a direct directory using the same official declaration', () => {
    const options = bundledFixture('knowledge', ['KnowledgeBase']);
    const activeRoot = path.join(options.workspaceRoot, 'active');
    const installedDirectory = path.join(activeRoot, 'knowledge', '1.0.0');
    const directDirectory = path.join(options.workspaceRoot, 'direct');
    fs.mkdirSync(path.join(options.workspaceRoot, 'KnowledgeBase'));
    writeManifest(installedDirectory, 'knowledge', ['KnowledgeBase']);
    writeManifest(directDirectory, 'knowledge', ['KnowledgeBase']);
    fs.writeFileSync(path.join(installedDirectory, 'SHA512SUMS'), 'official');
    fs.writeFileSync(path.join(directDirectory, 'SHA512SUMS'), 'different');
    fs.writeFileSync(path.join(options.bundledRoot, 'knowledge', 'SHA512SUMS'), 'official');
    expect(describePluginData({ ...options, activeRoot, registeredDirectory: installedDirectory })?.dataRoot)
      .toBe(path.join(options.workspaceRoot, 'KnowledgeBase'));
    expect(() => describePluginData({ ...options, activeRoot, registeredDirectory: directDirectory })).toThrow('来源不可信');
  });

  it('refuses a linked old root instead of treating the target as plugin data', () => {
    const options = bundledFixture('knowledge', ['KnowledgeBase']);
    const other = path.join(options.workspaceRoot, 'other');
    fs.mkdirSync(other);
    fs.symlinkSync(other, path.join(options.workspaceRoot, 'KnowledgeBase'), 'junction');
    expect(() => describePluginData(options)).toThrow('不是实际目录');
  });
});
