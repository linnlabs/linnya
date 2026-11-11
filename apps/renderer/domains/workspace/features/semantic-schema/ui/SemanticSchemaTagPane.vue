<template>
  <div class="semantic-schema-split">
    <ul
      class="semantic-schema-list"
      role="listbox"
      :aria-label="message('workspace.semanticSchema.tab.tagsLabel')"
    >
      <li
        v-for="tag in tags"
        :key="tag.id"
        class="semantic-schema-list__item"
        :class="{ 'is-selected': tag.id === selected?.id }"
        role="option"
        :aria-selected="tag.id === selected?.id"
        tabindex="0"
        @click="emit('select', tag.id)"
        @keydown.enter="emit('select', tag.id)"
      >
        <span class="semantic-schema-list__name">{{ tag.name }}</span>
        <span
          v-if="tag.similar.length"
          class="semantic-schema-list__hint"
        >{{ message('workspace.semanticSchema.list.similar') }}</span>
        <span class="semantic-schema-list__meta">{{ tag.document_count }}</span>
      </li>
      <li
        v-if="tags.length === 0"
        class="semantic-schema-list__empty"
      >
        {{ emptyText }}
      </li>
    </ul>

    <div
      v-if="selected"
      class="semantic-schema-detail"
    >
      <CustomTextInput
        :model-value="draftName"
        size="compact"
        class="semantic-schema-detail__name"
        :aria-label="message('workspace.semanticSchema.tag.nameLabel')"
        :disabled="busy"
        @update:model-value="draftName = $event"
        @change-value="commitName"
        @keydown.esc.stop="draftName = selected.name"
      />
      <p class="semantic-schema-detail__origin">
        {{ tagOriginText(selected.created_by, selected.created_at, context) }}
      </p>
      <div
        v-if="error"
        class="semantic-schema-detail__error"
        role="alert"
      >
        <span>{{ error.message }}</span>
        <BaseButton
          v-if="error.canAllowSimilar"
          variant="plain"
          size="sm"
          @click="emit('rename', draftName, true)"
        >
          {{ message('workspace.semanticSchema.rename.anyway') }}
        </BaseButton>
      </div>

      <div
        v-if="similarTarget"
        class="semantic-schema-note"
      >
        <p>{{ message('workspace.semanticSchema.similar.text', { name: similarTarget.name }) }}</p>
        <BaseButton
          variant="tint"
          size="sm"
          :disabled="busy"
          @click="emit('merge', similarTarget.id)"
        >
          {{ message('workspace.semanticSchema.similar.merge', { name: similarTarget.name }) }}
        </BaseButton>
      </div>

      <h3 class="semantic-schema-heading">
        {{ message('workspace.semanticSchema.tag.fields') }}
      </h3>
      <div
        v-if="!editingFields"
        class="semantic-schema-chips"
      >
        <span
          v-for="field in tagFields"
          :key="field.id"
          class="semantic-schema-chip"
        >{{ field.name }}</span>
        <span
          v-if="tagFields.length === 0"
          class="semantic-schema-muted"
        >{{ message('workspace.semanticSchema.tag.noFields') }}</span>
        <BaseButton
          variant="plain"
          size="sm"
          :disabled="busy || editableProperties.length === 0"
          @click="startEditFields"
        >
          <template #icon>
            <EditIcon />
          </template>{{ message('workspace.semanticSchema.tag.editFields') }}
        </BaseButton>
      </div>
      <div
        v-else
        class="semantic-schema-field-picker"
      >
        <div class="semantic-schema-chips">
          <button
            v-for="property in editableProperties"
            :key="property.id"
            type="button"
            class="semantic-schema-chip semantic-schema-chip--toggle"
            :class="{ 'is-on': draftFields.includes(property.id) }"
            :aria-pressed="draftFields.includes(property.id)"
            @click="toggleField(property.id)"
          >
            {{ property.name }}
          </button>
        </div>
        <p class="semantic-schema-muted">
          {{ message('workspace.semanticSchema.tag.editFieldsHint') }}
        </p>
        <ActionButtons
          :primary-action-text="message('workspace.semanticSchema.common.save')"
          :secondary-action-text="message('workspace.semanticSchema.common.cancel')"
          secondary-variant="plain"
          :is-primary-action-disabled="busy"
          class="semantic-schema-actions-end"
          @primary-click="saveFields"
          @secondary-click="editingFields = false"
        />
      </div>

      <h3 class="semantic-schema-heading">
        {{ message('workspace.semanticSchema.usage.title') }}
        <span
          v-if="usage"
          class="semantic-schema-heading__meta"
        >{{ usageMeta }}</span>
      </h3>
      <SemanticSchemaUsageList
        :usage="usage"
        :current-project-id="currentProjectId"
        :message="message"
        @open-document="emit('open-document', $event)"
      />

      <div class="semantic-schema-detail__actions">
        <SemanticSchemaPickMenu
          :label="message('workspace.semanticSchema.action.mergeTo')"
          :options="mergeOptions"
          :disabled="busy"
          @pick="emit('merge', $event)"
        />
        <BaseButton
          variant="plain"
          size="sm"
          class="semantic-schema-danger"
          :disabled="busy"
          @click="emit('delete')"
        >
          <template #icon>
            <DeleteIcon />
          </template>{{ message('workspace.semanticSchema.action.delete') }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SemanticSchemaPropertyItem, SemanticSchemaTagItem, SemanticSchemaUsage } from '@app/schemas';
