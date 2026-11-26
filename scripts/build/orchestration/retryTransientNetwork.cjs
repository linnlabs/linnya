'use strict';

const { spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

const {
  NETWORK_FAILURE_MARKER,
  describeTransientRegistryFailure,
} = require('../functions/transientNetworkFailure.cjs');

/** 重试两次、间隔递增：短暂断线多在几秒内恢复，第二次多等一些；真断网时总共多花约 20 秒。 */
const TRANSIENT_NETWORK_RETRY_DELAYS_MS = [5_000, 15_000];

/**
 * 只在 describeTransient 认出临时传输错误时重试；其他错误原样抛出。
 * 重试用尽后在 stderr 写一行网络失败标记，并抛出只含结论的错误，调用方打印 message 即可，不必打印堆栈。
 */
async function retryTransientNetwork(input) {
  const delays = input.delaysMs ?? TRANSIENT_NETWORK_RETRY_DELAYS_MS;
  const wait = input.wait ?? delay;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await input.attempt();
    } catch (error) {
      const reason = input.describeTransient(error);
      if (reason === undefined) throw error;
      if (attempt >= delays.length) {
        process.stderr.write(`${NETWORK_FAILURE_MARKER} ${input.label}：重试 ${delays.length} 次后仍失败（${reason}）\n`);
        throw new Error(`${input.label}：网络失败，重试 ${delays.length} 次后仍失败（${reason}）`, { cause: error });
      }
      const seconds = delays[attempt] / 1000;
      process.stderr.write(`[${input.label}] 网络临时失败（${reason}），${seconds} 秒后第 ${attempt + 1} 次重试\n`);
      await wait(delays[attempt]);
    }
  }
}

class CommandFailure extends Error {
  constructor(label, status, output) {
    super(`${label} 未通过（退出码 ${status}），原因见上方输出`);
    this.name = 'CommandFailure';
    this.output = output;
  }
}

/** 捕获输出用于判定失败原因，同时原样转发，日志里看到的内容不变。 */
function runCapturedCommand(input) {
  const result = spawnSync(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    shell: input.shell,
    encoding: 'utf8',
    // 审计报告与锁文件解析的输出可能较长，默认 1 MiB 不够。
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new CommandFailure(input.label, result.status ?? result.signal, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
}

/**
 * 运行访问 npm registry 的命令（npm install / ci / audit、pnpm audit）。
 * npm 对 POST 请求（审计接口）不做内置重试，一次 TLS 握手中断就会让整步失败，所以在调用处补上。
 */
function runRegistryCommand(input) {
  return retryTransientNetwork({
    label: input.label,
    attempt: () => runCapturedCommand(input),
    describeTransient: error => (error instanceof CommandFailure ? describeTransientRegistryFailure(error.output) : undefined),
    delaysMs: input.delaysMs,
    wait: input.wait,
  });
}

module.exports = {
  TRANSIENT_NETWORK_RETRY_DELAYS_MS,
  retryTransientNetwork,
  runRegistryCommand,
};
