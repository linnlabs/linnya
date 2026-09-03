/**
 * @file useToolCardCollapse.ts
 * @description ToolCallsMessage 的折叠策略聚合：初始化折叠、深度搜索完成自动收起、todo 旧卡自动收起。
 *
 * 约束：
 * - 折叠状态可被用户手动控制；一旦用户手动触发，则后续自动逻辑不再覆盖。
 * - 只做“明确规则”，不做猜测式修复。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { BaseMessage } from '../../../types';
import { isRecord } from '../../../utils/typeGuards';

export interface ToolCardCollapseState {
  isCollapsed: Ref<boolean>;
  isCollapseTouchedByUser: Ref<boolean>;
  toggleCollapse: () => void;
}

export function createToolCardCollapseState(): ToolCardCollapseState {
  const isCollapsed = ref(false);
  const isCollapseTouchedByUser = ref(false);
  const toggleCollapse = () => {
    isCollapseTouchedByUser.value = true;
    isCollapsed.value = !isCollapsed.value;
  };
  return { isCollapsed, isCollapseTouchedByUser, toggleCollapse };
}

export interface UseToolCardCollapseEffectsParams {
  message: Ref<BaseMessage>;
  toolName: ComputedRef<string>;
  toolArgs: ComputedRef<Record<string, unknown>>;
  status: ComputedRef<string>;
  isKnowledgeSearchTool: ComputedRef<boolean>;
  registryTitleText: ComputedRef<string | null>;
  latestTodoToolMessageId: ComputedRef<string | null>;
  // registry 可能没有 defaultCollapsed；这里传入“是否存在 + 取值函数”即可，避免强耦合 ToolUiConfig 类型
  registryDefaultCollapsed: ComputedRef<boolean | ((args: Record<string, unknown>) => boolean) | undefined>;
}

export interface ToolCardCollapseEffectsModel {
  isTodoTool: ComputedRef<boolean>;
  isLatestTodoToolCard: ComputedRef<boolean>;
}

export function useToolCardCollapseEffects(
  state: ToolCardCollapseState,
  params: UseToolCardCollapseEffectsParams
): ToolCardCollapseEffectsModel {
  const {
    message,
    toolName,
    toolArgs,
    status,
    isKnowledgeSearchTool,
    registryTitleText,
    registryDefaultCollapsed,
    latestTodoToolMessageId,
  } = params;

  const { isCollapsed, isCollapseTouchedByUser } = state;

  // ----------------------------------------------------------------------
  // ToDo 工具卡：自动收起旧卡（但尊重用户手动展开）
  // ----------------------------------------------------------------------

  const isTodoTool = computed(() => toolName.value === 'todo_read' || toolName.value === 'todo_write');

  const isLatestTodoToolCard = computed(() => {
    const latestId = latestTodoToolMessageId.value;
    if (!latestId) return false;
    return message.value.id === latestId;
  });

  watch(
    () => latestTodoToolMessageId.value,
    () => {
      if (!isTodoTool.value) return;
      if (isCollapseTouchedByUser.value) return;

      // 非最新：自动收起
      if (!isLatestTodoToolCard.value) {
        isCollapsed.value = true;
        return;
      }

      // 最新：todo_write 自动展开；todo_read 维持 registry 的默认折叠策略（不强制展开）
      if (toolName.value === 'todo_write') {
        isCollapsed.value = false;
      }
    },
    { immediate: true }
  );

  // ----------------------------------------------------------------------
  // 初始化折叠状态（根因级约束：只能初始化一次）
  // ----------------------------------------------------------------------

  watch(
    () => registryTitleText.value,
    (title, previousTitle) => {
      const hasTitle = !!title;
      const prevHasTitle = !!previousTitle;

      // 无标题：保持展开（不允许折叠隐藏内容，否则用户无法看到过程/结果）
      if (!hasTitle) {
        isCollapsed.value = false;
        return;
      }

      // 有标题但此前也有标题：禁止重置用户折叠状态
      if (prevHasTitle) return;

      // 用户已经手动操作过：尊重用户选择，不做初始化覆盖
      if (isCollapseTouchedByUser.value) return;

      // ✅ ToDo 优先：旧卡必须收起，避免与 defaultCollapsed 竞态
      if (isTodoTool.value && !isLatestTodoToolCard.value) {
        isCollapsed.value = true;
        return;
      }

      // 第一次出现标题：按 registry defaultCollapsed 初始化（否则默认折叠）
      const dc = registryDefaultCollapsed.value;
      if (dc !== undefined) {
        isCollapsed.value = typeof dc === 'function' ? dc(toolArgs.value) : dc;
        return;
      }
      isCollapsed.value = true;
    },
    { immediate: true }
  );

  // ----------------------------------------------------------------------
  // 深度搜索完成后自动收起整个卡片
  // ----------------------------------------------------------------------

  watch(
    () => status.value,
    (newStatus, oldStatus) => {
      if (!isKnowledgeSearchTool.value) return;
      if (isCollapseTouchedByUser.value) return;

      const args = toolArgs.value;
      const isDeepSearch = isRecord(args) && args['deep_search'] === true;
      if (!isDeepSearch) return;

      if (oldStatus === 'loading' && newStatus !== 'loading') {
        isCollapsed.value = true;
      }
    }
  );

  return {
    isTodoTool,
    isLatestTodoToolCard,
  };
}
