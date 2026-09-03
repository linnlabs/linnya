import type {
  AppendEventToRunOptions,
  ReplaceUserInputEventOptions,
  ReplaceUserInputEventResult,
  RunMetadata,
  RunSession,
} from 'src/app-hosts/linnya/adapters/persistence/event-store';
import { Logger } from 'src/shared/logger';
import type { RoutedRuntimeEvent, RuntimeEvent } from '@linnlabs/linnkit/contracts';
import type {
  ConversationPersistenceAdmissionPort,
} from 'src/app-hosts/linnya/application/conversation-lifecycle';

const logger = new Logger('PersistenceCoordinator');

/**
 * 持久化统计信息
 */
export interface PersistenceStats {
  totalRuns: number;
  totalEvents: number;
  successCount: number;
  failureCount: number;
  lastPersistAt: number;
}

/**
 * 宿主持久化端口。
 *
 * 中文备注：
 * - `EventPersistenceCoordinator` 的根因耦合点，不是“需要一个 HistoryRepository”，
 *   而是“需要一个能写 run session 的宿主持久化适配器”；
 * - conversation admission 已拆成独立 port，生产环境必须经过 lifecycle gate，不能因为
 *   EventStore 也有 ensureConversation 就从这里绕过目录和 cleanup barrier。
 */
export interface ConversationPersistencePort {
  beginRunSession(conversationId: string, runId: string, metadata: RunMetadata): Promise<RunSession>;
  openRunSession(conversationId: string, runId: string): Promise<RunSession>;
  appendEventToRun(
    session: RunSession,
    event: RoutedRuntimeEvent,
    options?: AppendEventToRunOptions,
  ): Promise<void>;
  replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
    options?: ReplaceUserInputEventOptions,
  ): Promise<ReplaceUserInputEventResult>;
  completeRun(session: RunSession): Promise<void>;
  failRun(session: RunSession, error: { code: string; message: string }): Promise<void>;
}

export interface EventPersistenceCoordinatorDependencies {
  persistencePort: ConversationPersistencePort;
  conversationAdmission: FlowConversationAdmissionPort;
}

export interface FlowConversationAdmissionInput<T> {
  readonly conversationId: string;
  readonly initialEvents: readonly RuntimeEvent[];
  readonly projectId?: string;
  readonly mode?: string;
  readonly admitted: () => Promise<T> | T;
}

export interface FlowConversationAdmissionPort {
  withConversationAdmission<T>(input: FlowConversationAdmissionInput<T>): Promise<T>;
}

export function createConversationPersistencePort(
  persistenceDelegate: ConversationPersistencePort,
): ConversationPersistencePort {
  return {
    beginRunSession: persistenceDelegate.beginRunSession.bind(persistenceDelegate),
    openRunSession: persistenceDelegate.openRunSession.bind(persistenceDelegate),
    appendEventToRun: persistenceDelegate.appendEventToRun.bind(persistenceDelegate),
    replaceUserInputEvent: persistenceDelegate.replaceUserInputEvent.bind(persistenceDelegate),
    completeRun: persistenceDelegate.completeRun.bind(persistenceDelegate),
    failRun: persistenceDelegate.failRun.bind(persistenceDelegate),
  };
}

