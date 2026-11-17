<template>
  <Modal
    :isVisible="props.show"
    :title="knowledgeBaseMessage('knowledgeBase.create.title')"
    width="520px"
    maxWidth="90vw"
    scroll-mode="content"
    :closeOnOverlayClick="!isCreating"
    :closeOnEsc="!isCreating"
    @close="handleClose"
  >
    <div class="create-kb-content">
      <!-- 知识库名称 -->
      <div class="form-row input-row">
        <label class="form-label">
          {{ knowledgeBaseMessage('knowledgeBase.create.nameLabel') }}
          <span class="required">*</span>
        </label>
        <div class="control-area">
          <input
            id="new-kb-name"
            ref="kbNameInput"
            v-model="kbName"
            class="settings-input"
            type="text"
            :placeholder="knowledgeBaseMessage('knowledgeBase.create.namePlaceholder')"
            :disabled="isCreating"
            @keyup.enter="handleConfirm"
          />
        </div>
      </div>

      <!-- 知识库描述 -->
      <div class="form-row input-row">
        <label class="form-label" for="new-kb-description">
          {{ knowledgeBaseMessage('knowledgeBase.create.descriptionLabel') }}
        </label>
        <div class="control-area">
          <textarea
            id="new-kb-description"
            v-model="kbDescription"
            class="settings-textarea"
            rows="4"
            :placeholder="knowledgeBaseMessage('knowledgeBase.create.descriptionPlaceholder')"
            :disabled="isCreating"
          ></textarea>
        </div>
      </div>

      <!-- 知识库标签 -->
      <div class="form-row input-row">
        <label class="form-label">{{ knowledgeBaseMessage('knowledgeBase.create.tagsLabel') }}</label>
        <div class="control-area">
          <div class="kb-tag-form-group">
            <div class="tag-input-wrapper">
              <input
                v-model="tagInput"
                type="text"
                :placeholder="knowledgeBaseMessage('knowledgeBase.create.tagPlaceholder')"
                class="settings-input tag-input"
                :disabled="isCreating"
                @keydown.enter.prevent="handleAddTag"
              />
              <IconButton
                :label="knowledgeBaseMessage('knowledgeBase.create.addTag')"
                size="lg"
                variant="subtle"
                class="add-tag-button"
                :disabled="isCreating || !tagInput.trim()"
                @click="handleAddTag"
              >
                <AddIcon class="add-icon" />
              </IconButton>
            </div>

            <div v-if="kbTags.length > 0" class="tags-list">
              <TagChip
                v-for="tag in kbTags"
                :key="tag"
                :label="tag"
                closable
                @close="handleRemoveTag(tag)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 关联项目 -->
      <div class="form-row input-row">
        <label class="form-label">{{ knowledgeBaseMessage('knowledgeBase.create.projectsLabel') }}</label>
        <div class="control-area">
          <div class="kb-tag-form-group">
            <div class="tag-input-wrapper">
              <!--
                说明：
                - Vue3 模板会自动“解包 ref”，所以 v-model 应该直接绑定 `selectedProjectId`（而不是 `.value`）。
                - 如果写成 `selectedProjectId.value`，模板编译后会在运行时对“已解包的值”再取 `.value`，反而容易触发 undefined 报错。
              -->
              <CustomSelect
                v-model="selectedProjectId"
                :options="projectOptions"
                :placeholder="knowledgeBaseMessage('knowledgeBase.create.projectPlaceholder')"
                :title="knowledgeBaseMessage('knowledgeBase.create.projectSelectTitle')"
                :usePortalToBody="true"
              >
                <!-- 使用通用 ChevronIcon 作为下拉箭头，右对齐并带展开/收起过渡动画 -->
                <template #arrow-icon="{ isOpen }">
                  <ChevronIcon
                    direction="down"
                    class="select-chevron"
                    :class="{ 'is-open': isOpen }"
                  />
                </template>
              </CustomSelect>
              <IconButton
                :label="knowledgeBaseMessage('knowledgeBase.create.addProject')"
                size="lg"
                variant="subtle"
                class="add-tag-button"
                :disabled="isCreating || !selectedProjectId"
                @click="handleAddProjectLink"
              >
                <AddIcon class="add-icon" />
              </IconButton>
            </div>

            <div v-if="linkedProjects.length > 0" class="tags-list">
              <TagChip
                v-for="project in linkedProjects"
                :key="project.id"
                :label="project.name"
                closable
                @close="handleRemoveProjectLink(project.id)"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>
    </div>

    <template #footer>
      <div class="create-kb-footer">
        <ActionButtons
          :secondary-action-text="knowledgeBaseMessage('knowledgeBase.common.cancel')"
          :primary-action-text="isCreating ? knowledgeBaseMessage('knowledgeBase.create.creating') : knowledgeBaseMessage('knowledgeBase.create.create')"
          :is-primary-action-disabled="isCreating || !kbName.trim()"
          @secondary-click="handleClose"
          @primary-click="handleConfirm"
        />
      </div>
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
import { useKnowledgeBase } from '../runtime.js';
import { ActionButtons, CustomSelect, IconButton, Modal, TagChip } from '@linnya/renderer-ui';
import { knowledgeBaseService } from '../services/knowledgeBaseService';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type { KnowledgeProjectSummary } from '../../shared';
import { replaceKnowledgeBaseProjects } from '../services/knowledgeProjectLinks';
import { createKnowledgeBaseSession } from '../features/create-knowledge-base/orchestration/createKnowledgeBaseSession';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';

