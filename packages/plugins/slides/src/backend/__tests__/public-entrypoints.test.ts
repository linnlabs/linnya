import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const slidesPackageDirectory = path.resolve(import.meta.dirname, '../../..');
const repositoryRoot = path.resolve(slidesPackageDirectory, '../../..');

function readPackageFile(relativePath: string): string {
  return fs.readFileSync(path.join(slidesPackageDirectory, relativePath), 'utf8');
}

function readRepositoryFile(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('slides backend public entrypoints', () => {
  it('keeps the backend contribution entry free of engine, sandbox, and persistence re-exports', () => {
    const backendIndex = readPackageFile('src/backend/index.ts');

    // 主入口是 contribution 装配面；内部实现能力必须走各自子入口，避免新代码从大门回流。
    expect(backendIndex).not.toMatch(/export\s+\{[\s\S]*from ['"]\.\/persistence/);
    expect(backendIndex).not.toMatch(/export\s+type\s+\{[\s\S]*from ['"]\.\/persistence/);
    expect(backendIndex).not.toMatch(/export\s+\{[\s\S]*from ['"]\.\/sandbox/);
    expect(backendIndex).not.toMatch(/export\s+type\s+\{[\s\S]*from ['"]\.\/sandbox/);
    expect(backendIndex).not.toMatch(/export\s+\{[\s\S]*from ['"]\.\/engine/);
    expect(backendIndex).not.toMatch(/export\s+type\s+\{[\s\S]*from ['"]\.\/engine/);
  });

  it('keeps unconnected optimization experiments out of public barrels', () => {
    const codegenIndex = readPackageFile('src/backend/codegen/index.ts');
    const toolsIndex = readPackageFile('src/backend/tools/index.ts');

    // 未接入生产链的实验实现不能成为稳定插件 API。
    expect(codegenIndex).not.toContain('PerSlideAssembleCache');
    expect(toolsIndex).not.toContain('presentationLayoutConstraints');
    expect(toolsIndex).not.toContain('recordLayoutConstraints');
    expect(toolsIndex).not.toContain('expandEditSpecWithLayoutConstraints');
  });

  it('keeps retired DeckSpec mutation runtimes out of the coordinator', () => {
    const coordinator = readPackageFile('src/backend/coordinator/PptCoordinator.ts');

    expect(coordinator).not.toMatch(/new\s+PageComposer\s*\(/);
    expect(coordinator).not.toContain('repairLoopAsync');
    expect(coordinator).not.toMatch(/\b(generate|patch|edit|relayout|repair)\s*\(/);
    expect(fs.existsSync(path.join(
      slidesPackageDirectory,
      'src/backend/coordinator/presentationGenerationRuntime.ts',
    ))).toBe(false);
    expect(fs.existsSync(path.join(
      slidesPackageDirectory,
      'src/backend/coordinator/presentationPatchEditRuntime.ts',
    ))).toBe(false);
    expect(fs.existsSync(path.join(
      slidesPackageDirectory,
      'src/backend/coordinator/presentationRelayoutRepairRuntime.ts',
    ))).toBe(false);
  });

  it('keeps inspect feedback spatial analysis behind the engine adapter', () => {
    const sceneGraph = readPackageFile('src/backend/tools/inspectFeedback/sceneGraph.ts');

    expect(sceneGraph).not.toContain('SpatialAnalyzer');
    expect(sceneGraph).toContain('analyzeSpatial');
  });

  it('keeps the retired generated edit runtime out of public wiring', () => {
    const coordinator = readPackageFile('src/backend/coordinator/PptCoordinator.ts');
    const toolsIndex = readPackageFile('src/backend/tools/index.ts');

    expect(toolsIndex).not.toContain('editRuntime');
    expect(toolsIndex).not.toContain('editInput');
    expect(coordinator).not.toContain('this.engine.resolvePatchImageSource(');
    expect(coordinator).not.toContain('this.engine.compilePatch(');
    expect(coordinator).not.toContain('patchEditRuntime');
  });

  it('keeps the engine core entry focused on coordinator/runtime assembly', () => {
    const engineCore = readPackageFile('src/backend/engine/core.ts');

    // core 是给 coordinator/codegen/factory 的装配入口，不暴露内部解析与质量实现。
    expect(engineCore).not.toContain('./layout/PageComposer');
    expect(engineCore).not.toContain('./layout/solver');
    expect(engineCore).not.toContain('./layout/renderers');
    expect(engineCore).not.toContain('./quality/');
    expect(engineCore).not.toContain('./parser/RenderModelMapper');
  });

  it('keeps the legacy engine barrel out of package public exports', () => {
    const packageJson = JSON.parse(readPackageFile('package.json')) as {
      exports?: Record<string, string>;
    };
    const tsconfig = readPackageFile('tsconfig.json');
    const rootTsconfig = readRepositoryFile('tsconfig.json');
    const viteConfig = readRepositoryFile('vite.config.mjs');
    const vitestConfig = readRepositoryFile('vitest.config.ts');

    expect(fs.existsSync(path.join(slidesPackageDirectory, 'src/backend/engine/index.ts'))).toBe(false);
    expect(packageJson.exports).not.toHaveProperty('./backend-engine');
    expect(tsconfig).not.toContain('"@plugin/slides/backend-engine"');
    expect(rootTsconfig).not.toContain('"@plugin/slides/backend-engine"');
    expect(viteConfig).not.toContain("'@plugin/slides/backend-engine'");
    expect(vitestConfig).not.toContain('^@plugin\\/slides\\/backend-engine$');
  });

  it('keeps production backend code off the legacy engine barrel', () => {
    const backendFiles = [
      'src/backend/ipc/slidesIpcHandlers.ts',
      'src/backend/tools/inspectFeedback/feedbackPayload.ts',
      'src/backend/tools/inspectFeedback/diagnostics.ts',
      'src/backend/tools/inspectFeedback/sceneGraph.ts',
    ];

    for (const file of backendFiles) {
      expect(readPackageFile(file)).not.toMatch(/from ['"]@plugin\/slides\/backend-engine['"]/);
    }
  });

  it('uses backend SDK modules instead of package-local host import shims', () => {
    const tsconfig = readPackageFile('tsconfig.json');

    expect(fs.existsSync(path.join(slidesPackageDirectory, 'src/backend/hostImports.d.ts'))).toBe(false);
    expect(tsconfig).not.toContain('hostImports.d.ts');
    expect(tsconfig).not.toContain('src/app-hosts/linnya/plugin-registry/types');
    expect(tsconfig).toContain('packages/plugin-host-contract/backend/*.ts');
    expect(tsconfig).toContain('packages/plugin-host-contract/renderer/*.ts');
    expect(tsconfig).not.toContain('packages/plugins/slides/host-types/backend/*.d.ts');
  });
});
