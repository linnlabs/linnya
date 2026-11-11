import { generatePrefixedId } from '@/shared/utils/idUtils';
import {
  createReviewAgent,
  listReviewAgents,
  updateReviewAgent,
} from '../services/reviewAgentsService';
import type { useReviewStore } from '../store/reviewStore';
import type { ReviewAgentDraft } from '../definitions/reviewAgent';
import { projectCustomReviewAgent } from '../functions/reviewAgentState';
export function createReviewActions(state: ReturnType<typeof useReviewStore>) {
  async function addCustomAgent(agent: ReviewAgentDraft) {
    const result = await createReviewAgent({
      name: agent.name,
      systemPrompt: agent.systemPrompt ?? '',
      knowledge: agent.knowledge ?? '',
    });

    if (!result.success) {
      console.warn('[reviewStore] 创建自定义角色失败:', result.error);
      return;
    }

    const created = result.data.agent;
    const newAgent = projectCustomReviewAgent(created);
    state.appendCustomAgent(newAgent);

    // 自动选中新创建的角色（如果没满）
    state.selectAgent(newAgent.id);

    // 新建完成后，清理编辑态并返回主界面
    state.exitAgentEditor();
  }

  async function updateCustomAgent(agentId: string, updates: ReviewAgentDraft) {
    const agent = state.availableAgents.find(a => a.id === agentId);
    if (!agent || !agent.isCustom) return;

    const result = await updateReviewAgent({
      id: agentId,
      name: updates.name,
      systemPrompt: updates.systemPrompt,
      knowledge: updates.knowledge,
    });

    if (!result.success) {
      console.warn('[reviewStore] 更新自定义角色失败:', result.error);
      return;
    }

    state.updateCustomAgentFields(agent, projectCustomReviewAgent(result.data.agent));

    // 编辑完成后回到主界面
    state.exitAgentEditor();
  }

  async function loadCustomAgents() {
    const result = await listReviewAgents();
    if (!result.success) {
      console.warn('[reviewStore] 加载自定义角色失败:', result.error);
      return;
    }

    state.replaceCustomAgents((result.data?.agents ?? []).map(projectCustomReviewAgent));
  }

  function startReview() {
    if (state.activeAgentIds.length === 0) return;

    state.beginReview(generatePrefixedId('review-run'));

    /**
     * 触发“开始审阅”事件：由容器（ReviewSidebar）负责：
     * - 从 UIStore 获取 editor 实例（所见即所得）
     * - 分段导出 document_fragment（DocumentView 协议）
     * - 以 agent 模式调用 /api/v1/conversation/next（promptKey='review'）
     * - 后端通过工具创建包含批注的新文档版本（meta.source='review'）
     */
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('review-started', {
          detail: {
            reviewRunId: state.currentReviewRunId,
            agentIds: [...state.activeAgentIds],
            background: state.reviewBackground,
            goal: state.reviewGoal,
          },
        })
      );
    }
  }
  return { addCustomAgent, updateCustomAgent, loadCustomAgents, startReview };
}