// Props：由列表视图控制显隐
const props = defineProps<{
  show: boolean;
}>();

// 对外事件：关闭与创建完成
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'created', id: string): void;
}>();

const kbStore = useKnowledgeBase();
const projects = ref<KnowledgeProjectSummary[]>([]);
let projectLoad: AbortController | null = null;
onScopeDispose(() => projectLoad?.abort());
const creation = createKnowledgeBaseSession({
  create: input => knowledgeBaseService.createKnowledgeBase(input),
  update: (id, input) => kbStore.updateKbModelSettings(id, input),
  replaceProjects: replaceKnowledgeBaseProjects,
  refresh: () => kbStore.fetchKnowledgeBases(),
});
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

// 表单状态
const kbName = ref('');
const kbDescription = ref('');
const kbTags = ref<string[]>([]);
const tagInput = ref('');
const selectedProjectId = ref<string | null>(null);
const linkedProjectIds = ref<string[]>([]);
const isCreating = ref(false);
const errorMessage = ref<string | null>(null);

// 输入框引用，用于自动聚焦
const kbNameInput = ref<HTMLInputElement | null>(null);

// 重置表单到初始状态
const resetForm = () => {
  creation.reset();
  kbName.value = '';
  kbDescription.value = '';
  kbTags.value = [];
  tagInput.value = '';
  selectedProjectId.value = null;
  linkedProjectIds.value = [];
  errorMessage.value = null;
};

// Project 下拉选项类型
type ProjectOption = {
  value: string;
  text: string;
};

// 项目下拉选项：基于 workspaceProjectsStore 的 projects 计算
const projectOptions = computed<ProjectOption[]>(() =>
  projects.value.map((project: KnowledgeProjectSummary) => ({
    value: project.id,
    text: project.name,
  }))
);

// 已关联项目的完整对象列表，便于展示名称
const linkedProjects = computed<KnowledgeProjectSummary[]>(() =>
  linkedProjectIds.value
    .map((id) => projects.value.find((project) => project.id === id) ?? null)
    .filter((project): project is KnowledgeProjectSummary => project !== null)
);

// 项目目录失败不阻塞名称输入；请求属于本次打开，关闭后不能回写。
watch(() => props.show, async visible => {
  projectLoad?.abort();
  if (!visible) return;
  resetForm();
  const controller = new AbortController();
  projectLoad = controller;
  void knowledgeBaseService.listProjects(controller.signal).then(result => {
    if (!controller.signal.aborted) projects.value = result;
  }).catch(error => {
    if (!controller.signal.aborted) {
      console.error('[CreateKnowledgeBaseModal] 加载项目目录失败', error);
      errorMessage.value = knowledgeBaseMessage('knowledgeBase.settings.error.linkProjectsFailed');
    }
  });
  await nextTick();
  if (!controller.signal.aborted) kbNameInput.value?.focus();
});

