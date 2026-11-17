import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { observeTree, readProcessTable, sameProcess } from '../infrastructure/processTree.mjs';

const exec = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/probe.mjs', import.meta.url));

function frontPid() {
  const app = execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf8' }).trim();
  const info = execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'pid', app], { encoding: 'utf8' });
  return Number(info.match(/"?pid"?\s*=\s*(\d+)/)?.[1]);
}

export function acceptance(name, { sampleInterval = 150, evidence } = {}) {
  const seenFront = new Set();
  const owned = new Map();
  const steps = [];
  const probe = async (command, ...args) => {
    const options = { cwd: repoRoot, timeout: 75_000, maxBuffer: 4 * 1024 * 1024 };
    let raw;
    try {
      ({ stdout: raw } = await exec(process.execPath, [bin, command, '--name', name, ...args], options));
    } catch (error) {
      if (!error.stdout) throw error;
      raw = error.stdout;
    }
    const result = JSON.parse(raw);
    if (evidence) {
      steps.push({ command, args, result });
      // stop --clean 会删除实例目录，附件必须在命令返回时就保存。
      for (const artifact of result.artifacts ?? []) evidence.artifact(artifact.path, command);
    }
    if (['up', 'restart'].includes(command) && result.ok) {
      for (const [pid, process] of observeTree(result.supervisor)) owned.set(pid, process);
      for (const [pid, process] of observeTree(result.electron)) owned.set(pid, process);
    }
    return result;
  };
  const run = async (...args) => {
    const result = await probe(...args);
    if (!result.ok) {
      // 跟手比较是已采样后的业务断言；找不到目标、超时等仍是运行错误。
      if (result.error.code === 'FOLLOW_MISMATCH') assert.fail(result.error.message);
      throw new ProbeError(result.error.code, result.error.message, result.error.hint, result.error.details);
    }
    return result;
  };
  const sample = () => seenFront.add(frontPid());
  sample();
  const timer = setInterval(sample, sampleInterval);
  return {
    run, probe,
    async finish({ clean = false } = {}) {
      try {
        const stop = await run('stop', ...(clean ? ['--clean'] : []));
        const table = readProcessTable();
        assert.deepEqual([...owned.values()].filter(entry => sameProcess(entry, table)).map(entry => entry.pid), []);
        assert.deepEqual(stop.cleanup?.remaining ?? [], []);
        assert.ok(seenFront.size > 0 && [...seenFront].every(Number.isSafeInteger));
        assert.deepEqual([...seenFront].filter(pid => owned.has(pid)), []);
        return { stopped: stop.ms, cleanup: stop.cleanup, observed: owned.size, foregroundPids: [...seenFront] };
      } finally {
        clearInterval(timer);
        evidence?.json('probe-steps', steps);
      }
    },
  };
}
