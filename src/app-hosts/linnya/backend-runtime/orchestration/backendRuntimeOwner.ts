/**
 * @file src/app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner.ts
 *
 * @brief Backend 服务生命周期协调器
 *
 * @description
 * 这个服务管理器负责协调整个后端服务的生命周期，包括：
 * 1. Qdrant 服务管理
 * 2. 所有应用服务的初始化
 * 3. API 服务器的启动和停止
 *
 * 重构后职责更加清晰，仅作为顶层协调器，具体实现委托给专门的模块。
 *
 * @see
 * - `ApiServer` - 负责 Express 服务器管理
 * - `ServiceInitializer` - 负责服务初始化
 */

// 导入Qdrant管理器
import { QdrantManager } from '../../../../electron-main/services/qdrantManager';

// 导入新的模块化组件
import { ApiServer } from '../../../../electron-main/services/apiServer';
import {
  ServiceInitializer,
  type InitializedServices,
  type ServiceInitializationConfig,
} from '../../../../electron-main/services/serviceInitializer';
import type { ProviderModelSynchronizationLifecycle } from '../../application/provider-onboarding';
import type { RouteConfigurationResult } from '../../../../electron-main/routes/index';
import type { AppServerBackendConfiguration } from '../../app-server-bootstrap';
import { QueueManager } from '../../../../infra/task-queue/queues';
import type { CommandAppOwnerLifecyclePort } from '../../adapters/commands/production-runtime';
import type { SandboxAppOwnerLifecyclePort } from '../../application/conversation-runtime';
import type { QdrantProcessRuntime } from '../../../../infra/adapters/vector-store/qdrant';
import type { LaunchOwnedPipeProcess } from '../../../../shared/process-runtime';
import type { QueueWorkerRuntime } from '../../../../infra/task-queue/definitions/queueWorkerRuntime';
import type { RuntimePathRoots } from '../../../../shared/runtime-paths';

export class BackendRuntimeShutdownError extends Error {
  constructor(readonly failures: readonly unknown[]) {
    super('App Server Backend 停止时存在未完成的收口步骤');
    this.name = 'BackendRuntimeShutdownError';
  }
}

export class BackendRuntimeStartupError extends Error {
  constructor(
    readonly startupFailure: unknown,
    readonly cleanupFailure: unknown
  ) {
    super('App Server Backend 启动失败，且已启动资源未能完整收口');
    this.name = 'BackendRuntimeStartupError';
  }
}

/**
 * App Server Backend 服务生命周期协调器
 *
 * @description
 * 只负责：
 * 1. 协调各模块的生命周期
 * 2. 提供统一的服务访问接口
 * 3. 按 App owner 合同收口命令、Sandbox、队列与 Qdrant
 */
export class BackendRuntimeOwner {
  private readonly apiServer: ApiServer;
  private readonly serviceInitializer: ServiceInitializer;
  private port: number | null = null;
  private isRunning = false;

  // 服务实例
  private services: InitializedServices | null = null;
  private routeConfigurationResult: RouteConfigurationResult | null = null;
  private commandOwnerLifecycle: CommandAppOwnerLifecyclePort | null = null;
  private commandAppOwnerEnded = false;
  private providerModelSynchronization: ProviderModelSynchronizationLifecycle | null = null;
  private sandboxOwnerLifecycle: SandboxAppOwnerLifecyclePort | null = null;
  private sandboxAppOwnerEnded = false;
  private shutdownSettlement: Promise<void> | null = null;

  // Qdrant服务管理
  private qdrantManager: QdrantManager | null = null;

  constructor(
    private readonly qdrantProcessRuntime: QdrantProcessRuntime,
    private readonly launchOwnedPipeProcess: LaunchOwnedPipeProcess,
    queueWorkerRuntime: QueueWorkerRuntime,
    runtimePathRoots: RuntimePathRoots,
    applicationVersion: string,
  ) {
    this.apiServer = new ApiServer();
    this.serviceInitializer = new ServiceInitializer(
      queueWorkerRuntime,
      runtimePathRoots,
      applicationVersion,
    );
    this.setupApiServer();
  }

  /**
   * 设置API服务器
   */
  private setupApiServer(): void {
    this.apiServer.setupMiddleware();
  }

