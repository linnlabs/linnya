<!-- 
  apps/renderer/app/pages/ProjectSetupPage/ProjectSetupView.vue
  
  AI 辅助项目初始化视图
  用户通过与 AI 对话来明确项目需求，完成后自动生成项目文档
-->
<template>
  <div class="project-setup-view">
    <!-- 顶部标题栏：极简风格 -->
    <header class="setup-header">
      <div class="header-right">
        <ActionButtons
          :primary-action-text="layoutMessage('layout.projectSetup.generate')"
          :secondary-action-text="layoutMessage('layout.projectSetup.skip')"
          :is-primary-action-disabled="isGenerating || !canGenerate"
          :is-secondary-action-disabled="isGenerating"
          :primary-variant="isGenerating ? 'default' : 'accent'"
          secondary-variant="plain"
          @primary-click="handleGenerate"
          @secondary-click="handleSkip"
        >
          <template #primary-content>
            <span v-if="!isGenerating" class="btn-content">
              <AiIcon class="btn-icon" />
              <span>{{ layoutMessage('layout.projectSetup.generate') }}</span>
            </span>
            <span v-else class="btn-content">
              <span class="btn-spinner"></span>
              <span>{{ layoutMessage('layout.projectSetup.generating') }}</span>
            </span>
          </template>
        </ActionButtons>
      </div>
    </header>

    <!-- 对话区域 - 复用 ConversationHost（仅对话内容，不包含输入框） -->
    <main class="conversation-container">
      <div class="conversation-inner">
        <!-- 注意：在项目初始化视图中，我们只使用 ConversationHost 的对话部分，
             输入框单独在本组件底部渲染并固定，以获得更好的布局控制 -->
        <ConversationHost
          :is-timeline-collapsed="true"
          :is-active="true"
          :hide-footer="true"
          class="project-conversation-host"
        />
      </div>
    </main>

    <!-- 项目初始化视图专用：固定在底部可视区域内的 AI 输入区域 -->
    <div class="project-setup-input-bar">
      <div class="project-setup-input-inner">
        <AiAssistantInput />
      </div>
    </div>

    <!-- 底部已简化，不再放操作按钮，避免视觉干扰 -->

    <!-- 错误提示 -->
    <Transition name="error-slide">
    <div v-if="errorMessage" class="error-banner">
        <span class="error-icon">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </span>
      <span class="error-text">{{ errorMessage }}</span>
        <button class="error-dismiss" @click="errorMessage = ''">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
    </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { useExecutionState } from '@/domains/conversation/store/executionState';
import { useWorkspaceTreeStore } from '@/domains/workspace/store/WorkspaceTreeStore';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import { useChatFlowOrchestrator } from '@/domains/conversation/services/orchestration/chatFlowOrchestrator';
import ConversationHost from '@/domains/conversation/ui/ConversationHost.vue';
import AiAssistantInput from '@/domains/conversation/ui/AiAssistantInput.vue';
import { ActionButtons } from '@linnya/renderer-ui';
import { AiIcon } from '@linnya/renderer-ui/icons';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { PROJECT_PLANNING_PROMPT_KEY } from '@app/schemas';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';

// Stores
const workspaceScopeStore = useWorkspaceScopeStore();
const assistantStore = useAssistantStore();
const executionState = useExecutionState();
const workspaceTreeStore = useWorkspaceTreeStore();
const workspaceProjectsStore = useWorkspaceProjectsStore();
const chatFlowOrchestrator = useChatFlowOrchestrator();
const navigation = getWorkspaceNavigationPort();
const { layoutMessage } = useLayoutLocalization();

// 组件状态
const isGenerating = ref(false);
const errorMessage = ref('');
// 避免重复发送欢迎消息
const hasSentWelcomeMessage = ref(false);

// 计算属性：项目名称
const projectName = computed(() => {
  const projectId = workspaceScopeStore.currentProjectId;
  if (!projectId) return '';
  const project = workspaceProjectsStore.projects.find(p => p.id === projectId);
  return project?.name || '';
});

// 计算属性：项目描述
const projectDescription = computed(() => {
  const projectId = workspaceScopeStore.currentProjectId;
  if (!projectId) return '';
  const project = workspaceProjectsStore.projects.find(p => p.id === projectId);
  const desc = (project?.description ?? '').trim();
  return desc;
});

// 是否可以点击生成（至少有一条对话）
const canGenerate = computed(() => {
  const messages = assistantStore.activeMessages;
  // 至少有一条用户消息和一条助手回复
  const hasUserMessage = messages.some((m) => m.role === 'user');
  const hasAssistantMessage = messages.some((m) => m.role === 'assistant');
  return hasUserMessage && hasAssistantMessage;
});

