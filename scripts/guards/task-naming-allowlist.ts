import type { TaskNamingOccurrence } from './task-naming-guard';

export interface TaskNamingAllowance {
  readonly id: string;
  readonly reason: string;
  readonly removeAfter: string;
  allows(occurrence: TaskNamingOccurrence): boolean;
}

function under(...prefixes: readonly string[]) {
  return (occurrence: TaskNamingOccurrence): boolean =>
    prefixes.some(prefix => occurrence.file === prefix || occurrence.file.startsWith(`${prefix}/`));
}

function inFiles(...files: readonly string[]) {
  const allowedFiles = new Set(files);
  return (occurrence: TaskNamingOccurrence): boolean => allowedFiles.has(occurrence.file);
}

function hasStandardTechnicalTaskName(name: string): boolean {
  return /(?:microtask|macrotask|longtask|long_task|tasklist|task_list)/i.test(name);
}

function hasPublicAgentTaskName(name: string): boolean {
  return /(?:AgentTask|GenericAgentTask|getAgentTask|RegisteredAgentTask|customTaskClass)/i.test(
    name
  );
}

function isPublicAgentDefinitionTaskField(occurrence: TaskNamingOccurrence): boolean {
  if (occurrence.name !== 'task') return false;
  return (
    inFiles(
      'src/app-hosts/linnya/adapters/child-runs/childRunInvokerFactory.ts',
      'src/app-hosts/linnya/agent-registry/GenericAgentTask.ts',
      'src/app-hosts/linnya/agent-registry/agentTaskResolver.ts',
      'src/app-hosts/linnya/agent-registry/types.ts',
      'src/app-hosts/linnya/plugin-registry/__tests__/enabled-runtime.test.ts',
      'src/tools/agent_control/subrun/subagent/__tests__/subagentTool.failure-recovery.integration.test.ts',
      'src/tools/agent_control/subrun/subagent/__tests__/subagentWorkspace.integration.test.ts'
    )(occurrence) ||
    /^src\/app-hosts\/linnya\/agent-registry\/agents\/.+\/(?:index|[^/]+\.test)\.ts$/.test(
      occurrence.file
    ) ||
    /^src\/app-hosts\/linnya\/agent-registry\/agents\/.+\/task\.ts$/.test(occurrence.file) ||
    /^packages\/plugins\/[^/]+\/src\/backend\/(?:app\/)?agents\/.+\/index(?:\.test)?\.ts$/.test(
      occurrence.file
    )
  );
}

function isKnowledgeWorkerExternalTaskProtocol(occurrence: TaskNamingOccurrence): boolean {
  if (!under('src/infra/task-queue')(occurrence)) return false;

  // Worker 内部类型和持有结构已使用 job 语义；这里只保留现有对外 task ID 和 IPC payload 字段。
  return occurrence.name === 'taskId' || occurrence.name === 'task';
}

/**
 * 临时允许列表按真实语义和退出里程碑维护，不记录全仓命中数量或行号。
 * 对应迁移完成后必须删除该组，而不是把新名称继续追加进旧组。
 */
