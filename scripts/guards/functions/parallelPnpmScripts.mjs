import os from 'node:os';

export const DEFAULT_GUARD_CONCURRENCY = 2;

const SCRIPT_NAME_PATTERN = /^[a-z0-9:_-]+$/iu;

/**
 * 校验并行门禁脚本名列表，拒绝空列表、非法脚本名或重复项。
 */
export function validateScriptNames(names) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new Error('At least one pnpm script name must be provided');
  }
  const seen = new Set();
  const validated = [];
  for (const name of names) {
    if (typeof name !== 'string' || !SCRIPT_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid pnpm script name: ${JSON.stringify(name)}`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate pnpm script name: ${name}`);
    }
    seen.add(name);
    validated.push(name);
  }
  return validated;
}

/**
 * 解析轻量门禁并发度：默认取 min(核数, 2, 脚本数)，可用 LINNYA_GUARD_CONCURRENCY 覆盖。
 */
export function resolveGuardConcurrency(
  rawValue,
  scriptCount,
  availableCores = os.availableParallelism(),
) {
  if (!Number.isInteger(scriptCount) || scriptCount < 1) {
    throw new Error(`Invalid script count: ${String(scriptCount)}`);
  }
  if (!Number.isInteger(availableCores) || availableCores < 1) {
    throw new Error(`Invalid available core count: ${String(availableCores)}`);
  }

  let requested = Math.max(1, Math.min(availableCores, DEFAULT_GUARD_CONCURRENCY));
  if (rawValue !== undefined) {
    const trimmed = String(rawValue).trim();
    if (trimmed !== '') {
      if (!/^[1-9]\d*$/u.test(trimmed)) {
        throw new Error(
          `LINNYA_GUARD_CONCURRENCY must be a positive integer, got: ${JSON.stringify(rawValue)}`,
        );
      }
      requested = Number(trimmed);
    }
  }

  return Math.min(requested, scriptCount);
}

/**
 * 在受控并发下跑完所有门禁脚本并保留原始顺序汇总结果；单项失败不吞掉后续脚本错误。
 */
export async function runParallelPnpmScripts({ scripts, concurrency, cwd, runScript }) {
  const validated = validateScriptNames(scripts);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Concurrency must be a positive integer, got: ${String(concurrency)}`);
  }

  const results = new Array(validated.length);
  const workerCount = Math.min(concurrency, validated.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= validated.length) return;
      const name = validated[currentIndex];
      const startedAt = Date.now();
      const outcome = await runScript({ name, index: currentIndex, cwd });
      results[currentIndex] = {
        name,
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs ?? Date.now() - startedAt,
        output: outcome.output ?? '',
      };
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const firstFailureExitCode = results.find(item => item.exitCode !== 0)?.exitCode ?? 0;
  return {
    ok: firstFailureExitCode === 0,
    results,
    firstFailureExitCode,
  };
}
