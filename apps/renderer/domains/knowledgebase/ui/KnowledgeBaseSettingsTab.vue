<template>
  <div class="settings-tab-content kb-settings-tab">
    <!-- 顶部基础信息：名称 / 描述 / 标签 -->
    <div class="section-divider-bottom">
      <div class="section-header-row">
        <h3 class="section-title-with-icon">
          {{ knowledgeBaseMessage('knowledgeBase.settings.basicInfo') }}
        </h3>
        <!-- 使用通用 ActionButtons 组件承载“保存”操作，保持全局交互一致 -->
        <ActionButtons
          :primary-action-text="isSaving ? knowledgeBaseMessage('knowledgeBase.settings.saving') : knowledgeBaseMessage('knowledgeBase.settings.save')"
          :is-primary-action-disabled="!currentKb || isSaving"
          :show-secondary-action="false"
          @primary-click="handleSaveBasicInfo"
        />
      </div>

      <!-- 知识库名称 -->
      <div class="form-row">
        <div class="label-area">
          <label class="form-label" for="kb-name">
            {{ knowledgeBaseMessage('knowledgeBase.settings.nameLabel') }}
          </label>
        </div>
        <div class="control-area">
          <input
            id="kb-name"
            v-model="localName"
            class="settings-input"
            type="text"
            :placeholder="knowledgeBaseMessage('knowledgeBase.settings.namePlaceholder')"
          />
        </div>
      </div>

      <!-- 知识库描述（可选，文案精简） -->
      <div class="form-row">
        <div class="label-area">
          <label class="form-label" for="kb-description">
            {{ knowledgeBaseMessage('knowledgeBase.settings.descriptionLabel') }}
          </label>
        </div>
        <div class="control-area">
          <textarea
            id="kb-description"
            v-model="localDescription"
            class="settings-textarea no-resize"
            rows="3"
            :placeholder="knowledgeBaseMessage('knowledgeBase.settings.descriptionPlaceholder')"
            v-autoresize
          />
        </div>
      </div>

      <!-- 知识库标签 -->
      <div class="form-row">
        <div class="label-area">
          <label class="form-label">{{ knowledgeBaseMessage('knowledgeBase.settings.tagsLabel') }}</label>
        </div>
        <div class="control-area">
          <div class="tags-input-row">
            <div class="kb-tag-form-group">
              <!-- 标签输入 + 添加按钮，复用 CreateKnowledgeBaseModal 的交互样式 -->
              <div class="tag-input-wrapper">
                <input
                  v-model="newTag"
                  class="settings-input tag-input"
                  type="text"
                  :placeholder="knowledgeBaseMessage('knowledgeBase.settings.tagPlaceholder')"
                  @keydown.enter.prevent="handleAddTag"
                />
                <button
                  type="button"
                  class="add-tag-button"
                  :disabled="!newTag.trim()"
                  @click="handleAddTag"
                >
                  <AddIcon class="add-icon" />
                </button>
              </div>

              <!-- 标签列表：使用通用 TagChip，与创建知识库弹窗保持一致 -->
              <div v-if="localTags.length > 0" class="tags-list">
                <TagChip
                  v-for="tag in localTags"
                  :key="tag"
                  :label="tag"
                  closable
                  @close="removeTag(tag)"
                />
              </div>
              <span v-else class="tag-empty-text">
                {{ knowledgeBaseMessage('knowledgeBase.settings.noTags') }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 关联项目区域：左右两栏布局，左侧已关联项目，右侧可关联项目 -->
    <div class="section-divider-bottom project-section">
      <div class="section-header-row">
        <h3 class="section-title-with-icon">
          {{ knowledgeBaseMessage('knowledgeBase.settings.projects') }}
        </h3>
      </div>
      <!-- 已移除 form-row 结构，直接展示全宽内容 -->
      <div class="project-section-content">
        <div class="control-area project-control-area">
          <!-- 右侧内容：左右两栏布局 -->
          <div class="project-content-container">
            <div class="project-columns">
              <!-- 左侧：已关联项目列表 -->
              <div class="project-column-wrapper">
                <div class="project-column-header">
                  <span class="project-column-title">
                    {{ knowledgeBaseMessage('knowledgeBase.settings.linkedProjects') }}
                  </span>
                </div>
                <div class="project-column">
                  <div v-if="linkedProjects.length > 0" class="project-list">
                    <div
                      v-for="project in linkedProjects"
                      :key="project.id"
                      class="project-item"
                    >
                      <div class="project-info">
                        <div class="project-name" :title="project.name">
                          {{ project.name }}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="project-action-btn remove-btn"
                        :title="knowledgeBaseMessage('knowledgeBase.settings.unlinkTitle')"
                        @click="unlinkProject(project.id)"
                      >
                        <CloseIcon class="action-icon" />
                      </button>
                    </div>
                  </div>
                  <div v-else class="project-empty">
                    {{ knowledgeBaseMessage('knowledgeBase.settings.noLinkedProjects') }}
                  </div>
                </div>
              </div>

              <!-- 右侧：可关联项目列表（工作区内所有未关联项目） -->
              <div class="project-column-wrapper">
                <div class="project-column-header">
                  <span class="project-column-title">
                    {{ knowledgeBaseMessage('knowledgeBase.settings.availableProjects') }}
                  </span>
                </div>
                <div class="project-column">
                  <div v-if="availableProjects.length > 0" class="project-list">
                    <div
                      v-for="project in availableProjects"
                      :key="project.id"
                      class="project-item"
                    >
                      <div class="project-info">
                        <div class="project-name" :title="project.name">
                          {{ project.name }}
                        </div>
                      </div>
                      <button
                        type="button"
                        class="project-action-btn add-btn"
                        :title="knowledgeBaseMessage('knowledgeBase.settings.linkTitle')"
                        @click="linkProject(project.id)"
                      >
                        <AddIcon class="action-icon" />
                      </button>
                    </div>
                  </div>
                  <div v-else class="project-empty">
                    {{ knowledgeBaseMessage('knowledgeBase.settings.noAvailableProjects') }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 危险操作区域：删除知识库 -->
    <div class="section-divider-bottom danger-section">
      <div class="danger-section-inner">
        <h3 class="danger-section-title">{{ knowledgeBaseMessage('knowledgeBase.settings.danger.title') }}</h3>
        <p class="danger-section-desc">
          {{ knowledgeBaseMessage('knowledgeBase.settings.danger.description') }}
        </p>
        <button
          type="button"
          class="danger-delete-btn"
          :disabled="!props.selectedKbId || props.selectedKbId === 'default'"
          @click="openDeleteDialog"
        >
          {{ knowledgeBaseMessage('knowledgeBase.settings.danger.deleteCurrent') }}
        </button>
      </div>
    </div>
  </div>

  <!-- 删除知识库确认弹窗 -->
  <AlertDialog
    :visible="showDeleteDialog"
    :title="knowledgeBaseMessage('knowledgeBase.settings.deleteDialog.title')"
    :message="deleteDialogMessage"
    :isConfirmation="true"
    :confirmText="knowledgeBaseMessage('knowledgeBase.common.delete')"
    :cancelText="knowledgeBaseMessage('knowledgeBase.common.cancel')"
    :isDangerousAction="true"
    @confirm="handleConfirmDelete"
    @cancel="closeDeleteDialog"
    @close="closeDeleteDialog"
  />
</template>

<script setup lang="ts">
import { ActionButtons, AlertDialog, TagChip } from '@linnya/renderer-ui';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import {
  useKnowledgeBaseSettings,
  type KnowledgeBaseSettingsProps
} from './useKnowledgeBaseSettings';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';

// props：由上层传入当前选中的知识库 ID
const props = defineProps<KnowledgeBaseSettingsProps>();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

// 将具体业务逻辑通过组合函数抽离，组件只保留与模板的绑定关系
const {
  currentKb,
  localName,
  localDescription,
  localTags,
  newTag,
  isSaving,
  linkedProjects,
  availableProjects,
  showDeleteDialog,
  deleteDialogMessage,
  handleAddTag,
  removeTag,
  linkProject,
  unlinkProject,
  openDeleteDialog,
  closeDeleteDialog,
  handleConfirmDelete,
  handleSaveBasicInfo
} = useKnowledgeBaseSettings(props, knowledgeBaseMessage);
</script>
