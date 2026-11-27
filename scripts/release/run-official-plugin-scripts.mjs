#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  resolveOfficialPluginConcurrency,
  runBoundedParallel,
} from './functions/officialPluginConcurrency.mjs';
import { preparePluginArtifactForSmoke } from './orchestration/preparePluginArtifactForSmoke.mjs';

import {
  listOfficialPluginReleaseTargetIds,
  repoRoot,
  resolvePluginPackageDir,
} from './plugin-release-targets.mjs';

const [scriptKind, ...args] = process.argv.slice(2);
function selectTargets() {
  if (args.length === 0 && ['package', 'smoke-artifact'].includes(scriptKind)) return listOfficialPluginReleaseTargetIds();
  if (scriptKind === 'prepare-smoke' && args.length === 1 && /^[a-z0-9][a-z0-9._-]{0,127}$/u.test(args[0])) return args;
  throw new Error('Usage: run-official-plugin-scripts.mjs package | smoke-artifact | prepare-smoke <pluginId>');
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const activeChildren = new Set();

function terminateActiveChildren(signal = 'SIGTERM') {
  for (const child of activeChildren) {
    if (!child.killed) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    terminateActiveChildren(signal);
    process.exit(1);
  });
}

let schemasPromise = null;
function ensureSchemasBuilt() {
  // 插件的独立浏览器入口消费 schemas 的正式导出，同一批打包只需要准备一次。
  if (!schemasPromise) {
    schemasPromise = runCommand(pnpmCommand, ['run', 'build:schemas'], repoRoot, {
      buffered: false,
    });
  }
  return schemasPromise;
}

class CommandExitError extends Error {
  constructor(command, exitCode) {
    super(`Command ${command} exited with status ${exitCode}`);
    this.exitCode = exitCode;
  }
}

function runCommand(command, commandArgs, cwd, { buffered = false, logLines = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: buffered ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      // Windows 的 pnpm.cmd 是批处理入口，不能交给 CreateProcess 直接执行。
      // 这里只对固定的 pnpm 命令启用 shell；Node verifier 继续直接启动。
      shell: process.platform === 'win32' && command === 'pnpm.cmd',
    });
    activeChildren.add(child);

    const chunks = [];
    if (buffered) {
      child.stdout?.on('data', chunk => chunks.push({ stream: process.stdout, chunk }));
      child.stderr?.on('data', chunk => chunks.push({ stream: process.stderr, chunk }));
    }

    child.once('error', error => {
      activeChildren.delete(child);
      reject(error);
    });

    child.once('close', (code, signal) => {
      activeChildren.delete(child);
      if (buffered && (logLines?.length || chunks.length > 0)) {
        for (const line of logLines ?? []) process.stdout.write(`${line}\n`);
        for (const entry of chunks) entry.stream.write(entry.chunk);
      }
      if (code === 0) {
        resolve();
        return;
      }
      const exitCode = typeof code === 'number' ? code : 1;
      const reason = signal ? `signal ${signal}` : `status ${exitCode}`;
      reject(new CommandExitError(`${command} ${commandArgs.join(' ')} (${reason})`, exitCode));
    });
  });
}

async function runTarget(id, buffered) {
  // 专项 smoke 的 Worker 与夹具属于仓内插件；发行批次则遵循发行目标的路径覆盖。
  const packageDir = resolvePluginPackageDir(id, scriptKind === 'prepare-smoke' ? {} : process.env);
  const bufferedLogLines = [];
  const log = message => {
    if (buffered) bufferedLogLines.push(message);
    else console.log(message);
  };

  const build = async () => {
    await ensureSchemasBuilt();
    log(`[official-plugin:${scriptKind}] ${id} package:artifact`);
    await runCommand(pnpmCommand, ['run', 'package:artifact'], packageDir, {
      buffered,
      logLines: buffered ? bufferedLogLines.splice(0) : null,
    });
  };

  if (scriptKind === 'package') await build();
  else await preparePluginArtifactForSmoke({ packageDir, repoRoot, build });

  if (scriptKind === 'smoke-artifact') {
    await runCommand(
      process.execPath,
      ['scripts/release/smoke-plugin-artifact.mjs', id, '--require-renderer-assets'],
      repoRoot,
      {
        buffered,
        logLines: buffered ? bufferedLogLines.splice(0) : null,
      },
    );
  }
}

async function main() {
  const targets = selectTargets();
  const concurrency = resolveOfficialPluginConcurrency(
    process.env.LINNYA_OFFICIAL_PLUGIN_CONCURRENCY,
    targets.length,
  );
  const buffered = concurrency > 1;
  await runBoundedParallel(targets, concurrency, id => runTarget(id, buffered));
}

main().catch(error => {
  terminateActiveChildren('SIGTERM');
  if (error instanceof CommandExitError) {
    process.exit(error.exitCode);
  }
  console.error(error);
  process.exit(1);
});
