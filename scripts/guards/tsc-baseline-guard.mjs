#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const BASELINE_RELATIVE_PATH = '.baseline/typescript-errors.txt';
const baselinePath = path.join(repoRoot, BASELINE_RELATIVE_PATH);
const args = new Set(process.argv.slice(2));
const shouldUpdateBaseline = args.has('--update-baseline');
const shouldStageBaseline = args.has('--stage-baseline');
const TSC_OUTPUT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const explicitLogFileArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith('--log-file='));
const explicitLogPath = explicitLogFileArg
  ? path.resolve(repoRoot, explicitLogFileArg.slice('--log-file='.length))
  : null;

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function readBaseline() {
  if (!existsSync(baselinePath)) {
    fail(`❌ tsc baseline 文件不存在：${path.relative(repoRoot, baselinePath)}`, 2);
  }

  const content = readFileSync(baselinePath, 'utf8');
  const match = content.match(/^Total errors:\s*(\d+)\s*$/m);
  if (!match) {
    fail(`❌ 无法从 ${BASELINE_RELATIVE_PATH} 解析 tsc baseline（缺少 "Total errors: N"）。`, 2);
  }

  return {
    content,
    value: Number(match[1]),
  };
}

function runTsc() {
  const tscBin = process.platform === 'win32'
    ? path.join(repoRoot, 'node_modules/.bin/tsc.cmd')
    : path.join(repoRoot, 'node_modules/.bin/tsc');

  if (!existsSync(tscBin)) {
    fail('❌ 找不到 node_modules/.bin/tsc；请先安装依赖。', 2);
  }

  const logPath = explicitLogPath
    ?? path.join(os.tmpdir(), `linnya-tsc-baseline-${process.pid}-${Date.now()}.log`);
  const result = spawnSync(tscBin, ['--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: TSC_OUTPUT_MAX_BUFFER_BYTES,
  });

  if (result.error) {
    fail(`❌ tsc 执行失败：${result.error.message}`, 2);
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const portableOutput = output.split(repoRoot).join('<repo-root>');
  writeFileSync(logPath, portableOutput);
  const current = output
    .split(/\r?\n/u)
    .filter((line) => /error TS\d+/u.test(line))
    .length;

  return {
    current,
    logPath,
  };
}

function removeLogIfTemporary(logPath) {
  if (!explicitLogPath) {
    rmSync(logPath, { force: true });
  }
}

function updateBaseline(content, current) {
  let next = content.replace(/^Total errors:\s*\d+\s*$/m, `Total errors: ${current}`);
  next = next.replace(
    /^(- tsc total errors:\s*<=\s*)\d+(\s.*)?$/m,
    (_, prefix, suffix = '') => `${prefix}${current}${suffix}`,
  );

  if (next === content) {
    fail('❌ tsc baseline 未能写回：没有找到可更新的 baseline 行。', 2);
  }

  writeFileSync(baselinePath, next);

  if (shouldStageBaseline) {
    const stageResult = spawnSync('git', ['add', '--', path.relative(repoRoot, baselinePath)], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (stageResult.status !== 0) {
      fail(`❌ baseline 已更新，但 git add 失败：${stageResult.stderr || stageResult.stdout}`, 2);
    }
  }
}

const baseline = readBaseline();
const tsc = runTsc();

console.log(`  baseline = ${baseline.value}`);
console.log(`  current  = ${tsc.current}`);

if (tsc.current > baseline.value) {
  const delta = tsc.current - baseline.value;
  console.error('');
  console.error(`❌ tsc 错误数净增 ${delta} 条（${baseline.value} → ${tsc.current}）`);
  console.error('   baseline 只能下降，不能上调。请修掉新增类型错误后重试。');
  console.error(`   完整 log: ${tsc.logPath}`);
  process.exit(1);
}

if (tsc.current < baseline.value) {
  if (!shouldUpdateBaseline) {
    console.error('');
    console.error(`❌ tsc baseline 已过宽（baseline ${baseline.value}，current ${tsc.current}）。`);
    console.error('   baseline 必须随错误数下降而收紧；请运行：pnpm run guard:tsc-baseline:update');
    console.error(`   完整 log: ${tsc.logPath}`);
    process.exit(1);
  }

  updateBaseline(baseline.content, tsc.current);
  removeLogIfTemporary(tsc.logPath);
  console.log(`  baseline tightened: ${baseline.value} -> ${tsc.current}`);
  if (shouldStageBaseline) {
    console.log('  baseline file staged');
  }
  process.exit(0);
}

removeLogIfTemporary(tsc.logPath);
console.log('  baseline is exact');