/** Flow 只关心 admission 成功与否；更细的历史文件状态由 lifecycle workflow 保留。 */
export function createFlowConversationAdmissionPort(
  admission: ConversationPersistenceAdmissionPort,
): FlowConversationAdmissionPort {
  return Object.freeze({
    async withConversationAdmission<T>(input: FlowConversationAdmissionInput<T>): Promise<T> {
      return admission.withAdmission({
        conversationId: input.conversationId,
        initialEvents: input.initialEvents,
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.mode !== undefined ? { mode: input.mode } : {}),
      }, () => input.admitted());
    },
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markRunFailedBestEffort(
  persistencePort: ConversationPersistencePort,
  session: RunSession,
  code: string,
  error: unknown,
): Promise<void> {
  try {
    await persistencePort.failRun(session, {
      code,
      message: getErrorMessage(error),
    });
  } catch (failRunError) {
    logger.error(`[${code}] Failed to mark run ${session.runId} as failed:`, failRunError);
  }
}

export class EventPersistenceCoordinator {
  private stats: PersistenceStats = {
    totalRuns: 0,
    totalEvents: 0,
    successCount: 0,
    failureCount: 0,
    lastPersistAt: Date.now()
  };

  private readonly persistencePort: ConversationPersistencePort;
  private readonly conversationAdmission: FlowConversationAdmissionPort;

  constructor(dependencies: EventPersistenceCoordinatorDependencies) {
    this.persistencePort = dependencies.persistencePort;
    this.conversationAdmission = dependencies.conversationAdmission;
    logger.info('EventPersistenceCoordinator initialized');
  }

  /**
   * 为一个已存在的 runtime run 打开写入会话。
   *
   * 中文备注：
   * - 普通 agent/chat root run 必须先由 linnkit RunSupervisor 注册；
   * - 这里仅校验并返回写入 token，不创建 run，也不生成 runId。
   */
  async openRunSession(conversationId: string, runId: string): Promise<RunSession> {
    return this.persistencePort.openRunSession(conversationId, runId);
  }

  /**
   * 创建一个显式 runId 的 host-only 写入会话。
   *
   * 中文备注：
   * - 只用于 persist_only 这类没有进入 RunSupervisor 的 host 写入；
   * - runId 仍必须由上层基于 turnId 传入，禁止存储层自行生成。
   */
  async createExplicitRunSession(
    conversationId: string,
    runId: string,
    metadata: RunMetadata
  ): Promise<RunSession> {
    return this.persistencePort.beginRunSession(conversationId, runId, metadata);
  }

  async appendEventsToRun(
    session: RunSession,
    events: readonly RoutedRuntimeEvent[],
    assetCommitsByEventId: ReadonlyMap<string, NonNullable<AppendEventToRunOptions['assetCommits']>> = new Map(),
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    try {
      for (const event of events) {
        const assetCommits = assetCommitsByEventId.get(event.id);
        await this.persistencePort.appendEventToRun(
          session,
          event,
          assetCommits ? { assetCommits } : undefined,
        );
      }

      this.stats.totalEvents += events.length;
      this.stats.successCount += events.length;
      this.stats.lastPersistAt = Date.now();
      
      logger.info(`[AppendToRun] Persisted ${events.length} events into run ${session.runId}`);
    } catch (error) {
      this.stats.failureCount += 1;
      logger.error(`[AppendToRun] Failed to persist events into run ${session.runId}:`, error);
      throw error;
    }
  }

  async replaceUserInputEvent(
    session: RunSession,
    targetEventId: string,
    replacement: RoutedRuntimeEvent,
    assetCommits: NonNullable<ReplaceUserInputEventOptions['assetCommits']> = [],
  ): Promise<ReplaceUserInputEventResult> {
    try {
      const result = await this.persistencePort.replaceUserInputEvent(
        session,
        targetEventId,
        replacement,
        assetCommits.length > 0 ? { assetCommits } : undefined,
      );
      this.stats.totalEvents += 1;
      this.stats.successCount += 1;
      this.stats.lastPersistAt = Date.now();
      logger.info(`[ReplaceUserInput] Replaced ${targetEventId} in run ${session.runId}`);
      return result;
    } catch (error) {
      this.stats.failureCount += 1;
      logger.error(`[ReplaceUserInput] Failed to replace ${targetEventId} in run ${session.runId}:`, error);
      throw error;
    }
  }

  async completeRun(session: RunSession): Promise<void> {
    try {
      await this.persistencePort.completeRun(session);
      this.stats.totalRuns += 1;
      this.stats.lastPersistAt = Date.now();
    } catch (error) {
      this.stats.failureCount += 1;
      logger.error(`[CompleteRun] Failed to complete run ${session.runId}:`, error);
      throw error;
    }
  }

  async failRun(session: RunSession, code: string, error: unknown): Promise<void> {
    this.stats.failureCount += 1;
    await markRunFailedBestEffort(this.persistencePort, session, code, error);
  }

  /**
   * 确保会话存在
   */
  async withConversationAdmission<T>(
    input: FlowConversationAdmissionInput<T>,
  ): Promise<T> {
    try {
      return await this.conversationAdmission.withConversationAdmission(input);
    } catch (error) {
      logger.error(`[Coordinator] Failed to admit conversation ${input.conversationId}:`, error);
      throw error;
    }
  }

  /**
   * 获取持久化统计信息（用于监控和调试）
   */
  getStats(): Readonly<PersistenceStats> {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalRuns: 0,
      totalEvents: 0,
      successCount: 0,
      failureCount: 0,
      lastPersistAt: Date.now()
    };
  }
}
