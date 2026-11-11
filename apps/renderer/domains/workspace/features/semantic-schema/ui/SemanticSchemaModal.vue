<template>
  <Modal
    :is-visible="isVisible"
    :title="message('workspace.semanticSchema.title')"
    width="880px"
    max-width="92%"
    height="min(620px, 86vh)"
    max-height="86vh"
    scroll-mode="internal"
    @close="emit('close')"
  >
    <template #title-extra>
      <span class="semantic-schema-scope">{{ message('workspace.semanticSchema.scope') }}</span>
    </template>
    <div class="semantic-schema">
      <div class="semantic-schema__bar">
        <SegmentedTabs
          v-model="page"
          :tabs="tabs"
          :aria-label="message('workspace.semanticSchema.title')"
        />
        <CustomTextInput
          v-if="page !== 'history'"
          v-model="query"
          :placeholder="message(page === 'tags' ? 'workspace.semanticSchema.find.tags' : 'workspace.semanticSchema.find.fields')"
          size="compact"
          clearable
          class="semantic-schema__find"
        />
      </div>

      <p
        v-if="manager.loadFailed.value"
        class="semantic-schema-detail__error"
        role="alert"
      >
        {{ message('workspace.semanticSchema.error.load') }}
      </p>
      <p
        v-else-if="overview === null"
        class="semantic-schema-muted"
      >
        {{ message('workspace.semanticSchema.usage.loading') }}
      </p>

      <SemanticSchemaTagPane
        v-else-if="page === 'tags'"
        :tags="visibleTags"
        :all-tags="overview.tags"
        :properties="overview.properties"
        :selected="selectedTag"
        :usage="usage"
        :current-project-id="currentProjectId"
        :busy="manager.busy.value"
        :error="paneError"
        :empty-text="emptyText(overview.tags.length)"
        :context="context"
        @select="selectedTagId = $event"
        @rename="renameTag"
        @merge="startMerge"
        @delete="startDeleteTag"
        @save-fields="saveTagFields"
        @open-document="emit('open-document', $event)"
      />

      <SemanticSchemaFieldPane
        v-else-if="page === 'fields'"
        :properties="visibleProperties"
        :tags="overview.tags"
        :selected="selectedProperty"
        :usage="usage"
        :current-project-id="currentProjectId"
        :busy="manager.busy.value"
        :error="paneError"
        :pending-type="pendingType"
        :type-preview="typePreview"
        :empty-text="emptyText(overview.properties.length)"
        :context="context"
        @select="selectedPropertyId = $event"
        @rename="renameProperty"
        @preview-type="previewType"
        @apply-type="applyType"
        @cancel-type="cancelType"
        @save-options="saveOptions"
        @delete="startDeleteProperty"
        @open-document="emit('open-document', $event)"
      />

      <template v-else>
        <p
          v-if="notice"
          class="semantic-schema-notice"
          role="status"
        >
          {{ notice }}
        </p>
        <SemanticSchemaHistoryPane
          :changes="overview.changes"
          :busy="manager.busy.value"
          :errors="undoErrors"
          :context="context"
          @undo="undo"
        />
      </template>
    </div>
  </Modal>

  <AlertDialog
    :visible="confirm !== null"
    :title="confirm?.title ?? ''"
    :message="confirm?.message ?? ''"
    :sections="confirm?.sections ?? []"
    :is-confirmation="true"
    :is-dangerous-action="confirm?.dangerous ?? false"
    :confirm-text="confirm?.confirmText ?? ''"
    :cancel-text="message('workspace.semanticSchema.common.cancel')"
    width="460px"
    @confirm="runConfirm"
    @cancel="confirm = null"
    @close="confirm = null"
  />
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { useHistoryTime } from '@app/localization';
import type {
  SemanticSchemaOperation,
  SemanticSchemaOverview,
  SemanticSchemaPreview,
  SemanticSchemaUsage,
  SemanticValueTypeValue,
} from '@app/schemas';
import { AlertDialog, CustomTextInput, Modal, SegmentedTabs, type AlertDialogSection } from '@linnya/renderer-ui';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { matchesQuery, quotedNames, type SemanticSchemaTextContext } from '../functions/semanticSchemaText';
import { useSemanticSchemaManager, type SemanticSchemaFailure } from '../orchestration/useSemanticSchemaManager';
import SemanticSchemaFieldPane from './SemanticSchemaFieldPane.vue';
import SemanticSchemaHistoryPane from './SemanticSchemaHistoryPane.vue';
import SemanticSchemaTagPane from './SemanticSchemaTagPane.vue';

