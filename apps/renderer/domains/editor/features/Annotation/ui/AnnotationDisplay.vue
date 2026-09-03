<!--/**
 * AnnotationDisplay.vue
 * 
 * 批注查看模式组件（优化版 - Notion风格）
 * 职责：
 * 1. 显示批注内容、作者信息
 * 2. 显示批注状态（如已解决标签）
 * 3. 提供批注操作按钮（AI、编辑、已解决/重新打开、删除）
 */-->

<template>
  <div class="annotation-item">
    <!-- 头部：作者信息 + 操作按钮 -->
    <div class="annotation-meta">
      <div class="annotation-creator">
        <TagChip
          v-if="isAI"
          label="AI"
          class="ai-tag-chip"
        />
        <span class="annotation-author">{{ authorName }}</span>
        <span v-if="panel.state === AnnotationState.RESOLVED" class="annotation-resolved-badge">
          {{ editorMessage('editor.annotation.status.resolved') }}
        </span>
      </div>
      
      <!-- 右侧区域：包含时间戳和操作按钮 -->
      <div class="annotation-meta-right">
        <!-- 默认显示时间戳 -->
        <span class="annotation-time">{{ formattedCreatedAt }}</span>
        
        <!-- Hover时显示操作按钮组 -->
        <div class="annotation-icon-buttons">
          <!-- AI 按钮 -->
          <button
            class="icon-button ai-icon"
            @click="$emit('ai-action')"
            :title="editorMessage('editor.annotation.action.ai')"
            :aria-label="editorMessage('editor.annotation.action.ai')"
          >
            <AiIcon />
          </button>
          
          <!-- 编辑按钮 -->
          <button 
            v-if="panel.state !== AnnotationState.RESOLVED" 
            class="icon-button edit-icon" 
            @click="$emit('edit')" 
            :title="editorMessage('editor.annotation.action.edit')"
            :aria-label="editorMessage('editor.annotation.action.edit')"
          >
            <EditIcon />
          </button>
          
          <!-- 已解决/重新打开按钮 -->
          <button 
            class="icon-button resolve-icon" 
            :class="{'is-resolved': panel.state === AnnotationState.RESOLVED}"
            @click="panel.state === AnnotationState.RESOLVED ? $emit('reopen') : $emit('resolve')"
            :title="panel.state === AnnotationState.RESOLVED
              ? editorMessage('editor.annotation.action.reopen')
              : editorMessage('editor.annotation.action.resolve')"
            :aria-label="panel.state === AnnotationState.RESOLVED
              ? editorMessage('editor.annotation.action.reopen')
              : editorMessage('editor.annotation.action.resolveAria')"
          >
            <OkIcon />
          </button>
          
          <!-- 删除按钮 -->
          <button 
            class="icon-button delete-icon" 
            @click="$emit('delete')"
            :title="editorMessage('editor.annotation.action.delete')"
            :aria-label="editorMessage('editor.annotation.action.delete')"
          >
            <NoIcon />
          </button>
        </div>
      </div>
    </div>
    
    <!-- 批注内容 -->
    <div class="annotation-text">{{ panel.content }}</div>
    
    <!-- 批注回复列表 -->
    <div v-if="panel.replies && panel.replies.length > 0" class="annotation-replies">
      <div v-for="reply in panel.replies" :key="reply.id" class="annotation-reply-item">
        <div class="annotation-reply-header">
          <span class="annotation-reply-author">{{ resolveReplyAuthorName(reply.author) }}</span>
          <span class="annotation-reply-time">{{ formatAnnotationTime(reply.createdAt, editorMessage) }}</span>
        </div>
        <div class="annotation-reply-content">{{ reply.content }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { TagChip } from '@linnya/renderer-ui';
import { AnnotationState } from '../commands/AnnoStateCommands';
import { AiIcon } from '@linnya/renderer-ui/icons';
import { EditIcon } from '@linnya/renderer-ui/icons';
import { OkIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon as NoIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import {
  formatAnnotationTime,
  resolveAnnotationAuthorName,
} from '../functions/annotationPresentation';

// 定义props
const props = defineProps({
  panel: {
    type: Object,
    required: true
  }
});

// 定义事件
defineEmits(['edit', 'resolve', 'reopen', 'delete', 'ai-action']);

const { editorMessage } = useEditorLocalization();

const authorName = computed(() => resolveAnnotationAuthorName(props.panel.author, editorMessage));
const formattedCreatedAt = computed(() => formatAnnotationTime(props.panel.createdAt, editorMessage));
const resolveReplyAuthorName = (author) => resolveAnnotationAuthorName(author, editorMessage);

const isAI = computed(() => {
  return props.panel.meta?.source === 'review';
});
</script>
