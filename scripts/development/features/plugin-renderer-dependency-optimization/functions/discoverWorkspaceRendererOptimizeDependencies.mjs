import fs from 'node:fs';
import path from 'node:path';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function packageNameFromSpecifier(specifier) {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function readDeclaredDependencyNames(packageJson, packageJsonPath) {
  const names = new Set();
  for (const section of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const dependencies = packageJson[section];
    if (dependencies === undefined) continue;
    if (!isRecord(dependencies)) {
      throw new Error(`${packageJsonPath}: ${section} 必须是对象`);
    }
    for (const [dependencyName, version] of Object.entries(dependencies)) {
      if (typeof version !== 'string') {
        throw new Error(`${packageJsonPath}: ${section}.${dependencyName} 必须是字符串`);
      }
      names.add(dependencyName);
    }
  }
  return names;
}

function readRendererOptimizeDependencies(packageJson, packageJsonPath) {
  const linnya = packageJson.linnya;
  if (linnya === undefined) return [];
  if (!isRecord(linnya)) throw new Error(`${packageJsonPath}: linnya 必须是对象`);

  const development = linnya.development;
  if (development === undefined) return [];
  if (!isRecord(development)) {
    throw new Error(`${packageJsonPath}: linnya.development 必须是对象`);
  }

  const dependencies = development.rendererOptimizeDependencies;
  if (dependencies === undefined) return [];
  if (
    !Array.isArray(dependencies) ||
    dependencies.some(dependency => typeof dependency !== 'string' || !dependency.trim())
  ) {
    throw new Error(
      `${packageJsonPath}: linnya.development.rendererOptimizeDependencies 必须是非空字符串数组`
    );
  }
  if (new Set(dependencies).size !== dependencies.length) {
    throw new Error(
      `${packageJsonPath}: linnya.development.rendererOptimizeDependencies 不得重复`
    );
  }
  return dependencies;
}

/**
 * 收集 workspace 插件主动声明的 Renderer 依赖预构建输入。
 *
 * 中文说明：Vite 无法总是在启动时发现运行期动态 import 的插件入口，因此插件 owner
 * 必须声明确实需要提前优化的包；Host 只消费通用元数据，不维护插件 ID 或实现依赖清单。
 */
export function discoverWorkspaceRendererOptimizeDependencies(repositoryRoot = process.cwd()) {
  const pluginsRoot = path.join(repositoryRoot, 'packages', 'plugins');
  if (!fs.existsSync(pluginsRoot)) return [];

  const dependencies = new Set();
  for (const entry of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = path.join(pluginsRoot, entry.name, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;

    const packageJson = readJson(packageJsonPath);
    if (!isRecord(packageJson)) throw new Error(`${packageJsonPath}: package.json 必须是对象`);
    const declaredDependencyNames = readDeclaredDependencyNames(packageJson, packageJsonPath);
    for (const specifier of readRendererOptimizeDependencies(packageJson, packageJsonPath)) {
      const dependencyName = packageNameFromSpecifier(specifier);
      if (!dependencyName || !declaredDependencyNames.has(dependencyName)) {
        throw new Error(
          `${packageJsonPath}: Renderer 优化项 ${specifier} 必须由插件自己的依赖字段声明`
        );
      }
      dependencies.add(specifier);
    }
  }

  return [...dependencies].sort((left, right) => left.localeCompare(right));
}