type Page = 'tags' | 'fields' | 'history';
type TypePreview = Extract<SemanticSchemaPreview, { kind: 'type' }>;
interface Confirm {
  readonly title: string;
  readonly message: string;
  readonly sections: readonly AlertDialogSection[];
  readonly confirmText: string;
  readonly dangerous: boolean;
  readonly operation: SemanticSchemaOperation;
}

const props = defineProps<{
  isVisible: boolean;
  currentProjectId: string | null;
  /** Agent 显示名；null 是默认 Agent，查不到时为 null。 */
  agentName: (agentId: string | null) => string | null;
}>();

const emit = defineEmits<{
  close: [];
  /** 标签或字段改了：文件页据此重读文档与保存的筛选。 */
  changed: [overview: SemanticSchemaOverview];
  'open-document': [documentId: string];
}>();

const { workspaceMessage: message } = useWorkspaceLocalization();
const { historyTime } = useHistoryTime();
const context: SemanticSchemaTextContext = {
  message,
  agentName: id => props.agentName(id),
  timeText: historyTime,
};

const manager = useSemanticSchemaManager({ onChanged: overview => emit('changed', overview) });
const overview = computed(() => manager.overview.value);
const page = ref<Page>('tags');
const query = ref('');
const selectedTagId = ref<string | null>(null);
const selectedPropertyId = ref<string | null>(null);
const usage = shallowRef<SemanticSchemaUsage | null>(null);
const paneError = ref<{ message: string; canAllowSimilar: boolean } | null>(null);
const undoErrors = ref<Record<string, string>>({});
const notice = ref<string | null>(null);
const confirm = shallowRef<Confirm | null>(null);
const pendingType = ref<SemanticValueTypeValue | null>(null);
const typePreview = shallowRef<TypePreview | null>(null);

watch(() => props.isVisible, visible => {
  if (!visible) return;
  query.value = '';
  notice.value = null;
  undoErrors.value = {};
  void manager.load();
}, { immediate: true });

const tabs = computed(() => [
  { id: 'tags', label: message('workspace.semanticSchema.tab.tags', { count: overview.value?.tags.length ?? 0 }) },
  { id: 'fields', label: message('workspace.semanticSchema.tab.fields', { count: overview.value?.properties.length ?? 0 }) },
  { id: 'history', label: message('workspace.semanticSchema.tab.history') },
]);
const visibleTags = computed(() => (overview.value?.tags ?? []).filter(tag => matchesQuery(tag.name, query.value)));
const visibleProperties = computed(() => (overview.value?.properties ?? []).filter(property => matchesQuery(property.name, query.value)));
// 选中的那一项被删掉、合并或查不到时，落到列表第一项。
const selectedTag = computed(() => visibleTags.value.find(tag => tag.id === selectedTagId.value) ?? visibleTags.value[0] ?? null);
const selectedProperty = computed(() => (
  visibleProperties.value.find(property => property.id === selectedPropertyId.value) ?? visibleProperties.value[0] ?? null
));

function emptyText(total: number): string {
  return total > 0 && query.value.trim()
    ? message('workspace.semanticSchema.empty.search', { query: query.value.trim() })
    : message(page.value === 'tags' ? 'workspace.semanticSchema.empty.tags' : 'workspace.semanticSchema.empty.fields');
}

