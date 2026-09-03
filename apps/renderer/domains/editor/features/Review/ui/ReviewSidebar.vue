<template>
  <div class="review-sidebar">
    <Transition name="review-sidebar-fade" mode="out-in">
      <ReviewSetup v-if="reviewStore.status === 'idle'" />
      <ReviewAgentCreator v-else-if="reviewStore.status === 'creating_agent'" />
      <ReviewProcessing v-else-if="reviewStore.status === 'processing'" />
      <ReviewDashboard v-else />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, computed, watch, ref } from 'vue';
import { useReviewStore } from '../store/reviewStore';
import { useUIStore } from '@shared/stores/ui';
import { useFileStore } from '@shared/stores/file';
import ReviewSetup from './views/ReviewSetup.vue';
import ReviewAgentCreator from './views/ReviewAgentCreator.vue';
import ReviewProcessing from './views/ReviewProcessing.vue';
import ReviewDashboard from './views/ReviewDashboard.vue';
import { getReviewContextConfig } from '../config/contextConfig';
import { chunkReviewDocumentFromEditor } from '../utils/reviewDocumentChunker';
import { workspaceGateway } from '@shared/ipc/workspaceGateway';
import { generateTextStream } from '@shared/services/aiService/unifiedApiService';

const reviewStore = useReviewStore();
const uiStore = useUIStore();
const fileStore = useFileStore();

// 标记是否已检查初始状态（避免用户点击“新审阅”后自动跳回结果页）
const hasCheckedInitialState = ref(false);

// 从 UIStore 获取编辑器实例，然后从编辑器获取 annotationStore 和 panelPositionManager
// 这些在 editorFactory.js 的 onCreate 钩子中被挂载到 editor 上 (line 190-191)
const editorInstance = computed(() => uiStore.getEditor());
const annotationStore = computed(() => editorInstance.value?.annotationStore);

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isReviewAnnotationLike = (annotation: unknown): boolean => {
  if (!isObjectRecord(annotation)) return false;
  const meta = annotation.meta;
  return isObjectRecord(meta) && meta.source === 'review';
};

// 监听文档切换，重置检查标记
watch(
  () => fileStore.currentFilePath,
  () => {
    hasCheckedInitialState.value = false;
    // 切换文档时，如果不在结果页，建议重置状态；如果在结果页，保留与否取决于产品定义
    // 这里简单处理：切换文档重置为 idle，以便重新检测新文档的状态
    if (reviewStore.status !== 'idle') {
      reviewStore.resetReview();
    }
  }
);

// 监听批注加载，如果有 Review 历史则自动跳转到结果页
watch(
  () => annotationStore.value?.annotations?.value,
  (annotations) => {
    // 1. 如果已经检查过并跳转过（或用户手动重置过），不再干预
    if (hasCheckedInitialState.value) return;
    
    // 2. 只有当前处于初始状态才跳转
    if (reviewStore.status !== 'idle') return;

    if (Array.isArray(annotations) && annotations.length > 0) {
      // 3. 检查是否存在 Review 来源的批注
      const hasReview = annotations.some(isReviewAnnotationLike);
      
      if (hasReview) {
        reviewStore.setStatus('results');
        hasCheckedInitialState.value = true;
      }
    }
  },
  { immediate: true, deep: true }
);

let runningAbortController: AbortController | null = null;

/**
 * 处理“开始审阅”事件：顺序执行（角色 × 分段），并在每段完成后刷新 annotations。
 *
 * 注意：
 * - Review 必须使用 agent 模式（mode='agent'），否则后端会禁用工具调用，无法落库批注
 * - 最终结果以 annotationStore.annotations 为事实源（meta.source === 'review'）
 */
const handleReviewStarted = async () => {
  const editor = editorInstance.value;
  const annoStore = annotationStore.value;
  const documentId = fileStore.currentFilePath;

  if (!editor || !annoStore) {
    console.warn('[ReviewSidebar] 无法开始审阅：缺少必要的实例', {
      hasEditor: !!editor,
      hasAnnotationStore: !!annoStore,
    });
    return;
  }

  if (!documentId) {
    console.warn('[ReviewSidebar] 无法开始审阅：当前没有打开的文档（documentId 为空）');
    return;
  }

  // 如果上一次还在跑，先取消，避免并发写入导致 UI 顺序混乱
  if (runningAbortController) {
    runningAbortController.abort();
  }
  runningAbortController = new AbortController();

  try {
    // 1) 分段导出全文（按块）
    const config = getReviewContextConfig();
    const chunks = await chunkReviewDocumentFromEditor({
      editor,
      documentId,
      config,
    });
    if (chunks.length === 0) {
      console.warn('[ReviewSidebar] 文档为空或无法导出分段，跳过审阅');
      reviewStore.setStatus('results');
      return;
    }

    // 2) 顺序执行：外层按角色，内层按 chunk
    const selectedAgents = reviewStore.selectedAgents;
    const totalCalls = selectedAgents.length * chunks.length;
    let completedCalls = 0;

    for (const agent of selectedAgents) {
      for (const chunk of chunks) {
        const chunkIndex = chunk.chunkIndex;
        reviewStore.progressState = {
          phase: 'reviewingChunk',
          agentId: agent.id,
          chunkIndex,
          totalChunks: chunks.length,
        };

        const reviewRunId = reviewStore.currentReviewRunId;
        const query = [
          '请审阅你收到的 document_fragment，并严格通过 tool_calls 创建批注。',
        ].join('\n');

        await generateTextStream(
          {
            prompt: query,
            prompt_key: 'review',
            mode: 'agent',
            enableTools: true,
            persist: false,
            history_mode: 'isolated',
            document_fragment: chunk.document_fragment,
            review_run_id: reviewRunId ?? undefined,
            agent_id: agent.id,
            chunk_index: chunkIndex,
            total_chunks: chunks.length,
            review_background: reviewStore.reviewBackground,
            review_goal: reviewStore.reviewGoal,
          },
          {
            onError: (e: Error) => {
              console.error('[ReviewSidebar] Review stream error:', e);
            },
          },
          runningAbortController.signal
        );

        completedCalls += 1;
        reviewStore.progress = Math.round((completedCalls / totalCalls) * 100);

        // 3) 刷新 annotations（后端工具已落库，本地需拉取最新）
        const annotationsResult = await workspaceGateway['list-annotations']({ documentId });
        if (annotationsResult?.success) {
          const annotations = annotationsResult.data?.annotations ?? [];
          if (typeof annoStore.loadAnnotations === 'function') {
            annoStore.loadAnnotations(annotations);
          }
        } else {
          console.warn('[ReviewSidebar] 刷新批注失败:', annotationsResult?.error);
        }
      }
    }

    reviewStore.progressState = { phase: 'completed' };
    reviewStore.setStatus('results');
  } catch (e: unknown) {
    console.error('[ReviewSidebar] 审阅执行失败:', e);
    reviewStore.progressState = { phase: 'failed' };
    reviewStore.setStatus('results');
  } finally {
    runningAbortController = null;
  }
};

onMounted(() => {
  if (typeof window !== 'undefined') {
    // 拉取一次自定义角色（agents 表）
    reviewStore.loadCustomAgents().catch((e: unknown) => {
      console.warn('[ReviewSidebar] 初始化加载自定义角色失败:', e);
    });

    window.addEventListener('review-started', handleReviewStarted);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('review-started', handleReviewStarted);
    if (runningAbortController) {
      runningAbortController.abort();
      runningAbortController = null;
    }
  }
});
</script>
