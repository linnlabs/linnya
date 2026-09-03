<template>
  <div class="notes-tab">
    <div class="toolbar">
      <div class="toolbar-buttons">
        <button
          class="toolbar-button"
          @click="insertTimestamp"
          :title="editorMessage('editor.audioBlock.action.insertTimestamp')"
        >
          <TimeIcon />
        </button>
        <span class="divider"></span>
        <button 
          class="toolbar-button" 
          @click="editor?.chain().focus().toggleBold().run()"
          :class="{ 'is-active': editor?.isActive('bold') }"
          :title="editorMessage('editor.audioBlock.action.bold')"
        >
          <BoldIcon />
        </button>
        <button 
          class="toolbar-button" 
          @click="editor?.chain().focus().toggleItalic().run()"
          :class="{ 'is-active': editor?.isActive('italic') }"
          :title="editorMessage('editor.audioBlock.action.italic')"
        >
          <ItalicIcon />
        </button>
        <button 
          class="toolbar-button" 
          @click="editor?.chain().focus().toggleBulletList().run()"
          :class="{ 'is-active': editor?.isActive('bulletList') }"
          :title="editorMessage('editor.audioBlock.action.bulletList')"
        >
          <ListItemIcon />
        </button>
        <button 
          class="toolbar-button" 
          @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
          :class="{ 'is-active': editor?.isActive('heading', { level: 2 }) }"
          :title="editorMessage('editor.audioBlock.action.heading')"
        >
          <HeadingIcon />
        </button>
      </div>
      <div class="timestamp-info" v-if="createdAt || lastEditedAt">
        <span v-if="createdAt" class="time-label">
          {{ editorMessage('editor.audioBlock.content.createdAt', { time: createdAt }) }}
        </span>
        <span v-if="createdAt && lastEditedAt" class="time-separator">｜</span>
        <span v-if="lastEditedAt" class="time-label">
          {{ editorMessage('editor.audioBlock.content.editedAt', { time: lastEditedAt }) }}
        </span>
      </div>
    </div>
    <div class="editor-wrapper">
      <div v-if="showPlaceholder" class="custom-placeholder">
        {{ editorMessage('editor.audioBlock.notes.placeholder') }}
      </div>
      <editor-content :editor="editor" class="notes-editor" />
    </div>
  </div>
</template>

<script setup>
import { computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { useAudioContentStore, useAudioRuntimeStore, useAudioEditorsStore } from '../../store/index.js';
import { TimestampNode } from './TimestampExtension.js';
import { BoldIcon } from '@linnya/renderer-ui/icons';
import { ItalicIcon } from '@linnya/renderer-ui/icons';
import { ListItemIcon } from '@linnya/renderer-ui/icons';
import { HeadingIcon } from '@linnya/renderer-ui/icons';
import { TimeIcon } from '@linnya/renderer-ui/icons';
import { SubEditorFindReplaceExtension } from './SubEditorFindReplaceExtension.js';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { formatAudioBlockContentTime } from '../../functions/audioBlockPresentation';

const props = defineProps({
  blockId: { type: String, required: true }
});

const contentStore = useAudioContentStore();
const runtimeStore = useAudioRuntimeStore();
const editorsStore = useAudioEditorsStore();
const { editorMessage } = useEditorLocalization();

// 计算属性：是否显示占位符
const showPlaceholder = computed(() => {
  if (!editor.value) return true;
  // 当内容大小小于等于2时（即只有一个空的<p>标签），视为空
  return editor.value.state.doc.content.size <= 2;
});

// 获取笔记创建和编辑时间
const content = computed(() => contentStore.getContent(props.blockId));
const runtime = computed(() => runtimeStore.getRuntime(props.blockId));
const createdAt = computed(() => formatAudioBlockContentTime(content.value.notesCreatedAt, editorMessage));
const lastEditedAt = computed(() => formatAudioBlockContentTime(content.value.notesLastEditedAt, editorMessage));

// 初始化 Tiptap 编辑器
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
    }),
    TimestampNode.configure({
      getCurrentPlayTime: () => {
        // 从 Store 获取当前时间
        const rt = runtimeStore.getRuntime(props.blockId);
        // 如果正在录制，使用录制时间；否则使用播放时间
        return rt.isRecording 
          ? (rt.recordingTime || 0)  // 录制时使用录制时间
          : (rt.currentPlayTime || 0); // 播放时使用播放时间
      },
    }),
    SubEditorFindReplaceExtension,
  ],
  content: contentStore.getContent(props.blockId).notesContent || '',
  editorProps: {
    attributes: {
      class: 'notes-editor-content',
    },
    handleDOMEvents: {
      // 监听时间戳点击事件
      'timestamp-click': (view, event) => {
        const customEvent = event;
        if (customEvent.detail && typeof customEvent.detail.time === 'number') {
          handleTimestampClick(customEvent.detail.time);
        }
        return true;
      },
    },
  },
  onUpdate: ({ editor }) => {
    // 只更新本地状态，标记为"脏"，不直接持久化
    const html = editor.getHTML();
    contentStore.setNotesContentDraft(props.blockId, html);

    // 确保滚动到可见区域
    requestAnimationFrame(() => {
      scrollToBottom();
    });
  },
});

