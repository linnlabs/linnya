import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

import {
  parsePluginManifest,
  parsePluginRendererStylesheetManifest,
  PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH,
} from '../../packages/schemas/dist/esm/index.js';
import {
  findOfficialPluginReleaseTarget,
  readSinglePluginIdFromCli,
  repoRoot,
  resolvePluginPackageDir,
  resolvePluginProductionDistDirectories,
} from './plugin-release-targets.mjs';
import {
  rendererUiPluginRuntimeEntries,
} from '../build/renderer-ui-runtime/rendererUiRuntimeEntryCatalog.mjs';

const pluginId = readSinglePluginIdFromCli({
  scriptName: 'scripts/release/verify-plugin-artifact.mjs',
});
const packageDir = resolvePluginPackageDir(pluginId);
const manifestPath = path.join(packageDir, 'plugin.json');
const packageJsonPath = path.join(packageDir, 'package.json');
const distDir = path.join(packageDir, 'dist');
const artifactDir = path.join(distDir, 'artifacts');
const shouldVerifyExtraResources = process.argv.includes('--extra-resources');
const shouldRequireRendererAssets = process.argv.includes('--require-renderer-assets');
const bundledPluginRoot = process.env.LINNYA_BUNDLED_PLUGIN_ROOT;
const artifactVerification = findOfficialPluginReleaseTarget(pluginId)?.artifactVerification ?? {};
const rendererUiSourceRoot = path.join(repoRoot, 'packages/renderer-ui/src');
const allowedBackendBareSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map(specifier => `node:${specifier}`),
  '@app/schemas',
  '@app/schemas/document-view',
  '@app/schemas/file-locator',
  '@app/schemas/plugins/manifest',
  ...(artifactVerification.allowedBackendBareSpecifiers ?? []),
]);

const readJson = async filePath => JSON.parse(await fs.readFile(filePath, 'utf8'));
const sha512Hex = buffer => createHash('sha512').update(buffer).digest('hex');

