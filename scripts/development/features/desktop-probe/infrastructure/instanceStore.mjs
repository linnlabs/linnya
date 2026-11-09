import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';

const key = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
export const instancesRoot = join(tmpdir(), 'linnya-dev-probe', `${basename(repoRoot)}-${key}`);

export function instanceRoot(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,47}$/.test(name)) {
    throw new ProbeError('USAGE', '实例名只能包含字母、数字、下划线和连字符，最多 48 字符');
  }
  return join(instancesRoot, name);
}

export function readOptional(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function readSession(root) {
  return JSON.parse(readOptional(join(root, 'session.json')) ?? 'null');
}

export function writeSession(root, session) {
  const temp = join(root, `.session-${randomUUID()}`);
  writeFileSync(temp, JSON.stringify(session), { mode: 0o600 });
  renameSync(temp, join(root, 'session.json'));
}

export function prepareInstance(root) {
  for (const name of ['', 'logs', 'artifacts', 'user-data', 'workspace', 'plugins', 'runtime']) {
    mkdirSync(join(root, name), { recursive: true, mode: 0o700 });
  }
  touchInstance(root);
}

export function touchInstance(root) {
  const file = join(root, 'last-used');
  closeSync(openSync(file, 'a', 0o600));
  const now = new Date();
  utimesSync(file, now, now);
}

export async function withLifecycleLock(root, action) {
  mkdirSync(instancesRoot, { recursive: true, mode: 0o700 });
  const lock = `${root}.lock`;
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new ProbeError('BUSY', '该实例正在启动或停止', '用 probe status 检查当前会话。');
    throw error;
  }
  const release = () => rmSync(lock, { recursive: true, force: true });
  const interrupt = () => { release(); process.exit(130); };
  const terminate = () => { release(); process.exit(143); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    return await action();
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
    release();
  }
}

export function writeArtifact(root, label, extension, data) {
  const folder = join(root, 'artifacts');
  const path = join(folder, `${Date.now()}-${label}-${randomUUID().slice(0, 8)}.${extension}`);
  writeFileSync(path, data, { mode: 0o600 });
  const files = readdirSync(folder).sort();
  for (const file of files.slice(0, -200)) rmSync(join(folder, file), { force: true });
  return { path, bytes: statSync(path).size };
}
