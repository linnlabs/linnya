<template>
  <div class="summary-tab">
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
        {{ editorMessage('editor.audioBlock.summary.placeholder') }}
      </div>
      <editor-content :editor="editor" class="summary-editor" />
    </div>
  </div>
</template>

<script setup>
import { computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import { useAudioContentStore, useAudioEditorsStore } from '../../store/index.js';
import { TimestampNode } from './TimestampExtension.js';
import { BoldIcon } from '@linnya/renderer-ui/icons';
import { ItalicIcon } from '@linnya/renderer-ui/icons';
import { ListItemIcon } from '@linnya/renderer-ui/icons';
import { HeadingIcon } from '@linnya/renderer-ui/icons';
import { TimeIcon } from '@linnya/renderer-ui/icons';
import { marked } from 'marked';
import { SubEditorFindReplaceExtension } from './SubEditorFindReplaceExtension.js';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';
import { formatAudioBlockContentTime } from '../../functions/audioBlockPresentation';

const props = defineProps({
  blockId: { type: String, required: true }
});

const contentStore = useAudioContentStore();
const editorsStore = useAudioEditorsStore();
const { editorMessage } = useEditorLocalization();

// 配置 marked 解析器
marked.setOptions({
  breaks: true,        // 支持GFM换行
  gfm: true,           // 启用GitHub Flavored Markdown
  headerIds: false,    // 不生成header id
  mangle: false        // 不混淆email地址
});

/**
 * 检测内容是否为 HTML 格式
 */
const isHtmlContent = (content) => {
  if (!content || typeof content !== 'string') return false;
  // 简单检测：如果包含 HTML 标签，认为是 HTML
  return /<[^>]+>/i.test(content);
};

/**
 * 检测内容是否为 Markdown 格式
 * 启发式检测：如果不是 HTML，且包含常见的 Markdown 语法标记，则认为是 Markdown
 */
const isMarkdownContent = (content) => {
  if (!content || typeof content !== 'string') return false;
  
  // 如果已经是 HTML，不是 Markdown（避免误判用户编辑后的内容）
  if (isHtmlContent(content)) return false;
  
  // 检测常见的 Markdown 语法
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // 标题 (# Title)
    /\*\*[^*]+\*\*/,         // 粗体 (**text**)
    /\*[^*]+\*/,             // 斜体 (*text*)
    /^\s*[-*+]\s+/m,         // 无序列表
    /^\s*\d+\.\s+/m,         // 有序列表
    /\[.+\]\(.+\)/,          // 链接 [text](url)
    /```[\s\S]*?```/,        // 代码块
    /`[^`]+`/                // 行内代码
  ];
  
  return markdownPatterns.some(pattern => pattern.test(content));
};

/**
 * 将 Markdown 字符串解析为 HTML
 */
const parseMarkdownToHtml = (markdown) => {
  try {
    return marked.parse(markdown);
  } catch (error) {
    console.error('[SummaryTab] Markdown 解析失败:', error);
    // 解析失败时，返回原始内容用段落包裹
    return `<p>${markdown}</p>`;
  }
};

// 计算属性：是否显示占位符
const showPlaceholder = computed(() => {
  if (!editor.value) return true;
  // 当内容大小小于等于2时（即只有一个空的<p>标签），视为空
  return editor.value.state.doc.content.size <= 2;
});

// 获取纪要创建和编辑时间
const content = computed(() => contentStore.getContent(props.blockId));
const createdAt = computed(() => formatAudioBlockContentTime(content.value.summaryCreatedAt, editorMessage));
const lastEditedAt = computed(() => formatAudioBlockContentTime(content.value.summaryLastEditedAt, editorMessage));

// 初始化编辑器内容（支持 Markdown 解析）
const getInitialContent = () => {
  const summaryContent = contentStore.getContent(props.blockId).summaryContent || '';
  
  if (summaryContent && isMarkdownContent(summaryContent)) {
    console.log('[SummaryTab] 初始化：检测到 Markdown 格式，正在解析...');
    return parseMarkdownToHtml(summaryContent);
  }
  
  return summaryContent;
};

// 初始化 Tiptap 编辑器
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      link: false,
      underline: false,
      listKeymap: false,
    }),
    TimestampNode.configure({
      getCurrentPlayTime: () => {
        // 从 Store 获取当前播放时间（需要 runtimeStore）
        return 0; // 暂时返回 0，如果需要播放时间功能，需要引入 runtimeStore
      },
    }),
    SubEditorFindReplaceExtension,
  ],
  content: getInitialContent(),
  editorProps: {
    attributes: {
      class: 'summary-editor-content',
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
    contentStore.setSummaryContentDraft(props.blockId, html);
    
    // 确保滚动到可见区域
    requestAnimationFrame(() => {
      scrollToBottom();
    });
  },
});

// 监听 Store 中的内容变化（用于初始加载和AI生成）
watch(
  () => contentStore.getContent(props.blockId).summaryContent,
  (newContent) => {
    if (!editor.value) return;
    
    // 如果内容没有变化，不做处理
    const currentHtml = editor.value.getHTML();
    if (currentHtml === newContent) return;
    
    // 检测是否为 Markdown 格式
    let contentToSet = newContent || '';
    
    if (newContent && isMarkdownContent(newContent)) {
      console.log('[SummaryTab] 检测到 Markdown 格式内容，正在解析...');
      contentToSet = parseMarkdownToHtml(newContent);
      console.log('[SummaryTab] Markdown 解析完成');
    }
    
    // 设置解析后的内容到编辑器
    editor.value.commands.setContent(contentToSet);
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
  
  // 获取当前播放时间（需要 runtimeStore）
  const currentTime = 0; // 暂时返回 0，如果需要播放时间功能，需要引入 runtimeStore
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
  console.log('[SummaryTab] 时间戳被点击，跳转到时间:', time);
  
  // 通知 Store 更新播放时间（需要 runtimeStore）
  // runtimeStore.seekToTime(props.blockId, time);
};

// 监听编辑器创建，注册实例
watch(editor, (newEditor, oldEditor) => {
  if (newEditor && !oldEditor) {
    console.log('[SummaryTab] 编辑器已创建，注册实例:', props.blockId)
    editorsStore.registerEditor(props.blockId, 'summary', newEditor)
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
  console.log('[SummaryTab] 组件卸载，注销编辑器实例:', props.blockId)
  // 注销编辑器实例
  editorsStore.unregisterEditor(props.blockId, 'summary');
  editor.value?.destroy();
});
</script>
