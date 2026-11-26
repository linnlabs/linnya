/**
 * @file src/electron-main/services/qdrantManager.ts
 *
 * @brief Qdrant 向量数据库服务管理器
 *
 * @description
 * 该模块负责启动、停止和管理 Qdrant 向量数据库进程。
 * 它是 App Server Backend 的向量进程 adapter，只处理 Qdrant 物理生命周期。
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { pathManager } from '../../shared/utils/pathManager';
import {
  assertQdrantDataDirectoryLength,
  createOwnedQdrantProcess,
  renderQdrantConfig,
  type OwnedQdrantProcess,
  type QdrantProcessRuntime,
} from '../../infra/adapters/vector-store/qdrant';
import type { LaunchOwnedPipeProcess } from '../../shared/process-runtime';

export interface QdrantConfig {
  host?: string;
  port?: number;
  timeout?: number;
}

export class QdrantStartupCleanupError extends Error {
  constructor(
    readonly startupFailure: unknown,
    readonly cleanupFailure: unknown,
  ) {
    super('Qdrant 启动失败，且进程 owner 未能完整收口');
    this.name = 'QdrantStartupCleanupError';
  }
}

/**
 * Qdrant 服务管理器类
 */
export class QdrantManager {
  private process: OwnedQdrantProcess | null = null;
  private host: string = '127.0.0.1';
  private port: number = 6333;
  private readonly requestedPort: number;
  private readonly dataRoot: string | null;
  private startTimeoutMs: number = 30_000;
  private dataDir: string = '';
  private isInitialized = false;

  constructor(
    config: QdrantConfig,
    private readonly processRuntime: QdrantProcessRuntime,
    private readonly launchOwnedPipeProcess: LaunchOwnedPipeProcess,
    dataRoot?: string,
  ) {
    if (!path.isAbsolute(processRuntime.binaryPath)) {
      throw new Error('Qdrant binary path 必须是绝对路径');
    }
    // 强制使用127.0.0.1，避免localhost在代理环境下的解析问题
    this.host = '127.0.0.1';
    this.requestedPort = config.port ?? 6333;
    this.port = this.requestedPort;
    this.startTimeoutMs = config.timeout ?? 30_000;
    this.dataRoot = dataRoot ? path.resolve(dataRoot) : null;
    if (!Number.isSafeInteger(this.startTimeoutMs) || this.startTimeoutMs <= 0) {
      throw new Error('Qdrant start timeout 必须是正整数');
    }
  }