// 监听执行状态，检测生成完成
watch(
  () => executionState.isStreaming,
  (newVal, oldVal) => {
    // 从 streaming 变为 非 streaming，说明流结束
    if (oldVal === true && newVal === false && isGenerating.value) {
      handleGenerationComplete();
    }
  }
);

// 生成完成处理
const handleGenerationComplete = async () => {
  console.log('[ProjectSetupView] Generation stream ended');
  
  try {
    // 刷新工作区树
    await workspaceTreeStore.reloadActiveProjectTree();
    
    // 切换到项目主页
    isGenerating.value = false;
    exitProjectSetupToWorkspace();
    
    console.log('[ProjectSetupView] Successfully completed project setup');
  } catch (error) {
    console.error('[ProjectSetupView] Error after generation:', error);
    isGenerating.value = false;
    errorMessage.value = layoutMessage('layout.projectSetup.refreshAfterGenerationFailed');
  }
};

// 点击"完成并生成"
const handleGenerate = async () => {
  if (isGenerating.value || !canGenerate.value) return;
  
  isGenerating.value = true;
  errorMessage.value = '';
  
  try {
    // 发送生成指令消息
    const generatePrompt = `请根据我们的对话内容，现在开始生成项目文档。请依次调用 write_file 工具创建以下三个 Markdown 文档：
1. Problem Definition - 路径: "/Problem Definition.md" - 包含项目背景、问题陈述、目标、范围等
2. Issue Tree - 路径: "/Issue Tree.md" - 问题树/议题分解
3. Workplan - 路径: "/Workplan.md" - 包含项目阶段、时间表、关键里程碑等

请直接开始创建，不需要再询问我。`;

    // 使用 chatFlowOrchestrator 发送消息，指定 promptKey
    const success = await chatFlowOrchestrator.sendChatMessage({ text: generatePrompt }, {
      promptKey: PROJECT_PLANNING_PROMPT_KEY
    });
    
    if (!success) {
      throw new Error(layoutMessage('layout.projectSetup.sendMessageFailed'));
    }
    
  } catch (error) {
    console.error('[ProjectSetupView] Error sending generate command:', error);
    isGenerating.value = false;
    errorMessage.value = layoutMessage('layout.projectSetup.sendMessageFailed');
  }
};

// 点击"跳过"
const handleSkip = () => {
  if (isGenerating.value) return;
  
  try {
    exitProjectSetupToWorkspace();
  } catch {
    errorMessage.value = layoutMessage('layout.projectSetup.exitFailed');
  }
};

function exitProjectSetupToWorkspace(): void {
  const projectId = workspaceScopeStore.currentProjectId;
  if (!projectId) {
    throw new Error(layoutMessage('layout.projectSetup.missingCurrentProject'));
  }

  // 中文说明：项目初始化页不直接改 uiStore 视图状态，统一交给 app-level navigation 回到工作台。
  navigation.openWorkspace({ kind: 'project', projectId });
}

// 初始化首轮对话：构造第一条“系统用户请求”，让 AI 返回真正的首条消息
const ensureWelcomeMessage = async () => {
  if (hasSentWelcomeMessage.value) {
    return;
  }

  const conversation = assistantStore.activeConversation;
  // 仅在当前对话存在且还没有任何可渲染消息时触发。
  if (!conversation || assistantStore.hasRenderableMessages) {
    return;
  }

  const name = projectName.value || '未命名项目';
  const desc = projectDescription.value || '（我暂未填写项目描述）';

  const initialPrompt = `下面是我刚创建的一个项目的基本信息，请你作为项目规划顾问来协助我：

- 项目名称：${name}
- 项目描述：${desc}

请你先用 2-3 句话复述你对这个项目的理解和假设，然后逐步向我提问，帮助进一步明确：
1. 这次项目的核心目标和衡量标准；
2. 主要读者、相关方或受众是谁；
3. 预期的主要交付物或成果是什么；
4. 时间范围和资源/约束大致如何。
5. 其他你认为需要进一步了解的详细问题。

每一轮对话请集中在一小组问题上，等待我回答后再继续提问。`;

  try {
    const projectId = workspaceScopeStore.currentProjectId || undefined;

    const ok = await chatFlowOrchestrator.sendChatMessage({ text: initialPrompt }, {
      promptKey: PROJECT_PLANNING_PROMPT_KEY,
      projectMetadata: {
        id: projectId,
        name,
        description: desc,
      },
    });

    if (ok) {
      hasSentWelcomeMessage.value = true;
    }
  } catch (error) {
    console.error('[ProjectSetupView] Failed to send initial project planning prompt:', error);
  }
};

onMounted(async () => {
  // 进入项目初始化视图后，自动向 AI 发送首条“系统用户请求”，让 AI 产生真正的第一条消息。
  // `.editor-shell.for-project-setup` 由 AppLayout 统一负责，避免页面组件重复改外层 DOM。
  await ensureWelcomeMessage();
});
</script>
