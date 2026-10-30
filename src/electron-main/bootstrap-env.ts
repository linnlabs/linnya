/**
 * @file src/electron-main/bootstrap-env.ts
 *
 * @description
 * 统一加载开发环境变量文件（仅做“补齐”，不覆盖命令行/系统已设置的变量）。
 *
 * 设计目标：
 * - 让开发者只需要维护一个 `.env.local`（不进 git）即可统一管理开关/密钥；
 * - 主进程在初始化路径、日志、worker 之前加载，确保所有后端代码读取到一致的 env；
 * - Vite 侧会自行加载 `.env.local`，因此前端同一份文件也能生效（仅 `VITE_` 前缀会暴露给 renderer）。
 *
 * 注意：
 * - packaged 应用禁止从启动工作目录加载配置；工作目录属于外部输入，不是可信配置根；
 * - `override=false`：不会覆盖已存在的 env，避免脚本/CI/生产环境被意外篡改。
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

type LoadResult = {
  filePath: string;
  loaded: boolean;
};

function tryLoadEnvFile(filePath: string): LoadResult {
  if (!fs.existsSync(filePath)) {
    return { filePath, loaded: false };
  }

  // 环境加载先于 command mode；dotenv 的启动提示不能污染 CLI 的 JSON stdout。
  const result = dotenv.config({ path: filePath, override: false, quiet: true });
  return { filePath, loaded: !result.error };
}

/**
 * 统一入口：按优先级加载 `.env.local` -> `.env`
 *
 * 约定：
 * - `.env.local`：个人开发机专用（默认推荐）
 * - `.env`：可选的团队共享（如果未来需要）
 */
export function bootstrapDevEnv(params: {
  readonly isPackaged: boolean;
  readonly developmentRoot: string;
}): void {
  // 生产包的 cwd 由 Finder、终端、快捷方式或调用方决定，不能成为配置来源。
  if (params.isPackaged) return;

  const candidates: string[] = [
    path.join(params.developmentRoot, '.env.local'),
    path.join(params.developmentRoot, '.env'),
  ];

  const results = candidates.map(tryLoadEnvFile).filter((r) => r.loaded);
  if (results.length === 0) return;

  // 开发提示走 stderr，让普通启动和 command mode 共用同一环境准入流程。
  const isDev = process.env.NODE_ENV === 'development' || process.env.LINNYA_DEV_MODE === 'true';
  if (!isDev) return;

  const loadedFiles = results.map((r) => r.filePath).join(', ');
  process.stderr.write(`[ENV] 已加载环境变量文件: ${loadedFiles}\n`);
}