  /**
   * 启动服务
   * @param config 服务配置
   * @returns 服务端口号
   */
  async start(config: AppServerBackendConfiguration): Promise<number> {
    if (this.shutdownSettlement) {
      throw new Error('App Server Backend 正在停止，请等待 Linnya 完成退出');
    }
    if (this.commandAppOwnerEnded || this.sandboxAppOwnerEnded) {
      throw new Error('当前 Linnya 进程的 App 运行时已经结束，请重新启动 Linnya');
    }
    if (!this.isRunning && (this.qdrantManager || this.services)) {
      throw new Error('上一次后端生命周期尚未收口，请重新停止服务后再启动');
    }
    console.log(
      '[Backend Service] 🚀 start() method called with config:',
      JSON.stringify(config, null, 2)
    );

    if (this.isRunning) {
      console.log('[Backend Service] Service is already running on port:', this.port);
      if (this.port === null) throw new Error('Backend Service 运行状态缺少监听端口');
      return this.port;
    }

    try {
      console.log('[Backend Service] 🚀 开始服务初始化...');

      // 步骤1：启动Qdrant服务
      console.log('[Backend Service] 📊 Step 1: 启动Qdrant服务...');
      this.qdrantManager = new QdrantManager({
        host: config.qdrant.host,
        port: config.qdrant.port,
      }, this.qdrantProcessRuntime, this.launchOwnedPipeProcess);
      await this.qdrantManager.start();
      console.log('[Backend Service] ✅ Step 1: Qdrant服务启动成功');

      // 步骤2：初始化全部 Backend services
      console.log('[Backend Service] ⚙️ Step 2: 初始化 Backend services...');
      // Qdrant 的实际 URL 来自已启动且完成就绪校验的 QdrantManager；bootstrap 中的
      // host/port 只用于拥有本地进程，不能误当成 Qdrant client 的认证/timeout 配置。
      const serviceConfig: ServiceInitializationConfig = {};

      this.services = await this.serviceInitializer.initializeServices(
        serviceConfig,
        this.qdrantManager.getConfig(),
      );
      console.log('[Backend Service] ✅ Step 2: Backend services 初始化完成');

      // 启动API服务器
      console.log('[Backend Service] 🌐 Step 4: 启动API服务器...');
      console.log('[Backend Service] 尝试在端口启动API服务器:', config.server.port);
      this.port = await this.apiServer.start(config.server.port);

      this.isRunning = true;
      console.log(`[Backend Service] 🎉 服务启动成功！端口: ${this.port}`);
      return this.port;
    } catch (error) {
      console.error('[Backend Service] 💥 服务启动失败:', error);
      this.isRunning = false;
      try {
        // 初始化器会在返回 services 前启动队列和维护任务；Qdrant 更早启动。
        // 这里复用正式停止顺序，避免失败重试覆盖旧实例后失去进程引用。
        await this.stop();
      } catch (cleanupFailure: unknown) {
        throw new BackendRuntimeStartupError(error, cleanupFailure);
      }
      throw error;
    }
  }

  /** 停止 App Server Backend 拥有的全部服务。 */
  stop(): Promise<void> {
    if (this.shutdownSettlement) {
      return this.shutdownSettlement;
    }
    if (
      !this.isRunning &&
      !this.services &&
      !this.qdrantManager &&
      !this.commandOwnerLifecycle &&
      !this.sandboxOwnerLifecycle &&
      !this.providerModelSynchronization
    ) {
      return Promise.resolve();
    }

    const stopSettlement = this.stopOnce();
    const trackedStopSettlement = stopSettlement.finally(() => {
      if (this.shutdownSettlement === trackedStopSettlement) {
        this.shutdownSettlement = null;
      }
    });
    this.shutdownSettlement = trackedStopSettlement;
    return trackedStopSettlement;
  }

