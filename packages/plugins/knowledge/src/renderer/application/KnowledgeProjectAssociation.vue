<template>
  <section class="project-kb-section">
    <div class="project-kb-header">
      <div class="header-text">
        <h2 class="header-title">
          <LibraryIcon class="header-title-icon" />
          <span>{{ knowledgeBaseMessage('knowledgeBase.projectAssociation.title') }}</span>
        </h2>
        <p class="header-subtitle">
          {{ knowledgeBaseMessage('knowledgeBase.projectAssociation.subtitle') }}
        </p>
      </div>
    </div>

    <div class="project-kb-body">
      <div class="columns">
        <!-- 左侧：已关联知识库 -->
        <div class="column-wrapper">
          <div class="column-header">
            <span class="column-title">{{ knowledgeBaseMessage('knowledgeBase.projectAssociation.linkedTitle') }}</span>
            <span class="column-meta">
              {{ knowledgeBaseMessage('knowledgeBase.projectAssociation.count', { count: linkedKnowledgeBases.length }) }}
            </span>
          </div>
          <div class="column" data-linnya-scrollbar="medium">
            <SkeletonRows
              v-if="isLoading"
              class="kb-list-skeleton"
              :label="knowledgeBaseMessage('knowledgeBase.projectAssociation.loadingLinks')"
              :rows="2"
              size="lg"
            />
            <div v-else-if="loadError" class="column-empty">{{ loadError }}</div>
            <div v-else-if="linkedKnowledgeBases.length === 0" class="column-empty">
              {{ knowledgeBaseMessage('knowledgeBase.projectAssociation.emptyLinked') }}
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
                  :title="knowledgeBaseMessage('knowledgeBase.projectAssociation.unlinkTitle')"
                  @click="unlinkKnowledgeBase(kb.id)"
                >
                  {{ knowledgeBaseMessage('knowledgeBase.projectAssociation.unlink') }}
                </BaseButton>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧：可关联知识库 -->
        <div class="column-wrapper">
          <div class="column-header">
            <span class="column-title">{{ knowledgeBaseMessage('knowledgeBase.projectAssociation.availableTitle') }}</span>
            <span class="column-meta">
              {{ knowledgeBaseMessage('knowledgeBase.projectAssociation.count', { count: availableKnowledgeBases.length }) }}
            </span>
          </div>
          <div class="column" data-linnya-scrollbar="medium">
            <SkeletonRows
              v-if="isLoading"
              class="kb-list-skeleton"
              :label="knowledgeBaseMessage('knowledgeBase.projectAssociation.loadingKnowledgeBases')"
              :rows="2"
              size="lg"
            />
            <div v-else-if="loadError" class="column-empty">{{ loadError }}</div>
            <div v-else-if="availableKnowledgeBases.length === 0" class="column-empty">
              {{ knowledgeBaseMessage('knowledgeBase.projectAssociation.emptyAvailable') }}
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
                  :title="knowledgeBaseMessage('knowledgeBase.projectAssociation.linkTitle')"
                  @click="linkKnowledgeBase(kb.id)"
                >
                  {{ knowledgeBaseMessage('knowledgeBase.projectAssociation.link') }}
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
        :primary-action-text="isSaving ? knowledgeBaseMessage('knowledgeBase.projectAssociation.saving') : knowledgeBaseMessage('knowledgeBase.projectAssociation.save')"
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
import { useKnowledgeBase } from '../runtime.js';
import { readProjectKnowledgeBaseIds, replaceProjectKnowledgeBases } from '../services/knowledgeProjectLinks';
import { showWorkspaceNotification } from '@plugin/renderer/workspaceRuntime';
import { useKnowledgeBaseLocalization } from '../ui/useKnowledgeBaseLocalization';
import { createProjectAssociationSession } from './orchestration/projectAssociationSession';

const props = defineProps<{
  projectId: string;
  projectName?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const kbStore = useKnowledgeBase();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

// 当前项目 ID 的只读映射，方便模板使用
const projectId = computed(() => props.projectId);

const session = createProjectAssociationSession(props.projectId, {
  loadCatalog: () => kbStore.ensureDataLoaded(),
  readLinks: readProjectKnowledgeBaseIds,
  replaceLinks: replaceProjectKnowledgeBases,
  loadFailed: () => showWorkspaceNotification(knowledgeBaseMessage('knowledgeBase.projectAssociation.loadFailed'), 'error', 4000),
  saveFailed: () => showWorkspaceNotification(knowledgeBaseMessage('knowledgeBase.projectAssociation.saveFailed'), 'error', 4000),
  saved() {
    showWorkspaceNotification(knowledgeBaseMessage('knowledgeBase.projectAssociation.updated'), 'success', 3000);
    emit('close');
  },
});
const linkedKbIds = session.linkedIds;
const isSaving = session.saving;
const isLoading = computed(() => session.status.value === 'loading');
const linksLoaded = computed(() => session.status.value === 'ready');
const loadError = computed(() => session.status.value === 'failed' ? knowledgeBaseMessage('knowledgeBase.projectAssociation.loadFailed') : '');
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
