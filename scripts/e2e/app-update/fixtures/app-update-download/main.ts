import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

import type { AppUpdateState } from '../../../../../src/shared/update/definitions/updateMessage';
import { createAppUpdateController } from '../../../../../src/electron-main/update/orchestration/createAppUpdateController';
import { createElectronAppUpdaterPort } from '../../../../../src/electron-main/update/orchestration/createElectronAppUpdaterPort';

/**
 * 真实 electron-updater 下载链路：本进程起一个 generic 更新源，按场景切换返回内容，
 * 验证版本判断、进度、断连后自动重试、校验失败与取消在正式 controller 下的表现。
 * 不安装、不调用 Squirrel，也不访问外网。
 */
const resultPath = process.env.LINNYA_UPDATE_DOWNLOAD_RESULT_PATH;
const workRoot = process.env.LINNYA_UPDATE_DOWNLOAD_WORK_ROOT;
if (!resultPath || !workRoot || !path.isAbsolute(resultPath) || !path.isAbsolute(workRoot)) {
  throw new Error('LINNYA_UPDATE_DOWNLOAD_RESULT_PATH / LINNYA_UPDATE_DOWNLOAD_WORK_ROOT must be absolute paths');
}

type ServeMode = 'normal' | 'drop-once' | 'corrupt' | 'slow';

interface Release {
  readonly version: string;
  readonly file: string;
  readonly bytes: Buffer;
}

const ZIP_SIZE = 4 * 1024 * 1024;
const releaseRoot = path.join(workRoot, 'feed');
const cacheDirName = `linnya-update-download-e2e-${process.pid}`;
fs.mkdirSync(releaseRoot, { recursive: true });

let mode: ServeMode = 'normal';
let dropped = false;
let manifest = '';
const releases = new Map<string, Release>();

function sha512(bytes: Buffer): string {
  return createHash('sha512').update(bytes).digest('base64');
}

function publishRelease(version: string): Release {
  const file = `Linnya-${version}-arm64-mac.zip`;
  const release = { version, file, bytes: randomBytes(ZIP_SIZE) };
  releases.set(file, release);
  manifest = [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512(release.bytes)}`,
    `    size: ${release.bytes.length}`,
    `path: ${file}`,
    `sha512: ${sha512(release.bytes)}`,
    "releaseDate: '2026-11-01T00:00:00.000Z'",
    "releaseNotes: '- 下载链路测试'",
    '',
  ].join('\n');
  return release;
}

const server = http.createServer((request, response) => {
  const name = decodeURIComponent((request.url ?? '/').split('?')[0].replace(/^\//, ''));
  if (name === 'latest-mac.yml' || name === 'latest.yml') {
    response.writeHead(200, { 'Content-Type': 'text/yaml' });
    response.end(manifest);
    return;
  }
  const release = releases.get(name);
  if (!release) {
    response.writeHead(404);
    response.end();
    return;
  }
  const body = mode === 'corrupt' ? randomBytes(release.bytes.length) : release.bytes;
  response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length });
  if (mode === 'drop-once' && !dropped) {
    dropped = true;
    // 发出一半后断开连接，模拟下载到一半断网。
    response.write(body.subarray(0, body.length / 2), () => request.socket.destroy());
    return;
  }
  if (mode === 'slow') {
    let offset = 0;
    const timer = setInterval(() => {
      if (response.destroyed) { clearInterval(timer); return; }
      const next = body.subarray(offset, offset + 64 * 1024);
      offset += next.length;
      if (next.length === 0) { clearInterval(timer); response.end(); return; }
      response.write(next);
    }, 50);
    response.on('close', () => clearInterval(timer));
    return;
  }
  response.end(body);
});

function waitFor(label: string, read: () => boolean, timeoutMs = 60_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (read()) { resolve(); return; }
      if (Date.now() > end) { reject(new Error(`${label} timed out`)); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function writeResult(value: unknown): void {
  const pending = `${resultPath}.${process.pid}.pending`;
  fs.writeFileSync(pending, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(pending, resultPath!);
}

void app.whenReady().then(async () => {
  const result: Record<string, unknown> = {};
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const configPath = path.join(workRoot, 'dev-app-update.yml');
    fs.writeFileSync(configPath, `provider: generic\nurl: http://127.0.0.1:${port}/\nupdaterCacheDirName: ${cacheDirName}\n`);
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.updateConfigPath = configPath;

    const states: AppUpdateState[] = [];
    let pendingInstall: string | null = null;
    const controller = createAppUpdateController({
      enabled: true,
      currentVersion: app.getVersion(),
      updater: createElectronAppUpdaterPort(),
      activity: {
        read: async () => ({ hasExecutingCommands: false, activeAgentRuns: [], knowledgeIngestionActive: false }),
        pauseAgentRuns: async () => undefined,
      },
      isInstallLocationSupported: () => true,
      setDownloadedUpdateReady: () => {},
      requestInstall: async () => 'kept_open',
      pendingInstall: { read: () => pendingInstall, write: value => { pendingInstall = value; } },
      publish: state => { states.push(state); },
      timers: {
        now: () => Date.now(),
        setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
        clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
      },
      log: (message, details) => { console.error(`[app-update-e2e] ${message} ${JSON.stringify(details ?? {})}`); },
    });
    const status = () => controller.getState().status;

    // 1. 更新源与当前版本相同：不出现入口。
    publishRelease(app.getVersion());
    result.sameVersion = await controller.check();
    result.sameVersionStatus = status();

    // 2. 新版本：下载到一半断开，自动重试后完成。
    publishRelease('0.2.0');
    mode = 'drop-once';
    result.available = await controller.check();
    const downloadStart = states.length;
    void controller.download();
    await waitFor('paused after drop', () => status() === 'paused');
    result.pausedFailure = controller.getState().failure?.kind;
    await waitFor('ready after retry', () => status() === 'ready', 30_000);
    const downloadStates = states.slice(downloadStart).map(state => state.status);
    result.dropSequence = downloadStates.filter((value, index) => value !== downloadStates[index - 1]);
    result.progressPublished = states.slice(downloadStart).some(state => (state.progress?.fraction ?? 0) > 0);
    result.pendingInstallAfterReady = pendingInstall;

    // 3. 已下载后更新源出现更新的版本，但服务的文件被篡改：校验失败，不进入 ready。
    publishRelease('0.3.0');
    mode = 'corrupt';
    await controller.check();
    await waitFor('integrity failure', () => status() === 'failed', 30_000);
    result.corruptState = { status: status(), failure: controller.getState().failure };

    // 4. 慢速下载中取消：回到 available。
    publishRelease('0.4.0');
    mode = 'slow';
    controller.cancelDownload();
    await controller.check();
    void controller.download();
    await waitFor('slow progress', () => (controller.getState().progress?.transferredBytes ?? 0) > 0, 30_000);
    controller.cancelDownload();
    await waitFor('cancelled', () => status() === 'available', 15_000);
    result.cancelState = status();

    controller.dispose();
    result.success = true;
  } catch (error: unknown) {
    result.success = false;
    result.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  } finally {
    writeResult(result);
    server.close();
    fs.rmSync(path.join(app.getPath('home'), 'Library', 'Caches', cacheDirName), { recursive: true, force: true });
    app.exit(0);
  }
});
