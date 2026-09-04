import fs from 'node:fs';
import path from 'node:path';

interface BoundaryViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly detail: string;
}

const REPOSITORY_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git']);
const CATALOG_ROOT = 'packages/provider-catalog';
const ADAPTER_ROOT = 'packages/linnkit-provider-ai-sdk';
const PUBLIC_PACKAGE_IMPORTS = new Set([
  '@linnya/provider-catalog',
  '@linnya/provider-catalog/runtime-bindings',
  '@linnlabs/linnkit-provider-ai-sdk',
  '@linnlabs/linnkit-provider-ai-sdk/conformance',
]);
const ROOT_NON_LANGUAGE_AI_SDK_DEPENDENCIES = new Set([
  'ai',
  '@ai-sdk/provider',
  '@ai-sdk/openai-compatible',
  '@ai-sdk/cohere',
]);
const EXTERNAL_LANGUAGE_PROVIDER_PACKAGES = new Set([
  '@openrouter/ai-sdk-provider',
  'ai-sdk-ollama',
]);

function isLanguageProviderPackage(moduleName: string): boolean {
  if (moduleName.startsWith('@ai-sdk/')) return true;
  for (const packageName of EXTERNAL_LANGUAGE_PROVIDER_PACKAGES) {
    if (moduleName === packageName || moduleName.startsWith(`${packageName}/`)) return true;
  }
  return false;
}

function normalize(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readManifestDependencies(relativePath: string): Readonly<Record<string, unknown>> {
  const manifest: unknown = JSON.parse(
    fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8')
  );
  if (!isRecord(manifest) || !isRecord(manifest.dependencies)) {
    throw new Error(`${relativePath} 缺少 dependencies 对象`);
  }
  return manifest.dependencies;
}

function listSourceFiles(relativeRoot: string): readonly string[] {
  const absoluteRoot = path.join(REPOSITORY_ROOT, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(normalize(path.relative(REPOSITORY_ROOT, absolutePath)));
      }
    }
  };
  visit(absoluteRoot);
  return files;
}

function isTestFile(file: string): boolean {
  return /(?:^|\/)(__tests__\/|[^/]+\.(?:test|spec)\.)/u.test(file);
}

function readImports(file: string): readonly { readonly module: string; readonly line: number }[] {
  const content = fs.readFileSync(path.join(REPOSITORY_ROOT, file), 'utf8');
  const pattern = /(?:import|export)\s+(?:type\s+)?[\s\S]{0,500}?\sfrom\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gu;
  return [...content.matchAll(pattern)].map(match => ({
    module: match[1] ?? match[2] ?? '',
    line: content.slice(0, match.index).split(/\r?\n/u).length,
  }));
}

function escapesPackage(file: string, moduleName: string, packageRoot: string): boolean {
  if (!moduleName.startsWith('.')) return false;
  const sourceDirectory = path.dirname(path.join(REPOSITORY_ROOT, file));
  const target = path.resolve(sourceDirectory, moduleName);
  const absolutePackageRoot = path.resolve(REPOSITORY_ROOT, packageRoot);
  return target !== absolutePackageRoot && !target.startsWith(`${absolutePackageRoot}${path.sep}`);
}

function catalogForbidden(moduleName: string): boolean {
  return (
    moduleName === 'ai' ||
    isLanguageProviderPackage(moduleName) ||
    moduleName === '@linnlabs/linnkit' ||
    moduleName.startsWith('@linnlabs/linnkit/') ||
    moduleName === 'linnkit' ||
    moduleName.startsWith('linnkit/') ||
    moduleName.startsWith('src/') ||
    moduleName.startsWith('apps/') ||
    moduleName.startsWith('cloud/') ||
    moduleName === 'electron'
  );
}

function adapterForbidden(moduleName: string): boolean {
  return (
    moduleName === '@app/schemas' ||
    moduleName.startsWith('@app/schemas/') ||
    moduleName === '@linnya/provider-catalog' ||
    moduleName.startsWith('@linnya/provider-catalog/') ||
    moduleName.startsWith('src/') ||
    moduleName.startsWith('apps/') ||
    moduleName.startsWith('cloud/') ||
    moduleName === 'electron'
  );
}

function inspectPackage(
  packageRoot: string,
  forbidden: (moduleName: string) => boolean,
  rulePrefix: string
): readonly BoundaryViolation[] {
  const files = listSourceFiles(packageRoot).filter(file => !isTestFile(file));
  return files.flatMap(file =>
    readImports(file).flatMap(({ module: moduleName, line }) => {
      const violations: BoundaryViolation[] = [];
      if (forbidden(moduleName)) {
        violations.push({
          file,
          line,
          rule: `${rulePrefix}-DEPENDENCY`,
          detail: `禁止依赖 ${moduleName}`,
        });
      }
      if (escapesPackage(file, moduleName, packageRoot)) {
        violations.push({
          file,
          line,
          rule: `${rulePrefix}-ESCAPE`,
          detail: `相对 import 逃逸 package 边界：${moduleName}`,
        });
      }
      return violations;
    })
  );
}