// 换了选中项、换页或数据更新后重读“用在哪里”；迟到的旧结果丢弃。
let usageGeneration = 0;
const usageTarget = computed(() => {
  if (page.value === 'tags' && selectedTag.value) return { kind: 'tag' as const, id: selectedTag.value.id };
  if (page.value === 'fields' && selectedProperty.value) return { kind: 'property' as const, id: selectedProperty.value.id };
  return null;
});
watch([usageTarget, overview], ([target], old) => {
  if (target?.id !== old?.[0]?.id) {
    paneError.value = null;
    cancelType();
  }
  const current = ++usageGeneration;
  usage.value = null;
  if (!target) return;
  manager.usage(target.kind, target.id).then(result => {
    if (current === usageGeneration) usage.value = result;
  }).catch((error: unknown) => console.error('[SemanticSchema] 读取用在哪里失败:', error));
}, { immediate: true });

/** 名称相近时说清像谁（Backend 的说法是按新建写的）；其他错误用 Backend 的原因。 */
function failed(result: SemanticSchemaFailure): void {
  const similar = result.code === 'similar_name';
  paneError.value = {
    message: similar && result.candidates?.length
      ? message('workspace.semanticSchema.rename.similar', { names: quotedNames(result.candidates.map(candidate => candidate.name)) })
      : result.message,
    canAllowSimilar: similar,
  };
}

async function guarded(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error: unknown) {
    console.error('[SemanticSchema] 写入失败:', error);
    paneError.value = { message: message('workspace.semanticSchema.error.generic'), canAllowSimilar: false };
  }
}

async function apply(operation: SemanticSchemaOperation): Promise<boolean> {
  let done = false;
  await guarded(async () => {
    const result = await manager.apply(operation);
    if (!result.ok) failed(result);
    else {
      paneError.value = null;
      done = true;
    }
  });
  return done;
}

function renameTag(name: string, allowSimilar: boolean): void {
  const tag = selectedTag.value;
  if (tag) void apply({ op: 'rename_tag', tag: tag.id, name, allow_similar: allowSimilar });
}

function renameProperty(name: string, allowSimilar: boolean): void {
  const property = selectedProperty.value;
  if (property) void apply({ op: 'rename_property', property: property.id, name, allow_similar: allowSimilar });
}

async function saveTagFields(fieldIds: string[]): Promise<void> {
  const tag = selectedTag.value;
  if (!tag) return;
  await guarded(async () => {
    const result = await manager.setTagFields(tag.id, fieldIds);
    if (!result.ok) failed(result);
  });
}

/** 先读影响范围，再弹确认；确认后执行。 */
async function previewThen(operation: SemanticSchemaOperation, build: (preview: SemanticSchemaPreview) => Omit<Confirm, 'operation'>): Promise<void> {
  await guarded(async () => {
    const preview = await manager.preview(operation);
    if ('ok' in preview) failed(preview);
    else confirm.value = { ...build(preview), operation };
  });
}

function filterSection(preview: SemanticSchemaPreview): AlertDialogSection[] {
  return preview.saved_filters.length ? [{
    title: message('workspace.semanticSchema.section.savedFilters'),
    items: preview.saved_filters.map(filter => message('workspace.semanticSchema.confirm.filterItem', { name: filter.name, project: filter.project_name })),
  }] : [];
}

function startMerge(targetId: string): void {
  const source = selectedTag.value;
  const target = overview.value?.tags.find(tag => tag.id === targetId);
  if (!source || !target) return;
  void previewThen({ op: 'merge_tags', source: source.id, target: target.id }, preview => {
    const sections: AlertDialogSection[] = [];
    if (preview.kind === 'tag') {
      sections.push({
        title: message('workspace.semanticSchema.section.documents'),
        items: [
          preview.already_target
            ? message('workspace.semanticSchema.merge.documentsSome', { count: preview.documents, already: preview.already_target, target: target.name })
            : message('workspace.semanticSchema.merge.documents', { count: preview.documents, target: target.name }),
          message('workspace.semanticSchema.merge.valuesKept'),
        ],
      });
      if (preview.added_fields.length) {
        sections.push({
          title: message('workspace.semanticSchema.section.fields'),
          items: [message('workspace.semanticSchema.merge.addFields', { target: target.name, names: quotedNames(preview.added_fields) })],
        });
      }
    }
    return {
      title: message('workspace.semanticSchema.merge.title', { source: source.name, target: target.name }),
      message: message('workspace.semanticSchema.merge.message', { target: target.name }),
      sections: [...sections, ...filterSection(preview)],
      confirmText: message('workspace.semanticSchema.merge.confirm'),
      dangerous: false,
    };
  });
}

