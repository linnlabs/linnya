import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONVERSATION_CONTROL_BRIDGE_PATH,
  CONVERSATION_CONTROL_CONNECTION_FILE_ENV,
  CONVERSATION_CONTROL_PROTOCOL_VERSION,
  CONVERSATION_CONTROL_TOKEN_HEADER,
} from '@app/schemas';
import { createProjectLifecycle, PROJECT_SCHEMAS } from 'src/domains/projects';
import { controlProjects } from 'src/app-hosts/linnya/application/conversation-control/orchestration/controlProjects';
import { createConversationControlBridgeRouter } from '../conversationControlBridge.router';
import { createInstalledCliLauncher } from '../functions/createInstalledCliLauncher';
import { publishInstalledCliLauncher } from '../orchestration/publishInstalledCliLauncher';
import { resolveConversationControlConnectionFile } from '../functions/resolveConversationControlConnectionFile';

const repoRoot = path.resolve(import.meta.dirname, '../../../../../..');
const token = 'f'.repeat(64);

interface CliResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 像外部 Agent 那样执行入口：只给一个假的用户主目录，不给连接文件覆盖变量，
 * 让入口、随包 Node、CLI bundle 和用户级连接描述按安装版的真实发现路径串起来。
 */
function runLauncher(
  launcherFile: string,
  homeDirectory: string,
  args: readonly string[],
  wrap: (command: string, commandArgs: readonly string[]) => readonly [string, readonly string[]] =
    (command, commandArgs) => [command, commandArgs],
): Promise<CliResult> {
  const windows = process.platform === 'win32';
  const [command, commandArgs] = wrap(windows ? `"${launcherFile}"` : launcherFile, args);
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory };
  delete environment[CONVERSATION_CONTROL_CONNECTION_FILE_ENV];
  return new Promise((resolve, reject) => {
    // Windows 只能经 cmd 执行批处理；外部 Agent 的 Shell 工具同样如此。
    const child = spawn(command, [...commandArgs], {
      cwd: homeDirectory, env: environment, shell: windows, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
}

// 只在已构建 CLI bundle 的入口运行（test:linnya-cli:bundle 与平台构建 CI），与其他产物级测试一致。
const bundleSuite = process.env.LINNYA_CLI_TEST_ENTRY === 'bundle' ? describe : describe.skip;

bundleSuite('安装版 linnya 入口 → 随包 CLI bundle → 真实 HTTP bridge → Project SQLite', { timeout: 60_000 }, () => {
  let root: string;
  let homeDirectory: string;
  let resourcesPath: string;
  let db: Database.Database | undefined;
  let server: Server | undefined;

  async function installResources(target: string): Promise<void> {
    // 与 package.json build.extraResources 的落点一致：只带启动器、bundle 和构建证据，没有源码。
    await mkdir(path.join(target, 'linnya-cli', 'dist'), { recursive: true });
    await cp(path.join(repoRoot, 'apps/linnya-cli/bin'), path.join(target, 'linnya-cli', 'bin'), { recursive: true });
    for (const file of ['cli.cjs', 'build.json']) {
      await cp(path.join(repoRoot, 'apps/linnya-cli/dist', file), path.join(target, 'linnya-cli', 'dist', file));
    }
  }

  function createLauncher(currentResourcesPath = resourcesPath) {
    return createInstalledCliLauncher({
      platform: process.platform,
      homeDirectory,
      resourcesPath: currentResourcesPath,
      nodeExecutablePath: process.execPath,
    });
  }

  async function startInstalledApp(): Promise<void> {
    db = new Database(path.join(root, 'projects.sqlite'));
    db.pragma('foreign_keys = ON');
    const database = db;
    PROJECT_SCHEMAS.forEach(sql => database.exec(sql));
    const app = express();
    app.use((request, response, next) => {
      if (request.headers[CONVERSATION_CONTROL_TOKEN_HEADER] !== token) {
        response.sendStatus(401);
        return;
      }
      next();
    });
    app.use(
      CONVERSATION_CONTROL_BRIDGE_PATH,
      createConversationControlBridgeRouter({
        // 安装版没有源码目录，也不提供审计。
        sourceCheckout: null,
        auditControl: { available: false, level: 'off', setLevel() {} },
        appInstanceId: 'installed-cli-test',
        appVersion: '0.4.0',
        diagnostics: { error: vi.fn() },
        useCase: {
          async execute(request) {
            if (request.command !== 'projects') throw new Error('Expected project command');
            return controlProjects(createProjectLifecycle(database, { publish() {} }), request);
          },
        },
      }),
    );
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      listening.once('error', reject);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const connectionFile = resolveConversationControlConnectionFile({}, homeDirectory);
    await mkdir(path.dirname(connectionFile), { recursive: true, mode: 0o700 });
    await writeFile(connectionFile, JSON.stringify({
      protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
      app_instance_id: 'installed-cli-test',
      pid: process.pid,
      host: '127.0.0.1',
      port: address.port,
      session_token: token,
      created_at: Date.now(),
      updated_at: Date.now(),
    }), { mode: 0o600 });
  }

  beforeEach(async () => {
    // 真实路径里就有空格和中文：macOS 的 App 名是“林芽”，Windows 用户名常是中文。
    root = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'linnya-installed-cli-')));
    homeDirectory = path.join(root, '用户 主目录');
    resourcesPath = path.join(homeDirectory, 'Applications', '林芽.app', 'Contents', 'Resources');
    await mkdir(homeDirectory, { recursive: true });
    await installResources(resourcesPath);
  });

  afterEach(async () => {
    const closing = server;
    server = undefined;
    if (closing) await new Promise<void>(resolve => { closing.close(() => resolve()); });
    db?.close();
    db = undefined;
    await rm(root, { recursive: true, force: true });
  });

  it('桌面端没开时入口立刻返回未运行；打开后同一入口能诊断、建项目并列出项目', async () => {
    const launcher = createLauncher();
    expect(await publishInstalledCliLauncher(launcher)).toBe(true);

    const beforeStart = await runLauncher(launcher.filePath, homeDirectory, ['doctor']);
    expect(beforeStart.exitCode).toBe(3);
    expect(JSON.parse(beforeStart.stderr)).toMatchObject({
      error: { code: 'app_not_running' },
      connection: { source_root: null, state: 'not_connected' },
    });

    await startInstalledApp();
    const doctor = await runLauncher(launcher.filePath, homeDirectory, ['doctor']);
    expect(doctor.stderr).toBe('');
    expect(doctor.exitCode).toBe(0);
    const diagnosis: unknown = JSON.parse(doctor.stdout);
    expect(diagnosis).toMatchObject({
      ok: true,
      cli: { mode: 'bundle' },
      app: { version: '0.4.0', kind: 'packaged', source_root: null },
      protocol_version: CONVERSATION_CONTROL_PROTOCOL_VERSION,
    });
    // 安装版不公告审计能力，诊断里要能看出缺席而不是假装可用。
    expect(JSON.stringify(diagnosis)).not.toContain(token);

    const created = await runLauncher(launcher.filePath, homeDirectory, ['projects', 'create', 'Quarterly']);
    expect(created.exitCode).toBe(0);
    const listed = await runLauncher(launcher.filePath, homeDirectory, ['projects']);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)).toMatchObject({
      command: 'projects', action: 'list', projects: [{ name: 'Quarterly' }],
    });
  });

  it('安装版拒绝无界面运行，并说明该怎么用', async () => {
    const launcher = createLauncher();
    await publishInstalledCliLauncher(launcher);
    const result = await runLauncher(launcher.filePath, homeDirectory, ['runtime', 'start']);
    expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: 'capability_unavailable', message: expect.stringContaining('desktop app') },
    });
  });

  it('App 被移走后旧入口给出可读回执；在新位置重新发布后恢复，位置没变则不重写', async () => {
    const launcher = createLauncher();
    expect(await publishInstalledCliLauncher(launcher)).toBe(true);
    expect(await publishInstalledCliLauncher(launcher)).toBe(false);

    const movedResources = path.join(homeDirectory, 'Moved', '林芽.app', 'Contents', 'Resources');
    await mkdir(path.dirname(movedResources), { recursive: true });
    await rename(resourcesPath, movedResources);
    const stale = await runLauncher(launcher.filePath, homeDirectory, ['doctor']);
    expect(stale.exitCode).toBe(3);
    expect(stale.stdout).toBe('');
    expect(JSON.parse(stale.stderr)).toMatchObject({
      ok: false,
      error: { code: 'app_not_running', message: expect.stringContaining('recorded location') },
    });

    const refreshed = createLauncher(movedResources);
    expect(refreshed.filePath).toBe(launcher.filePath);
    expect(await publishInstalledCliLauncher(refreshed)).toBe(true);
    expect(await readFile(launcher.filePath, 'utf8')).toBe(refreshed.content);
    await startInstalledApp();
    expect((await runLauncher(launcher.filePath, homeDirectory, ['doctor'])).exitCode).toBe(0);
  });

  // Codex 默认沙箱与 Claude Code 沙箱模式在 macOS 上都用 Seatbelt 拦本机连接；这里用同一机制复现。
  it.skipIf(process.platform !== 'darwin')(
    '被 Agent 沙箱拦住连接时说明是沙箱而不是让人去重启 App',
    async () => {
      const launcher = createLauncher();
      await publishInstalledCliLauncher(launcher);
      await startInstalledApp();
      const result = await runLauncher(launcher.filePath, homeDirectory, ['doctor'], (command, commandArgs) => [
        '/usr/bin/sandbox-exec',
        ['-p', '(version 1)(allow default)(deny network-outbound)', command, ...commandArgs],
      ]);
      expect(result.exitCode).toBe(3);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: {
          code: 'transport_failure',
          retryable: true,
          message: expect.stringContaining('outside the sandbox'),
        },
      });
    },
  );
});
