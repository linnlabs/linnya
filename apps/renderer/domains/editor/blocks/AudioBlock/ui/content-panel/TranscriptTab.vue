<template>
  <div class="transcript-tab">
    <div v-if="hasRealContent" class="toolbar">
      <div class="toolbar-left">
        <button
          v-if="hasRealContent"
          class="toolbar-button"
          @click="copyTranscript"
        >
          <CopyIcon />
          <span>{{ editorMessage('editor.audioBlock.transcript.copyFullText') }}</span>
        </button>
        
        <!-- 翻译按钮和下拉菜单 -->
        <div class="translate-menu-container" ref="translateMenuRef">
          <button
            class="toolbar-button translate-button"
            @click.stop="toggleTranslateMenu"
            ref="translateButtonRef"
            :disabled="isTranslating"
          >
            <RippleLoadingIcon v-if="isTranslating" class="loading-icon" />
            <TranslateIcon v-else />
            <span>{{ translateButtonText }}</span>
          </button>
          
          <Teleport to="body">
            <Transition name="transcript-menu-fade">
              <div 
                v-if="showTranslateMenu" 
                :style="translateMenuPosition"
              >
                <CustomSelect
                  :model-value="selectedLanguage"
                  :options="translateOptions"
                  :manual-mode="true"
                  :external-trigger-ref="translateButtonRef"
                  min-width="140px"
                  @update:model-value="selectLanguage"
                  @close="closeTranslateMenu"
                />
              </div>
            </Transition>
          </Teleport>
        </div>
      </div>
      <div class="timestamp-info" v-if="displayCreatedAt || displayLastEditedAt">
        <span v-if="displayCreatedAt" class="time-label">
          {{ editorMessage('editor.audioBlock.content.createdAt', { time: displayCreatedAt }) }}
        </span>
        <span v-if="displayCreatedAt && displayLastEditedAt" class="time-separator">｜</span>
        <span v-if="displayLastEditedAt" class="time-label">
          {{ editorMessage('editor.audioBlock.content.editedAt', { time: displayLastEditedAt }) }}
        </span>
      </div>
    </div>

    <!-- Tiptap 编辑器 -->
    <editor-content 
      v-if="hasRealContent && editor" 
      :editor="editor" 
      class="transcript-editor"
    />

    <!-- 无内容时的空状态 -->
    <div v-else class="empty-state">
      <p>{{ editorMessage('editor.audioBlock.transcript.empty') }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, provide, watch } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { useAudioContentStore, useAudioRuntimeStore, useAudioEditorsStore } from '../../store/index.js'
