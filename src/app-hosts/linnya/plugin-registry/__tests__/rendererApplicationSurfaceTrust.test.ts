import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { mapTrustedRendererApplicationSurfaces } from '../rendererApplicationSurfaceTrust';
import type { RendererPluginEntry } from 'src/electron-main/plugins/loader/rendererPluginEntries';

const root = mkdtempSync(path.join(tmpdir(), 'renderer-surface-trust-'));
afterEach(() => rmSync(root, { recursive: true, force: true }));

function entry(directory: string, sourceKind: RendererPluginEntry['sourceKind']): RendererPluginEntry {
  return { pluginId: 'knowledge', version: '1.0.0', rendererUiRange: '^3.3.0', entryUrl: 'plugin://knowledge/dist/renderer/index.js', cssUrls: [], pluginDir: directory, sourceKind };
}

it('only grants the fixed product slot to a matching admitted bundled artifact; development env cannot grant packaged access', () => {
  const bundledRoot = path.join(root, 'bundled');
  const active = path.join(root, 'active/knowledge/1.0.0');
  const bundled = path.join(bundledRoot, 'knowledge');
  for (const dir of [active, bundled]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'knowledge', version: '1.0.0', entry: { backend: 'backend.cjs', renderer: 'renderer.js' } }));
    writeFileSync(path.join(dir, 'SHA512SUMS'), 'verified-artifact-entry');
  }
  const options = { packaged: true, workspaceRoot: root, backendDirectDirs: [active], bundledPluginRoot: bundledRoot, getRegisteredPluginDirectory: () => active };
  expect(mapTrustedRendererApplicationSurfaces([entry(active, 'active')], options)[0]?.applicationSurfaceSlot).toBe('knowledge-base');
  expect(mapTrustedRendererApplicationSurfaces([entry(active, 'direct')], options)[0]?.applicationSurfaceSlot).toBeUndefined();
  writeFileSync(path.join(active, 'SHA512SUMS'), 'different-artifact');
  expect(mapTrustedRendererApplicationSurfaces([entry(active, 'active')], options)[0]?.applicationSurfaceSlot).toBeUndefined();
});

it('does not grant an ordinary direct plugin with the same id, or a Renderer from a different Backend source', () => {
  const official = path.join(root, 'packages/plugins/knowledge');
  const outsider = path.join(root, 'external');
  const options = { packaged: false, workspaceRoot: root, backendDirectDirs: [], bundledPluginRoot: undefined, getRegisteredPluginDirectory: () => official };
  expect(mapTrustedRendererApplicationSurfaces([entry(official, 'official-source')], options)[0]?.applicationSurfaceSlot).toBe('knowledge-base');
  expect(mapTrustedRendererApplicationSurfaces([entry(outsider, 'direct')], { ...options, getRegisteredPluginDirectory: () => outsider })[0]?.applicationSurfaceSlot).toBeUndefined();
  expect(mapTrustedRendererApplicationSurfaces([entry(outsider, 'direct')], { ...options, backendDirectDirs: [outsider] })[0]?.applicationSurfaceSlot).toBeUndefined();
  expect(mapTrustedRendererApplicationSurfaces([entry(outsider, 'direct')], { ...options, backendDirectDirs: [outsider], getRegisteredPluginDirectory: () => outsider })[0]?.applicationSurfaceSlot).toBe('knowledge-base');
});