function inspectConsumers(): readonly BoundaryViolation[] {
  const files = ['src', 'apps', 'cloud']
    .flatMap(listSourceFiles)
    .filter(file => !isTestFile(file));
  return files.flatMap(file =>
    readImports(file).flatMap(({ module: moduleName, line }) => {
      if (
        moduleName === '@linnlabs/linnkit-provider-ai-sdk/conformance' &&
        !file.includes('/testkit/')
      ) {
        return [{
          file,
          line,
          rule: 'PROVIDER-PACKAGE-CONFORMANCE-IN-PRODUCTION',
          detail: 'conformance 出口只能由测试或 testkit 消费',
        }];
      }
      if (
        (moduleName.startsWith('@linnya/provider-catalog/') ||
          moduleName.startsWith('@linnlabs/linnkit-provider-ai-sdk/')) &&
        !PUBLIC_PACKAGE_IMPORTS.has(moduleName)
      ) {
        return [{
          file,
          line,
          rule: 'PROVIDER-PACKAGE-DEEP-IMPORT',
          detail: `消费者只能使用已声明 package export：${moduleName}`,
        }];
      }
      if (
        file.startsWith('apps/renderer/') &&
        (moduleName === '@linnya/provider-catalog/runtime-bindings' ||
          moduleName.startsWith('@linnlabs/linnkit-provider-ai-sdk'))
      ) {
        return [{
          file,
          line,
          rule: 'PROVIDER-PACKAGE-RENDERER',
          detail: `Renderer 禁止导入 Node-only Provider package 出口：${moduleName}`,
        }];
      }
      return [];
    })
  );
}

function inspectLinnyaProviderImports(): readonly BoundaryViolation[] {
  const files = listSourceFiles('src/app-hosts/linnya').filter(file => !isTestFile(file));
  return files.flatMap(file =>
    readImports(file).flatMap(({ module: moduleName, line }) => {
      if (moduleName === '@ai-sdk/openai-compatible') {
        const allowed =
          file.startsWith('src/app-hosts/linnya/adapters/image-generation/') ||
          file ===
            'src/app-hosts/linnya/adapters/inference/capabilities/ai-sdk/orchestration/embedWithAiSdk.ts';
        return allowed
          ? []
          : [{
              file,
              line,
              rule: 'LINNYA-LANGUAGE-PROVIDER-IMPORT',
              detail: `${moduleName} 只能由明确保留在 Host 的 Image Generation/Embedding owner 导入`,
            }];
      }
      if (moduleName === '@ai-sdk/cohere') {
        return file ===
          'src/app-hosts/linnya/adapters/inference/capabilities/ai-sdk/orchestration/rerankWithAiSdk.ts'
          ? []
          : [{
              file,
              line,
              rule: 'LINNYA-LANGUAGE-PROVIDER-IMPORT',
              detail: `${moduleName} 只能由明确保留在 Host 的 Reranking owner 导入`,
            }];
      }
      if (isLanguageProviderPackage(moduleName) && moduleName !== '@ai-sdk/provider') {
        return [{
          file,
          line,
          rule: 'LINNYA-LANGUAGE-PROVIDER-IMPORT',
          detail: `具体 Language Provider factory 必须由 adapter package 拥有：${moduleName}`,
        }];
      }
      return [];
    })
  );
}

function inspectManifestDependencyOwnership(): readonly BoundaryViolation[] {
  const rootDependencies = readManifestDependencies('package.json');
  const adapterDependencies = readManifestDependencies(`${ADAPTER_ROOT}/package.json`);
  const violations: BoundaryViolation[] = [];

  for (const name of Object.keys(rootDependencies)) {
    if (isLanguageProviderPackage(name) && !ROOT_NON_LANGUAGE_AI_SDK_DEPENDENCIES.has(name)) {
      violations.push({
        file: 'package.json',
        line: 1,
        rule: 'PROVIDER-PACKAGE-DEPENDENCY-OWNER',
        detail: `Language Provider 依赖必须由 adapter package 声明：${name}`,
      });
    }
  }

  for (const [name, version] of Object.entries(adapterDependencies)) {
    if (
      (name === 'ai' || isLanguageProviderPackage(name)) &&
      (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version))
    ) {
      violations.push({
        file: `${ADAPTER_ROOT}/package.json`,
        line: 1,
        rule: 'PROVIDER-PACKAGE-DEPENDENCY-PIN',
        detail: `${name} 必须使用精确 semver，当前为 ${version}`,
      });
    }
  }
  return violations;
}

const violations = [
  ...inspectPackage(CATALOG_ROOT, catalogForbidden, 'PROVIDER-CATALOG'),
  ...inspectPackage(ADAPTER_ROOT, adapterForbidden, 'LINNKIT-AI-SDK-ADAPTER'),
  ...inspectConsumers(),
  ...inspectLinnyaProviderImports(),
  ...inspectManifestDependencyOwnership(),
];

if (violations.length > 0) {
  console.error('Provider package boundary guard 发现违规：');
  for (const violation of violations) {
    console.error(
      `- [${violation.rule}] ${violation.file}:${violation.line} ${violation.detail}`
    );
  }
  process.exit(1);
}

console.log('Provider package boundary guard passed');
