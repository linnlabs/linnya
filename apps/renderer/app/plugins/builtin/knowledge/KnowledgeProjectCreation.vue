<template>
<div class="form-row input-row">
        <label class="form-label">{{ workspaceMessage('workspace.project.modal.knowledgeBaseLabel') }}</label>
        <div class="control-area">
          <div class="kb-tag-form-group">
            <div class="tag-input-wrapper">
              <!--
                说明：
                - 这里复用“知识库创建弹窗”的交互：下拉框仅代表“待添加的知识库”，真正加入关联列表需要点右侧“+”；
                - 下拉选择也计入传给 Host 的草稿；不要求用户必须点“+”后才能提交。
              -->
              <CustomSelect
                v-model="selectedKnowledgeBaseId"
                :disabled="disabled || loading"
                :options="knowledgeBaseOptions"
                :placeholder="workspaceMessage('workspace.project.modal.knowledgeBasePlaceholder')"
                :title="workspaceMessage('workspace.project.modal.knowledgeBaseSelectTitle')"
                :usePortalToBody="true"
              >
                <template #arrow-icon="{ isOpen }">
                  <ChevronIcon
                    direction="down"
                    class="select-chevron"
                    :class="{ 'is-open': isOpen }"
                  />
                </template>
              </CustomSelect>
              <IconButton
                :label="workspaceMessage('workspace.project.modal.addKnowledgeBase')"
                size="lg"
                class="add-tag-button"
                :disabled="disabled || loading || !selectedKnowledgeBaseId"
                @click="handleAddKnowledgeBaseLink"
              >
                <AddIcon class="add-icon" />
              </IconButton>
            </div>

            <div v-if="linkedKnowledgeBases.length > 0" class="tags-list">
              <TagChip
                v-for="kb in linkedKnowledgeBases"
                :key="kb.id"
                :label="kb.name"
                closable
                @close="handleRemoveKnowledgeBaseLink(kb.id)"
              />
            </div>
          </div>
        </div>
      </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CustomSelect, IconButton, TagChip } from '@linnya/renderer-ui';
import { AddIcon, ChevronIcon } from '@linnya/renderer-ui/icons';
import { useKnowledgeBase } from '@/domains/knowledgebase/runtime.js';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { useNotificationStore } from '@/app/notification';
const props = defineProps<{ modelValue: readonly string[]; disabled: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [ids: string[]] }>();
const { workspaceMessage } = useWorkspaceLocalization();
const notifications = useNotificationStore();
const runtime = useKnowledgeBase();
const selectedKnowledgeBaseId = ref<string | null>(null);
const linkedKnowledgeBaseIds = ref<string[]>([...props.modelValue]);
const loading = ref(true);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
onMounted(async () => {
  try {
    await runtime.ensureDataLoaded();
    if (runtime.error) throw new Error(runtime.error);
  } catch (error) {
    if (!disposed) notifications.show(error instanceof Error ? error.message
      : workspaceMessage('workspace.projectKb.loadFailed'), 'error', 4000);
  } finally { if (!disposed) loading.value = false; }
});
const knowledgeBaseOptions = computed(() => runtime.knowledgeBases.map(kb => ({ value: kb.id, text: kb.name })));
const linkedKnowledgeBases = computed(() => runtime.knowledgeBases.filter(kb => linkedKnowledgeBaseIds.value.includes(kb.id)));
function handleAddKnowledgeBaseLink() {
  const id = selectedKnowledgeBaseId.value;
  if (id && !linkedKnowledgeBaseIds.value.includes(id)) linkedKnowledgeBaseIds.value = [...linkedKnowledgeBaseIds.value, id];
  selectedKnowledgeBaseId.value = null;
}
function handleRemoveKnowledgeBaseLink(id: string) {
  linkedKnowledgeBaseIds.value = linkedKnowledgeBaseIds.value.filter(value => value !== id);
}
// 保留现有语义：下拉已选但未点“+”的条目，也属于创建提交的草稿。
watch([linkedKnowledgeBaseIds, selectedKnowledgeBaseId], ([ids, pending]) => {
  emit('update:modelValue', Array.from(new Set([...ids, ...(pending ? [pending] : [])])));
}, { flush: 'sync' });
</script>
