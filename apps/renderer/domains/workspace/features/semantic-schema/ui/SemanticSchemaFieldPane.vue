<template>
  <div class="semantic-schema-split">
    <ul
      class="semantic-schema-list"
      role="listbox"
      :aria-label="message('workspace.semanticSchema.tab.fieldsLabel')"
    >
      <li
        v-for="property in properties"
        :key="property.id"
        class="semantic-schema-list__item"
        :class="{ 'is-selected': property.id === selected?.id }"
        role="option"
        :aria-selected="property.id === selected?.id"
        tabindex="0"
        @click="emit('select', property.id)"
        @keydown.enter="emit('select', property.id)"
      >
        <span class="semantic-schema-list__name">{{ property.name }}</span>
        <span class="semantic-schema-list__meta">{{ valueTypeLabel(property.value_type, message) }}</span>
      </li>
      <li
        v-if="properties.length === 0"
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
        :aria-label="message('workspace.semanticSchema.field.nameLabel')"
        :disabled="busy || readonly"
        @update:model-value="draftName = $event"
        @change-value="commitName"
        @keydown.esc.stop="draftName = selected.name"
      />
      <p class="semantic-schema-detail__origin">
        {{ originText }}
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
      <p
        v-if="readonly"
        class="semantic-schema-muted"
      >
        {{ message('workspace.semanticSchema.field.plugin') }}
      </p>

      <h3 class="semantic-schema-heading">
        {{ message('workspace.semanticSchema.field.type') }}
      </h3>
      <div class="semantic-schema-type">
        <CustomSelect
          :model-value="pendingType ?? selected.value_type"
          :options="typeOptions"
          :disabled="busy || readonly"
          class="semantic-schema-type__select"
          @update:model-value="chooseType"
        />
        <span
          v-if="pendingType"
          class="semantic-schema-muted"
        >
          {{ message('workspace.semanticSchema.field.wasType', { type: valueTypeLabel(selected.value_type, message) }) }}
        </span>
      </div>

      <div
        v-if="pendingType"
        class="semantic-schema-note semantic-schema-note--block"
      >
        <p
          v-if="typePreview === null"
          class="semantic-schema-muted"
        >
          {{ message('workspace.semanticSchema.usage.loading') }}
        </p>
        <template v-else-if="typePreview.total === 0">
          <p class="semantic-schema-note__title">
            {{ message('workspace.semanticSchema.convert.empty') }}
          </p>
        </template>
        <template v-else>
          <p class="semantic-schema-note__title">
            {{ message('workspace.semanticSchema.convert.title', { type: valueTypeLabel(pendingType, message), count: typePreview.total }) }}
          </p>
          <div class="semantic-schema-convert">
            <div
              v-for="row in convertRows"
              :key="row.key"
              class="semantic-schema-convert__row"
              :class="{ 'is-zero': row.count === 0 }"
            >
              <span class="semantic-schema-convert__count">{{ message('workspace.semanticSchema.convert.count', { count: row.count }) }}</span>
              <span>{{ row.label }}</span>
              <span class="semantic-schema-convert__samples">{{ row.samples || '—' }}</span>
            </div>
          </div>
        </template>
        <p
          v-if="typePreview && typePreview.to_options.length"
          class="semantic-schema-note__hint"
        >
          {{ message('workspace.semanticSchema.convert.options', { names: quotedNames(typePreview.to_options.map(option => option.name)) }) }}
        </p>
        <p
          v-if="typePreview && typePreview.failed + typePreview.emptied > 0"
          class="semantic-schema-note__hint"
        >
          {{ message('workspace.semanticSchema.convert.note', { count: typePreview.failed + typePreview.emptied }) }}
        </p>
        <p
          v-if="typePreview && typePreview.saved_filters.length"
          class="semantic-schema-note__hint"
        >
          {{ message('workspace.semanticSchema.convert.filters', { names: quotedNames(typePreview.saved_filters.map(filter => filter.name)) }) }}
        </p>
        <ActionButtons
          :primary-action-text="message('workspace.semanticSchema.convert.apply')"
          :secondary-action-text="message('workspace.semanticSchema.common.cancel')"
          secondary-variant="plain"
          :is-primary-action-disabled="busy || typePreview === null"
          class="semantic-schema-actions-end"
          @primary-click="emit('apply-type')"
          @secondary-click="emit('cancel-type')"
        />
      </div>

      <template v-if="hasOptions && !pendingType">
        <h3 class="semantic-schema-heading">
          {{ message('workspace.semanticSchema.options.title') }}
        </h3>
        <div class="semantic-schema-options">
          <div
            v-for="(option, index) in draftOptions"
            :key="option.key"
            class="semantic-schema-options__row"
          >
            <CustomTextInput
              :model-value="option.name"
              size="compact"
              class="semantic-schema-options__input"
              :placeholder="message('workspace.semanticSchema.options.placeholder')"
              :disabled="busy || readonly"
              @update:model-value="option.name = $event"
            />
            <button
              type="button"
              class="semantic-schema-icon-button"
              :aria-label="message('workspace.semanticSchema.options.moveUp')"
              :data-linnya-tooltip="message('workspace.semanticSchema.options.moveUp')"
              :disabled="busy || readonly || index === 0"
              @click="move(index, -1)"
            >
              <ChevronIcon class="semantic-schema-icon-button__up" />
            </button>
            <button
              type="button"
              class="semantic-schema-icon-button"
              :aria-label="message('workspace.semanticSchema.options.moveDown')"
              :data-linnya-tooltip="message('workspace.semanticSchema.options.moveDown')"
              :disabled="busy || readonly || index === draftOptions.length - 1"
              @click="move(index, 1)"
            >
              <ChevronIcon />
            </button>
            <button
              type="button"
              class="semantic-schema-icon-button"
              :aria-label="message('workspace.semanticSchema.options.remove')"
              :data-linnya-tooltip="message('workspace.semanticSchema.options.remove')"
              :disabled="busy || readonly || draftOptions.length === 1"
              @click="draftOptions.splice(index, 1)"
            >
              <CloseIcon />
            </button>
          </div>
          <div class="semantic-schema-options__footer">
            <BaseButton
              variant="plain"
              size="sm"
              :disabled="busy || readonly"
              @click="addOption"
            >
              <template #icon>
                <AddIcon />
              </template>{{ message('workspace.semanticSchema.options.add') }}
            </BaseButton>
            <ActionButtons
              v-if="optionsChanged"
              :primary-action-text="message('workspace.semanticSchema.options.save')"
              :secondary-action-text="message('workspace.semanticSchema.options.reset')"
              secondary-variant="plain"
              :is-primary-action-disabled="busy || !optionsValid"
              @primary-click="saveOptions"
              @secondary-click="resetOptions"
            />
          </div>
        </div>
      </template>

      <h3 class="semantic-schema-heading">
        {{ message('workspace.semanticSchema.usage.title') }}
        <span
          v-if="usage"
          class="semantic-schema-heading__meta"
        >{{ usageMetaText(usage, message) }}</span>
      </h3>
      <SemanticSchemaUsageList
        :usage="usage"
        :current-project-id="currentProjectId"
        :message="message"
        @open-document="emit('open-document', $event)"
      />

      <div class="semantic-schema-detail__actions">
        <BaseButton
          variant="plain"
          size="sm"
          class="semantic-schema-danger"
          :disabled="busy || readonly"
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
import type {
  SemanticSchemaPreview,
  SemanticSchemaPropertyItem,
  SemanticSchemaTagItem,
  SemanticSchemaUsage,
  SemanticValueTypeValue,
} from '@app/schemas';
import { ActionButtons, BaseButton, CustomSelect, CustomTextInput } from '@linnya/renderer-ui';
import { AddIcon, ChevronIcon, CloseIcon, DeleteIcon } from '@linnya/renderer-ui/icons';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import {
  quotedNames,
  SEMANTIC_VALUE_TYPE_ORDER,
  valueTypeLabel,
  type SemanticSchemaTextContext,
} from '../functions/semanticSchemaText';
import { usageMetaText } from '../functions/semanticSchemaUsage';
import SemanticSchemaUsageList from './SemanticSchemaUsageList.vue';

