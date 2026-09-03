<template>
  <section class="project-kb-section">
    <div class="project-kb-header">
      <div class="header-text">
        <h2 class="header-title">
          <KnowledgeBaseIcon class="header-title-icon" />
          <span>{{ workspaceMessage('workspace.projectKb.title') }}</span>
        </h2>
        <p class="header-subtitle">
          {{ workspaceMessage('workspace.projectKb.subtitle') }}
        </p>
      </div>
    </div>

    <div class="project-kb-body">
      <div class="columns">
        <!-- 左侧：已关联知识库 -->
        <div class="column-wrapper">
          <div class="column-header">
            <span class="column-title">{{ workspaceMessage('workspace.projectKb.linkedTitle') }}</span>
            <span class="column-meta">
              {{ workspaceMessage('workspace.projectKb.count', { count: linkedKnowledgeBases.length }) }}
            </span>
          </div>
          <div class="column">
            <div v-if="isLoading" class="column-empty">
              {{ workspaceMessage('workspace.projectKb.loadingLinks') }}
            </div>
            <div v-else-if="linkedKnowledgeBases.length === 0" class="column-empty">
              {{ workspaceMessage('workspace.projectKb.emptyLinked') }}
            </div>
            <div v-else class="kb-list">
              <div
                v-for="kb in linkedKnowledgeBases"
                :key="kb.id"
                class="kb-item"
              >
                <div class="kb-info">
                  <div class="kb-name" :title="kb.name">
                    {{ kb.name }}
                  </div>
                  <div v-if="kb.description" class="kb-desc" :title="kb.description">
                    {{ kb.description }}
                  </div>
                </div>
                <button
                  type="button"
                  class="kb-action-btn remove-btn"
                  :title="workspaceMessage('workspace.projectKb.unlinkTitle')"
                  @click="unlinkKnowledgeBase(kb.id)"
                >
                  {{ workspaceMessage('workspace.projectKb.unlink') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：可关联知识库 -->
        <div class="column-wrapper">
          <div class="column-header">
            <span class="column-title">{{ workspaceMessage('workspace.projectKb.availableTitle') }}</span>
            <span class="column-meta">
              {{ workspaceMessage('workspace.projectKb.count', { count: availableKnowledgeBases.length }) }}
            </span>
          </div>
          <div class="column">
            <div v-if="isLoading" class="column-empty">
              {{ workspaceMessage('workspace.projectKb.loadingKnowledgeBases') }}
            </div>
            <div v-else-if="availableKnowledgeBases.length === 0" class="column-empty">
              {{ workspaceMessage('workspace.projectKb.emptyAvailable') }}
            </div>
            <div v-else class="kb-list">
              <div
                v-for="kb in availableKnowledgeBases"
                :key="kb.id"
                class="kb-item"
              >
                <div class="kb-info">
                  <div class="kb-name" :title="kb.name">
                    {{ kb.name }}
                  </div>
                  <div v-if="kb.description" class="kb-desc" :title="kb.description">
                    {{ kb.description }}
                  </div>
                </div>
                <button
                  type="button"
                  class="kb-action-btn add-btn"
                  :title="workspaceMessage('workspace.projectKb.linkTitle')"
                  @click="linkKnowledgeBase(kb.id)"
                >
                  {{ workspaceMessage('workspace.projectKb.link') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 操作区固定在内容末尾，保持“主操作在右下角”的一致交互 -->
    <div class="project-kb-footer">
      <ActionButtons
        :primary-action-text="isSaving ? workspaceMessage('workspace.projectKb.saving') : workspaceMessage('workspace.projectKb.save')"
        :is-primary-action-disabled="!projectId || isSaving"
        :show-secondary-action="false"
        @primary-click="handleSave"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ActionButtons } from '@linnya/renderer-ui';
import { KnowledgeBaseIcon } from '@linnya/renderer-ui/icons';
import { useKnowledgeBaseStore } from '@/domains/knowledgebase/stores/knowledgeBase';
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
import { useNotificationStore } from '@/app/notification';
import { useWorkspaceLocalization } from '../useWorkspaceLocalization';

const props = defineProps<{
  projectId: string;
  projectName?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const kbStore = useKnowledgeBaseStore();
const notificationStore = useNotificationStore();
const { workspaceMessage } = useWorkspaceLocalization();

type KnowledgeBaseItem = {
  id: string;
  name: string;
  description?: string;
};

// 当前项目 ID 的只读映射，方便模板使用
const projectId = computed(() => props.projectId);

// UI 状态
const linkedKbIds = ref<string[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);

const displayProjectName = computed(() => {
  if (props.projectName && props.projectName.trim().length > 0) {
    return props.projectName;
  }
  return workspaceMessage('workspace.projectKb.untitledProject');
});

const knowledgeBases = computed<KnowledgeBaseItem[]>(() => {
  return (kbStore.knowledgeBases || []) as KnowledgeBaseItem[];
});

const linkedKnowledgeBases = computed<KnowledgeBaseItem[]>(() =>
  knowledgeBases.value.filter((kb) => linkedKbIds.value.includes(kb.id))
);

const availableKnowledgeBases = computed<KnowledgeBaseItem[]>(() =>
  knowledgeBases.value.filter((kb) => !linkedKbIds.value.includes(kb.id))
);

const loadLinkedKnowledgeBasesForProject = async (targetProjectId: string) => {
  if (!targetProjectId) {
    linkedKbIds.value = [];
    return;
  }

  try {
    isLoading.value = true;
    const result = await projectKbLinksGateway.listKnowledgeBaseIdsForProject({
      projectId: targetProjectId
    });
    if (result.success) {
      linkedKbIds.value = Array.isArray(result.data) ? result.data : [];
    } else {
      linkedKbIds.value = [];
      notificationStore.show(workspaceMessage('workspace.projectKb.loadFailed'), 'error', 4000);
    }
  } catch (error) {
    console.error(
      '[ProjectKbSettingsPanel] 加载项目关联知识库失败:',
      error
    );
    notificationStore.show(workspaceMessage('workspace.projectKb.loadFailed'), 'error', 4000);
    linkedKbIds.value = [];
  } finally {
    isLoading.value = false;
  }
};

const ensureKnowledgeBasesLoaded = async () => {
  // 优先使用 store 内的懒加载入口，避免重复请求
  if (typeof kbStore.ensureDataLoaded === 'function') {
    await kbStore.ensureDataLoaded();
    return;
  }
  if (
    Array.isArray(kbStore.knowledgeBases) &&
    kbStore.knowledgeBases.length > 0
  ) {
    return;
  }
  if (typeof kbStore.fetchKnowledgeBases === 'function') {
    await kbStore.fetchKnowledgeBases();
  }
};

onMounted(async () => {
  await ensureKnowledgeBasesLoaded();
  if (props.projectId) {
    await loadLinkedKnowledgeBasesForProject(props.projectId);
  }
});

watch(
  () => props.projectId,
  (newId, oldId) => {
    if (newId && newId !== oldId) {
      void loadLinkedKnowledgeBasesForProject(newId);
    }
    if (!newId) {
      linkedKbIds.value = [];
    }
  }
);

const linkKnowledgeBase = (kbId: string) => {
  if (!kbId) {
    return;
  }
  if (!linkedKbIds.value.includes(kbId)) {
    linkedKbIds.value.push(kbId);
  }
};

const unlinkKnowledgeBase = (kbId: string) => {
  linkedKbIds.value = linkedKbIds.value.filter((id) => id !== kbId);
};

const handleSave = async () => {
  if (!projectId.value) {
    return;
  }

  try {
    isSaving.value = true;
    const result =
      await projectKbLinksGateway.replaceProjectKnowledgeBaseLinks({
        projectId: projectId.value,
        kbIds: [...linkedKbIds.value]
      });

    if (!result.success) {
      notificationStore.show(workspaceMessage('workspace.projectKb.updateFailed'), 'error', 4000);
      return;
    }

    notificationStore.show(workspaceMessage('workspace.projectKb.updated'), 'success', 3000);
    // 保存成功后关闭父级概览弹窗，符合“主操作完成即退出”的交互预期
    emit('close');
  } catch (error) {
    console.error('[ProjectKbSettingsPanel] 保存关联关系失败:', error);
    notificationStore.show(workspaceMessage('workspace.projectKb.saveFailed'), 'error', 4000);
  } finally {
    isSaving.value = false;
  }
};
</script>
