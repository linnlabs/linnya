/**
 * @file src/app-hosts/linnya/agent-registry/agents/review/index.ts
 * @description Review Agent 定义（包含扩展点与 enricher 注册）
 */

import { PromptKeys } from '../../prompt.types';
import type { AgentDefinition, AgentRegistryDependencies } from '../../types';
import { ReviewOptionsExtender } from 'src/app-hosts/linnya/adapters/flow/history-builder/extenders/review-options.extender';
import { ReviewRequestEnricher } from 'src/features/review/enrichment/review.enricher';
import { AgentsService } from 'src/features/workspace/infrastructure/sqlite/services/agents.service';
import { ReviewAgentTask } from './task';

/**
 * Review（审阅）Agent 工具白名单（内聚定义）
 * - 只允许创建批注，禁止编辑文档/创建文档等其他 Workspace 工具
 */
const REVIEW_AGENT_TOOLS = [
  'markdown_create_annotations',
] as const;

function requireDatabaseService(
  deps: AgentRegistryDependencies
): import('src/electron-main/services/database').DatabaseService {
  const candidate = deps.databaseService;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof (candidate as { getDb?: unknown }).getDb !== 'function'
  ) {
    throw new Error('[ReviewAgentDefinition] databaseService 类型不符合预期：缺少 getDb()');
  }
  return candidate as import('src/electron-main/services/database').DatabaseService;
}

export const AGENT_DEFINITION: AgentDefinition = {
  id: PromptKeys.REVIEW,
  promptKey: PromptKeys.REVIEW,
  defaultMode: 'agent',
  description: '审阅（Review）- 通过工具创建批注',
  config: {
    contextPolicy: { profileId: 'agent', toolHistory: { strategy: 'per-run', keepLatestRuns: 1 } },
    enableTools: true,
    availableTools: REVIEW_AGENT_TOOLS,
    knowledgeBaseId: 'default',
    // ✅ Review(Agent)：使用“用户选择的主模型”
    modelPolicy: { kind: 'user_primary' },
    preferredModelCapability: 'tool_calling',
  },
  task: {
    // Review 需要重写 buildMessages，使用专用 Task
    customTaskClass: ReviewAgentTask,
  },
  integrations: {
    historyBuilderExtenders: [() => new ReviewOptionsExtender()],
    requestEnrichers: [
      (deps) => {
        const databaseService = requireDatabaseService(deps);
        const db = databaseService.getDb();
        const agentsService = new AgentsService(db);
        return new ReviewRequestEnricher(agentsService);
      },
    ],
  },
};

export default AGENT_DEFINITION;