type TypePreview = Extract<SemanticSchemaPreview, { kind: 'type' }>;
interface DraftOption { key: string; id: string | null; name: string }

const props = defineProps<{
  properties: readonly SemanticSchemaPropertyItem[];
  tags: readonly SemanticSchemaTagItem[];
  selected: SemanticSchemaPropertyItem | null;
  usage: SemanticSchemaUsage | null;
  currentProjectId: string | null;
  busy: boolean;
  error: { readonly message: string; readonly canAllowSimilar: boolean } | null;
  pendingType: SemanticValueTypeValue | null;
  typePreview: TypePreview | null;
  emptyText: string;
  context: SemanticSchemaTextContext;
}>();

const emit = defineEmits<{
  select: [id: string];
  rename: [name: string, allowSimilar: boolean];
  'preview-type': [type: SemanticValueTypeValue];
  'apply-type': [];
  'cancel-type': [];
  'save-options': [options: { id?: string; name: string }[]];
  delete: [];
  'open-document': [documentId: string];
}>();

const message: WorkspaceMessageResolver = (key, params) => props.context.message(key, params);

const draftName = ref('');
const draftOptions = ref<DraftOption[]>([]);
let nextKey = 0;

function resetOptions(): void {
  draftOptions.value = (props.selected?.options ?? []).map(option => ({ key: `o${nextKey++}`, id: option.id, name: option.name }));
}