import { ActionButtons, BaseButton, CustomTextInput } from '@linnya/renderer-ui';
import { DeleteIcon, EditIcon } from '@linnya/renderer-ui/icons';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import { tagOriginText, type SemanticSchemaTextContext } from '../functions/semanticSchemaText';
import { usageMetaText } from '../functions/semanticSchemaUsage';
import SemanticSchemaPickMenu from './SemanticSchemaPickMenu.vue';
import SemanticSchemaUsageList from './SemanticSchemaUsageList.vue';

const props = defineProps<{
  tags: readonly SemanticSchemaTagItem[];
  allTags: readonly SemanticSchemaTagItem[];
  properties: readonly SemanticSchemaPropertyItem[];
  selected: SemanticSchemaTagItem | null;
  usage: SemanticSchemaUsage | null;
  currentProjectId: string | null;
  busy: boolean;
  error: { readonly message: string; readonly canAllowSimilar: boolean } | null;
  emptyText: string;
  context: SemanticSchemaTextContext;
}>();

const emit = defineEmits<{
  select: [id: string];
  rename: [name: string, allowSimilar: boolean];
  merge: [targetId: string];
  delete: [];
  'save-fields': [fieldIds: string[]];
  'open-document': [documentId: string];
}>();

const message: WorkspaceMessageResolver = (key, params) => props.context.message(key, params);

const draftName = ref('');
const editingFields = ref(false);
const draftFields = ref<string[]>([]);
watch(() => [props.selected?.id, props.selected?.name] as const, () => {
  draftName.value = props.selected?.name ?? '';
  editingFields.value = false;
}, { immediate: true });

const propertyById = computed(() => new Map(props.properties.map(property => [property.id, property])));
const tagFields = computed(() => (props.selected?.field_ids ?? []).flatMap(id => propertyById.value.get(id) ?? []));
const editableProperties = computed(() => props.properties.filter(property => property.owner_plugin_id === null));
const similarTarget = computed(() => props.selected?.similar[0] ?? null);
const mergeOptions = computed(() => props.allTags
  .filter(tag => tag.id !== props.selected?.id)
  .map(tag => ({ value: tag.id, text: tag.name })));
const usageMeta = computed(() => (props.usage ? usageMetaText(props.usage, message) : ''));

function commitName(value: string): void {
  const name = value.trim();
  if (!props.selected || !name || name === props.selected.name) {
    draftName.value = props.selected?.name ?? '';
    return;
  }
  emit('rename', name, false);
}

function startEditFields(): void {
  draftFields.value = [...(props.selected?.field_ids ?? [])];
  editingFields.value = true;
}

function toggleField(id: string): void {
  draftFields.value = draftFields.value.includes(id)
    ? draftFields.value.filter(item => item !== id)
    : [...draftFields.value, id];
}

function saveFields(): void {
  editingFields.value = false;
  emit('save-fields', draftFields.value);
}
</script>
