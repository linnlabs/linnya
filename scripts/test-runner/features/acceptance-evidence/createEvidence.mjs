import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** 只认可测试框架的断言错误，普通运行错误不能充当反向回归的红灯。 */
export function failureOf(error) {
  return {
    kind: error?.code === 'ERR_ASSERTION' || error?.name === 'AssertionError' ? 'assertion' : 'error',
    message: error?.stack || error?.message || String(error),
  };
}

export function createEvidence(scenario, { root = process.cwd(), files = [], directory = process.env.ACCEPTANCE_EVIDENCE_DIR } = {}) {
  const output = directory ? resolve(directory) : mkdtempSync(join(tmpdir(), 'linnya-acceptance-'));
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const manifest = join(output, 'evidence.json');
  if (existsSync(manifest)) throw new Error(`验收输出目录已经使用：${output}`);
  const data = { version: 1, scenario, testFiles: [], checks: [], errors: [], artifacts: [] };
  const addFile = file => {
    const path = relative(root, resolve(root, file)).split(sep).join('/');
    if (!path || path.startsWith('../') || isAbsolute(path)) throw new Error(`测试文件不在当前源码内：${file}`);
    if (!data.testFiles.includes(path)) data.testFiles.push(path);
  };
  files.forEach(addFile);
  return {
    directory: output, data, addFile,
    record(name, status, failure) {
      data.checks.push({ name, status, ...(failure ? { failure } : {}) });
    },
    async check(name, action) {
      try {
        const value = await action();
        this.record(name, 'passed');
        return value;
      } catch (error) {
        this.record(name, 'failed', failureOf(error));
        throw error;
      }
    },
    error(error) { data.errors.push(error?.stack || error?.message || String(error)); },
    artifact(path, label = basename(path)) {
      const target = `${String(data.artifacts.length + 1).padStart(3, '0')}-${basename(path)}`;
      copyFileSync(path, join(output, target));
      data.artifacts.push({ path: target, label });
    },
    json(label, value) {
      const target = `${String(data.artifacts.length + 1).padStart(3, '0')}-${label}.json`;
      writeFileSync(join(output, target), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      data.artifacts.push({ path: target, label });
    },
    finish() {
      data.testFiles.sort();
      writeFileSync(manifest, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      return { manifest, directory: output, checks: data.checks, artifacts: data.artifacts };
    },
  };
}