watch(() => props.selected, (current, previous) => {
  if (current?.id !== previous?.id || current?.name !== previous?.name) draftName.value = current?.name ?? '';
  resetOptions();
}, { immediate: true });

const readonly = computed(() => props.selected?.owner_plugin_id !== null);
const hasOptions = computed(() => props.selected?.value_type === 'select' || props.selected?.value_type === 'multi_select');
const typeOptions = computed(() => SEMANTIC_VALUE_TYPE_ORDER.map(type => ({ value: type, text: valueTypeLabel(type, message) })));
const originText = computed(() => {
  if (!props.selected) return '';
  const names = props.tags.filter(tag => props.selected?.tag_ids.includes(tag.id)).map(tag => tag.name);
  return [
    names.length
      ? message('workspace.semanticSchema.field.usedBy', { names: quotedNames(names) })
      : message('workspace.semanticSchema.field.usedByNone'),
    message('workspace.semanticSchema.field.filled', { count: props.selected.document_count }),
  ].join(' · ');
});

const convertRows = computed(() => {
  const preview = props.typePreview;
  if (!preview) return [];
  const converted = preview.samples.converted.map(sample => `“${sample.from}” → ${sample.to ?? ''}`).join('，');
  const unconverted = (list: TypePreview['samples']['failed']) => list
    .map(sample => `“${sample.from}”（${sample.document.title}）`).join('、');
  return [
    { key: 'converted', count: preview.converted, label: message('workspace.semanticSchema.convert.converted'), samples: converted },
    { key: 'failed', count: preview.failed, label: message('workspace.semanticSchema.convert.failed'), samples: unconverted(preview.samples.failed) },
    { key: 'emptied', count: preview.emptied, label: message('workspace.semanticSchema.convert.emptied'), samples: unconverted(preview.samples.emptied) },
  ];
});

const optionsChanged = computed(() => JSON.stringify(draftOptions.value.map(option => [option.id, option.name.trim()]))
  !== JSON.stringify((props.selected?.options ?? []).map(option => [option.id, option.name])));
const optionsValid = computed(() => {
  const names = draftOptions.value.map(option => option.name.normalize('NFKC').trim().toLowerCase());
  return names.length > 0 && names.every(Boolean) && new Set(names).size === names.length;
});

function commitName(value: string): void {
  const name = value.trim();
  if (!props.selected || !name || name === props.selected.name) {
    draftName.value = props.selected?.name ?? '';
    return;
  }
  emit('rename', name, false);
}

function chooseType(value: string | null): void {
  const type = SEMANTIC_VALUE_TYPE_ORDER.find(item => item === value);
  if (!type || !props.selected) return;
  if (type === props.selected.value_type) emit('cancel-type');
  else emit('preview-type', type);
}

function move(index: number, offset: -1 | 1): void {
  const list = [...draftOptions.value];
  const [item] = list.splice(index, 1);
  list.splice(index + offset, 0, item);
  draftOptions.value = list;
}

function addOption(): void {
  draftOptions.value = [...draftOptions.value, { key: `o${nextKey++}`, id: null, name: '' }];
}

function saveOptions(): void {
  emit('save-options', draftOptions.value.map(option => (option.id === null
    ? { name: option.name.trim() }
    : { id: option.id, name: option.name.trim() })));
}
</script>
