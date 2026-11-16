import { spawn } from 'node:child_process';

const READY_MARKER = '[linnya-flow-crash-fixture-ready]';
const STARTUP_TIMEOUT_MS = 60_000;
const EXECUTION_TIMEOUT_MS = 20_000;
export const FLOW_CRASH_TEST_TIMEOUT_MS = 90_000;

/** 先确认模块加载及数据库装配完成，父进程才开始计算业务执行期限。 */
export function markFlowCrashFixtureReady(): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${READY_MARKER}\n`, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/** 只观测真实夹具进程；看门狗不能伪造业务边界上的 SIGKILL。 */
export function runFlowCrashFixture(
  fixturePath: string,
  environment: NodeJS.ProcessEnv,
): Promise<{
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly elapsedMs: number;
  readonly output: string;
}> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'node_modules/vitest/vitest.mjs', 'run', '--pool=threads', '--maxWorkers=1', fixturePath,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let phase: 'startup' | 'execution' = 'startup';
    let output = '';
    const terminate = () => {
      output += `\nCrash fixture watchdog expired during ${phase}\n`;
      child.kill('SIGTERM');
    };
    // 冷启动需要另行编译整棵 Host 导入图。不能把 CI 的编译排队算成恢复流程卡住。
    let timeout = setTimeout(terminate, STARTUP_TIMEOUT_MS);
    const observe = (chunk: Buffer) => {
      const combined = output + chunk.toString();
      if (phase === 'startup' && combined.includes(READY_MARKER)) {
        clearTimeout(timeout);
        phase = 'execution';
        timeout = setTimeout(terminate, EXECUTION_TIMEOUT_MS);
      }
      output = combined.slice(-20_000);
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    // close 等到两条输出管道收口，保留崩溃前的完整诊断。
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode, signal, elapsedMs: performance.now() - started, output });
    });
  });
}