// 关闭弹窗（处理期间禁止关闭）
const handleClose = () => {
  if (isCreating.value) {
    return;
  }
  emit('close');
};

// 新增标签
const handleAddTag = () => {
  const value = tagInput.value.trim();
  if (!value) {
    return;
  }
  if (!kbTags.value.includes(value)) {
    kbTags.value.push(value);
  }
  tagInput.value = '';
};

// 移除标签
const handleRemoveTag = (tag: string) => {
  kbTags.value = kbTags.value.filter((t) => t !== tag);
};

// 关联项目：添加一条关联
const handleAddProjectLink = () => {
  if (!selectedProjectId.value) {
    return;
  }
  if (!linkedProjectIds.value.includes(selectedProjectId.value)) {
    linkedProjectIds.value.push(selectedProjectId.value);
  }
  selectedProjectId.value = null;
};

// 关联项目：移除一条关联
const handleRemoveProjectLink = (projectId: string) => {
  linkedProjectIds.value = linkedProjectIds.value.filter((id) => id !== projectId);
};

// 提交创建请求
const handleConfirm = async () => {
  const name = kbName.value.trim();

  if (isCreating.value) {
    return;
  }

  if (!name) {
    errorMessage.value = knowledgeBaseMessage('knowledgeBase.create.error.nameRequired');
    return;
  }

  try {
    isCreating.value = true;
    errorMessage.value = null;

    /**
     * 关联项目的交互说明（重要）：
     * - 下拉框仅用于“选中一个待添加的项目”，真正加入关联列表需要点右侧“+”；
     * - 但用户很容易误以为“选中即已关联”，然后直接点击创建；
     *
     * 为避免这种 UX 误解导致“看起来关联了但实际上没写入”，这里在提交时做一次收口：
     * - 若当前仍有选中的项目（selectedProjectId），则自动并入 linkedProjectIds 一起提交。
     */
    const normalizedProjectIds: string[] = Array.from(
      new Set([
        ...linkedProjectIds.value,
        ...(selectedProjectId.value ? [selectedProjectId.value] : []),
      ])
    );

    // 同步本地状态（保证 UI 与提交内容一致）
    if (normalizedProjectIds.length !== linkedProjectIds.value.length) {
      linkedProjectIds.value = normalizedProjectIds;
    }
    selectedProjectId.value = null;

    /**
     * 标签的交互说明（重要）：
     * - 输入框仅代表“待添加的标签”，真正加入列表需要按回车或点“+”；
     * - 用户很容易误以为“输入了就算添加”，然后直接点击创建；
     *
     * 这里同样在提交时做一次收口，确保创建后能在设置页看到标签。
     */
    const normalizedTags: string[] = Array.from(
      new Set([
        ...kbTags.value.map((t) => t.trim()).filter((t) => t.length > 0),
        ...(tagInput.value.trim().length > 0 ? [tagInput.value.trim()] : []),
      ])
    );

    // 同步本地状态（保证 UI 与提交内容一致）
    if (normalizedTags.length !== kbTags.value.length) {
      kbTags.value = normalizedTags;
    }
    tagInput.value = '';

    const id = await creation.save({
      name, description: kbDescription.value.trim(), tags: normalizedTags, projectIds: normalizedProjectIds,
    });
    kbStore.setCurrentKnowledgeBase(id);
    emit('created', id);
    emit('close');
  } catch (err: unknown) {
    errorMessage.value = knowledgeBaseMessage('knowledgeBase.create.error.createFailed');
    console.error('[CreateKnowledgeBaseModal] 创建知识库失败:', err);
  } finally {
    isCreating.value = false;
  }
};
</script>
