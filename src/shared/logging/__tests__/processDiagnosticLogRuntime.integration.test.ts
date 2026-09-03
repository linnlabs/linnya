import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory =>
      rm(directory, {
        recursive: true,
        force: true,
      })
    )
  );
});

describe('进程级诊断日志所有权', () => {
  it('两个独立模块实例复用同一个文件 writer，并由 App owner 统一收口', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'linnya-process-log-runtime-'));
    temporaryDirectories.push(directory);
    const logPath = path.join(directory, 'backend.log');

    const appOwnerLogger = await import('../../logger');
    appOwnerLogger.enableConsoleLogging(false);
    appOwnerLogger.enableFileLogging(true, logPath);
    new appOwnerLogger.Logger('app-owner').info('owner-started');
    await vi.waitFor(() => {
      expect(appOwnerLogger.getDiagnosticLogWriterStatus()?.writtenEntries).toBe(1);
    });

    // 独立 bundle 会重新求值 logger 模块；清空模块 registry 可以复现该边界，且不把
    // 测试绑定到 Electron 构建产物。进程级运行时必须仍能看到 App 已创建的 writer。
    vi.resetModules();
    const backendBundleLogger = await import('../../logger');
    expect(backendBundleLogger.getDiagnosticLogWriterStatus()?.writtenEntries).toBe(1);
    new backendBundleLogger.Logger('app-server-backend').info('backend-started');

    const shutdown = await backendBundleLogger.shutdownDiagnosticLogging();
    expect(shutdown?.complete).toBe(true);
    const logFiles = (await readdir(directory)).filter(name => name.startsWith('backend-'));
    expect(logFiles).toHaveLength(1);
    const [writtenLogFile] = logFiles;
    if (!writtenLogFile) throw new Error('诊断日志 writer 未生成目标文件');
    const logContent = await readFile(path.join(directory, writtenLogFile), 'utf8');
    expect(logContent).toContain('owner-started');
    expect(logContent).toContain('backend-started');

    backendBundleLogger.enableFileLogging(false);
    backendBundleLogger.enableConsoleLogging(true);
  });
});
