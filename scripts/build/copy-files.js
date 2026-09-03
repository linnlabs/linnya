import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { copyMeasurementWorkerAssets } from './copy-measurement-worker-assets.js';
import { projectProductionPackageManifest } from './functions/productionPackageManifest.mjs';
import { assertProductionPackageLock } from './functions/productionPackageLock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const distBuildDir = path.join(rootDir, 'dist_build');

async function copyFiles() {
  try {
    console.log('Starting build preparation...');

    await copyMeasurementWorkerAssets();

    console.log(`Ensuring directory ${distBuildDir} exists...`);
    await fs.ensureDir(distBuildDir);

    const directSources = [
      ['dist', 'dist'],
      ['public', 'public'],
      ['release-notes.md', 'release-notes.md'],
      ['THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
      ['config/headless-node-runtime.json', 'config/headless-node-runtime.json'],
      ['build', 'build']
    ];

    for (const [src, dest] of directSources) {
      const sourcePath = path.join(rootDir, src);
      const destPath = path.join(distBuildDir, dest);
      if (await fs.exists(sourcePath)) {
        console.log(`Copying ${sourcePath} to ${destPath}...`);
        await fs.copy(sourcePath, destPath, { dereference: true });
        console.log(`Successfully copied ${src}.`);
      } else {
        console.warn(`Source path ${sourcePath} does not exist. Skipping.`);
      }
    }

    const productionPackageManifest = projectProductionPackageManifest(
      await fs.readJson(path.join(rootDir, 'package.json')),
    );
    const productionPackagePath = path.join(distBuildDir, 'package.json');
    await fs.writeJson(productionPackagePath, productionPackageManifest, { spaces: 2 });
    console.log(`Wrote workspace-free production package manifest to ${productionPackagePath}.`);
    const sourceProductionLockPath = path.join(rootDir, 'production-package-lock.json');
    const productionPackageLock = await fs.readJson(sourceProductionLockPath);
    assertProductionPackageLock(productionPackageLock, productionPackageManifest);
    const productionPackageLockPath = path.join(distBuildDir, 'package-lock.json');
    await fs.writeJson(productionPackageLockPath, productionPackageLock, { spaces: 2 });
    console.log(`Copied verified production package lock to ${productionPackageLockPath}.`);

    const packagedAppServerEntry = path.join(distBuildDir, 'dist', 'main', 'app-server-entry.cjs');
    const packagedAppServerBackend = path.join(distBuildDir, 'dist', 'main', 'app-server-backend.cjs');
    const packagedMainBytecode = path.join(distBuildDir, 'dist', 'main', 'main.jsc');
    const packagedMainSource = path.join(distBuildDir, 'dist', 'main', 'main.cjs');
    if (!(await fs.pathExists(packagedMainBytecode))) {
      throw new Error(`生产主进程字节码不存在：${packagedMainBytecode}`);
    }
    if (!(await fs.pathExists(packagedAppServerEntry))) {
      throw new Error(`生产 App Server 入口不存在：${packagedAppServerEntry}`);
    }
    if (!(await fs.pathExists(packagedAppServerBackend))) {
      throw new Error(`生产 App Server Backend 不存在：${packagedAppServerBackend}`);
    }
    // Main 仍使用 Electron 字节码；App Server 必须保留普通 CJS，交给固定 headless Node 执行。
    await fs.remove(packagedMainSource);
    console.log('Removed production main.cjs source artifact; preserved headless App Server CJS.');

    // 仅复制生产运行真正需要的本地包产物，避免 file: 依赖 symlink 指向整棵源码目录。
    const localRuntimePackages = [
      {
        sourceDir: path.join(rootDir, 'packages', 'schemas'),
        destDir: path.join(distBuildDir, 'packages', 'schemas'),
        include: ['package.json', 'dist']
      },
      {
        sourceDir: path.join(rootDir, 'packages', 'parser-wasm', 'pkg'),
        destDir: path.join(distBuildDir, 'packages', 'parser-wasm', 'pkg'),
        include: ['package.json', 'parser_wasm.js', 'parser_wasm_bg.wasm', 'parser_wasm.d.ts']
      },
      {
        sourceDir: path.join(rootDir, 'packages', 'parser-wasm', 'pkg-node'),
        destDir: path.join(distBuildDir, 'packages', 'parser-wasm', 'pkg-node'),
        include: ['package.json', 'parser_wasm.js', 'parser_wasm_bg.wasm', 'parser_wasm.d.ts']
      }
    ];

    for (const pkg of localRuntimePackages) {
      await fs.ensureDir(pkg.destDir);
      for (const relativePath of pkg.include) {
        const sourcePath = path.join(pkg.sourceDir, relativePath);
        const destPath = path.join(pkg.destDir, relativePath);
        if (!(await fs.pathExists(sourcePath))) {
          console.warn(`Runtime package path ${sourcePath} does not exist. Skipping.`);
          continue;
        }
        console.log(`Copying ${sourcePath} to ${destPath}...`);
        await fs.copy(sourcePath, destPath, { dereference: true });
      }
      console.log(`Successfully copied runtime package subset to ${pkg.destDir}.`);
    }

    // 默认模型目录只携带 route 与环境变量名。生产包不得内嵌开发机凭据。
    const modelsSourcePath = path.join(
      rootDir,
      'src',
      'domains',
      'model-catalog',
      'features',
      'default-catalog',
      'assets',
      'default_models.json',
    );
    const modelsDestDir = path.join(distBuildDir, 'dist', 'domains', 'model-catalog');
    const modelsDestPath = path.join(modelsDestDir, 'default_models.json');

    console.log('Processing default_models.json for production build...');

    if (await fs.exists(modelsSourcePath)) {
        try {
            const modelsConfig = await fs.readJson(modelsSourcePath);
            if (modelsConfig.models && Array.isArray(modelsConfig.models)) {
                for (const model of modelsConfig.models) {
                    if ('api_key' in model || 'api_key_env_var' in model) {
                        throw new Error(`默认模型 ${String(model.id)} 包含已废弃的 API key 字段。`);
                    }
                }
            }

            await fs.ensureDir(modelsDestDir);
            await fs.writeJson(modelsDestPath, modelsConfig, { spaces: 2 });
            console.log(`Successfully wrote credential-free default_models.json to ${modelsDestPath}.`);

        } catch (error) {
            console.error('Error processing default_models.json:', error);
            process.exit(1); 
        }
    } else {
        throw new Error(`Model Catalog 默认目录资产不存在：${modelsSourcePath}`);
    }

    // 复制内置 Skill 文件（.md）到 dist/ 以便打包
    const builtinSkillsSrc = path.join(rootDir, 'src', 'features', 'skills', 'builtin', 'skills');
    const builtinSkillsDest = path.join(distBuildDir, 'dist', 'builtin-skills');
    if (await fs.pathExists(builtinSkillsSrc)) {
      await fs.copy(builtinSkillsSrc, builtinSkillsDest);
      console.log(`Successfully copied builtin skill files to ${builtinSkillsDest}.`);
    } else {
      console.warn(`Builtin skills directory ${builtinSkillsSrc} does not exist. Skipping.`);
    }

    console.log('Build preparation completed successfully.');
  } catch (error) {
    console.error('Error during file copy operation:', error);
    process.exit(1);
  }
}

copyFiles();
