import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hostRendererExternalUrls } from '../../../../../packages/plugins/rendererHostExternalMap.mjs';
import {
  rendererUiPluginRuntimeEntries,
  rendererUiRuntimeEntries,
} from '../../../../../scripts/build/renderer-ui-runtime/rendererUiRuntimeEntryCatalog.mjs';
import {
  RENDERER_MODULE_RESOLUTION_CATALOG,
} from '../../../../../scripts/build/renderer-module-resolution/definitions/rendererModuleResolutionCatalog.js';

const root = process.cwd();
const workspacePluginRoot = 'packages/plugins';

const workspaceRendererPlugins = fs
  .readdirSync(path.join(root, workspacePluginRoot), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.posix.join(workspacePluginRoot, entry.name))
  .filter((packageDir) => fs.existsSync(path.join(root, packageDir, 'plugin.json')))
  .filter((packageDir) => fs.existsSync(path.join(root, packageDir, 'src/renderer')))
  .sort();

const rendererPluginSourceDirs = workspaceRendererPlugins
  .map((packageDir) => path.posix.join(packageDir, 'src/renderer'));

const rendererAppSourceDirs = [
  'apps/renderer/app',
  'apps/renderer/domains',
  'apps/renderer/shared',
];

const viteConfigPaths = workspaceRendererPlugins
  .map((packageDir) => path.posix.join(packageDir, 'vite.plugin.config.mts'))
  .filter((configPath) => fs.existsSync(path.join(root, configPath)));
const externalMapPath = 'packages/plugins/rendererHostExternalMap.mjs';
const rendererHtmlPath = 'index.html';

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listRuntimeSourceFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(root, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      files.push(...listRuntimeSourceFiles(relativePath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|vue)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|tsx|vue)$/.test(entry.name)) continue;
    files.push(relativePath);
  }

  return files;
}

interface RuntimeImport {
  readonly moduleId: string;
  readonly namedImports: readonly string[];
}

function parseRuntimeImports(source: string): RuntimeImport[] {
  const imports: RuntimeImport[] = [];
  const importRegex = /import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match = importRegex.exec(source);
  while (match) {
    const importClause = match[1] ?? '';
    const moduleId = match[2] ?? '';
    imports.push({
      moduleId,
      namedImports: parseNamedImports(importClause),
    });
    match = importRegex.exec(source);
  }
  return imports;
}

function parseNamedImports(importClause: string): string[] {
  const namedBlock = /\{([\s\S]*?)\}/.exec(importClause)?.[1];
  if (!namedBlock) return [];

  return namedBlock
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !item.startsWith('type '))
    .map((item) => item.split(/\s+as\s+/)[0]?.trim() ?? '')
    .filter((item) => item.length > 0);
}

function collectRuntimeImports(): RuntimeImport[] {
  return rendererPluginSourceDirs
    .flatMap(listRuntimeSourceFiles)
    .flatMap((filePath) => parseRuntimeImports(readRepoFile(filePath)));
}

function collectRuntimeImportsByModule(moduleId: string): Set<string> {
  const names = new Set<string>();
  for (const runtimeImport of collectRuntimeImports()) {
    if (runtimeImport.moduleId !== moduleId) continue;
    for (const namedImport of runtimeImport.namedImports) {
      names.add(namedImport);
    }
  }
  return names;
}

function parseRuntimeExportNames(source: string): string[] {
  const names = new Set<string>();
  const declarationRegex = /export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g;
  let declarationMatch = declarationRegex.exec(source);
  while (declarationMatch) {
    if (declarationMatch[1]) names.add(declarationMatch[1]);
    declarationMatch = declarationRegex.exec(source);
  }
  const exportRegex = /export\s+(?!type\b)\{([\s\S]*?)\}\s+from\s+['"][^'"]+['"]/g;
  let match = exportRegex.exec(source);
  while (match) {
    const exportBlock = match[1] ?? '';
    for (const rawItem of exportBlock.split(',')) {
      const item = rawItem.trim();
      if (!item) continue;
      const aliasMatch = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(item);
      names.add(aliasMatch?.[1] ?? item.split(/\s+/)[0] ?? item);
    }
    match = exportRegex.exec(source);
  }
  return Array.from(names).sort();
}

function rendererSdkUrl(specifier: string): string {
  return `plugin://host/plugin-renderer/${specifier.replace('@plugin/renderer/', '')}.js`;
}

function rendererHostExternalUrl(specifier: string): string {
  if (specifier === '@app/localization') {
    return 'plugin://host/app-localization.js';
  }
  return rendererSdkUrl(specifier);
}

