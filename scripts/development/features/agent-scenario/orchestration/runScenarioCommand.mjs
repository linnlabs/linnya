import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { scenarioEnv } from '../functions/parseScenarioArgs.mjs';
import { renderScenarioTest, scenarioTestPath } from '../functions/scenarioTemplates.mjs';

const ROOTS = ['src', 'apps', 'packages'];
const SKIP = new Set(['node_modules', 'dist', 'out', '.vite', '_dev_data', '_dev_electron']);
const SCENARIO_MARK = /\bcreateFlowScenario\(/;

function walk(directory, files) {
  for (const name of readdirSync(directory)) {
    if (SKIP.has(name)) continue;
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, files);
    else if (/\.test\.ts$/.test(name)) files.push(path);
  }
  return files;
}

/** 用场景夹具写的测试文件（按内容识别，不靠命名约定）。 */
export function findScenarioTests(repoRoot) {
  return ROOTS.filter(root => existsSync(join(repoRoot, root)))
    .flatMap(root => walk(join(repoRoot, root), []))
    .filter(path => SCENARIO_MARK.test(readFileSync(path, 'utf8')))
    .map(path => relative(repoRoot, path))
    .sort();
}

function testTitles(repoRoot, file) {
  return [...readFileSync(join(repoRoot, file), 'utf8').matchAll(/\bit\(\s*'([^']+)'/g)].map(match => match[1]);
}

function runVitest(repoRoot, files, parsed) {
  if (files.length === 0) {
    console.log('没有匹配的场景测试。用 `pnpm -s scenario list` 看全部。');
    return Promise.resolve(1);
  }
  const args = [join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...files];
  if (parsed.options?.grep) args.push('-t', parsed.options.grep);
  // 场景会启动真实 Runtime，日志很多；默认只看用例结果，--verbose 时保留日志。
  // Runtime logger 直接写控制台，--silent 拦不住，另由 SCENARIO_QUIET 让场景夹具关掉。
  if (!parsed.options?.verbose) args.push('--silent');
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, ...scenarioEnv(parsed) },
    });
    child.on('exit', code => resolve(code ?? 1));
  });
}

export async function runScenarioCommand(parsed, repoRoot) {
  switch (parsed.command) {
    case 'list': {
      for (const file of findScenarioTests(repoRoot)) {
        console.log(file);
        for (const title of testTitles(repoRoot, file)) console.log(`  · ${title}`);
      }
      return 0;
    }
    case 'run': {
      const files = findScenarioTests(repoRoot)
        .filter(file => parsed.filters.length === 0 || parsed.filters.some(filter => file.includes(filter)));
      return runVitest(repoRoot, files, parsed);
    }
    case 'fuzz':
    case 'replay': {
      const files = findScenarioTests(repoRoot).filter(file => file.includes('.fuzz.'))
        .filter(file => !parsed.filters?.length || parsed.filters.some(filter => file.includes(filter)));
      return runVitest(repoRoot, files, parsed);
    }
    case 'new': {
      const target = scenarioTestPath(parsed.name);
      const absolute = join(repoRoot, target);
      if (existsSync(absolute)) {
        console.log(`已存在：${target}`);
        return 1;
      }
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, renderScenarioTest(parsed.name));
      console.log(`已生成：${target}\n运行：pnpm -s scenario run ${parsed.name}`);
      return 0;
    }
    default:
      return 1;
  }
}
