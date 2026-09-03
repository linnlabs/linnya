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
              <button
                type="button"
                class="add-tag-button"
                :disabled="isCreating || !tagInput.trim()"
                @click="handleAddTag"
              >
                <AddIcon class="add-icon" />
              </button>
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
              <button
                type="button"
                class="add-tag-button"
                :disabled="isCreating || !selectedProjectId"
                @click="handleAddProjectLink"
              >
                <AddIcon class="add-icon" />
              </button>
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
import { computed, nextTick, ref, watch } from 'vue';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { ActionButtons, CustomSelect, Modal, TagChip } from '@linnya/renderer-ui';
import { knowledgeBaseService } from '../services/knowledgeBaseService.js';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useWorkspaceProjectsStore } from '@/domains/workspace/store/WorkspaceProjectsStore';
import type { Project } from '@/domains/workspace/store';
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
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

// 与后端返回结构对齐的轻量类型
type KnowledgeBaseItem = {
  id: string;
  name: string;
  description?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeCreatedKnowledgeBase(value: unknown): KnowledgeBaseItem | null {
  if (!isRecord(value)) return null;

  const source = value.knowledge_base;
  if (!isRecord(source)) return null;

  const id = typeof source.id === 'string' ? source.id : null;
  const name = typeof source.name === 'string' ? source.name : null;
  if (!id || !name) return null;

  const description = typeof source.description === 'string' ? source.description : undefined;
  return { id, name, description };
}

const kbStore = useKnowledgeBaseStore();
const workspaceProjectsStore = useWorkspaceProjectsStore();
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
  workspaceProjectsStore.projects.map((project: Project) => ({
    value: project.id,
    text: project.name,
  }))
);

// 已关联项目的完整对象列表，便于展示名称
const linkedProjects = computed<Project[]>(() =>
  linkedProjectIds.value
    .map((id) => workspaceProjectsStore.projects.find((project) => project.id === id) ?? null)
    .filter((project): project is Project => project !== null)
);

// 监听显示状态，打开时重置表单并聚焦名称输入框
watch(
  () => props.show,
  async (visible) => {
    if (visible) {
      resetForm();
      // 打开弹窗时，确保已经加载项目列表
      if (workspaceProjectsStore.projects.length === 0 && !workspaceProjectsStore.isLoading) {
        try {
          await workspaceProjectsStore.loadProjects();
        } catch (error) {
          console.error('[CreateKnowledgeBaseModal] 加载项目列表失败:', error);
        }
      }
      await nextTick();
      if (kbNameInput.value) {
        kbNameInput.value.focus();
      }
    }
  }
);

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

    const payload: { name: string; description?: string } = {
      name
    };

    if (kbDescription.value.trim()) {
      payload.description = kbDescription.value.trim();
    }

    // 统一入口：knowledgeBaseService 在 Electron 环境会优先走 IPC，在 Web 环境回退到 HTTP
    const response = await knowledgeBaseService.createKnowledgeBase(payload);
    const createdKb = normalizeCreatedKnowledgeBase(response);

    // 重新拉取列表，确保状态一致
    await kbStore.fetchKnowledgeBases();

    // 如果创建成功并拿到了ID，则选中新建的知识库
    if (createdKb && createdKb.id) {
      const kbId = createdKb.id;

      // ✅ 先将「创建弹窗内添加的标签」写入后端（落库到 knowledge_bases.tags_json）
      // 说明：
      // - 设置页读取标签来源于后端返回的 tags 字段（由 tags_json 反序列化而来）；
      // - 过去创建时未写入标签，导致进入后“看起来标签丢了”；
      // - 这里复用统一的 settings 更新通道（IPC/HTTP 均可用）。
      if (normalizedTags.length > 0) {
        try {
          await kbStore.updateKbModelSettings(kbId, {
            tags: [...normalizedTags],
          });
        } catch (error) {
          console.error('[CreateKnowledgeBaseModal] 更新新建知识库标签失败:', error);
          errorMessage.value = knowledgeBaseMessage('knowledgeBase.create.error.saveTagsFailed');
          // 关键：标签写入失败时不关闭弹窗，避免用户误以为已保存
          return;
        }
      }

      // ✅ 再将「创建弹窗内选择的关联项目」写入后端
      //    - 这里直接复用知识库设置页中的统一 IPC Gateway
      //    - 使用 replaceKnowledgeBaseProjectLinks 进行“整体替换”，保证状态一致
      try {
        const linkResult =
          await projectKbLinksGateway.replaceKnowledgeBaseProjectLinks({
            kbId,
            projectIds: [...normalizedProjectIds],
          });

        if (!linkResult.success) {
          errorMessage.value = knowledgeBaseMessage('knowledgeBase.create.error.linkProjectsFailed');
          console.error('[CreateKnowledgeBaseModal] 更新新建知识库关联项目失败:', linkResult.error);

          // 关键：关联失败时不关闭弹窗、不继续走 created/close，避免“看起来成功但其实没关联”
          return;
        }
      } catch (error) {
        console.error(
          '[CreateKnowledgeBaseModal] 调用项目-知识库关联 IPC 失败:',
          error,
        );
        // 关键：IPC 调用异常同样需要提示用户，并阻止关闭
        errorMessage.value = knowledgeBaseMessage('knowledgeBase.create.error.linkProjectsIpcFailed');
        return;
      }

      /**
       * 关键时序修复：
       * - 如果先 setCurrentKnowledgeBase，会触发页面切换到“知识库详情/设置页”
       * - 设置页会立即拉取一次已关联项目/标签（此时写入还没完成），从而显示“未关联/无标签”
       * - 且 selectedKbId 不变时不会自动再次加载，导致用户误以为关联没生效
       *
       * 因此：必须在“标签/关联写入成功后”再切换当前知识库。
       */
      kbStore.setCurrentKnowledgeBase(kbId);

      emit('created', kbId);
    } else {
      emit('created', '');
    }

    handleClose();
  } catch (err: unknown) {
    errorMessage.value = knowledgeBaseMessage('knowledgeBase.create.error.createFailed');
    console.error('[CreateKnowledgeBaseModal] 创建知识库失败:', err);
  } finally {
    isCreating.value = false;
  }
};
</script>