describe('renderer plugin host external boundary', () => {
  it('由唯一 Renderer UI entry catalog 对账 package、provider、protocol、external 与 import map', () => {
    const packageJson = JSON.parse(readRepoFile('packages/renderer-ui/package.json')) as {
      readonly exports: Readonly<Record<string, string>>;
    };
    const hostModuleProviderSource = readRepoFile('apps/renderer/app/plugins/loader/hostModuleProvider.ts');
    const pluginProtocolSource = readRepoFile('src/electron-main/plugins/loader/pluginProtocol.ts');
    const rendererHtmlSource = readRepoFile(rendererHtmlPath);
    const moduleResolutionSpecifiers = new Set(
      RENDERER_MODULE_RESOLUTION_CATALOG.map(entry => entry.specifier),
    );

    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ...rendererUiRuntimeEntries.map(entry => entry.packageExport),
      './package.json',
    ].sort());
    expect(pluginProtocolSource).toContain('rendererUiPluginRuntimeEntries.map');
    expect(hostModuleProviderSource).toContain('rendererUiPluginRuntimeEntries.map');

    for (const entry of rendererUiRuntimeEntries) {
      expect(packageJson.exports[entry.packageExport]).toBe(`./${entry.canonicalSource.replace('packages/renderer-ui/', '')}`);
      if (entry.cssOnly) {
        expect(entry.pluginRuntimeExternal).toBe(false);
        expect(hostRendererExternalUrls).not.toHaveProperty(entry.specifier);
        expect(rendererHtmlSource).not.toContain(`"${entry.specifier}"`);
        continue;
      }

      expect(moduleResolutionSpecifiers).toContain(entry.specifier);
      if (entry.pluginRuntimeExternal) {
        expect(hostModuleProviderSource).toContain(`from '${entry.specifier}'`);
      } else {
        expect(entry.hostModuleKey).toBeNull();
        expect(entry.protocolUrl).toBeNull();
        expect(hostRendererExternalUrls).not.toHaveProperty(entry.specifier);
        expect(hostModuleProviderSource).not.toContain(`from '${entry.specifier}'`);
      }
      expect([...entry.namedExports].sort()).toEqual(
        parseRuntimeExportNames(readRepoFile(entry.canonicalSource)),
      );
    }

    for (const entry of rendererUiPluginRuntimeEntries) {
      expect(entry.protocolUrl).not.toBeNull();
      expect(hostRendererExternalUrls[entry.specifier]).toBe(entry.protocolUrl);
      expect(rendererHtmlSource).toContain(`"${entry.specifier}": "${entry.protocolUrl}"`);
    }
  });

  it('按 entry 交付策略 external 或 bundle 官方插件使用的 Renderer UI import', () => {
    const rendererUiEntriesBySpecifier = new Map(
      rendererUiRuntimeEntries.map(entry => [entry.specifier, entry]),
    );

    for (const runtimeImport of collectRuntimeImports()) {
      if (!runtimeImport.moduleId.startsWith('@linnya/renderer-ui')) continue;
      const entry = rendererUiEntriesBySpecifier.get(runtimeImport.moduleId);
      expect(entry, `Renderer UI entry missing: ${runtimeImport.moduleId}`).toBeDefined();
      for (const importedName of runtimeImport.namedImports) {
        expect(entry?.namedExports).toContain(importedName);
      }
      if (entry?.pluginRuntimeExternal) {
        expect(hostRendererExternalUrls).toHaveProperty(entry.specifier, entry.protocolUrl);
      } else {
        expect(hostRendererExternalUrls).not.toHaveProperty(entry?.specifier ?? '');
      }
    }
  });

  it('keeps app renderer imports on Vite-resolvable plugin SDK aliases', () => {
    const offenders = rendererAppSourceDirs
      .flatMap(listRuntimeSourceFiles)
      .filter((filePath) => readRepoFile(filePath).includes('src/plugin-sdk/renderer/'));

    expect(offenders).toEqual([]);
  });

  it('maps every runtime @plugin/renderer import used by official plugins to host modules and plugin:// shims', () => {
    const runtimeImports = collectRuntimeImports();
    const usedSdkSpecifiers = Array.from(new Set(
      runtimeImports
        .map((runtimeImport) => runtimeImport.moduleId)
        .filter((moduleId) => moduleId.startsWith('@plugin/renderer/') || moduleId === '@app/localization'),
    )).sort();
    const hostModuleProviderSource = readRepoFile('apps/renderer/app/plugins/loader/hostModuleProvider.ts');
    const pluginProtocolSource = readRepoFile('src/electron-main/plugins/loader/pluginProtocol.ts');
    const externalMapSource = readRepoFile(externalMapPath);
    const rendererHtmlSource = readRepoFile(rendererHtmlPath);
    const viteConfigSources = viteConfigPaths.map(readRepoFile);

    expect(usedSdkSpecifiers).toContain('@plugin/renderer/workspaceNavigation');
    expect(usedSdkSpecifiers).toContain('@plugin/renderer/interactiveTool');
    expect(usedSdkSpecifiers).toContain('@plugin/renderer/imageAssetSource');
    expect(usedSdkSpecifiers).toContain('@plugin/renderer/documentMutationPort');

    for (const specifier of usedSdkSpecifiers) {
      const expectedUrl = rendererHostExternalUrl(specifier);
      expect(hostModuleProviderSource).toContain(`'${specifier}':`);
      expect(pluginProtocolSource).toContain(`buildNamedHostShim('${specifier}'`);
      expect(pluginProtocolSource).toContain(new URL(expectedUrl).pathname);
      expect(externalMapSource).toContain(`'${specifier}': '${expectedUrl}'`);
    }

    for (const viteConfigSource of viteConfigSources) {
      expect(viteConfigSource).toContain('../rendererHostExternalMap.mjs');
      expect(viteConfigSource).toContain('external: isHostRendererExternal');
      expect(viteConfigSource).toContain('paths: resolveHostRendererExternalUrl');
    }

    const subrunToolUiSpecifier = '@plugin/renderer/subrunToolUi';
    expect(rendererHtmlSource).toContain(
      `"${subrunToolUiSpecifier}": "${rendererSdkUrl(subrunToolUiSpecifier)}"`,
    );
    expect(rendererHtmlSource).not.toContain('@plugin/renderer/taskToolUi');

    const exportArtifactSpecifier = '@plugin/renderer/exportArtifact';
    expect(rendererHtmlSource).toContain(
      `"${exportArtifactSpecifier}": "${rendererSdkUrl(exportArtifactSpecifier)}"`,
    );

    const composerCommandSpecifier = '@plugin/renderer/composerCommandPort';
    const composerCommandUrl = rendererHostExternalUrl(composerCommandSpecifier);
    expect(hostModuleProviderSource).toContain(`'${composerCommandSpecifier}':`);
    expect(pluginProtocolSource).toContain(`buildNamedHostShim('${composerCommandSpecifier}'`);
    expect(pluginProtocolSource).toContain(new URL(composerCommandUrl).pathname);
    expect(externalMapSource).toContain(`'${composerCommandSpecifier}': '${composerCommandUrl}'`);

    const subrunSpecifier = '@plugin/renderer/conversationSubrunInvocationPort';
    const subrunUrl = rendererHostExternalUrl(subrunSpecifier);
    expect(hostModuleProviderSource).toContain(`'${subrunSpecifier}':`);
    expect(pluginProtocolSource).toContain(`buildNamedHostShim('${subrunSpecifier}'`);
    expect(pluginProtocolSource).toContain(new URL(subrunUrl).pathname);
    expect(externalMapSource).toContain(`'${subrunSpecifier}': '${subrunUrl}'`);
  });

  it('keeps named runtime imports exported by plugin://host renderer SDK shims', () => {
    const sdkImportsByModule = new Map<string, Set<string>>();
    for (const runtimeImport of collectRuntimeImports()) {
      if (!runtimeImport.moduleId.startsWith('@plugin/renderer/') && runtimeImport.moduleId !== '@app/localization') continue;
      const names = sdkImportsByModule.get(runtimeImport.moduleId) ?? new Set<string>();
      for (const namedImport of runtimeImport.namedImports) {
        names.add(namedImport);
      }
      sdkImportsByModule.set(runtimeImport.moduleId, names);
    }

    const pluginProtocolSource = readRepoFile('src/electron-main/plugins/loader/pluginProtocol.ts');
    for (const [specifier, importedNames] of sdkImportsByModule) {
      expect(pluginProtocolSource).toContain(`buildNamedHostShim('${specifier}'`);
      for (const importedName of importedNames) {
        expect(pluginProtocolSource).toContain(`'${importedName}'`);
      }
    }
  });

  it('maps Vue and Pinia singletons to plugin://host URLs instead of browser bare specifiers', () => {
    const runtimeModuleIds = new Set(collectRuntimeImports().map((runtimeImport) => runtimeImport.moduleId));
    const pluginProtocolSource = readRepoFile('src/electron-main/plugins/loader/pluginProtocol.ts');
    const externalMapSource = readRepoFile(externalMapPath);
    const vueRuntimeImports = collectRuntimeImportsByModule('vue');
    const piniaRuntimeImports = collectRuntimeImportsByModule('pinia');

    expect(runtimeModuleIds.has('vue')).toBe(true);
    expect(runtimeModuleIds.has('pinia')).toBe(true);
    expect(pluginProtocolSource).toContain("['/vue.js'");
    expect(pluginProtocolSource).toContain("['/pinia.js'");
    for (const importedName of vueRuntimeImports) {
      expect(pluginProtocolSource).toContain(`export const ${importedName} = host.${importedName};`);
    }
    for (const importedName of piniaRuntimeImports) {
      expect(pluginProtocolSource).toContain(`export const ${importedName} = host.${importedName};`);
    }

    expect(externalMapSource).toContain("vue: 'plugin://host/vue.js'");
    expect(externalMapSource).toContain("pinia: 'plugin://host/pinia.js'");
    expect(externalMapSource).toContain('Object.prototype.hasOwnProperty.call(hostRendererExternalUrls, id)');
    expect(externalMapSource).not.toContain("id.startsWith('@plugin/renderer/')");
  });

});
