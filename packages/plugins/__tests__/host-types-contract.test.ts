import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { collectPluginContractGuardViolations } from '../../../scripts/guards/agent-package-boundary-guard';

const repoRoot = path.resolve(__dirname, '../../..');
const pluginsRoot = path.join(repoRoot, 'packages/plugins');

const pluginIds = fs.readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(pluginId => fs.existsSync(path.join(pluginsRoot, pluginId, 'tsconfig.json'))
    && fs.existsSync(path.join(pluginsRoot, pluginId, 'package.json')))
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
    const config = z.object({ include: z.array(z.string()) }).parse(JSON.parse(tsconfigText(pluginId)));
    // 旧 owner 的环境声明仍须齐全；使用正式 vite/client 的新 owner 不再复制环境文件。
    const declaredHostTypes = config.include.filter(file => file.startsWith('host-types/')).sort();
    expect(hostTypesFiles(pluginId)).toEqual(declaredHostTypes);
  });

  it('keeps both environment-shim and mirror-free owners behind the same Host boundary', () => {
    // 复用生产门禁限制允许的 shim 与 tsconfig target，不能靠删掉镜像恢复 Host deep import。
    const ownerViolations = collectPluginContractGuardViolations().filter(violation =>
      pluginIds.some(pluginId => violation.file.startsWith(`packages/plugins/${pluginId}/`))
    );
    expect(ownerViolations).toEqual([]);
  });
});
