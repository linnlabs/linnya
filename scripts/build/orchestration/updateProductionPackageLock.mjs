import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { projectProductionPackageManifest } from '../functions/productionPackageManifest.mjs';
import { assertProductionPackageLock } from '../functions/productionPackageLock.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outputPath = path.join(rootDir, 'production-package-lock.json');

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

export function updateProductionPackageLock(input = {}) {
  const fresh = input.fresh === true;
  const verify = input.verify === true;
  const verifyInstall = input.verifyInstall === true;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-production-lock-'));
  try {
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const productionManifest = projectProductionPackageManifest(sourceManifest);
    writeJson(path.join(tempRoot, 'package.json'), productionManifest);
    const schemaPackageRoot = path.join(tempRoot, 'packages', 'schemas');
    fs.mkdirSync(schemaPackageRoot, { recursive: true });
    fs.copyFileSync(
      path.join(rootDir, 'packages', 'schemas', 'package.json'),
      path.join(schemaPackageRoot, 'package.json')
    );
    if (!fresh && fs.existsSync(outputPath)) {
      fs.copyFileSync(outputPath, path.join(tempRoot, 'package-lock.json'));
    }

    execFileSync(
      'npm',
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      {
        cwd: tempRoot,
        env: createCleanNpmEnvironment(tempRoot),
        stdio: 'inherit',
      }
    );
    const generatedLock = JSON.parse(
      fs.readFileSync(path.join(tempRoot, 'package-lock.json'), 'utf8')
    );
    assertProductionPackageLock(generatedLock, productionManifest);
    const serialized = `${JSON.stringify(generatedLock, null, 2)}\n`;
    if (verifyInstall) {
      execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
        cwd: tempRoot,
        env: createCleanNpmEnvironment(tempRoot),
        stdio: 'inherit',
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
  });
}
