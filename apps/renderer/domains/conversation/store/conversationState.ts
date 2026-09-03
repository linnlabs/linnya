/**
 * @file apps/renderer/domains/conversation/store/conversationState.ts
 * @description 对话状态管理模块
 * 
 * @brief 设计理念
 * 功能 (What): 管理AI助手的对话和会话状态，包括对话列表、活跃对话、模式等
 * 输入 (Input): 对话操作调用、模式切换
 * 输出 (Output): 响应式对话状态引用
 * 副作用 (Side-effects): 修改对话数据、创建新对话
 * 
 * @principles 设计原则
 * 1. 高内聚：所有对话相关的状态和操作集中管理
 * 2. 低耦合：通过明确的接口暴露状态和操作，避免外部直接访问
 * 3. 状态一致性：确保活跃对话、模式等状态的一致性
 * 4. 持久化边界：本 store 只维护运行期状态，历史持久化由 history 编排负责
 */

import { ref, type Ref } from 'vue';
import { defineStore } from 'pinia';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { generateConversationId } from '@shared/utils/idUtils';
import { resolveCurrentConversationMessage } from '../functions/resolveCurrentConversationMessage';
import type { Conversation } from '../types';
import type { ConversationSelectedAgentId } from '@app/schemas';

type ConversationTitleOrigin = Conversation['titleOrigin'];

function createDefaultConversationTitle(): string {
  return resolveCurrentConversationMessage('conversation.sidebar.newConversation');
}

/**
 * 对话状态接口定义
 */
export interface ConversationState {
  /** 活跃对话ID */
  activeConversationId: string | null;
  /** 对话列表 */
  conversations: Conversation[];
  /** 输入文本 */
  inputText: string;
  /** 当前正在进行历史加载的会话ID（运行期状态，不持久化） */
  historyLoadingConversationId: string | null;
}

/**
 * 对话状态操作接口
 */
export interface ConversationStateActions {
  /** 创建新对话 */
  createNewConversation: (projectId?: string | null) => string;
  /** 🔥 新增：创建自定义对话 */
  createConversation: (options?: {
    id?: string;
    title?: string;
    autoActivate?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }) => string;
  /** 设置活跃对话 */
  setActiveConversation: (conversationId: string | null) => void;
  /** 更新对话标题 */
  updateConversationTitle: (conversationId: string, title: string, titleOrigin: ConversationTitleOrigin) => void;
  /** 设置输入文本 */
  setInputText: (text: string) => void;
  /** 设置正在进行历史加载的会话ID */
  setHistoryLoadingConversation: (conversationId: string | null) => void;
  /** 重置对话状态 */
  resetConversationState: () => void;
}