  private async stopOnce(): Promise<void> {
    console.log('[Backend Service] 🛑 开始停止服务...');
    const failures: unknown[] = [];

    const stopStage = async (name: string, stop: () => Promise<void>): Promise<boolean> => {
      try {
        await stop();
        console.log(`[Backend Service] ✅ ${name}已停止`);
        return true;
      } catch (error: unknown) {
        failures.push(error);
        console.error(`[Backend Service] ❌ ${name}停止时出错:`, error);
        return false;
      }
    };

    // 先停止接收新请求，随后命令 owner 才能在没有新 admission 的前提下可信收口。
    // 先同步发出取消，防止 HTTP drain 期间目录刷新继续接单或发起下一轮写入。
    const modelSynchronizationStopped = this.providerModelSynchronization?.stop();
    await stopStage('API服务器', () => this.apiServer.stop());
    await stopStage('账号模型同步', async () => { await modelSynchronizationStopped; });
    if (this.commandOwnerLifecycle) {
      const commandOwnerLifecycle = this.commandOwnerLifecycle;
      try {
        await commandOwnerLifecycle.endOwnerAndWait();
        this.commandOwnerLifecycle = null;
        console.log('[Backend Service] ✅ 命令运行时已停止');
      } catch (error: unknown) {
        failures.push(error);
        console.error('[Backend Service] ❌ 命令运行时停止时出错:', error);
      } finally {
        // scope 会在等待进程收口前同步结束全局 approval host；即使 drain 失败也不可重开。
        this.commandAppOwnerEnded = true;
      }
    }

    if (this.sandboxOwnerLifecycle) {
      const sandboxOwnerLifecycle = this.sandboxOwnerLifecycle;
      try {
        await sandboxOwnerLifecycle.endOwnerAndWait();
        this.sandboxOwnerLifecycle = null;
        console.log('[Backend Service] ✅ Sandbox 运行时已停止');
      } catch (error: unknown) {
        failures.push(error);
        console.error('[Backend Service] ❌ Sandbox 运行时停止时出错:', error);
      } finally {
        // Sandbox scope 的 App owner 一旦开始收口就不能再接收任务；失败只允许重试收口。
        this.sandboxAppOwnerEnded = true;
      }
    }

    if (this.services) {
      const services = this.services;
      await stopStage('Renderer integration', async () => {
        services.disposeRendererIntegration();
      });
    }

    // 两类 App owner 已经收口后再停 worker，避免退出期间后台 owner 交叉产生新工作。
    await stopStage('后台任务队列', () => QueueManager.getInstance().shutdown());

    // 停止Qdrant服务
    if (this.qdrantManager) {
      const qdrantManager = this.qdrantManager;
      if (await stopStage('Qdrant服务', () => qdrantManager.stop())) {
        this.qdrantManager = null;
      }
    }

    // 清理状态
    this.isRunning = false;
    this.port = null;
    this.services = null;
    this.routeConfigurationResult = null;

    if (failures.length > 0) {
      throw new BackendRuntimeShutdownError(failures);
    }

    console.log('[Backend Service] 🏁 服务已完全停止');
  }

  /**
   * 重启服务
   * @param config 新的配置
   */
  async restart(config: AppServerBackendConfiguration): Promise<number> {
    if (
      this.commandOwnerLifecycle ||
      this.sandboxOwnerLifecycle ||
      this.commandAppOwnerEnded ||
      this.sandboxAppOwnerEnded
    ) {
      // App owner 结束后不可逆；旧 restart 也不会重新配置 routes 和生产 runtime。
      // 因此必须在 stop 前明确拒绝，不能先杀掉一个可用后端再启动半套服务。
      throw new Error('App 运行时启用后不支持进程内重启，请重新启动 Linnya');
    }
    await this.stop();
    return this.start(config);
  }

  /**
   * 获取当前端口
   */
  getPort(): number | null {
    return this.port;
  }

  /** 最后窗口只需要知道是否会终止真实命令，不应取得 Commands owner 或进程身份。 */
  hasExecutingCommands(): boolean {
    return this.commandOwnerLifecycle?.hasExecutingCommands() ?? false;
  }

  getToken(): string {
    return this.apiServer.getToken();
  }

  setRouteConfigurationResult(result: RouteConfigurationResult): void {
    this.routeConfigurationResult = result;
  }

  registerProviderModelSynchronization(lifecycle: ProviderModelSynchronizationLifecycle): void {
    if (this.providerModelSynchronization) {
      throw new Error('当前 App owner 已注册账号模型同步');
    }
    this.providerModelSynchronization = lifecycle;
  }

  startProviderModelSynchronization(): void {
    this.providerModelSynchronization?.start();
  }

  registerCommandOwnerLifecycle(lifecycle: CommandAppOwnerLifecyclePort): void {
    if (this.commandAppOwnerEnded) {
      throw new Error('当前 Linnya 进程的命令运行时已经结束，不能注册新的 owner');
    }
    if (this.commandOwnerLifecycle && this.commandOwnerLifecycle !== lifecycle) {
      throw new Error('当前 App owner 已注册另一套命令运行时');
    }
    this.commandOwnerLifecycle = lifecycle;
  }

  registerSandboxOwnerLifecycle(lifecycle: SandboxAppOwnerLifecyclePort): void {
    if (this.sandboxAppOwnerEnded) {
      throw new Error('当前 Linnya 进程的 Sandbox 运行时已经结束，不能注册新的 owner');
    }
    if (this.sandboxOwnerLifecycle && this.sandboxOwnerLifecycle !== lifecycle) {
      throw new Error('当前 App owner 已注册另一套 Sandbox 运行时');
    }
    this.sandboxOwnerLifecycle = lifecycle;
  }