  /**
   * 异步初始化，设置路径
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;
    // 生产运行由插件向量 capability 注入所属数据根；无注入时仅用于低层测试夹具。
    const root = this.dataRoot ?? pathManager.getWorkspaceRoot();
    this.dataDir = path.join(root, 'qdrant');
    this.isInitialized = true;
  }

  /**
   * 启动Qdrant服务
   */
  async start(): Promise<void> {
    await this.initialize();
    // 必须先于建目录：超限时 Qdrant 建集合必然失败，不留下半个数据目录或配置文件。
    assertQdrantDataDirectoryLength(this.processRuntime.platform, this.dataDir);

    // 重复 start 也必须等待旧树与 owner 资源完整收口，不能覆盖唯一进程引用。
    if (this.process) await this.stop();

    // 运行时组件可能在 App 运行期间安装或替换，每次启动时才解析实际可执行文件。
    const qdrantBinary = this.processRuntime.resolveExecutable
      ? await this.processRuntime.resolveExecutable()
      : this.processRuntime.binaryPath;

    // 检查文件是否存在
    try {
      await fs.access(qdrantBinary);
      console.log(`[QdrantManager] Found Qdrant binary at: ${qdrantBinary}`);
    } catch (error) {
      throw new Error(`Qdrant binary not found at ${qdrantBinary}: ${error}`);
    }

    // 创建数据目录
    await fs.mkdir(this.dataDir, { recursive: true });

    // 创建static目录以避免Web UI警告
    const staticDir = path.join(this.dataDir, 'static');
    try {
      await fs.mkdir(staticDir, { recursive: true });
      const indexFile = path.join(staticDir, 'index.html');
      await fs.writeFile(indexFile, 
        '<html><head><title>Qdrant</title></head><body><h3>Qdrant running</h3></body></html>',
        'utf-8'
      );
    } catch (error) {
      console.debug(`[QdrantManager] Failed to create static directory: ${error}`);
    }

    const configDirectory = path.join(this.dataDir, 'config');
    await fs.mkdir(configDirectory, { recursive: true });
    const configPath = path.join(configDirectory, 'config.yaml');
    await fs.writeFile(configPath, renderQdrantConfig({
      host: this.host,
      httpPort: this.requestedPort,
      platform: this.processRuntime.platform,
    }), 'utf-8');

    // 创建日志文件
    const logDir = path.join(this.dataDir, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    const logFilePath = path.join(logDir, 'qdrant.log');
    const logStream = (await fs.open(logFilePath, 'a')).createWriteStream();

    console.log(`[QdrantManager] Starting Qdrant server on ${this.host}:${this.port}`);
    console.log(`[QdrantManager] Data directory: ${this.dataDir}`);
    console.log(`[QdrantManager] Config file: ${configPath}`);

    const ownedProcess = await createOwnedQdrantProcess({
      launchOwnedPipeProcess: this.launchOwnedPipeProcess,
      launch: {
        executablePath: qdrantBinary,
        argv: ['--config-path', configPath],
        cwd: this.dataDir,
        environment: {
          ...this.processRuntime.environment,
          // listener 事实来自锁定制品的 INFO 输出，不能被开发 shell 的日志过滤器隐藏。
          RUST_LOG: 'info',
          QDRANT__LOG_LEVEL: 'INFO',
          QDRANT__LOGGER__FORMAT: 'text',
          QDRANT__SERVICE__HOST: this.host,
          QDRANT__SERVICE__HTTP_PORT: String(this.requestedPort),
        },
      },
      output: logStream,
    });
    this.process = ownedProcess;
    void ownedProcess.terminal.then(
      exit => {
        console.log(
          `[QdrantManager] Qdrant process terminal: code=${String(exit.exitCode)} `
            + `signal=${String(exit.signal)}`,
        );
        if (this.process === ownedProcess) this.process = null;
      },
      error => {
        // cleanup 失败时保留 owner 引用，让 App shutdown 继续报告同一真实失败。
        console.error('[QdrantManager] Qdrant process terminal failed:', error);
      },
    );

    // 等待Qdrant服务启动
    console.log(`[QdrantManager] Waiting for Qdrant to be ready...`);
    try {
      await this.waitForReady(ownedProcess);
    } catch (startupFailure: unknown) {
      try {
        await ownedProcess.stopAndWait();
        if (this.process === ownedProcess) this.process = null;
      } catch (cleanupFailure: unknown) {
        throw new QdrantStartupCleanupError(startupFailure, cleanupFailure);
      }
      throw startupFailure;
    }
    console.log(`[QdrantManager] ✅ Qdrant service started successfully on ${this.host}:${this.port}`);
  }

  /**
   * 等待Qdrant服务就绪
   */
  private async waitForReady(process: OwnedQdrantProcess): Promise<void> {
    const deadline = AbortSignal.timeout(this.startTimeoutMs);
    const abort = new AbortController();
    const signal = AbortSignal.any([deadline, abort.signal]);
    const timeout = new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    try {
      await Promise.race([
        (async () => {
          this.port = await process.httpPort;
          await this.pollUntilReady(signal);
        })(),
        timeout,
        process.terminal.then(exit => {
          throw new Error(
            `Qdrant process exited during startup: code=${String(exit.exitCode)} `
              + `signal=${String(exit.signal)}`,
          );
        }),
      ]);
    } finally {
      // 启动超时或 child 提前退出后停止 readiness poll，不能继续探测其他实例。
      abort.abort();
    }
  }

  private async pollUntilReady(signal: AbortSignal): Promise<void> {
    const checkInterval = 200; // 每200ms检查一次
    const startTime = Date.now();

    while (Date.now() - startTime < this.startTimeoutMs) {
      signal.throwIfAborted();
      try {
        // 使用fetch检查健康状态，带超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);
        try {
          const response = await fetch(`http://${this.host}:${this.port}/readyz`, {
            method: 'GET',
            signal: AbortSignal.any([signal, controller.signal]),
          });
          if (response.ok) {
            console.log(`[QdrantManager] Health check passed after ${Date.now() - startTime}ms`);
            return;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch {
        // 预期的错误，继续等待
      }

      // 等待一段时间后再次检查
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error(`Qdrant service failed to start within ${this.startTimeoutMs}ms`);
  }

  /**
   * 停止Qdrant服务
   */
  async stop(): Promise<void> {
    const process = this.process;
    if (!process) return;

    console.log('[QdrantManager] Terminating Qdrant process...');
    await process.stopAndWait();
    if (this.process === process) this.process = null;
    console.log('[QdrantManager] Qdrant process tree terminated and resources released.');
  }

  /**
   * 检查服务是否运行中
   */
  isRunning(): boolean {
    return this.process !== null;
  }

  /**
   * 获取连接配置
   */
  getConfig(): { host: string; port: number; url: string } {
    return {
      host: this.host,
      port: this.port,
      url: `http://${this.host}:${this.port}`
    };
  }
}