export const TASK_NAMING_ALLOWANCES: readonly TaskNamingAllowance[] = [
  {
    id: 'stable-taskstate-domain',
    reason:
      'TaskState 是有目标、多步推进的真实业务 task；只允许其领域、边界适配器和既有展示/协议表面。',
    removeAfter: '长期保留',
    allows: occurrence =>
      under(
        'src/domains/task-state',
        'src/infra/adapters/task-state',
        'src/tools/agent_control/task',
        'apps/renderer/domains/conversation/ui/tools/taskstate',
        'packages/schemas/src/tools/taskstate.ts'
      )(occurrence) ||
      inFiles(
        'apps/renderer/domains/conversation/ui/tools/configs/common.ts',
        'apps/renderer/domains/conversation/ui/tools/configs/common.taskstate.test.ts'
      )(occurrence),
  },
  {
    id: 'standard-technical-terms',
    reason: 'JavaScript task queue、Long Task 和 Markdown task list 属于标准技术术语。',
    removeAfter: '长期保留',
    allows: occurrence =>
      hasStandardTechnicalTaskName(occurrence.name) ||
      inFiles(
        'apps/renderer/domains/editor/ui/scheduling/editorIdleScheduler.ts',
        'packages/linnkit/src/runtime-kernel/graph-engine/orchestration/runWithLifecycleTelemetry.ts'
      )(occurrence),
  },
  {
    id: 'linnkit-public-agent-task-api',
    reason: 'Linnkit 公开 AgentTask API 不在本轮中风险迁移范围。',
    removeAfter: '独立公开 API 迁移',
    allows: occurrence =>
      hasPublicAgentTaskName(occurrence.name) ||
      isPublicAgentDefinitionTaskField(occurrence) ||
      under('packages/linnkit/src/context-manager/profiles/agent/tasks')(occurrence) ||
      inFiles(
        'packages/linnkit/src/context-manager/profiles/agent/orchestration/AgentMessageOrchestrator.ts',
        'packages/plugin-host-contract/backend/agentRegistry.ts',
        'src/app-hosts/linnya/adapters/context-injection/defaultGraphExecutorContextBuilder.ts',
        'src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/childRunInvokerFactory.test.ts',
        'src/app-hosts/linnya/adapters/flow/agent-runner/__tests__/executionPolicyAssembler.test.ts',
        'src/app-hosts/linnya/plugin-registry/registry.ts',
        'src/tools/agent_control/subrun/shared/__tests__/subagentRunner.integration.test.ts',
        'apps/renderer/domains/conversation/services/orchestration/annotationRunOrchestrator.ts'
      )(occurrence),
  },
  {
    id: 'knowledge-and-worker-job-protocol',
    reason:
      '知识库 HTTP/IPC task 协议本轮排除；Worker 内部只保留现有 task ID 与 IPC payload 字段。',
    removeAfter: '独立知识库 job 协议迁移',
    allows: occurrence =>
      under('src/features/knowledge-base', 'apps/renderer/domains/knowledgebase')(occurrence) ||
      isKnowledgeWorkerExternalTaskProtocol(occurrence) ||
      inFiles(
        'src/electron-main/ipc/handlers/knowledge-base/knowledge-base-ipc.ts',
        'src/electron-main/routes/knowledgeBaseRouter.ts',
        'src/shared/types.ts',
        'src/shared/utils/idUtils.ts',
        'scripts/e2e/knowledge-base/knowledge-search.e2e.ts',
        'src/types/electron-api.d.ts'
      )(occurrence),
  },
  {
    id: 'cloud-model-task-defaults-wire',
    reason:
      'Linnya Cloud /v1/models 与现有 renderer 模型响应仍使用 task_defaults；客户端业务内部已收敛为 purpose defaults。',
    removeAfter: '独立云端模型协议迁移',
    allows: occurrence =>
      occurrence.name === 'task_defaults' &&
      inFiles(
        'src/domains/model-catalog/features/cloud-catalog/orchestration/fetchCloudModels.ts',
        'src/domains/model-catalog/features/cloud-catalog/__tests__/fetchCloudModels.test.ts',
        'src/electron-main/routes/modelRouter.ts',
        'apps/renderer/domains/model-configuration/features/model-catalog/definitions/modelCatalog.ts',
        'apps/renderer/domains/model-configuration/features/model-catalog/functions/modelCatalogProjection.ts',
        'apps/renderer/domains/model-configuration/features/model-catalog/functions/modelCatalogProjection.test.ts',
        'scripts/cloud-model-kv-v2-migration/functions/buildMigrationPlan.ts',
        'scripts/cloud-model-kv-v2-migration/functions/cloudModelKvV2Migration.test.ts'
      )(occurrence),
  },
  {
    id: 'explicitly-excluded-internal-audit-api',
    reason: 'TaskTrackingMeta 与 audit path 删除属于另一个公开/共享表面治理项。',
    removeAfter: '独立 audit API 治理',
    allows: inFiles(
      'src/shared/audit/taskTracking.ts',
      'src/shared/audit/index.ts',
      'packages/linnkit/src/contracts/messages.ts',
      'src/shared/utils/pathManager.ts'
    ),
  },
  {
    id: 'excluded-deep-search-and-test-fixture-identities',
    reason: 'Deep Search prompt builder 与独立工具测试中的 taskId 不是 conversation 委派协议。',
    removeAfter: '对应 domain 独立命名治理',
    allows: inFiles('src/tools/knowledgebase/search/deep/taskMessageBuilder.ts'),
  },
];

export function findTaskNamingAllowance(
  occurrence: TaskNamingOccurrence
): TaskNamingAllowance | undefined {
  return TASK_NAMING_ALLOWANCES.find(allowance => allowance.allows(occurrence));
}