  markCommandAppOwnerEnded(): void {
    this.commandAppOwnerEnded = true;
  }

  markConversationRuntimeAppOwnerEnded(): void {
    // 路由装配失败时，上层编排已经结束两个 scope，但它们可能尚未来得及注册到本管理器。
    // 两个 owner 必须一起冻结，否则当前进程可能重开一套缺少 Commands 或 Sandbox 的运行时。
    this.commandAppOwnerEnded = true;
    this.sandboxAppOwnerEnded = true;
  }

  getRouteConfigurationResult(): RouteConfigurationResult | null {
    return this.routeConfigurationResult;
  }

  /**
   * 检查服务是否运行中
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 获取服务实例
   */
  getServices() {
    if (!this.services) {
      return {
        knowledgeBaseService: null,
        projectKnowledgeBaseLinksService: null,
        transcriptionService: null,
        databaseService: null,
        documentOcr: null,
      };
    }

    return {
      knowledgeBaseService: this.services.knowledgeBaseService,
      projectKnowledgeBaseLinksService: this.services.projectKnowledgeBaseLinksService,
      transcriptionService: this.services.transcriptionService,
      databaseService: this.services.databaseService,
      documentOcr: this.services.documentOcr,
    };
  }

  /**
   * 获取项目-知识库关联服务实例
   */
  getProjectKnowledgeBaseLinksService() {
    return this.services?.projectKnowledgeBaseLinksService || null;
  }

  /**
   * [新增] 返回 ApiServer 实例
   */
  getApiServer(): ApiServer {
    return this.apiServer;
  }

}

/**
 * 全局服务管理器单例
 */
let instance: BackendRuntimeOwner | null = null;
let instanceQdrantProcessRuntime: QdrantProcessRuntime | null = null;
let instanceLaunchOwnedPipeProcess: LaunchOwnedPipeProcess | null = null;
let instanceQueueWorkerRuntime: QueueWorkerRuntime | null = null;
let instanceRuntimePathRoots: RuntimePathRoots | null = null;
let instanceApplicationVersion: string | null = null;

/** App owner 关闭阶段只读取既有实例；未开始 Backend 时 shutdown 必须是幂等空操作。 */
export function getExistingBackendRuntimeOwner(): BackendRuntimeOwner | null {
  return instance;
}

/**
 * 获取服务管理器的单例实例
 */
export function getBackendRuntimeOwner(
  qdrantProcessRuntime?: QdrantProcessRuntime,
  launchOwnedPipeProcess?: LaunchOwnedPipeProcess,
  queueWorkerRuntime?: QueueWorkerRuntime,
  runtimePathRoots?: RuntimePathRoots,
  applicationVersion?: string,
): BackendRuntimeOwner {
  if (!instance) {
    if (
      !qdrantProcessRuntime
      || !launchOwnedPipeProcess
      || !queueWorkerRuntime
      || !runtimePathRoots
      || !applicationVersion
    ) {
      throw new Error(
        'BackendRuntimeOwner 首次创建缺少 Qdrant runtime、process owner、Queue Worker runtime、Runtime path roots 或 application version',
      );
    }
    instance = new BackendRuntimeOwner(
      qdrantProcessRuntime,
      launchOwnedPipeProcess,
      queueWorkerRuntime,
      runtimePathRoots,
      applicationVersion,
    );
    instanceQdrantProcessRuntime = qdrantProcessRuntime;
    instanceLaunchOwnedPipeProcess = launchOwnedPipeProcess;
    instanceQueueWorkerRuntime = queueWorkerRuntime;
    instanceRuntimePathRoots = runtimePathRoots;
    instanceApplicationVersion = applicationVersion;
  } else if (
    (qdrantProcessRuntime && qdrantProcessRuntime !== instanceQdrantProcessRuntime)
    || (launchOwnedPipeProcess && launchOwnedPipeProcess !== instanceLaunchOwnedPipeProcess)
    || (queueWorkerRuntime && queueWorkerRuntime !== instanceQueueWorkerRuntime)
    || (runtimePathRoots && runtimePathRoots !== instanceRuntimePathRoots)
    || (applicationVersion && applicationVersion !== instanceApplicationVersion)
  ) {
    throw new Error(
      'BackendRuntimeOwner 已绑定另一份 Qdrant runtime、process owner、Queue Worker runtime、Runtime path roots 或 application version',
    );
  }
  return instance;
}