// 监听 Store 中的内容变化（用于初始加载）
watch(
  () => contentStore.getContent(props.blockId).notesContent,
  (newContent) => {
    if (editor.value && editor.value.getHTML() !== newContent) {
      editor.value.commands.setContent(newContent || '');
    }
  }
);

// 滚动到底部的函数
const scrollToBottom = () => {
  if (!editor.value) return;
  
  // 获取编辑器的 DOM 元素
  const editorElement = editor.value.view.dom;
  if (!editorElement) return;
  
  // 查找父容器 .panel-content
  const panelContent = editorElement.closest('.panel-content');
  if (panelContent) {
    // 滚动到底部，并添加一些额外的空间以确保光标完全可见
    panelContent.scrollTop = panelContent.scrollHeight + 50;
  }
};

const insertTimestamp = () => {
  if (!editor.value) return;
  
  // 获取当前时间（从 Store 中获取）
  const rt = runtimeStore.getRuntime(props.blockId);
  // 如果正在录制，使用录制时间；否则使用播放时间
  const currentTime = rt.isRecording 
    ? (rt.recordingTime || 0)  // 录制时使用录制时间
    : (rt.currentPlayTime || 0); // 播放时使用播放时间
  const timestamp = formatTimestamp(currentTime);
  
  // 在光标位置插入时间戳节点
  editor.value.chain().focus().insertContent({
    type: 'timestamp',
    attrs: {
      time: currentTime,
      label: timestamp,
    },
  }).run();
};

const formatTimestamp = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// 处理时间戳点击事件
const handleTimestampClick = (time) => {
  console.log('[NotesTab] 时间戳被点击，跳转到时间:', time);
  
  // 通知 Store 更新播放时间
  runtimeStore.seekToTime(props.blockId, time);
};

// 监听编辑器创建，注册实例
watch(editor, (newEditor, oldEditor) => {
  if (newEditor && !oldEditor) {
    console.log('[NotesTab] 编辑器已创建，注册实例:', props.blockId)
    editorsStore.registerEditor(props.blockId, 'notes', newEditor)
  }
}, { immediate: true })

onMounted(() => {
  // 监听时间戳点击事件（使用原生事件监听作为备用方案）
  const editorElement = editor.value?.view?.dom;
  if (editorElement) {
    editorElement.addEventListener('timestamp-click', (event) => {
      const customEvent = event;
      if (customEvent.detail && typeof customEvent.detail.time === 'number') {
        handleTimestampClick(customEvent.detail.time);
      }
    });
  }
});

onBeforeUnmount(() => {
  console.log('[NotesTab] 组件卸载，注销编辑器实例:', props.blockId)
  // 注销编辑器实例
  editorsStore.unregisterEditor(props.blockId, 'notes');
  editor.value?.destroy();
});
</script>
