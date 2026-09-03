import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearInterval, setInterval, setTimeout } from 'node:timers';

import {
  createDiagnosticLogFileSink,
  createDiagnosticLogWriter,
  DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS,
  projectDiagnosticLogEntry,
} from '../../../../src/shared/logging/index.ts';
import { createIsolatedRunRoot } from '../harness/isolatedRunRoot.mjs';

async function main() {
  const runRoot = await createIsolatedRunRoot();
  let heartbeatTimer;
  try {
  const fileSink = createDiagnosticLogFileSink({
    baseFilePath: path.join(runRoot.path, 'backend-2026-07-31.log'),
  });
  const sink = {
    async write(records) {
      await new Promise(resolve => setTimeout(resolve, 5));
      await fileSink.write(records);
    },
  };
  const writer = createDiagnosticLogWriter({ sink });
  const payload = '诊断日志压力'.repeat(12_000);
  let heartbeatCount = 0;
  let maxHeartbeatLagMs = 0;
  let previousHeartbeatAt = performance.now();
  heartbeatTimer = setInterval(() => {
    const now = performance.now();
    maxHeartbeatLagMs = Math.max(maxHeartbeatLagMs, now - previousHeartbeatAt - 10);
    previousHeartbeatAt = now;
    heartbeatCount += 1;
  }, 10);

  const enqueueStartedAt = performance.now();
  for (let index = 0; index < 3000; index += 1) {
    writer.write({
      receivedAt: index < 1500
        ? new Date(2026, 6, 31, 23, 59, 59)
        : new Date(2026, 7, 1, 0, 0, 1),
      level: index % 500 === 0 ? 'ERROR' : 'INFO',
      module: 'shell-harness',
      message: `event-${index}`,
      data: { payload, index },
    });
  }
  const enqueueDurationMs = performance.now() - enqueueStartedAt;
  const shutdown = await writer.shutdown();
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;

  // 再用同一生产 sink 写满单文件，验证 Windows rename/锁语义没有被单元测试掩盖。
  const rotationRecords = Array.from({ length: 900 }, (_, index) => projectDiagnosticLogEntry({
    receivedAt: new Date(2026, 6, 31, 23, 59, 59),
    level: 'INFO',
    module: 'rotation-harness',
    message: `rotation-${index}`,
    data: { payload },
  }, DEFAULT_DIAGNOSTIC_LOG_PROJECTION_LIMITS));
  await fileSink.write(rotationRecords);

  const files = (await readdir(runRoot.path)).filter(name => name.startsWith('backend-'));
  const fileSizes = Object.fromEntries(await Promise.all(files.map(async name => [
    name,
    (await stat(path.join(runRoot.path, name))).size,
  ])));
  const contents = await Promise.all(files.map(name => readFile(path.join(runRoot.path, name), 'utf8')));
  const status = shutdown.status;
  const result = {
    platform: process.platform,
    architecture: process.arch,
    enqueueDurationMs: Math.round(enqueueDurationMs),
    maxHeartbeatLagMs: Math.round(maxHeartbeatLagMs),
    heartbeatCount,
    shutdownComplete: shutdown.complete,
    files,
    fileSizes,
    writtenEntries: status.writtenEntries,
    dropped: status.dropped,
    retainedErrorSummaries: contents.reduce(
      (count, content) => count + (content.match(/\[ERROR\]/gu)?.length ?? 0),
      0,
    ),
  };

  if (!shutdown.complete) throw new Error('诊断日志 writer 未在默认退出预算内清空');
  if (status.dropped.queue === 0) throw new Error('压力负载没有触发有界队列，语料无效');
  if (result.retainedErrorSummaries !== 6) {
    throw new Error(`拥塞时 ERROR 终态摘要保留不完整: ${result.retainedErrorSummaries}/6`);
  }
  if (!files.some(name => /\.\d+\.log$/u.test(name))) throw new Error('单文件压力没有触发运行时轮转');
  if (Object.values(fileSizes).some(bytes => bytes > 8 * 1024 * 1024)) {
    throw new Error('运行时轮转后仍有文件超过 8 MiB');
  }
  if (maxHeartbeatLagMs > 2500) throw new Error(`事件循环最长延迟过高: ${maxHeartbeatLagMs}ms`);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await runRoot.cleanup();
  }
}

void main();
