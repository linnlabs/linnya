import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

/**
 * dev:electron 的只读附着信息。
 *
 * 中文说明：日常 dev:electron 实例只在 127.0.0.1 开一个随机 CDP 端口，端口与 Renderer
 * 地址写进本实例 profile 的 runtime 目录，供探针 `--attach` 只读查看；会话结束即删除。
 * 路径与 resolveDevelopmentInstancePaths 一致：LINNYA_DEV_INSTANCE_ROOT 覆盖时一起移动。
 */
export function developmentAttachmentFile(repositoryRoot, instanceRootOverride = process.env.LINNYA_DEV_INSTANCE_ROOT) {
  const instanceRoot = path.resolve(repositoryRoot, instanceRootOverride?.trim() || '.');
  return path.join(instanceRoot, '_dev_electron', 'runtime', 'dev-attach.json');
}

export function developmentLogDirectory(repositoryRoot, instanceRootOverride = process.env.LINNYA_DEV_INSTANCE_ROOT) {
  const instanceRoot = path.resolve(repositoryRoot, instanceRootOverride?.trim() || '.');
  return path.join(instanceRoot, '_dev_data', 'logs');
}

/** 由系统分配一个空闲回环端口；只监听 127.0.0.1。 */
export function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export function writeDevelopmentAttachment(file, attachment) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(attachment), { mode: 0o600 });
}

export function readDevelopmentAttachment(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 只删除本会话写入的记录，避免误删同一 profile 下更新的会话。 */
export function removeDevelopmentAttachment(file, launcherPid) {
  const current = readDevelopmentAttachment(file);
  if (current && current.launcherPid !== launcherPid) return;
  rmSync(file, { force: true });
}