export const useConversationState = defineStore('conversationState', () => {
  // ===============================
  // 响应式状态定义
  // ===============================
  
  /** 活跃对话ID */
  const activeConversationId = ref<string | null>(null);
  
  /** 对话列表 */
  /** 显式固定业务实体类型，避免 Vue 对递归 JSON metadata 重复展开类型；运行时仍是深层 ref。 */
  const conversations: Ref<Conversation[]> = ref([]);
  
  /** 输入文本 */
  const inputText = ref<string>('');

  /**
   * 历史加载事实源。
   *
   * 中文说明：
   * - 这个状态只表达“哪个会话正在被 HistoryLoader 回放”，不属于 conversation snapshot；
   * - 由 HistoryLoader 独占写入，UI 与投影层只读；
   * - 不写入 metadata，避免投影 commit 整对象替换时洗掉生命周期信息。
   */
  const historyLoadingConversationId = ref<string | null>(null);

  /** 当前 workspace scope 是对话归属的唯一来源。 */
  const workspaceScopeStore = useWorkspaceScopeStore();

  // ===============================
  // 内部辅助方法
  // ===============================

  /**
   * 查找对话
   * 
   * @param conversationId 对话ID
   * @returns 找到的对话对象或null
   */
  const findConversation = (conversationId: string): Conversation | null => {
    return conversations.value.find(conv => conv.id === conversationId) || null;
  };

  // ===============================
  // 对话管理操作
  // ===============================

  /**
   * 创建新对话
   * 
   * @param projectId 项目归属。undefined 表示沿用当前项目，null 表示明确创建无项目对话。
   * @returns 新创建的对话ID
   */
  const createNewConversation = (projectId?: string | null): string => {
    const resolvedProjectId =
      projectId === undefined
        ? workspaceScopeStore.currentProjectId ?? undefined
        : projectId ?? undefined;
    
    const newConversation: Conversation = {
      id: generateConversationId(),
      title: createDefaultConversationTitle(),
      titleOrigin: 'default',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      userMessageCount: 0,
      messages: [],
      selectedAgentId: null,
      metadata: resolvedProjectId ? { projectId: resolvedProjectId } : {},
    };

    // 将新对话添加到列表开头
    conversations.value.unshift(newConversation);
    
    // 设置为活跃对话
    activeConversationId.value = newConversation.id;
    return newConversation.id;
  };

  /**
   * 创建自定义对话
   * 
   * @param options 自定义对话选项
   * @returns 新创建的对话ID
   */
  const createConversation = (options?: {
    id?: string;
    title?: string;
    autoActivate?: boolean;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): string => {
    const {
      id,
      title,
      autoActivate = false,
      tags = [],
      metadata = {}
    } = options || {};
    const resolvedTitle = title ?? createDefaultConversationTitle();

    const newConversation: Conversation = {
      id: id || generateConversationId(),
      title: resolvedTitle,
      titleOrigin: title === undefined ? 'default' : 'explicit',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      userMessageCount: 0,
      messages: [],
      selectedAgentId: null,
      tags: tags,
      metadata: metadata
    };

    conversations.value.push(newConversation);

    if (autoActivate) {
      activeConversationId.value = newConversation.id;
    }

    return newConversation.id;
  };

  /**
   * 设置活跃对话
   * 
   * @param conversationId 对话ID，null表示取消活跃对话
   */
  const setActiveConversation = (conversationId: string | null): void => {
    activeConversationId.value = conversationId;
    
    if (conversationId) {
      const conversation = findConversation(conversationId);
      if (!conversation) {
        console.warn('[ConversationState] 未找到指定的对话:', conversationId);
      }
    }
  };

  const updateConversationTitle = (
    conversationId: string,
    title: string,
    titleOrigin: ConversationTitleOrigin
  ): void => {
    const trimmedTitle = title.trim();
    if (!conversationId || !trimmedTitle) return;

    const conversation = findConversation(conversationId);
    if (!conversation) return;

    conversation.title = trimmedTitle;
    conversation.titleOrigin = titleOrigin;
    conversation.updatedAt = Date.now();
  };

  /**
   * 设置输入文本
   * 
   * @param text 新的输入文本
   */
  const setInputText = (text: string): void => {
    // 核心修复：直接赋值，而不是追加，防止重复
    inputText.value = text;
  };

  const setHistoryLoadingConversation = (conversationId: string | null): void => {
    historyLoadingConversationId.value = conversationId;
  };

  const setConversationSelectedAgent = (
    conversationId: string,
    selectedAgentId: ConversationSelectedAgentId | null,
  ): void => {
    const conversation = findConversation(conversationId);
    if (!conversation) return;
    conversation.selectedAgentId = selectedAgentId;
  };

  /**
   * 合并指定对话的元数据
   */
  const mergeConversationMetadata = (conversationId: string, metadata: Record<string, unknown>): void => {
    if (!conversationId || !metadata) return;
    const conversation = findConversation(conversationId);
    if (!conversation) return;
    conversation.metadata = {
      ...(conversation.metadata || {}),
      ...metadata,
    };
  };

  /**
   * 重置所有对话状态
   * 
   * @description
   * 将所有对话状态重置为初始值，通常在应用重置或登出时使用
   */
  const resetConversationState = (): void => {
    activeConversationId.value = null;
    historyLoadingConversationId.value = null;
    conversations.value = [];
    inputText.value = '';
  };

  // ===============================
  // 便捷方法
  // ===============================

  /**
   * 获取活跃对话对象
   * 
   * @returns 活跃对话对象或null
   */
  const getActiveConversation = (): Conversation | null => {
    if (!activeConversationId.value) return null;
    return findConversation(activeConversationId.value);
  };

  /**
   * 删除对话
   * 
   * @param conversationId 要删除的对话ID
   */
  const deleteConversation = (conversationId: string): void => {
    const index = conversations.value.findIndex(conv => conv.id === conversationId);
    if (index === -1) {
      console.warn('[ConversationState] 未找到要删除的对话:', conversationId);
      return;
    }
    
    // 删除对话
    conversations.value.splice(index, 1);
    
    // 如果删除的是活跃对话，清除活跃对话ID
    if (activeConversationId.value === conversationId) {
      activeConversationId.value = null;
    }
  };

  /**
   * 获取对话状态的快照（用于调试）
   *
   * @returns 当前对话状态的简化对象
   */
  const getConversationSnapshot = () => ({
    activeConversationId: activeConversationId.value,
    conversationCount: conversations.value.length,
    inputTextLength: inputText.value.length,
    hasActiveConversation: !!getActiveConversation(),
    conversationTitles: conversations.value.map(conv => ({
      id: conv.id,
      title: conv.title,
      messageCount: conv.messages.length
    }))
  });

  // ===============================
  // 返回状态和操作接口
  // ===============================

  return {
    // 响应式状态
    activeConversationId,
    conversations,
    inputText,
    historyLoadingConversationId,
    
    // 基础操作
    createNewConversation,
    createConversation, // 新增的 createConversation 方法
    setActiveConversation,
    updateConversationTitle,
    setInputText,
    setHistoryLoadingConversation,
    setConversationSelectedAgent,
    resetConversationState,
    mergeConversationMetadata,
    
    // 便捷方法
    getActiveConversation,
    deleteConversation,
    getConversationSnapshot,
  };
});
