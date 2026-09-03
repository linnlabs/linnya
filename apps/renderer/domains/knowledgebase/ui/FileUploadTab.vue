<!-- src/renderer/features/KnowledgeBase/ui/FileUploadTab.vue -->
<!-- 文件上传Tab组件，负责文件选择、上传和任务监控 -->

<template>
  <div 
    class="upload-tab"
  >
    <!-- 顶部拖拽 / 点击 上传区域：承载原先的拖拽上传能力 -->
    <div
      class="upload-drop-zone"
      :class="{ 'is-dragging': isDragging }"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
      @click="selectFiles"
    >
      <div class="drop-zone-icons">
        <div class="drop-zone-icon-circle">
          <UploadIcon class="drop-zone-icon" />
        </div>
      </div>
      <p class="drop-zone-title">{{ knowledgeBaseMessage('knowledgeBase.upload.dropTitle') }}</p>
      <p class="drop-zone-subtitle">{{ knowledgeBaseMessage('knowledgeBase.upload.dropSubtitle') }}</p>
      <!-- 支持文件类型说明文案：直接从 SUPPORTED_FILE_TYPES 常量生成，保证与实际受支持类型一致 -->
      <p class="drop-zone-filetypes">
        {{ supportedFileTypesText }}
      </p>
    </div>

    <div class="control-bar">
      <div class="left-controls">
        <!-- 预留左侧占位，后续可放筛选 / 过滤控件；当前保持布局对称 -->
      </div>
      <div class="center-controls">
        <p class="control-hint-text">
          {{ knowledgeBaseMessage('knowledgeBase.upload.controlHint') }}
        </p>
        <!-- 仅在“知识库详情页（非全局视图）”提示用户如何查看全局任务 -->
        <p v-if="!showAllKbTasks && selectedKbId" class="control-hint-text">
          {{ knowledgeBaseMessage('knowledgeBase.upload.scopeHint.beforeLink') }}
          <span class="scope-link" @click.stop="openGlobalUploadFromHint">
            {{ knowledgeBaseMessage('knowledgeBase.upload.scopeHint.link') }}
          </span>
          {{ knowledgeBaseMessage('knowledgeBase.upload.scopeHint.afterLink') }}
        </p>
        <p v-if="kbStore.parsingSettings?.forceVisionMode" class="control-hint-text warning-text">
          {{ knowledgeBaseMessage('knowledgeBase.upload.pdfForceOcrLimit') }}
        </p>
      </div>
      <div class="right-controls">
        <input 
          ref="fileInput" 
          class="file-input"
          type="file" 
          multiple 
          @change="handleFileSelect"
          :accept="SUPPORTED_FILE_TYPES.join(',')"
        />
        <ActionButtons
          :primary-action-text="knowledgeBaseMessage('knowledgeBase.upload.startParsing')"
          :is-primary-action-disabled="pendingFilesCount === 0"
          :showSecondaryAction="false"
          @primary-click="kbStore.startParsing"
        />
      </div>
    </div>

    <div class="file-list-area">
      <div class="file-list-container upload-list">
        <div class="file-list-header">
          <div class="col-name">{{ knowledgeBaseMessage('knowledgeBase.common.file') }}</div>
          <div class="col-size">{{ knowledgeBaseMessage('knowledgeBase.common.size') }}</div>
          <div class="col-category">{{ knowledgeBaseMessage('knowledgeBase.common.knowledgeBase') }}</div>
          <div class="col-status">{{ knowledgeBaseMessage('knowledgeBase.common.status') }}</div>
          <div class="col-progress">{{ knowledgeBaseMessage('knowledgeBase.common.progress') }}</div>
          <div class="col-actions">{{ knowledgeBaseMessage('knowledgeBase.common.actions') }}</div>
        </div>
        
        <div v-if="uploadTasks.length > 0" class="file-list-items">
          <div v-for="file in uploadTasks" :key="file.id" class="file-item">
            <div class="col-name">
              <span class="file-name">{{ file.name }}</span>
            </div>
            <div class="col-size">{{ file.size }}</div>
            <div class="col-category">{{ file.category }}</div>
            <div class="col-status">
              <span class="status-text" :class="`status-${file.status}`">{{ file.statusText }}</span>
            </div>
            <div class="col-progress">
              <div v-if="(file.status === 'processing' || file.status === 'uploading') || (file.status === 'completed' && parseFloat(file.progress) < 100)" class="progress-details">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: file.progress + '%' }"></div>
                </div>
                <span class="progress-percent">{{ file.progress }}%</span>
              </div>
              <div v-if="file.status === 'error'" class="error-details">
                {{ file.error }}
              </div>
            </div>
            <div class="col-actions">
              <button v-if="file.status === 'failed' || file.status === 'error'" @click="retryFile(file.id)" class="action-link retry-btn">
                {{ knowledgeBaseMessage('knowledgeBase.common.retry') }}
              </button>
              <button v-if="file.status !== 'completed'" @click="handleCancelOrDelete(file)" class="action-link cancel-btn">
                {{ file.status === 'pending' || file.status === 'processing' || file.status === 'uploading' ? knowledgeBaseMessage('knowledgeBase.upload.action.cancel') : knowledgeBaseMessage('knowledgeBase.upload.action.delete') }}
              </button>
            </div>
          </div>
        </div>
        
        <div v-else class="empty-list-placeholder">
          <div class="empty-content">
            <p class="empty-title">{{ knowledgeBaseMessage('knowledgeBase.upload.empty.title') }}</p>
            <p class="empty-desc">
              {{ knowledgeBaseMessage('knowledgeBase.upload.empty.description') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useKnowledgeBaseStore } from '../stores/knowledgeBase'
import { SUPPORTED_FILE_TYPES } from '../constants'
import { useNotificationStore } from '@/app/notification'
import { ActionButtons } from '@linnya/renderer-ui';
import { UploadIcon } from '@linnya/renderer-ui/icons';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';
import {
  resolveUploadTaskErrorText,
  resolveUploadTaskStatusText,
} from '../functions/knowledgeBaseUploadPresentation';

const props = defineProps({
  selectedKbId: String,
  // 是否展示“全局任务列表”（仍然需要 selectedKbId 用于新增文件的归属）
  showAllKbTasks: {
    type: Boolean,
    default: false,
  },
})
const emit = defineEmits(['update:selectedKbId', 'open-global-upload'])

const kbStore = useKnowledgeBaseStore()
const notificationStore = useNotificationStore()
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization()
const fileInput = ref(null)
const isDragging = ref(false)

// 支持的文件类型提示文案，基于后端/配置常量实时生成，避免文案与实际支持列表不一致
const supportedFileTypesText = computed(() => {
  return knowledgeBaseMessage('knowledgeBase.upload.supportedFileTypes', {
    types: SUPPORTED_FILE_TYPES.join('、')
  })
})

// 🐛 修复：移除了 onUnmounted 钩子。
// cleanupIpcListener 是一个全局清理函数，应在应用退出时调用，
// 而不应由任何一个组件的生命周期来管理，这是导致无限递归的根源。

const uploadTasks = computed(() => {
  const allTasks = Array.from(kbStore.uploadTasks.values());
  
  // [UX优化] 仅显示当前选中知识库的任务，实现上下文隔离
  // 避免在 KB-A 的详情页看到 KB-B 的上传任务，减少视觉噪音
  const currentKbTasks = props.showAllKbTasks
    ? allTasks
    : (props.selectedKbId 
        ? allTasks.filter(task => task.kbId === props.selectedKbId)
        : allTasks);

  const tasks = currentKbTasks.map(task => ({
    id: task.id,
    name: task.filename,
    size: formatFileSize(task.size),
    category: getKbNameById(task.kbId),
    status: task.status,
    progress: task.displayProgress.toFixed(1),
    statusText: resolveUploadTaskStatusText(task, knowledgeBaseMessage),
    error: resolveUploadTaskErrorText(task.error, knowledgeBaseMessage),
    createdAt: parseInt(task.id.split('-')[1]) || 0,
  }));
  
  return tasks.sort((a, b) => {
    // [V170 优化] 改进状态排序逻辑，使用更精确的优先级顺序
    const getPriority = (status) => {
      // 优先级从高到低：
      // 1. 进行中的任务 (processing/uploading) - 最高优先级，用户最关心的
      // 2. 错误/失败的任务 (failed/error) - 需要用户注意和处理
      // 3. 等待中的任务 (pending) - 即将开始但尚未处理
      // 4. 重复文件 (duplicate) - 信息性通知，不需要用户处理
      // 5. 已完成的任务 (completed) - 最低优先级，已经处理完成
      switch(status) {
        case 'processing': 
        case 'uploading': return 1; // 最高优先级
        case 'failed': 
        case 'error': return 2;
        case 'pending': return 3;
        case 'duplicate': return 4;
        case 'completed': return 5; // 最低优先级
        default: return 6;
      }
    }
    
    const priorityA = getPriority(a.status);
    const priorityB = getPriority(b.status);
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB; // 按优先级排序
    }
    
    // 同优先级按创建时间倒序（新的在前）
    return b.createdAt - a.createdAt;
  })
})

