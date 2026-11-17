<template>
  <section class="project-kb-section">
    <div class="project-kb-header">
      <div class="header-text">
        <h2 class="header-title">
          <LibraryIcon class="header-title-icon" />
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
            <SkeletonRows
              v-if="isLoading"
              class="kb-list-skeleton"
              :label="workspaceMessage('workspace.projectKb.loadingLinks')"
              :rows="2"
              size="lg"
            />
            <div v-else-if="loadError" class="column-empty">{{ loadError }}</div>
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
                <BaseButton
                  variant="plain"
                  tone="danger"
                  :title="workspaceMessage('workspace.projectKb.unlinkTitle')"
                  @click="unlinkKnowledgeBase(kb.id)"
                >
                  {{ workspaceMessage('workspace.projectKb.unlink') }}
                </BaseButton>
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
            <SkeletonRows
              v-if="isLoading"
              class="kb-list-skeleton"
              :label="workspaceMessage('workspace.projectKb.loadingKnowledgeBases')"
              :rows="2"
              size="lg"
            />
            <div v-else-if="loadError" class="column-empty">{{ loadError }}</div>
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
                <BaseButton
                  variant="plain"
                  :title="workspaceMessage('workspace.projectKb.linkTitle')"
                  @click="linkKnowledgeBase(kb.id)"
                >
                  {{ workspaceMessage('workspace.projectKb.link') }}
                </BaseButton>
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
        :is-primary-action-disabled="!projectId || isSaving || !linksLoaded"
        :show-secondary-action="false"
        @primary-click="handleSave"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue';
import { ActionButtons, BaseButton, SkeletonRows } from '@linnya/renderer-ui';
import { LibraryIcon } from '@linnya/renderer-ui/icons';
import { useKnowledgeBase } from '@/domains/knowledgebase/runtime.js';
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
import { useNotificationStore } from '@/app/notification';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { createProjectAssociationSession } from './orchestration/projectAssociationSession';

const props = defineProps<{
  projectId: string;
  projectName?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const kbStore = useKnowledgeBase();
const notificationStore = useNotificationStore();
const { workspaceMessage } = useWorkspaceLocalization();

// 当前项目 ID 的只读映射，方便模板使用
const projectId = computed(() => props.projectId);

const session = createProjectAssociationSession(props.projectId, {
  loadCatalog: () => kbStore.ensureDataLoaded(),
  async readLinks(projectId) {
    const result = await projectKbLinksGateway.listKnowledgeBaseIdsForProject({ projectId });
    if (!result.success || !result.data) throw new Error(workspaceMessage('workspace.projectKb.loadFailed'));
    return result.data;
  },
  async replaceLinks(projectId, kbIds) {
    const result = await projectKbLinksGateway.replaceProjectKnowledgeBaseLinks({ projectId, kbIds });
    if (!result.success) throw new Error(workspaceMessage('workspace.projectKb.updateFailed'));
  },
  loadFailed: () => notificationStore.show(workspaceMessage('workspace.projectKb.loadFailed'), 'error', 4000),
  saveFailed: () => notificationStore.show(workspaceMessage('workspace.projectKb.saveFailed'), 'error', 4000),
  saved() {
    notificationStore.show(workspaceMessage('workspace.projectKb.updated'), 'success', 3000);
    emit('close');
  },
});
const linkedKbIds = session.linkedIds;
const isSaving = session.saving;
const isLoading = computed(() => session.status.value === 'loading');
const linksLoaded = computed(() => session.status.value === 'ready');
const loadError = computed(() => session.status.value === 'failed' ? workspaceMessage('workspace.projectKb.loadFailed') : '');
const linkKnowledgeBase = session.link;
const unlinkKnowledgeBase = session.unlink;
const handleSave = session.save;
onMounted(session.load);
onBeforeUnmount(session.dispose);

const knowledgeBases = computed(() => {
  return kbStore.knowledgeBases;
});

const linkedKnowledgeBases = computed(() =>
  knowledgeBases.value.filter((kb) => linkedKbIds.value.includes(kb.id))
);

const availableKnowledgeBases = computed(() =>
  knowledgeBases.value.filter((kb) => !linkedKbIds.value.includes(kb.id))
);

</script>
