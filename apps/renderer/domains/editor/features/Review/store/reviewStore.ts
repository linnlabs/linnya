import { defineStore } from 'pinia';
import { createBuiltinReviewAgents } from '../functions/reviewAgentPresentation';
import { IDLE_REVIEW_PROGRESS } from '../definitions/reviewProgress';
import type { ReviewAgent, CustomReviewAgent } from '../definitions/reviewAgent';
import type { ReviewState } from '../definitions/reviewState';
import {
  mergeCustomReviewAgents,
  projectReviewAgentSelection,
} from '../functions/reviewAgentState';

export const useReviewStore = defineStore('review', {
  state: (): ReviewState => ({
    // 审阅流程状态
    // idle: 闲置/主配置页
    // creating_agent: 正在创建新角色
    // processing: 进行中
    // results: 结果展示
    status: 'idle',

    // 所有可用角色（预置 + 用户自定义）
    availableAgents: createBuiltinReviewAgents(),

    // 当前选中的角色 ID 列表 (最多 3 个)
    activeAgentIds: [],

    /**
     * 当前一次审阅运行的 ID：
     * - 由前端生成，用于后端写入 annotation.meta.reviewRunId
     * - 便于前端按“某次审阅”分组展示/回滚（后续扩展点）
     */
    currentReviewRunId: null,

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
    progressState: IDLE_REVIEW_PROGRESS,

    /**
     * 当前筛选的“审阅角色”：
     * - 'all'：展示全部角色的结果
     * - 角色 id：仅展示该角色产出的结果
     *
     * 说明：
     * 顶部 Tab 要按“选择的角色”分组，而不是按 message.category 标签。
     */
    activeAgentFilter: 'all',
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
    appendCustomAgent(agent: CustomReviewAgent) {
      this.availableAgents.push(agent);
    },
    updateCustomAgentFields(target: CustomReviewAgent, next: CustomReviewAgent) {
      target.name = next.name;
      target.systemPrompt = next.systemPrompt;
      target.knowledge = next.knowledge;
    },
    replaceCustomAgents(agents: CustomReviewAgent[]) {
      this.availableAgents = mergeCustomReviewAgents(this.availableAgents, agents);
    },
    beginReview(runId: string) {
      this.status = 'processing';
      this.progress = 0;
      this.progressState = { phase: 'preparing' };
      this.currentReviewRunId = runId;
    },
    setStatus(status: ReviewState['status']) {
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
      this.activeAgentIds = projectReviewAgentSelection(this.activeAgentIds, agentId);
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

    /**
     * 更新自定义角色（仅允许更新 isCustom === true 的角色）
     */

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

    resetReview() {
      this.status = 'idle';
      this.progress = 0;
      this.progressState = IDLE_REVIEW_PROGRESS;
      this.activeAgentFilter = 'all';
      this.currentReviewRunId = null;
    },
  },
});
