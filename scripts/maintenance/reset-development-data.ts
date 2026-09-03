/**
 * 开发数据全量重置入口。
 *
 * 影响：把仓库根目录下精确的 `_dev_data` 整体移入同盘隔离目录；不会接受自定义目标，
 * 不会修改生产 AppData，也不会在重置后自动启动应用。
 * 运行前提：在 Linnya 仓库根目录执行，并先停止所有开发进程。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { createNodeDevelopmentDataFilesystem } from '../../src/app-hosts/linnya/adapters/development-data-filesystem/createNodeDevelopmentDataFilesystem';
import { createDevelopmentDataLifecycle } from '../../src/app-hosts/linnya/application/development-data-lifecycle';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function assertLinnyaRepositoryRoot(developmentRoot: string): Promise<void> {
  const manifestPath = path.join(developmentRoot, 'package.json');
  const manifestValue: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!isRecord(manifestValue) || manifestValue.name !== 'linnya') {
    throw new Error(`[DevelopmentData] 当前目录不是 Linnya 仓库根目录：${developmentRoot}`);
  }
}

function formatBytes(byteSize: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = byteSize;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

async function main(): Promise<void> {
  const developmentRoot = process.cwd();
  await assertLinnyaRepositoryRoot(developmentRoot);
  const lifecycle = createDevelopmentDataLifecycle({
    filesystem: createNodeDevelopmentDataFilesystem(),
  });
  const result = await lifecycle.reset({
    developmentRoot,
    beforeRetire(inspection) {
      console.log(`[DevelopmentData] 即将隔离：${inspection.dataRoot}`);
      console.log(`[DevelopmentData] 当前体积：${formatBytes(inspection.byteSize)}`);
      console.log(
        `[DevelopmentData] 顶层内容：${inspection.topLevelEntries.join(', ') || '（空）'}`
      );
    },
  });

  if (result.status === 'absent') {
    console.log(`[DevelopmentData] 无需重置，目录不存在：${result.dataRoot}`);
    return;
  }

  console.log(`[DevelopmentData] 已隔离开发数据：${result.dataRoot}`);
  console.log(`[DevelopmentData] 可恢复位置：${result.retiredPath}`);
  console.log('[DevelopmentData] 下次启动会创建当前 epoch 的全新开发运行态。');
}

void main().catch((error: unknown) => {
  const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${reason}\n`);
  process.exitCode = 1;
});
