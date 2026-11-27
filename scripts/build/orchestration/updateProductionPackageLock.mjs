import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { projectPackagedSchemasManifest, projectProductionPackageManifest } from '../functions/productionPackageManifest.mjs';
import { assertProductionPackageLock } from '../functions/productionPackageLock.mjs';
import { runRegistryCommand } from './retryTransientNetwork.cjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outputPath = path.join(rootDir, 'production-package-lock.json');
const MAX_LOCK_CONVERGENCE_PASSES = 8;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createCleanNpmEnvironment(tempRoot) {
  const userConfigPath = path.join(tempRoot, 'empty-user-npmrc');
  fs.writeFileSync(userConfigPath, 'registry=https://registry.npmjs.org/\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  const environmentWithoutNpmConfig = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toLocaleLowerCase('en-US').startsWith('npm_config_')
    )
  );
  return {
    // pnpm 会把 workspace 配置投影为 npm_config_* 环境变量。生产 lock 必须只消费
    // 下方明确声明的公开 registry/cache/userconfig，不能把调用方的 pnpm/npm 配置带入 npm。
    ...environmentWithoutNpmConfig,
    npm_config_cache: path.join(tempRoot, 'npm-cache'),
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_userconfig: userConfigPath,
    NPM_CONFIG_CACHE: path.join(tempRoot, 'npm-cache'),
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    NPM_CONFIG_USERCONFIG: userConfigPath,
  };
}

async function generateStablePackageLock(tempRoot) {
  const packageLockPath = path.join(tempRoot, 'package-lock.json');
  let previous = fs.existsSync(packageLockPath)
    ? fs.readFileSync(packageLockPath, 'utf8')
    : undefined;

  for (let pass = 1; pass <= MAX_LOCK_CONVERGENCE_PASSES; pass += 1) {
    await runRegistryCommand({
      label: 'npm 解析生产 package lock',
      command: 'npm',
      args: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      cwd: tempRoot,
      env: createCleanNpmEnvironment(tempRoot),
    });
    const current = fs.readFileSync(packageLockPath, 'utf8');
    if (current === previous) return JSON.parse(current);
    previous = current;
  }

  // npm 会分轮传播 optional peer 的 dev/devOptional 标记。若有限轮次内仍不稳定，
  // 继续写出只会让 update 成功、verify 失败，因此必须在发行边界显式终止。
  throw new Error(`生产 package lock 在 ${MAX_LOCK_CONVERGENCE_PASSES} 轮 npm 解析后仍未收敛`);
}

export async function updateProductionPackageLock(input = {}) {
  const fresh = input.fresh === true;
  const audit = input.audit === true;
  const verify = input.verify === true || audit;
  const verifyInstall = input.verifyInstall === true;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-production-lock-'));
  try {
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const productionManifest = projectProductionPackageManifest(sourceManifest);
    writeJson(path.join(tempRoot, 'package.json'), productionManifest);
    const schemaPackageRoot = path.join(tempRoot, 'packages', 'schemas');
    const sourceSchemas = JSON.parse(fs.readFileSync(path.join(rootDir, 'packages', 'schemas', 'package.json'), 'utf8'));
    writeJson(path.join(schemaPackageRoot, 'package.json'), projectPackagedSchemasManifest(sourceSchemas));
    if (!fresh && fs.existsSync(outputPath)) {
      fs.copyFileSync(outputPath, path.join(tempRoot, 'package-lock.json'));
    }

    const generatedLock = await generateStablePackageLock(tempRoot);
    assertProductionPackageLock(generatedLock, productionManifest);
    const serialized = `${JSON.stringify(generatedLock, null, 2)}\n`;
    if (verifyInstall) {
      await runRegistryCommand({
        label: 'npm 冻结生产安装',
        command: 'npm',
        args: ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
        cwd: tempRoot,
        env: createCleanNpmEnvironment(tempRoot),
      });
      if (fs.readFileSync(path.join(tempRoot, 'package-lock.json'), 'utf8') !== serialized) {
        throw new Error('冻结生产安装修改了 package lock');
      }
    }
    if (verify) {
      if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, 'utf8') !== serialized) {
        throw new Error('生产 package lock 与当前 manifest 的冻结解析不一致');
      }
    } else {
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    if (audit) {
      // Desktop 安装的是这棵 npm 冻结图；pnpm 的安全覆盖不会自动进入成品。
      // 先核对受跟踪 lock，再只读审计，避免审计了临时解析的新树却放行旧成品。
      // 审计接口是 POST，npm 不做内置重试；只有断线、超时会重试，查出漏洞当场失败。
      await runRegistryCommand({
        label: 'npm 审计生产依赖',
        command: 'npm',
        args: ['audit', '--package-lock-only', '--omit=dev', '--audit-level=low'],
        cwd: tempRoot,
        env: createCleanNpmEnvironment(tempRoot),
      });
    }
    if (audit) {
      // 生产 lock 只含以 node_modules 形式随包的依赖；打进 bundle 的包来自 pnpm 的生产依赖图，
      // 上面的 npm 审计看不到它们，所以对这张图再审计一次。
      await runRegistryCommand({
        label: 'pnpm 审计生产依赖',
        command: 'pnpm',
        args: ['audit', '--prod', '--audit-level=low'],
        cwd: rootDir,
        shell: process.platform === 'win32',
      });
    }
    process.stdout.write(
      `[production-package-lock] ${verify ? 'verified' : 'updated'} ${path.relative(rootDir, outputPath)}\n`
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter(argument => argument !== '--');
  updateProductionPackageLock({
    fresh: args.includes('--fresh'),
    verify: args.includes('--verify'),
    verifyInstall: args.includes('--verify-install'),
    audit: args.includes('--audit'),
  }).catch(error => {
    // 失败原因已在上方输出（命令原文或网络失败标记），这里只给结论，不打印堆栈。
    process.stderr.write(`[production-package-lock] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
