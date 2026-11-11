<template>
  <div class="semantic-schema-usage">
    <p
      v-if="usage === null"
      class="semantic-schema-muted"
    >
      {{ message('workspace.semanticSchema.usage.loading') }}
    </p>
    <template v-else>
      <p
        v-if="usage.documents.length === 0 && usage.saved_filters.length === 0"
        class="semantic-schema-muted"
      >
        {{ message('workspace.semanticSchema.usage.none') }}
      </p>
      <template
        v-for="group in groups"
        :key="group.project.id"
      >
        <p class="semantic-schema-usage__group">
          {{ group.project.name }}<span>{{ group.project.document_count }}</span>
        </p>
        <button
          v-for="document in group.documents"
          :key="document.id"
          type="button"
          class="semantic-schema-usage__doc"
          :disabled="document.project_id !== currentProjectId"
          :data-linnya-tooltip="document.project_id !== currentProjectId ? message('workspace.semanticSchema.usage.otherProject') : undefined"
          @click="emit('open-document', document.id)"
        >
          <DocumentTextIcon class="semantic-schema-usage__icon" />
          <span class="semantic-schema-usage__title">{{ document.title }}</span>
        </button>
      </template>
      <p
        v-if="truncated"
        class="semantic-schema-muted"
      >
        {{ message('workspace.semanticSchema.usage.truncated', { count: usage.documents.length }) }}
      </p>
      <template v-if="usage.saved_filters.length">
        <p class="semantic-schema-usage__group">
          {{ message('workspace.semanticSchema.usage.savedFilters') }}
        </p>
        <p
          v-for="filter in usage.saved_filters"
          :key="filter.id"
          class="semantic-schema-usage__filter"
        >
          {{ filter.name }}
          <span>{{ filter.project_name }} · {{ message(filter.layout === 'board' ? 'workspace.semanticSchema.usage.board' : 'workspace.semanticSchema.usage.table') }}</span>
        </p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SemanticSchemaUsage } from '@app/schemas';
import { DocumentTextIcon } from '@linnya/renderer-ui/icons';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import { groupUsageDocuments } from '../functions/semanticSchemaUsage';

/** 用在哪里：按项目分组的文档（当前项目的可以打开）和引用它的保存的筛选。 */
const props = defineProps<{
  usage: SemanticSchemaUsage | null;
  currentProjectId: string | null;
  message: WorkspaceMessageResolver;
}>();

const emit = defineEmits<{ 'open-document': [documentId: string] }>();

const groups = computed(() => (props.usage ? groupUsageDocuments(props.usage) : []));
const truncated = computed(() => (props.usage
  ? props.usage.projects.reduce((sum, project) => sum + project.document_count, 0) > props.usage.documents.length
  : false));
</script>
