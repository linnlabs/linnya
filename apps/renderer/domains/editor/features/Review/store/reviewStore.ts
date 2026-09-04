import { defineStore } from 'pinia';
import { generatePrefixedId } from '../../../../../shared/utils/idUtils';
import {
  createReviewAgent,
  listReviewAgents,
  updateReviewAgent,
  type ReviewAgentRecord,
} from '../services/reviewAgentsService';
import { createBuiltinReviewAgents } from '../functions/reviewAgentPresentation';
import { IDLE_REVIEW_PROGRESS, type ReviewProgressState } from '../definitions/reviewProgress';
import type { ReviewAgent, ReviewAgentDraft } from '../definitions/reviewAgent';

export const useReviewStore = defineStore('review', {
  state: () => ({
    // 审阅流程状态
    // idle: 闲置/主配置页
    // creating_agent: 正在创建新角色
    // processing: 进行中
    // results: 结果展示
    status: 'idle' as 'idle' | 'creating_agent' | 'processing' | 'results',
    
    // 所有可用角色（预置 + 用户自定义）
    availableAgents: createBuiltinReviewAgents(),

    // 当前选中的角色 ID 列表 (最多 3 个)
    activeAgentIds: [] as string[],

    /**
     * 当前一次审阅运行的 ID：
     * - 由前端生成，用于后端写入 annotation.meta.reviewRunId
     * - 便于前端按“某次审阅”分组展示/回滚（后续扩展点）
     */
    currentReviewRunId: null as string | null,

    /**
     * 当前正在编辑的自定义角色 ID：
     * - null：表示“新建自定义角色”
     * - string：表示“编辑已有自定义角色”
     *
     * 之所以放在 store：`ReviewSidebar.vue` 通过 status 切换视图，
     * 子视图之间不直接传参，避免低内聚高耦合。
     */
    editingAgentId: null as string | null,
    
    // 审阅背景
    reviewBackground: '',

    // 审阅目标
    reviewGoal: '',
    
    // 进度状态
    progress: 0,
    progressState: IDLE_REVIEW_PROGRESS as ReviewProgressState,

    /**
     * 当前筛选的“审阅角色”：
     * - 'all'：展示全部角色的结果
     * - 角色 id：仅展示该角色产出的结果
     *
     * 说明：
     * 顶部 Tab 要按“选择的角色”分组，而不是按 message.category 标签。
     */
    activeAgentFilter: 'all' as 'all' | string,
  }),

  getters: {
    // 获取当前选中的完整 Agent 对象
    selectedAgents(state): ReviewAgent[] {
      return state.activeAgentIds
        .map(id => state.availableAgents.find(a => a.id === id))
        .filter((a): a is ReviewAgent => !!a);
    },

    // 剩余可选的 Agent（用于下拉框展示）
    selectableAgents(state): ReviewAgent[] {
      return state.availableAgents.filter(a => !state.activeAgentIds.includes(a.id));
    },

    // Review 的结果列表来自当前文档内批注（单一事实源），因此 store 不再维护 reviewMessages。
  },

  actions: {
    setStatus(status: 'idle' | 'creating_agent' | 'processing' | 'results') {
      this.status = status;
    },

    /**
     * 进入“新建自定义角色”流程
     */
    beginCreateCustomAgent() {
      this.editingAgentId = null;
      this.status = 'creating_agent';
    },

    /**
     * 进入“编辑自定义角色”流程
     */
    beginEditCustomAgent(agentId: string) {
      this.editingAgentId = agentId;
      this.status = 'creating_agent';
    },

    /**
     * 退出角色编辑器（回到主配置页）
     */
    exitAgentEditor() {
      this.status = 'idle';
      this.editingAgentId = null;
    },

    // 选中角色
    selectAgent(agentId: string) {
      if (this.activeAgentIds.length >= 3) return;
      if (!this.activeAgentIds.includes(agentId)) {
        this.activeAgentIds.push(agentId);
      }
    },

    // 移除已选角色
    removeAgent(agentId: string) {
      const index = this.activeAgentIds.indexOf(agentId);
      if (index !== -1) {
        this.activeAgentIds.splice(index, 1);
      }

      // 如果当前正筛选该角色，则回落到“全部”
      if (this.activeAgentFilter === agentId) {
        this.activeAgentFilter = 'all';
      }
    },

    // 添加自定义角色
    async addCustomAgent(agent: ReviewAgentDraft) {
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
      const newAgent: ReviewAgent = {
        id: created.id,
        name: created.name,
        systemPrompt: created.systemPrompt,
        knowledge: created.knowledge,
        isCustom: true,
      };

      this.availableAgents.push(newAgent);

      // 自动选中新创建的角色（如果没满）
      if (this.activeAgentIds.length < 3) {
        this.activeAgentIds.push(newAgent.id);
      }

      // 新建完成后，清理编辑态并返回主界面
      this.editingAgentId = null;
      this.status = 'idle';
    },

    /**
     * 更新自定义角色（仅允许更新 isCustom === true 的角色）
     */
    async updateCustomAgent(agentId: string, updates: ReviewAgentDraft) {
      const agent = this.availableAgents.find((a) => a.id === agentId);
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

      agent.name = result.data.agent.name;
      agent.systemPrompt = result.data.agent.systemPrompt;
      agent.knowledge = result.data.agent.knowledge;

      // 编辑完成后回到主界面
      this.editingAgentId = null;
      this.status = 'idle';
    },

    // 兼容旧 API (Toggle) - 虽然 UI 可能不用了，但保留逻辑也可以
    toggleAgent(agentId: string) {
      if (this.activeAgentIds.includes(agentId)) {
        this.removeAgent(agentId);
      } else {
        this.selectAgent(agentId);
      }
    },

    setReviewBackground(value: string) {
      this.reviewBackground = value;
    },

    setReviewGoal(value: string) {
      this.reviewGoal = value;
    },

    /**
     * 设置当前筛选的审阅角色
     *
     * 说明：
     * - 这是“结果页（ReviewDashboard）”的筛选维度，不等同于“本次准备审阅所选角色”（activeAgentIds）
     * - 当用户打开历史审阅结果时，activeAgentIds 可能为空/与历史不一致；此时仍应允许按历史 agentId 筛选
     *
     * 因此这里不再强制要求 agentId 必须属于 activeAgentIds。
     */
    setActiveAgentFilter(agentId: 'all' | string) {
      if (agentId === 'all') {
        this.activeAgentFilter = 'all';
        return;
      }

      // 空字符串/非法值直接回落到 all
      if (typeof agentId !== 'string' || agentId.trim().length === 0) {
        this.activeAgentFilter = 'all';
        return;
      }

      this.activeAgentFilter = agentId;
    },

    /**
     * 拉取并合并自定义角色（agents 表，type='review'）
     *
     * 说明：
     * - 系统内置角色仍由前端内置，不入库
     * - 自定义角色以 DB 为权威（避免前端请求里塞 prompt 导致版本漂移）
     */
    async loadCustomAgents() {
      const result = await listReviewAgents();
      if (!result.success) {
        console.warn('[reviewStore] 加载自定义角色失败:', result.error);
        return;
      }

      const fromDb = (result.data?.agents ?? []).map((a: ReviewAgentRecord): ReviewAgent => ({
        id: a.id,
        name: a.name,
        systemPrompt: a.systemPrompt,
        knowledge: a.knowledge,
        isCustom: true,
      }));

      // 先移除旧的自定义角色，再合并新的，避免重复/脏数据
      this.availableAgents = [
        ...this.availableAgents.filter((a) => !a.isCustom),
        ...fromDb,
      ];
    },

    startReview() {
      if (this.activeAgentIds.length === 0) return;

      this.status = 'processing';
      this.progress = 0;
      this.progressState = { phase: 'preparing' };
      this.currentReviewRunId = generatePrefixedId('review-run');

      /**
       * 触发“开始审阅”事件：由容器（ReviewSidebar）负责：
       * - 从 UIStore 获取 editor 实例（所见即所得）
       * - 分段导出 document_fragment（DocumentView 协议）
       * - 以 agent 模式调用 /api/v1/conversation/next（promptKey='review'）
       * - 后端通过工具创建包含批注的新文档版本（meta.source='review'）
       */
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('review-started', {
          detail: {
            reviewRunId: this.currentReviewRunId,
            agentIds: [...this.activeAgentIds],
            background: this.reviewBackground,
            goal: this.reviewGoal
          }
        }));
      }
    },

    resetReview() {
      this.status = 'idle';
      this.progress = 0;
      this.progressState = IDLE_REVIEW_PROGRESS;
      this.activeAgentFilter = 'all';
      this.currentReviewRunId = null;
    }
  }
});