const assertJsonEqual = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${pluginId} plugin artifact ${label} mismatch`);
  }
};

const sortStrings = values => [...values].sort((left, right) => left.localeCompare(right));

const normalizePluginRelativePath = (rawPath, label) => {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error(`${pluginId} plugin artifact ${label} must be a non-empty path`);
  }

  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(
      `${pluginId} plugin artifact ${label} must stay inside the plugin package: ${rawPath}`
    );
  }
  return normalized;
};

const buildManifestDisplayAssetPaths = manifest =>
  (manifest.screenshots ?? []).map((screenshot, index) =>
    normalizePluginRelativePath(screenshot, `screenshots[${index}]`)
  );

const assertOnlyProductionArtifactPaths = (
  artifactPaths,
  manifest,
  productionDistDirectories,
  label
) => {
  const displayAssetPaths = new Set(buildManifestDisplayAssetPaths(manifest));
  const unexpectedPaths = artifactPaths.filter(
    artifactPath =>
      artifactPath !== 'plugin.json' &&
      artifactPath !== 'SHA512SUMS' &&
      !artifactPath.startsWith('resources/') &&
      !displayAssetPaths.has(artifactPath) &&
      !productionDistDirectories.some(directory => artifactPath.startsWith(`${directory}/`))
  );
  if (unexpectedPaths.length > 0) {
    throw new Error(
      `${pluginId} ${label} contains files outside the production allowlist: ${unexpectedPaths.join(', ')}`
    );
  }
};

const assertZipEntry = (zip, entryPath, label) => {
  if (!zip.file(entryPath)) {
    throw new Error(`${pluginId} plugin artifact missing ${label}: ${entryPath}`);
  }
};

const assertZipPrefix = (zip, prefix, label) => {
  const hasEntry = Object.keys(zip.files).some(entryPath => entryPath.startsWith(prefix));
  if (!hasEntry) {
    throw new Error(`${pluginId} plugin artifact missing ${label}: ${prefix}`);
  }
};

const assertDeclaredArtifactRequirements = (artifactPaths, label) => {
  const pathSet = new Set(artifactPaths);
  for (const requirement of artifactVerification.requiredFiles ?? []) {
    const entryPath = normalizePluginRelativePath(requirement.path, requirement.label);
    if (!pathSet.has(entryPath)) {
      throw new Error(
        `${pluginId} plugin artifact missing ${requirement.label} ${label}: ${entryPath}`
      );
    }
  }
  for (const requirement of artifactVerification.requiredPrefixes ?? []) {
    const prefix = normalizePluginRelativePath(requirement.path, requirement.label);
    if (!artifactPaths.some(entryPath => entryPath.startsWith(prefix))) {
      throw new Error(
        `${pluginId} plugin artifact missing ${requirement.label} ${label}: ${prefix}`
      );
    }
  }
  for (const requirement of artifactVerification.minimumMatchingFiles ?? []) {
    const pattern = new RegExp(requirement.pattern, 'u');
    const count = artifactPaths.filter(entryPath => pattern.test(entryPath)).length;
    if (count < requirement.minimum) {
      throw new Error(
        `${pluginId} plugin artifact ${requirement.label} ${label} is incomplete: found=${count}, expected>=${requirement.minimum}`
      );
    }
  }
};

const typescriptLibReferencePattern = /<reference\s+lib=["']([^"']+)["'][^>]*>/gu;
const typescriptLibFileNamePattern = /^lib\.[a-z0-9.-]+\.d\.ts$/u;

const assertPackagedTypeScriptRuntime = async ({ artifactPaths, label, readText }) => {
  const runtimeConfig = artifactVerification.typescriptRuntime;
  if (!runtimeConfig) return;

  const runtimeRoot = normalizePluginRelativePath(runtimeConfig.root, 'TypeScript runtime root');
  const readRequiredText = async entryPath => {
    const text = await readText(entryPath);
    if (typeof text !== 'string') {
      throw new Error(
        `${pluginId} plugin artifact missing readable TypeScript runtime file ${label}: ${entryPath}`
      );
    }
    return text;
  };
  const runtimeManifest = JSON.parse(
    await readRequiredText(`${runtimeRoot}/runtime-manifest.json`)
  );
  const runtimePackageJson = JSON.parse(await readRequiredText(`${runtimeRoot}/package.json`));
  if (
    runtimeManifest.schemaVersion !== 1 ||
    typeof runtimeManifest.packageVersion !== 'string' ||
    !Array.isArray(runtimeManifest.standardLibRoots) ||
    !runtimeManifest.standardLibRoots.every(value => typeof value === 'string') ||
    !Array.isArray(runtimeManifest.standardLibFiles) ||
    !runtimeManifest.standardLibFiles.every(value => typeof value === 'string')
  ) {
    throw new Error(`${pluginId} plugin artifact TypeScript runtime manifest is invalid ${label}`);
  }
  if (
    runtimePackageJson.name !== 'typescript' ||
    runtimePackageJson.version !== runtimeManifest.packageVersion ||
    runtimePackageJson.main !== './lib/typescript.js'
  ) {
    throw new Error(
      `${pluginId} plugin artifact TypeScript runtime package metadata is invalid ${label}`
    );
  }

  const closure = new Set();
  const visit = async fileName => {
    if (
      !typescriptLibFileNamePattern.test(fileName) ||
      path.posix.basename(fileName) !== fileName
    ) {
      throw new Error(
        `${pluginId} plugin artifact has invalid TypeScript stdlib filename ${label}: ${fileName}`
      );
    }
    if (closure.has(fileName)) return;
    closure.add(fileName);
    const source = await readRequiredText(`${runtimeRoot}/lib/${fileName}`);
    for (const match of source.matchAll(typescriptLibReferencePattern)) {
      const libName = match[1]?.trim().toLowerCase();
      if (!libName) {
        throw new Error(
          `${pluginId} plugin artifact has an empty TypeScript stdlib reference ${label}: ${fileName}`
        );
      }
      await visit(`lib.${libName}.d.ts`);
    }
  };
  for (const root of runtimeManifest.standardLibRoots) {
    await visit(root);
  }

  const expectedFiles = [...closure].sort((left, right) => left.localeCompare(right));
  const declaredFiles = [...runtimeManifest.standardLibFiles].sort((left, right) =>
    left.localeCompare(right)
  );
  const actualFiles = artifactPaths
    .filter(
      entryPath => entryPath.startsWith(`${runtimeRoot}/lib/lib.`) && entryPath.endsWith('.d.ts')
    )
    .map(entryPath => path.posix.basename(entryPath))
    .sort((left, right) => left.localeCompare(right));
  if (
    JSON.stringify(expectedFiles) !== JSON.stringify(declaredFiles) ||
    JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)
  ) {
    throw new Error(
      `${pluginId} plugin artifact TypeScript stdlib is not the exact reference closure ${label}: expected=${expectedFiles.length}, declared=${declaredFiles.length}, actual=${actualFiles.length}`
    );
  }
};

const listFiles = async dir => {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
};

const assertFile = async (filePath, label) => {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(
      `${pluginId} bundled artifact missing ${label}: ${path.relative(repoRoot, filePath)}`
    );
  }
};

const assertDirectory = async (dir, label) => {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(
      `${pluginId} bundled artifact missing ${label}: ${path.relative(repoRoot, dir)}`
    );
  }
};

const stripJavaScriptCommentsAndLiterals = source => {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      output += '  ';
      index += 2;
      while (index < source.length && source[index] !== '\n') {
        output += ' ';
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      output += '  ';
      index += 2;
      while (index < source.length) {
        const blockChar = source[index];
        const blockNext = source[index + 1];
        if (blockChar === '*' && blockNext === '/') {
          output += '  ';
          index += 2;
          break;
        }
        output += blockChar === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      output += ' ';
      index += 1;
      while (index < source.length) {
        const stringChar = source[index];
        output += stringChar === '\n' ? '\n' : ' ';
        index += 1;
        if (stringChar === '\\') {
          if (index < source.length) {
            output += source[index] === '\n' ? '\n' : ' ';
            index += 1;
          }
          continue;
        }
        if (stringChar === quote) break;
      }
      continue;
    }

    output += char;
    index += 1;
  }
  return output;
};

const rendererNodeProcessPatterns = [
  {
    label: 'Node process import',
    pattern: /\b(?:import|from)\s*(?:[\s\S]{0,120}?)['"]node:process['"]/u,
    stripLiterals: false,
  },
  {
    label: 'Node process require',
    pattern: /\brequire\s*\(\s*['"](?:node:)?process['"]\s*\)/u,
    stripLiterals: false,
  },
  {
    label: 'global process object access',
    pattern: /\b(?:globalThis|global|window|self)\s*(?:\.|\?\.)\s*process\b/u,
    stripLiterals: true,
  },
  {
    label: 'process property access',
    pattern:
      /\bprocess\s*(?:\.|\?\.)\s*(?:env|platform|pid|argv|cwd|stdout|stderr|stdin|exit|memoryUsage|execArgv|nextTick|browser|versions|resourcesPath|type)\b/u,
    stripLiterals: true,
  },
];

const assertNoRendererNodeProcessReferences = (source, filePath) => {
  const codeOnlySource = stripJavaScriptCommentsAndLiterals(source);
  for (const { label, pattern, stripLiterals } of rendererNodeProcessPatterns) {
    const candidateSource = stripLiterals ? codeOnlySource : source;
    if (pattern.test(candidateSource)) {
      throw new Error(
        `${pluginId} renderer artifact contains ${label}: ${path.relative(packageDir, filePath)}`
      );
    }
  }
};

const rendererUiBareImportPattern = /(?:\bfrom|\bimport\s*\()\s*['"](@linnya\/renderer-ui(?:\/[^'"]*)?)['"]/gu;

const assertNoBareRendererUiImports = (source, artifactPath, label) => {
  const unrewrittenSpecifiers = Array.from(
    source.matchAll(rendererUiBareImportPattern),
    match => match[1]
  ).filter(Boolean);
  if (unrewrittenSpecifiers.length === 0) return;

  throw new Error(
    `${pluginId} renderer artifact contains unrewritten Renderer UI imports ${label}: ${artifactPath} -> ${[...new Set(unrewrittenSpecifiers)].join(', ')}`
  );
};

const extractCssSelectorClassNames = source => {
  const classNames = new Set();
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//gu, '');
  for (const ruleMatch of withoutComments.matchAll(/(?:^|\})\s*([^@}\n][^{]+)\{/gmu)) {
    const selector = ruleMatch[1];
    if (!selector) continue;
    for (const classMatch of selector.matchAll(/\.([a-z_][a-z0-9_-]*)/giu)) {
      if (classMatch[1]) classNames.add(classMatch[1]);
    }
  }
  return classNames;
};

const readRendererUiStyleFacts = async () => {
  // feature-local CSS 也是 Renderer UI 私有样式合同，artifact 验证不能只看顶层 styles。
  const cssFiles = (await listFiles(rendererUiSourceRoot)).filter(filePath =>
    filePath.endsWith('.css')
  );
  const tokenDefinitions = new Set();
  const classNames = new Set();
  for (const filePath of cssFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    for (const match of source.matchAll(/(--[a-z][a-z0-9-]*)\s*:/giu)) {
      if (match[1]) tokenDefinitions.add(match[1]);
    }
    for (const className of extractCssSelectorClassNames(source)) classNames.add(className);
  }
  return { classNames, tokenDefinitions };
};

const extractRendererUiRuntimeImports = source => {
  const specifiers = new Set();
  const staticImportPattern = /\bimport\s+(?!type\b)([\s\S]*?)\s+from\s+['"](@linnya\/renderer-ui(?:\/[^'"]*)?)['"]/gu;
  for (const match of source.matchAll(staticImportPattern)) {
    const importClause = match[1]?.trim();
    const specifier = match[2];
    if (!importClause || !specifier) continue;
    const namedOnly = importClause.match(/^\{([\s\S]*)\}$/u)?.[1];
    if (
      namedOnly !== undefined
      && namedOnly.split(',').every(binding => /^type\b/u.test(binding.trim()))
    ) {
      continue;
    }
    specifiers.add(specifier);
  }

  const sideEffectOrDynamicPattern = /\bimport\s*(?:\(\s*)?['"](@linnya\/renderer-ui(?:\/[^'"]*)?)['"]\s*\)?/gu;
  for (const match of source.matchAll(sideEffectOrDynamicPattern)) {
    if (match[1]) specifiers.add(match[1]);
  }
  return specifiers;
};

const readRendererUiRuntimeImportsFromSource = async () => {
  const rendererSourceDir = path.join(packageDir, 'src/renderer');
  const sourceFiles = (await listFiles(rendererSourceDir)).filter(filePath =>
    /\.(?:js|jsx|ts|tsx|vue)$/u.test(filePath)
  );
  const specifiers = new Set();
  for (const filePath of sourceFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    for (const specifier of extractRendererUiRuntimeImports(source)) specifiers.add(specifier);
  }
  return specifiers;
};

const assertRendererUiArtifactBoundary = async ({
  cssArtifacts,
  javascriptArtifacts,
  label,
}) => {
  const styleFacts = await readRendererUiStyleFacts();
  const rendererUiRuntimeImports = await readRendererUiRuntimeImportsFromSource();
  const javascriptSources = [];

  for (const artifact of javascriptArtifacts) {
    const source = await artifact.read();
    javascriptSources.push(source);
    assertNoBareRendererUiImports(source, artifact.path, label);
  }

  for (const entry of rendererUiPluginRuntimeEntries) {
    if (!rendererUiRuntimeImports.has(entry.specifier)) continue;
    if (!javascriptSources.some(source => source.includes(entry.protocolUrl))) {
      throw new Error(
        `${pluginId} renderer artifact is missing Renderer UI host external ${label}: ${entry.specifier} -> ${entry.protocolUrl}`
      );
    }
  }

  for (const artifact of cssArtifacts) {
    const source = await artifact.read();
    const duplicateTokens = Array.from(source.matchAll(/(--[a-z][a-z0-9-]*)\s*:/giu))
      .map(match => match[1])
      .filter(token => token && styleFacts.tokenDefinitions.has(token));
    const duplicateClasses = [...extractCssSelectorClassNames(source)]
      .filter(className => styleFacts.classNames.has(className));
    if (duplicateTokens.length > 0 || duplicateClasses.length > 0) {
      throw new Error(
        `${pluginId} renderer artifact duplicates Renderer UI CSS ${label}: ${artifact.path}`
        + `${duplicateTokens.length > 0 ? `; tokens=${[...new Set(duplicateTokens)].join(', ')}` : ''}`
        + `${duplicateClasses.length > 0 ? `; classes=${[...new Set(duplicateClasses)].join(', ')}` : ''}`
      );
    }
  }
};

const listCommonJsBareSpecifiers = source => {
  const specifiers = new Set();
  const requirePattern = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu;
  for (const match of source.matchAll(requirePattern)) {
    const specifier = match[1];
    if (specifier && !specifier.startsWith('.') && !specifier.startsWith('/')) {
      specifiers.add(specifier);
    }
  }
  return [...specifiers].sort((left, right) => left.localeCompare(right));
};

const verifyBackendRuntimeDependencies = async manifest => {
  if (!manifest.entry.backend) return;

  const backendEntryPath = path.join(
    packageDir,
    ...normalizePluginRelativePath(manifest.entry.backend, 'entry.backend').split('/')
  );
  const source = await fs.readFile(backendEntryPath, 'utf8');
  const unexpectedSpecifiers = listCommonJsBareSpecifiers(source).filter(
    specifier =>
      !allowedBackendBareSpecifiers.has(specifier) && !specifier.startsWith('@plugin/backend/')
  );

  if (unexpectedSpecifiers.length > 0) {
    throw new Error(
      `${pluginId} backend artifact contains unpackaged runtime dependencies: ${unexpectedSpecifiers.join(', ')}`
    );
  }
};

const readChecksumLines = async checksumPath => {
  const content = await fs.readFile(checksumPath, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
};

const assertChecksumIncludes = async (checksumPath, artifactPath) => {
  const lines = await readChecksumLines(checksumPath);
  const suffix = `  ${artifactPath}`;
  if (!lines.some(line => line.endsWith(suffix))) {
    throw new Error(`${pluginId} SHA512SUMS missing entry: ${artifactPath}`);
  }
};

const assertChecksumContentIncludes = (checksumContent, artifactPath) => {
  const suffix = `  ${artifactPath}`;
  const lines = checksumContent
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (!lines.some(line => line.endsWith(suffix))) {
    throw new Error(`${pluginId} artifact root SHA512SUMS missing entry: ${artifactPath}`);
  }
};

const verifyZipChecksum = async zipPath => {
  const checksumPath = `${zipPath}.sha512`;
  const checksumContent = await fs.readFile(checksumPath, 'utf8');
  const expected = checksumContent.trim().split(/\s+/u)[0];
  const actual = sha512Hex(await fs.readFile(zipPath));
  if (actual !== expected) {
    throw new Error(
      `${pluginId} artifact zip sha512 mismatch: expected=${expected}, actual=${actual}`
    );
  }
};

const verifyContentBom = () => {
  const contentBomScript = path.join(
    repoRoot,
    'scripts/release/orchestration/generatePluginArtifactContentBom.ts'
  );
  execFileSync(process.execPath, ['--import', 'tsx', contentBomScript, pluginId, '--verify'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
};

const readDiskRendererStylesheetManifest = async manifest => {
  if (!manifest.entry.renderer) return null;
  const manifestPath = path.join(
    packageDir,
    ...PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH.split('/')
  );
  const stylesheetManifest = parsePluginRendererStylesheetManifest(await readJson(manifestPath));
  const rendererDir = path.join(packageDir, 'dist/renderer');
  const actualStylesheets = (await listFiles(rendererDir))
    .filter(filePath => filePath.endsWith('.css'))
    .map(filePath => path.relative(rendererDir, filePath).replace(/\\/g, '/'))
    .sort((left, right) => left.localeCompare(right));
  const declaredStylesheets = [...stylesheetManifest.stylesheets]
    .sort((left, right) => left.localeCompare(right));
  assertJsonEqual(actualStylesheets, declaredStylesheets, 'renderer stylesheet file set');
  return stylesheetManifest;
};

const verifyZipArtifact = async (manifest, productionDistDirectories) => {
  const zipName = `${manifest.id}-${manifest.version}.zip`;
  const zipPath = path.join(artifactDir, zipName);
  await assertFile(zipPath, 'artifact zip');
  await verifyZipChecksum(zipPath);

  const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
  const zipFilePaths = Object.entries(zip.files)
    .filter(([, entry]) => !entry.dir)
    .map(([entryPath]) => entryPath);
  assertOnlyProductionArtifactPaths(
    zipFilePaths,
    manifest,
    productionDistDirectories,
    'plugin zip'
  );
  const zippedManifest = parsePluginManifest(
    JSON.parse((await zip.file('plugin.json')?.async('string')) ?? 'null')
  );
  assertJsonEqual(zippedManifest, manifest, 'zipped plugin.json');

  for (const [entryName, rawEntryPath] of Object.entries(manifest.entry)) {
    assertZipEntry(
      zip,
      normalizePluginRelativePath(rawEntryPath, `entry.${entryName}`),
      `entry.${entryName}`
    );
  }
  for (const assetPath of buildManifestDisplayAssetPaths(manifest)) {
    assertZipEntry(zip, assetPath, `display asset ${assetPath}`);
  }
  assertZipEntry(zip, 'SHA512SUMS', 'root checksum file');
  const checksumContent = await zip.file('SHA512SUMS')?.async('string');
  if (!checksumContent) {
    throw new Error(`${pluginId} plugin artifact missing readable root SHA512SUMS`);
  }
  assertChecksumContentIncludes(checksumContent, 'plugin.json');
  for (const rawEntryPath of Object.values(manifest.entry)) {
    assertChecksumContentIncludes(
      checksumContent,
      normalizePluginRelativePath(rawEntryPath, 'entry')
    );
  }

  if (manifest.entry.renderer) {
    const diskStylesheetManifest = await readDiskRendererStylesheetManifest(manifest);
    const zippedStylesheetManifest = parsePluginRendererStylesheetManifest(
      JSON.parse(
        (await zip.file(PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH)?.async('string')) ?? 'null'
      )
    );
    assertJsonEqual(
      zippedStylesheetManifest,
      diskStylesheetManifest,
      'renderer stylesheet manifest in zip'
    );
    assertChecksumContentIncludes(checksumContent, PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH);
    for (const stylesheetPath of zippedStylesheetManifest.stylesheets) {
      const artifactPath = `dist/renderer/${stylesheetPath}`;
      assertZipEntry(zip, artifactPath, `renderer stylesheet ${stylesheetPath}`);
      assertChecksumContentIncludes(checksumContent, artifactPath);
    }
    await assertRendererUiArtifactBoundary({
      label: 'in zip',
      javascriptArtifacts: zipFilePaths
        .filter(entryPath => entryPath.startsWith('dist/renderer/') && entryPath.endsWith('.js'))
        .map(entryPath => ({
          path: entryPath,
          read: () => zip.file(entryPath)?.async('string'),
        })),
      cssArtifacts: zippedStylesheetManifest.stylesheets.map(stylesheetPath => {
        const entryPath = `dist/renderer/${stylesheetPath}`;
        return {
          path: entryPath,
          read: () => zip.file(entryPath)?.async('string'),
        };
      }),
    });
  }

  if (shouldRequireRendererAssets && manifest.entry.renderer) {
    assertZipPrefix(zip, 'dist/renderer/assets/', 'renderer assets');
  }
  if (Array.isArray(manifest.skills) && manifest.skills.length > 0) {
    assertZipPrefix(zip, 'resources/skills/', 'skill resources');
  }
  assertDeclaredArtifactRequirements(Object.keys(zip.files), 'zip entries');
  await assertPackagedTypeScriptRuntime({
    artifactPaths: zipFilePaths,
    label: 'in zip',
    readText: async entryPath => zip.file(entryPath)?.async('string'),
  });
};

const verifyPackageManifestContract = async manifest => {
  const packageJson = await readJson(packageJsonPath);
  if (packageJson.version !== manifest.version) {
    throw new Error(
      `${pluginId} package.json version mismatch: expected=${manifest.version}, actual=${packageJson.version}`
    );
  }
  if (packageJson.name && packageJson.name !== `@plugin/${manifest.id}`) {
    throw new Error(
      `${pluginId} package.json name mismatch: expected=@plugin/${manifest.id}, actual=${packageJson.name}`
    );
  }
  if (manifest.entry.renderer) {
    const manifestRange = manifest.compat?.rendererUi;
    const peerRange = packageJson.peerDependencies?.['@linnya/renderer-ui'];
    const developmentRange = packageJson.devDependencies?.['@linnya/renderer-ui'];
    if (peerRange !== manifestRange) {
      throw new Error(
        `${pluginId} Renderer UI range mismatch: package peer=${peerRange}, manifest=${manifestRange}`
      );
    }
    if (developmentRange !== 'workspace:*') {
      throw new Error(
        `${pluginId} renderer package must develop against @linnya/renderer-ui workspace:*`
      );
    }
  }
};

const verifyManifestDataContract = manifest => {
  const ownedTables = manifest.ownedTables ?? [];
  const migrations = manifest.migrations ?? [];
  const migrationCapability = (manifest.capabilities ?? []).find(
    capability => capability.name === 'migration'
  );

  if (ownedTables.length > 0 && migrations.length === 0) {
    throw new Error(`${pluginId} declares ownedTables but no migrations`);
  }
  if (migrations.length > 0 && ownedTables.length === 0) {
    throw new Error(`${pluginId} declares migrations but no ownedTables`);
  }
  if (migrationCapability && migrations.length === 0) {
    throw new Error(`${pluginId} declares migration capability but no migrations`);
  }
};

const verifyLatestManifest = async manifest => {
  const latestPath = path.join(artifactDir, 'latest.json');
  const stat = await fs.stat(latestPath).catch(() => null);
  if (!stat?.isFile()) return;

  const latest = await readJson(latestPath);
  if (latest.version !== manifest.version) {
    throw new Error(
      `${pluginId} latest.json version mismatch: expected=${manifest.version}, actual=${latest.version}`
    );
  }
  if (latest.minApp !== undefined && latest.minApp !== manifest.compat?.minApp) {
    throw new Error(
      `${pluginId} latest.json minApp mismatch: expected=${manifest.compat?.minApp}, actual=${latest.minApp}`
    );
  }
  if (manifest.entry.renderer && latest.rendererUi !== manifest.compat?.rendererUi) {
    throw new Error(
      `${pluginId} latest.json rendererUi mismatch: expected=${manifest.compat?.rendererUi}, actual=${latest.rendererUi}`
    );
  }
  const zipName = `${manifest.id}-${manifest.version}.zip`;
  if (typeof latest.url === 'string' && !latest.url.endsWith(`/${zipName}`)) {
    throw new Error(`${pluginId} latest.json url must point to ${zipName}: ${latest.url}`);
  }
  if (typeof latest.sha512 === 'string') {
    const zipPath = path.join(artifactDir, zipName);
    const actualSha512 = sha512Hex(await fs.readFile(zipPath));
    if (latest.sha512 !== actualSha512) {
      throw new Error(
        `${pluginId} latest.json sha512 mismatch: expected=${actualSha512}, actual=${latest.sha512}`
      );
    }
  }

  const expectedAssetPaths = sortStrings([...buildManifestDisplayAssetPaths(manifest)]);
  const latestAssetPaths = sortStrings(latest.assets?.map(asset => asset.path) ?? []);
  if (latest.assets !== undefined) {
    assertJsonEqual(latestAssetPaths, expectedAssetPaths, 'latest.json assets');
  }
};

const verifyDistChecksums = async (manifest, productionDistDirectories) => {
  const checksumPath = path.join(distDir, 'SHA512SUMS');
  await assertFile(checksumPath, 'dist SHA512SUMS');
  const checksumArtifactPaths = (await readChecksumLines(checksumPath)).map(line =>
    line.slice(line.indexOf('  ') + 2)
  );
  assertOnlyProductionArtifactPaths(
    checksumArtifactPaths,
    manifest,
    productionDistDirectories,
    'dist SHA512SUMS'
  );
  for (const rawEntryPath of Object.values(manifest.entry)) {
    await assertChecksumIncludes(checksumPath, normalizePluginRelativePath(rawEntryPath, 'entry'));
  }
  if (manifest.entry.renderer) {
    await assertChecksumIncludes(checksumPath, 'dist/renderer/index.js');
    await assertChecksumIncludes(checksumPath, PLUGIN_RENDERER_STYLESHEET_MANIFEST_PATH);
  }
  if (manifest.entry.backend) {
    await assertChecksumIncludes(checksumPath, 'dist/backend/index.cjs');
  }
  assertDeclaredArtifactRequirements(checksumArtifactPaths, 'dist checksum entries');
  await assertPackagedTypeScriptRuntime({
    artifactPaths: checksumArtifactPaths,
    label: 'in dist checksums',
    readText: entryPath =>
      fs.readFile(path.join(packageDir, ...entryPath.split('/')), 'utf8').catch(() => undefined),
  });
};

const verifyRendererBrowserArtifact = async manifest => {
  if (!manifest.entry.renderer) return;

  const rendererDir = path.join(packageDir, 'dist', 'renderer');
  await readDiskRendererStylesheetManifest(manifest);
  const files = await listFiles(rendererDir);
  const jsFiles = files.filter(filePath => filePath.endsWith('.js'));
  if (jsFiles.length === 0) {
    throw new Error(`${pluginId} renderer artifact has no JavaScript files`);
  }

  for (const filePath of jsFiles) {
    const source = await fs.readFile(filePath, 'utf8');
    assertNoRendererNodeProcessReferences(source, filePath);
    if (/Enable_tracing_of_the_name_resolution_process/u.test(source)) {
      throw new Error(
        `${pluginId} renderer artifact appears to bundle TypeScript/compiler code: ${path.relative(packageDir, filePath)}`
      );
    }
  }

  const cssFiles = files.filter(filePath => filePath.endsWith('.css'));
  await assertRendererUiArtifactBoundary({
    label: 'on disk',
    javascriptArtifacts: jsFiles.map(filePath => ({
      path: path.relative(packageDir, filePath).replace(/\\/g, '/'),
      read: () => fs.readFile(filePath, 'utf8'),
    })),
    cssArtifacts: cssFiles.map(filePath => ({
      path: path.relative(packageDir, filePath).replace(/\\/g, '/'),
      read: () => fs.readFile(filePath, 'utf8'),
    })),
  });
};

const verifyDeclaredBrowserRuntimeArtifacts = async () => {
  for (const rawDirectory of artifactVerification.browserRuntimeDirectories ?? []) {
    const directory = normalizePluginRelativePath(rawDirectory, 'browser runtime directory');
    const runtimeDir = path.join(packageDir, ...directory.split('/'));
    const javaScriptFiles = (await listFiles(runtimeDir)).filter(filePath =>
      filePath.endsWith('.js')
    );
    if (javaScriptFiles.length === 0) {
      throw new Error(`${pluginId} ${directory} artifact has no JavaScript files`);
    }
    for (const filePath of javaScriptFiles) {
      assertNoRendererNodeProcessReferences(await fs.readFile(filePath, 'utf8'), filePath);
    }
  }
};

const verifyExtraResources = async (manifest, productionDistDirectories) => {
  if (!shouldVerifyExtraResources) return;
  if (!bundledPluginRoot) {
    throw new Error(
      `${pluginId} bundled artifact verification requires explicit LINNYA_BUNDLED_PLUGIN_ROOT`
    );
  }

  const pluginDir = path.join(bundledPluginRoot, manifest.id);
  await assertFile(path.join(pluginDir, 'plugin.json'), 'plugin.json');
  await assertFile(path.join(pluginDir, 'SHA512SUMS'), 'SHA512SUMS');
  const extraResourceFiles = (await listFiles(pluginDir)).map(filePath =>
    path.relative(pluginDir, filePath).replace(/\\/g, '/')
  );
  assertOnlyProductionArtifactPaths(
    extraResourceFiles,
    manifest,
    productionDistDirectories,
    'bundled artifact root'
  );

  for (const rawEntryPath of Object.values(manifest.entry)) {
    await assertFile(
      path.join(pluginDir, ...normalizePluginRelativePath(rawEntryPath, 'entry').split('/')),
      'runtime entry'
    );
  }
  for (const assetPath of buildManifestDisplayAssetPaths(manifest)) {
    await assertFile(path.join(pluginDir, ...assetPath.split('/')), `display asset ${assetPath}`);
  }

  if (shouldRequireRendererAssets && manifest.entry.renderer) {
    await assertDirectory(
      path.join(pluginDir, 'dist/renderer/assets'),
      'renderer assets directory'
    );
  }
  if (Array.isArray(manifest.skills) && manifest.skills.length > 0) {
    await assertDirectory(path.join(pluginDir, 'resources/skills'), 'skills resources directory');
  }
  assertDeclaredArtifactRequirements(extraResourceFiles, 'bundled artifact entries');
  await assertPackagedTypeScriptRuntime({
    artifactPaths: extraResourceFiles,
    label: 'in bundled artifact root',
    readText: entryPath =>
      fs.readFile(path.join(pluginDir, ...entryPath.split('/')), 'utf8').catch(() => undefined),
  });
};

const main = async () => {
  const manifest = parsePluginManifest(await readJson(manifestPath));
  if (manifest.id !== pluginId) {
    throw new Error(`Requested pluginId=${pluginId}, but manifest id=${manifest.id}`);
  }
  const productionDistDirectories = resolvePluginProductionDistDirectories(
    pluginId,
    manifest.entry
  );

  await verifyPackageManifestContract(manifest);
  verifyManifestDataContract(manifest);
  await verifyZipArtifact(manifest, productionDistDirectories);
  verifyContentBom();
  await verifyLatestManifest(manifest);
  await verifyDistChecksums(manifest, productionDistDirectories);
  await verifyRendererBrowserArtifact(manifest);
  await verifyDeclaredBrowserRuntimeArtifacts();
  await verifyBackendRuntimeDependencies(manifest);
  await verifyExtraResources(manifest, productionDistDirectories);

  console.log(`[plugin-artifact:${pluginId}] verification passed`);
};

await main();
