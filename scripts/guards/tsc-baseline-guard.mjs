#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
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

/**
 * 每个项目各有一份只降不升的错误总数基线。根项目覆盖迁移期的 aggregate graph；
 * Renderer 用 vue-tsc 的独立 profile，才能看到 .vue 文件里的类型错误。
 */
const PROJECTS = [
  {
    key: 'repo',
    label: '全仓 tsc',
    bin: 'tsc',
    tsconfig: 'tsconfig.json',
    baseline: '.baseline/typescript-errors.txt',
    // 这部分必须零错误：既不能被其他模块的下降抵消，也不能通过更新基线接纳。
    strictZero: {
      label: 'Shell E2E fixtures/harness',
      pattern: /^scripts\/e2e\/shell-tool\/(fixtures|harness)\/.*error TS\d+/u,
    },
  },
  {
    key: 'renderer',
    label: 'Renderer vue-tsc',
    bin: 'vue-tsc',
    tsconfig: 'apps/renderer/tsconfig.json',
    baseline: '.baseline/renderer-typescript-errors.txt',
  },
];

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function readBaseline(project) {
  const baselinePath = path.join(repoRoot, project.baseline);
  if (!existsSync(baselinePath)) {
    fail(`❌ tsc baseline 文件不存在：${project.baseline}`, 2);
  }

  const content = readFileSync(baselinePath, 'utf8');
  const match = content.match(/^Total errors:\s*(\d+)\s*$/m);
  if (!match) {
    fail(`❌ 无法从 ${project.baseline} 解析 tsc baseline（缺少 "Total errors: N"）。`, 2);
  }

  return {
    path: baselinePath,
    content,
    value: Number(match[1]),
  };
}

function logPathFor(project) {
  if (explicitLogPath) {
    return `${explicitLogPath.replace(/\.log$/u, '')}.${project.key}.log`;
  }
  return path.join(os.tmpdir(), `linnya-tsc-baseline-${project.key}-${process.pid}-${Date.now()}.log`);
}

function runTypecheck(project) {
  const binName = process.platform === 'win32' ? `${project.bin}.cmd` : project.bin;
  const bin = path.join(repoRoot, 'node_modules/.bin', binName);

  if (!existsSync(bin)) {
    fail(`❌ 找不到 node_modules/.bin/${binName}；请先安装依赖。`, 2);
  }

  const logPath = logPathFor(project);
  const result = spawnSync(bin, ['--noEmit', '-p', project.tsconfig, '--pretty', 'false'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: TSC_OUTPUT_MAX_BUFFER_BYTES,
  });

  if (result.error) {
    fail(`❌ ${project.label} 执行失败：${result.error.message}`, 2);
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const portableOutput = output.split(repoRoot).join('<repo-root>');
  writeFileSync(logPath, portableOutput);
  const current = output
    .split(/\r?\n/u)
    .filter((line) => /error TS\d+/u.test(line))
    .length;

  // tsc 的正常诊断退出码为 1/2；被信号终止或没有诊断的失败不能当成错误减少。
  // 先留日志，再拒绝更新基线，避免编译器崩溃把存量债务误写成零。
  if (result.signal || result.status === null
    || (result.status !== 0 && (![1, 2].includes(result.status) || current === 0))
    || (result.status === 0 && current > 0)) {
    fail(`❌ ${project.label} 未正常完成（exit=${result.status}, signal=${result.signal}）；完整 log: ${logPath}`, 2);
  }

  const strictZeroErrors = project.strictZero
    ? portableOutput
      .split(/\r?\n/u)
      .filter((line) => project.strictZero.pattern.test(line.replaceAll('\\', '/')))
    : [];

  return {
    current,
    strictZeroErrors,
    logPath,
  };
}

function removeLogIfTemporary(logPath) {
  if (!explicitLogPath) {
    rmSync(logPath, { force: true });
  }
}

function updateBaseline(project, baseline, current) {
  let next = baseline.content.replace(/^Total errors:\s*\d+\s*$/m, `Total errors: ${current}`);
  next = next.replace(
    /^(- tsc total errors:\s*<=\s*)\d+(\s.*)?$/m,
    (_, prefix, suffix = '') => `${prefix}${current}${suffix}`,
  );

  if (next === baseline.content) {
    fail(`❌ ${project.baseline} 未能写回：没有找到可更新的 baseline 行。`, 2);
  }

  writeFileSync(baseline.path, next);

  if (shouldStageBaseline) {
    const stageResult = spawnSync('git', ['add', '--', project.baseline], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (stageResult.status !== 0) {
      fail(`❌ baseline 已更新，但 git add 失败：${stageResult.stderr || stageResult.stdout}`, 2);
    }
  }
}

/** 返回该项目是否通过；不在第一个失败处退出，好让一次运行报告全部项目。 */
function checkProject(project) {
  const baseline = readBaseline(project);
  const result = runTypecheck(project);

  console.log(`${project.label}（${project.tsconfig}）`);

  if (project.strictZero) {
    if (result.strictZeroErrors.length > 0) {
      console.error(result.strictZeroErrors.join('\n'));
      console.error(`❌ ${project.strictZero.label} 必须零类型错误；完整 log: ${result.logPath}`);
      return false;
    }
    console.log(`  ${project.strictZero.label}: 0 type errors`);
  }

  console.log(`  baseline = ${baseline.value}`);
  console.log(`  current  = ${result.current}`);

  if (result.current > baseline.value) {
    const delta = result.current - baseline.value;
    console.error('');
    console.error(`❌ ${project.label} 错误数净增 ${delta} 条（${baseline.value} → ${result.current}）`);
    console.error('   baseline 只能下降，不能上调。请修掉新增类型错误后重试。');
    console.error(`   完整 log: ${result.logPath}`);
    return false;
  }

  if (result.current < baseline.value) {
    if (!shouldUpdateBaseline) {
      console.error('');
      console.error(`❌ ${project.label} baseline 已过宽（baseline ${baseline.value}，current ${result.current}）。`);
      console.error('   baseline 必须随错误数下降而收紧；请运行：pnpm run guard:tsc-baseline:update');
      console.error(`   完整 log: ${result.logPath}`);
      return false;
    }

    updateBaseline(project, baseline, result.current);
    removeLogIfTemporary(result.logPath);
    console.log(`  baseline tightened: ${baseline.value} -> ${result.current}`);
    if (shouldStageBaseline) {
      console.log('  baseline file staged');
    }
    return true;
  }

  removeLogIfTemporary(result.logPath);
  console.log('  baseline is exact');
  return true;
}

const results = PROJECTS.map(checkProject);
if (results.includes(false)) {
  process.exit(1);
}
