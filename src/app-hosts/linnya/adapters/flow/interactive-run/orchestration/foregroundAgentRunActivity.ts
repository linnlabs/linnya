import type { RunId } from '@linnlabs/linnkit/contracts';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import { Logger } from 'src/shared/logger';

import type { FlowOrchestrator } from '../../flow.orchestrator';
import {
  EXECUTING_RUN_STATUSES,
  selectActiveForegroundRootRuns,
  type ActiveForegroundConversationRuns,
} from '../functions/selectActiveForegroundRootRuns';

const logger = new Logger('ForegroundAgentRunActivity');

export interface ForegroundAgentRunActivityItem {
  readonly conversationId: string;
  readonly conversationTitle: string | null;
}

export interface ForegroundAgentRunPauseSettlement {
  readonly pausedConversationIds: readonly string[];
  /** 仍在执行却无法安全暂停（缺少恢复输入、身份过期等）；重启会直接中断它们。 */
  readonly unpausableConversationIds: readonly string[];
}

/** App 级“正在执行的前台任务”读取与批量暂停；只暂停，不取消或丢弃任何运行。 */
export interface ForegroundAgentRunActivityPort {
  listActive(): Promise<readonly ForegroundAgentRunActivityItem[]>;
  pauseAll(): Promise<ForegroundAgentRunPauseSettlement>;
}

export interface ForegroundAgentRunActivityDependencies {
  readonly supervisor: Pick<runSupervisor.RunSupervisor, 'list' | 'findByConversation'>;
  /** 复用 HTTP pause 的同一 Flow 入口：校验 descriptor 与 execution 身份并等待原 execution 收口。 */
  readonly flow: Pick<FlowOrchestrator, 'pauseRun'>;
  /** 对话不存在时返回 null；标题只用于展示，不参与暂停判断。 */
  readonly readConversationTitle: (conversationId: string) => Promise<string | null>;
}

type RunPauseOutcome = 'paused' | 'settled' | 'unpausable';

async function readExecutingForegroundRoots(
  supervisor: ForegroundAgentRunActivityDependencies['supervisor']
): Promise<readonly ActiveForegroundConversationRuns[]> {
  const status = [...EXECUTING_RUN_STATUSES];
  // list() 只返回 RunMeta（不含 lane），先找出有执行中 run 的对话，再按对话读取带 metadata 的根 run。
  const { runs } = await supervisor.list({ status });
  const conversationIds = [...new Set(runs.map(run => run.conversationId))];
  const snapshots = await Promise.all(
    conversationIds.map(conversationId => supervisor.findByConversation(conversationId, { status }))
  );
  return selectActiveForegroundRootRuns(snapshots.flat());
}

/** 以暂停尝试之后的持久状态为准：并发自然结束的 run 不算暂停，也不会被重启打断。 */
async function classifyAfterPauseAttempt(
  supervisor: ForegroundAgentRunActivityDependencies['supervisor'],
  conversationId: string,
  runId: RunId
): Promise<RunPauseOutcome> {
  const current = (await supervisor.findByConversation(conversationId)).find(
    run => run.runId === runId
  );
  if (!current) return 'settled';
  if (current.status === 'paused') return 'paused';
  if (current.status === 'pending' || current.status === 'running') return 'unpausable';
  return 'settled';
}

async function pauseOneRun(
  dependencies: ForegroundAgentRunActivityDependencies,
  run: runSupervisor.RunSnapshot
): Promise<RunPauseOutcome> {
  const executionId = run.metadata?.executionId;
  if (typeof executionId === 'string' && executionId.length > 0) {
    try {
      await dependencies.flow.pauseRun(run.runId, run.conversationId, executionId);
    } catch (error: unknown) {
      logger.warn('前台 run 暂停未被接纳，按暂停后的持久状态归类', {
        conversationId: run.conversationId,
        runId: run.runId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    logger.warn('前台 run 缺少 executionId，无法发出暂停', {
      conversationId: run.conversationId,
      runId: run.runId,
    });
  }
  return classifyAfterPauseAttempt(dependencies.supervisor, run.conversationId, run.runId);
}

function settleConversation(
  outcomes: readonly PromiseSettledResult<RunPauseOutcome>[]
): RunPauseOutcome {
  const values = outcomes.map(outcome =>
    outcome.status === 'fulfilled' ? outcome.value : 'unpausable'
  );
  if (values.includes('unpausable')) return 'unpausable';
  if (values.includes('paused')) return 'paused';
  return 'settled';
}

export function createForegroundAgentRunActivity(
  dependencies: ForegroundAgentRunActivityDependencies
): ForegroundAgentRunActivityPort {
  return Object.freeze({
    async listActive() {
      const groups = await readExecutingForegroundRoots(dependencies.supervisor);
      return Promise.all(
        groups.map(async ({ conversationId }) =>
          Object.freeze({
            conversationId,
            conversationTitle: await dependencies.readConversationTitle(conversationId),
          })
        )
      );
    },

    async pauseAll() {
      const groups = await readExecutingForegroundRoots(dependencies.supervisor);
      const settled = await Promise.all(
        groups.map(async group => ({
          conversationId: group.conversationId,
          outcome: settleConversation(
            await Promise.allSettled(group.runs.map(run => pauseOneRun(dependencies, run)))
          ),
        }))
      );
      for (const { conversationId, outcome } of settled) {
        if (outcome === 'unpausable') {
          logger.warn('前台对话无法暂停，重启会中断其运行', { conversationId });
        }
      }
      return Object.freeze({
        pausedConversationIds: Object.freeze(
          settled.filter(item => item.outcome === 'paused').map(item => item.conversationId)
        ),
        unpausableConversationIds: Object.freeze(
          settled.filter(item => item.outcome === 'unpausable').map(item => item.conversationId)
        ),
      });
    },
  });
}