const pendingFilesCount = computed(() => {
  const allTasks = Array.from(kbStore.uploadTasks.values());
  const currentKbTasks = props.showAllKbTasks
    ? allTasks
    : (props.selectedKbId 
        ? allTasks.filter(task => task.kbId === props.selectedKbId)
        : allTasks);
  return currentKbTasks.filter(t => t.status === 'pending').length
})

watch(() => props.selectedKbId, (newKbId) => {
  if (newKbId) {
    kbStore.setCurrentKnowledgeBase(newKbId)
  }
})

/**
 * 功能 (What): 从提示文案中打开“全局上传/任务”界面
 * 输入 (Input): 无
 * 输出 (Output): 无
 * 副作用 (Side-effects): 向父组件发出 open-global-upload 事件，由页面决定如何展示弹窗/详情
 */
const openGlobalUploadFromHint = () => {
  emit('open-global-upload')
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const getKbNameById = (kbId) => {
  if (!kbId) {
    return knowledgeBaseMessage('knowledgeBase.common.unknown')
  }
  const kb = kbStore.getKnowledgeBaseById(kbId)
  return kb ? kb.name : knowledgeBaseMessage('knowledgeBase.common.unknown')
}

const selectFiles = () => fileInput.value?.click()

/**
 * 功能：当用户开启强制 OCR 解析并选择了 PDF 时，提前提示大文档限制。
 * 说明：
 * - 前端不读取 PDF 页数，避免为此引入额外依赖或增加上传前开销；
 * - 这里只做规则提示，把“是否需要拆分”的判断交给用户。
 */
const notifyPdfForceOcrLimitIfNeeded = (files) => {
  if (!kbStore.parsingSettings?.forceVisionMode) {
    return
  }

  const hasPdfFile = files.some(file => {
    const name = typeof file?.name === 'string' ? file.name : ''
    return name.toLowerCase().endsWith('.pdf')
  })

  if (!hasPdfFile) {
    return
  }

  notificationStore.show(
    knowledgeBaseMessage('knowledgeBase.upload.pdfForceOcrLimit'),
    'warning',
    4500
  )
}

const notifyDuplicateFilesSkipped = (count) => {
  notificationStore.show(
    knowledgeBaseMessage('knowledgeBase.upload.toast.skippedDuplicate', { count }),
    'warning',
    3000
  )
}

const handleFileSelect = (event) => {
  const files = event.target.files
  if (!files || files.length === 0 || !props.selectedKbId) {
    return
  }

  const supportedFiles = Array.from(files).filter(file => {
    const name = file.name
    const lastDot = name.lastIndexOf('.')
    if (lastDot === -1 || lastDot === 0 || name.length === lastDot + 1) {
      return false
    }
    const extension = name.substring(lastDot).toLowerCase()
    return SUPPORTED_FILE_TYPES.includes(extension)
  })

  notifyPdfForceOcrLimitIfNeeded(supportedFiles)
  
  kbStore.addFilesToQueue(props.selectedKbId, supportedFiles, {
    onDuplicateFilesSkipped: notifyDuplicateFilesSkipped
  })

  // Reset input value to allow selecting same file/folder again
  if (event.target) {
    event.target.value = ''
  }
}

const removeFile = async (id) => {
  try {
    await kbStore.cancelUploadTask(id)
  } catch (error) {
    console.error('取消任务失败:', error)
  }
}

const retryFile = async (id) => {
  try {
    await kbStore.retryUploadTask(id)
  } catch (error) {
    console.error('重试任务失败:', error)
  }
}

/**
 * 功能 (What): 根据任务状态执行“取消”或“删除”
 * 输入 (Input / @param): file 对象（包含 id 与 status）
 * 输出 (Output / @returns): Promise<void>
 * 副作用 (Side-effects):
 * - 取消：通知后端取消（若有taskId/docId），并更新前端状态为失败以保留在列表
 * - 删除：仅从前端列表中移除该任务项
 */
const handleCancelOrDelete = async (file) => {
  try {
    const status = file.status
    if (status === 'pending' || status === 'processing' || status === 'uploading') {
      await kbStore.cancelUploadTask(file.id)
    } else {
      await kbStore.deleteUploadTask(file.id)
    }
  } catch (error) {
    console.error('处理取消/删除失败:', error)
  }
}

// --- Drag and Drop Handlers ---
function handleDragOver() {
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

async function handleDrop(event) {
  isDragging.value = false;
  if (!props.selectedKbId) return;

  const items = event.dataTransfer.items;
  if (!items) {
    const files = event.dataTransfer.files
    if (!files || files.length === 0) return
    kbStore.addFilesToQueue(props.selectedKbId, Array.from(files), {
      onDuplicateFilesSkipped: notifyDuplicateFilesSkipped
    })
    return
  }
  
  const promises = [];

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry();
    if (entry) {
      promises.push(traverseEntry(entry));
    }
  }

  const nestedFiles = await Promise.all(promises);
  const allFiles = nestedFiles.flat(Infinity);

  const supportedFiles = allFiles.filter(file => {
    if (!(file instanceof File)) return false;
    const name = file.name;
    const lastDot = name.lastIndexOf('.');
    if (lastDot === -1 || lastDot === 0 || name.length === lastDot + 1) {
      return false;
    }
    const extension = name.substring(lastDot).toLowerCase();
    return SUPPORTED_FILE_TYPES.includes(extension);
  });

  if (supportedFiles.length > 0) {
    notifyPdfForceOcrLimitIfNeeded(supportedFiles);
    kbStore.addFilesToQueue(props.selectedKbId, supportedFiles, {
      onDuplicateFilesSkipped: notifyDuplicateFilesSkipped
    });
  }
}

/**
 * 递归遍历文件/文件夹入口
 */
async function traverseEntry(entry) {
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      entry.file(file => resolve(file), err => reject(err));
    });
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    return new Promise((resolve, reject) => {
      const iterationAttempts = [];
      const readEntries = () => {
        reader.readEntries(async (entries) => {
          if (entries.length) {
            iterationAttempts.push(Promise.all(entries.map(traverseEntry)));
            readEntries();
          } else {
            resolve(await Promise.all(iterationAttempts));
          }
        }, err => reject(err));
      };
      readEntries();
    });
  }
  return [];
}
</script>
