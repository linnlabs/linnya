import fs from 'node:fs';
import path from 'node:path';

const distDir = path.resolve('dist');
const workerBundleNames = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((fileName) => fileName.endsWith('.worker.cjs'))
  : [];

const forbiddenMarkers = [
  {
    marker: 'node_modules/electron/index.js',
    reason: '打进了 Electron npm 包入口',
  },
  {
    marker: 'Electron failed to install correctly',
    reason: '打进了 Electron npm 包安装检查逻辑',
  },
];

const forbiddenWorkspaceRequires = [
  '@linnlabs/linnkit-provider-ai-sdk',
  '@linnlabs/linnkit',
  '@linnya/provider-catalog',
];

const failures = [];

if (workerBundleNames.length === 0) {
  failures.push('dist/*.worker.cjs: 构建产物不存在，请先运行 build:worker');
}

for (const bundleName of workerBundleNames) {
  const bundlePath = path.join(distDir, bundleName);
  if (!fs.existsSync(bundlePath)) {
    failures.push(`${bundleName}: 构建产物不存在，请先运行 build:worker`);
    continue;
  }

  const content = fs.readFileSync(bundlePath, 'utf8');
  for (const { marker, reason } of forbiddenMarkers) {
    if (content.includes(marker)) {
      failures.push(`${bundleName}: ${reason} (${marker})`);
    }
  }
  for (const packageName of forbiddenWorkspaceRequires) {
    const requirePattern = new RegExp(
      `require\\(["']${packageName.replaceAll('/', '\\/')}(?:\\/[^"']*)?["']\\)`,
      'u',
    );
    if (requirePattern.test(content)) {
      failures.push(`${bundleName}: 保留了生产包无法解析的 workspace require (${packageName})`);
    }
  }
}

if (failures.length > 0) {
  console.error('[worker-bundle-electron-runtime-guard] Worker bundle 边界检查失败：');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error('\nWorker 线程不能静态依赖 Electron main/plugin runtime；请把跨边界能力改为显式注入或 app-level 编排。');
  process.exitCode = 1;
} else {
  console.log(
    '[worker-bundle-electron-runtime-guard] Worker bundle 未包含 Electron runtime 或 workspace require。',
  );
}