import { useNotificationStore } from '@/app/notification'
import { useFindReplaceStore } from '../../../../features/FindReplace/store/useFindReplaceStore.js'
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { TranslateIcon } from '@linnya/renderer-ui/icons';
import { CustomSelect } from '@linnya/renderer-ui';
import { RippleLoadingIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization'
import { 
  TranscriptDocument, 
  TranscriptSegment, 
  TranscriptText, 
  TranscriptTranslation 
} from './TranscriptSegmentExtension.js'
import { SubEditorFindReplaceExtension } from './SubEditorFindReplaceExtension.js'
import { proseMirrorDocToSegments, segmentsToProseMirrorDoc } from './transcriptDataConverter.js'
import Text from '@tiptap/extension-text'
import History from '@tiptap/extension-history'
import Placeholder from '@tiptap/extension-placeholder'
import {
  buildAudioBlockTranslationLanguages,
  buildAudioBlockTranslationOptions,
  formatAudioBlockContentTime,
} from '../../functions/audioBlockPresentation'

const props = defineProps({
  blockId: { type: String, required: true }
})

const contentStore = useAudioContentStore()
const runtimeStore = useAudioRuntimeStore()
const editorsStore = useAudioEditorsStore()
const notificationStore = useNotificationStore()
const findReplaceStore = useFindReplaceStore()
const { editorMessage } = useEditorLocalization()

// --- 状态访问 ---

// 从 content store 获取内容
const content = computed(() => contentStore.getContent(props.blockId))

// --- 翻译功能相关 ---
const showTranslateMenu = ref(false)
const translateMenuRef = ref(null)
const translateButtonRef = ref(null)
const translateMenuPosition = ref({})
const isTranslating = ref(false)

// 从 store 读取翻译状态
const selectedLanguage = computed({
  get: () => content.value.translationLanguage || 'en',
  set: (value) => contentStore.setTranslationState(props.blockId, { language: value })
})

const showTranslation = computed({
  get: () => content.value.translationVisible || false,
  set: (value) => contentStore.setTranslationState(props.blockId, { visible: value })
})

// 全局分割线悬停状态
const isDividerHovering = ref(false)

// 全局列宽比例（原文列宽度百分比）
const textColumnWidth = ref(50)

// Provide showTranslation 给 NodeView
provide('showTranslation', showTranslation)
provide('isDividerHovering', isDividerHovering)
provide('textColumnWidth', textColumnWidth)
provide('onSeekToTime', (startTime) => {
  runtimeStore.seekToTime(props.blockId, startTime)
})

const translateLanguages = computed(() => buildAudioBlockTranslationLanguages(editorMessage))

const translateOptions = computed(() => {
  return buildAudioBlockTranslationOptions(translateLanguages.value, editorMessage)
})

const transcriptContent = computed(() => {
  const raw = content.value.transcriptContent
  // 统一返回合法的 ProseMirror 文档或 null
  if (!raw) {
    return null
  }
  if (typeof raw === 'object' && raw.type === 'transcriptDocument') {
    return raw
  }
  // 非法或旧格式，视为无内容
  return null
})

const hasRealContent = computed(() => {
  return !!transcriptContent.value
})

const hasTranslation = computed(() => {
  if (!transcriptContent.value || !transcriptContent.value.content) return false
  // 检查第一个 segment 是否有 translation 节点
  const firstSegment = transcriptContent.value.content[0]
  if (!firstSegment || !firstSegment.content) return false
  return firstSegment.content.length > 1 && firstSegment.content[1]?.type === 'transcriptTranslation'
})

const translateButtonText = computed(() => {
  if (isTranslating.value) {
    return editorMessage('editor.audioBlock.transcript.translating')
  }
  return hasTranslation.value
    ? editorMessage('editor.audioBlock.transcript.retranslateTo')
    : editorMessage('editor.audioBlock.transcript.translateTo')
})

// 获取转录创建和编辑时间
const createdAt = computed(() => formatAudioBlockContentTime(content.value.transcriptCreatedAt, editorMessage))
const lastEditedAt = computed(() => formatAudioBlockContentTime(content.value.transcriptLastEditedAt, editorMessage))

const displayCreatedAt = computed(() => {
  if (hasRealContent.value) {
    return createdAt.value
  }
  return ''
})

const displayLastEditedAt = computed(() => {
  if (hasRealContent.value) {
    return lastEditedAt.value
  }
  return ''
})

// 创建 Tiptap 编辑器
const editor = useEditor({
  extensions: [
    TranscriptDocument,
    TranscriptSegment,
    TranscriptText,
    TranscriptTranslation,
    Text,
    History,
    SubEditorFindReplaceExtension,
    Placeholder.configure({
      placeholder: editorMessage('editor.audioBlock.transcript.placeholder'),
    }),
  ],
  content: transcriptContent.value || { type: 'transcriptDocument', content: [] },
  editable: true,
  onUpdate: ({ editor }) => {
    // 编辑器内容变化时保存
    saveEditorContent(editor)
  },
})

// 监听内容变化，更新编辑器
watch(
  () => transcriptContent.value,
  (newContent) => {
    if (!editor.value) return
    
    const safeDoc = newContent || { type: 'transcriptDocument', content: [] }
    const currentDoc = editor.value.getJSON()
    
    // 只在内容真正不同时更新
    if (JSON.stringify(currentDoc) !== JSON.stringify(safeDoc)) {
      editor.value.commands.setContent(safeDoc, false)
    }
  },
  { deep: true }
)

// 保存编辑器内容（只更新本地状态，标记为"脏"）
function saveEditorContent(editorInstance) {
  if (!editorInstance) return

  const doc = editorInstance.getJSON()
  
  contentStore.setTranscriptContentDraft(props.blockId, doc)
}

// 复制全文
const copyTranscript = async () => {
  if (!editor.value) return

  const text = editor.value.getText()

  try {
    await navigator.clipboard.writeText(text)
    notificationStore.show(editorMessage('editor.audioBlock.toast.copied'), 'success', 2000)
  } catch (error) {
    notificationStore.show(editorMessage('editor.audioBlock.toast.copyFailed'), 'error', 2000)
  }
}

// 翻译菜单
const updateTranslateMenuPosition = () => {
  if (!translateButtonRef.value) return
  
  const buttonRect = translateButtonRef.value.getBoundingClientRect()
  translateMenuPosition.value = {
    position: 'fixed',
    top: `${buttonRect.bottom + 4}px`,
    left: `${buttonRect.left}px`,
    zIndex: 10000
  }
}

const toggleTranslateMenu = () => {
  showTranslateMenu.value = !showTranslateMenu.value
  if (showTranslateMenu.value) {
    nextTick(() => {
      updateTranslateMenuPosition()
    })
  }
}

const closeTranslateMenu = () => {
  showTranslateMenu.value = false
}

const selectLanguage = async (langCode) => {
  if (!langCode) return
  
  selectedLanguage.value = langCode
  showTranslateMenu.value = false
  
  const lang = translateLanguages.value.find(l => l.code === langCode)
  
  // 检查是否有转录内容
  if (!editor.value || !transcriptContent.value || !transcriptContent.value.content || transcriptContent.value.content.length === 0) {
    notificationStore.show(editorMessage('editor.audioBlock.toast.noTranscriptToTranslate'), 'warning', 2000)
    return
  }
  
  // 将 ProseMirror 文档转换为 segments 数组
  const segments = proseMirrorDocToSegments(transcriptContent.value)
  
  // 开始翻译
  isTranslating.value = true
  notificationStore.show(
    editorMessage('editor.audioBlock.toast.translatingTo', { language: lang?.label || langCode }),
    'info',
    2000
  )
  
  try {
    // 动态导入翻译服务
    const { translateTranscript } = await import('../../services/audioContentAiService.js')
    
    // 调用翻译服务
    await translateTranscript(
      { segments },
      lang?.serviceLabel || langCode,
      {
        onTextChunk: (chunk) => {
          // 实时翻译进度（静默处理）
        },
        onStreamEnd: (translatedSegments) => {
          
          // 将翻译后的 segments 转换为 ProseMirror JSON
          const updatedDoc = segmentsToProseMirrorDoc(translatedSegments)
          
          // *** 根本性修复：使用 Draft 方法更新内容以触发保存 ***
          contentStore.setTranscriptContentDraft(props.blockId, updatedDoc);
          
          // 显示翻译列
          showTranslation.value = true
          
          // 翻译完成
          isTranslating.value = false
          notificationStore.show(editorMessage('editor.audioBlock.toast.translationCompleted'), 'success', 2000)
        },
        onError: (error) => {
          console.error('❌ [TranscriptTab] 翻译失败:', error)
          isTranslating.value = false
          notificationStore.show(
            editorMessage('editor.audioBlock.toast.translationFailed'),
            'error',
            3000
          )
        }
      }
    )
  } catch (error) {
    console.error('❌ [TranscriptTab] 翻译服务加载失败:', error)
    isTranslating.value = false
    notificationStore.show(
      editorMessage('editor.audioBlock.toast.translationFailed'),
      'error',
      3000
    )
  }
}

// 监听 showTranslation 变化，更新编辑器中的翻译节点显示状态
watch(showTranslation, (newValue) => {
  if (!editor.value) return
  
  // 遍历所有 segment 节点，更新其 translationVisible 属性
  const { state, view } = editor.value
  const tr = state.tr
  
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'transcriptSegment') {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        translationVisible: newValue
      })
    }
  })
  
  if (tr.docChanged) {
    view.dispatch(tr)
  }
})

// 监听编辑器创建，注册实例
watch(editor, (newEditor, oldEditor) => {
  if (newEditor && !oldEditor) {
    editorsStore.registerEditor(props.blockId, 'transcript', newEditor)
  }
}, { immediate: true })

onMounted(() => {
  window.addEventListener('scroll', updateTranslateMenuPosition, true)
  window.addEventListener('resize', updateTranslateMenuPosition)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updateTranslateMenuPosition, true)
  window.removeEventListener('resize', updateTranslateMenuPosition)

  // 注销编辑器实例
  editorsStore.unregisterEditor(props.blockId, 'transcript')
  editor.value?.destroy()
})
</script>