function startDeleteTag(): void {
  const tag = selectedTag.value;
  if (!tag) return;
  void previewThen({ op: 'delete_tag', tag: tag.id }, preview => ({
    title: message('workspace.semanticSchema.deleteTag.title', { name: tag.name }),
    message: message('workspace.semanticSchema.deleteTag.message'),
    sections: [
      ...(preview.kind === 'tag' && preview.documents
        ? [{ title: message('workspace.semanticSchema.section.documents'), items: [message('workspace.semanticSchema.deleteTag.documents', { count: preview.documents })] }]
        : []),
      ...filterSection(preview),
    ],
    confirmText: message('workspace.semanticSchema.action.delete'),
    dangerous: true,
  }));
}

function startDeleteProperty(): void {
  const property = selectedProperty.value;
  if (!property) return;
  void previewThen({ op: 'delete_property', property: property.id }, preview => ({
    title: message('workspace.semanticSchema.deleteField.title', { name: property.name }),
    message: message('workspace.semanticSchema.deleteField.message'),
    sections: filterSection(preview),
    confirmText: message('workspace.semanticSchema.action.delete'),
    dangerous: true,
  }));
}

async function runConfirm(): Promise<void> {
  const current = confirm.value;
  confirm.value = null;
  if (current) await apply(current.operation);
}

async function previewType(type: SemanticValueTypeValue): Promise<void> {
  const property = selectedProperty.value;
  if (!property) return;
  pendingType.value = type;
  typePreview.value = null;
  paneError.value = null;
  await guarded(async () => {
    const preview = await manager.preview({ op: 'change_property_type', property: property.id, value_type: type });
    if (pendingType.value !== type) return;
    if ('ok' in preview) {
      failed(preview);
      pendingType.value = null;
    } else if (preview.kind === 'type') {
      typePreview.value = preview;
    }
  });
}

function cancelType(): void {
  pendingType.value = null;
  typePreview.value = null;
}

async function applyType(): Promise<void> {
  const property = selectedProperty.value;
  const type = pendingType.value;
  if (!property || !type) return;
  if (await apply({ op: 'change_property_type', property: property.id, value_type: type })) cancelType();
}

/** 删掉的选项有文档在用或有筛选引用时先确认，否则直接保存。 */
async function saveOptions(options: { id?: string; name: string }[]): Promise<void> {
  const property = selectedProperty.value;
  if (!property) return;
  const operation: SemanticSchemaOperation = { op: 'update_options', property: property.id, options };
  await guarded(async () => {
    const preview = await manager.preview(operation);
    if ('ok' in preview) {
      failed(preview);
      return;
    }
    if (preview.kind !== 'options' || (preview.documents === 0 && preview.saved_filters.length === 0)) {
      await apply(operation);
      return;
    }
    confirm.value = {
      title: message('workspace.semanticSchema.options.confirmTitle', { names: quotedNames(preview.removed) }),
      message: message('workspace.semanticSchema.options.confirmMessage', { count: preview.documents }),
      sections: filterSection(preview),
      confirmText: message('workspace.semanticSchema.common.save'),
      dangerous: true,
      operation,
    };
  });
}

async function undo(changeId: string): Promise<void> {
  notice.value = null;
  try {
    const result = await manager.undo(changeId);
    if (!result.ok) {
      undoErrors.value = { ...undoErrors.value, [changeId]: result.message };
      return;
    }
    undoErrors.value = Object.fromEntries(Object.entries(undoErrors.value).filter(([id]) => id !== changeId));
    if (result.saved_filters_skipped) {
      notice.value = message('workspace.semanticSchema.history.skipped', { count: result.saved_filters_skipped });
    }
  } catch (error: unknown) {
    console.error('[SemanticSchema] 撤回失败:', error);
    undoErrors.value = { ...undoErrors.value, [changeId]: message('workspace.semanticSchema.error.generic') };
  }
}
</script>
