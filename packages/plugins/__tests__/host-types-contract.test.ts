import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const pluginsRoot = path.join(repoRoot, 'packages/plugins');

const pluginIds = fs.readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(pluginId => fs.existsSync(path.join(pluginsRoot, pluginId, 'tsconfig.json')))
  .sort();

function tsconfigText(pluginId: string): string {
  const tsconfigPath = path.join(repoRoot, 'packages/plugins', pluginId, 'tsconfig.json');
  return fs.readFileSync(tsconfigPath, 'utf8');
}

function hostTypesFiles(pluginId: string): string[] {
  const hostTypesRoot = path.join(repoRoot, 'packages/plugins', pluginId, 'host-types');
  if (!fs.existsSync(hostTypesRoot)) {
    return [];
  }

  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (entry.isFile()) {
        out.push(path.relative(path.join(repoRoot, 'packages/plugins', pluginId), fullPath).replaceAll('\\', '/'));
      }
    }
  };

  visit(hostTypesRoot);
  return out.sort();
}

describe('plugin host contract type source', () => {
  it.each(pluginIds)('keeps %s @plugin facades pointed at the contract package', (pluginId) => {
    const tsconfig = tsconfigText(pluginId);

    expect(tsconfig).toContain('packages/plugin-host-contract/backend/*.ts');
    expect(tsconfig).toContain('packages/plugin-host-contract/renderer/*.ts');
    expect(tsconfig).toContain('packages/plugin-host-contract/renderer/localization.ts');
    expect(tsconfig).not.toContain('hostImports.d.ts');
    expect(tsconfig).not.toContain('rendererHostImports.d.ts');
    expect(tsconfig).not.toContain('src/app-hosts/linnya/plugin-registry/types');
  });

  it.each(pluginIds)('does not revive %s SDK mirror host-types', (pluginId) => {
    const allowedHostTypes = pluginId === 'sheet'
      ? ['host-types/renderer/sheetEngine.d.ts', 'host-types/rendererEnv.d.ts']
      : ['host-types/rendererEnv.d.ts'];

    expect(hostTypesFiles(pluginId)).toEqual(allowedHostTypes);
  });
});
