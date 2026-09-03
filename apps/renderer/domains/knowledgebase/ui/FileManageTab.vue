<!-- src/renderer/features/KnowledgeBase/ui/FileManageTab.vue -->
<!-- 文件管理Tab组件，负责已上传文档的查看和管理 -->

<template>
    <div class="manage-tab">
      <div class="file-list-container manage-list">
        <div class="file-list-header">
          <div class="col-name">{{ knowledgeBaseMessage('knowledgeBase.common.file') }}</div>
          <div class="col-size">{{ knowledgeBaseMessage('knowledgeBase.common.size') }}</div>
          <div class="col-category">{{ knowledgeBaseMessage('knowledgeBase.common.knowledgeBase') }}</div>
          <div class="col-parse-status">{{ knowledgeBaseMessage('knowledgeBase.manage.parseStatus') }}</div>
          <div class="col-upload-time">{{ knowledgeBaseMessage('knowledgeBase.manage.uploadTime') }}</div>
          <div class="col-actions">
            <button 
              @click="onClearAllClick" 
              class="action-link clear-all-btn warning-btn" 
              :disabled="kbDocsCount === 0 || isClearing"
            >
               {{ 
                 isClearing 
                 ? knowledgeBaseMessage('knowledgeBase.manage.clearing')
                 : knowledgeBaseMessage('knowledgeBase.manage.clearFiles')
               }}
            </button>
          </div>
        </div>
        
        <div v-if="managedFiles.length > 0" class="file-list-items">
          <div v-for="file in managedFiles" :key="file.id" class="file-item">
            <div class="col-name">
              <span class="file-name">{{ file.name }}</span>
            </div>
            <div class="col-size">{{ file.size }}</div>
            <div class="col-category">{{ file.category }}</div>
            <div class="col-parse-status">
              <span class="parse-status-badge" :class="{ 'is-partial': file.parseStatus.isPartial }">
                {{ file.parseStatus.label }}
              </span>
            </div>
            <div class="col-upload-time">{{ file.uploadTime }}</div>
            <div class="col-actions">
              <button
                v-if="file.canContinueFailedPages"
                @click="continueFailedPages(file.id)"
                class="action-link continue-btn"
                :disabled="isContinuing(file.id)"
              >
                {{
                  isContinuing(file.id)
                    ? knowledgeBaseMessage('knowledgeBase.manage.continueFailedPages.running')
                    : knowledgeBaseMessage('knowledgeBase.manage.continueFailedPages.action')
                }}
              </button>
              <button @click="deleteManagedFile(file.id)" class="action-link delete-btn">
                {{ knowledgeBaseMessage('knowledgeBase.common.delete') }}
              </button>
            </div>
          </div>
        </div>
        
        <div v-else class="empty-list-placeholder">
          <div class="empty-content">
            <p class="empty-title">{{ knowledgeBaseMessage('knowledgeBase.manage.empty.title') }}</p>
            <p class="empty-desc">
              {{ knowledgeBaseMessage('knowledgeBase.manage.empty.description') }}
            </p>
          </div>
        </div>
      </div>

      <!-- 确认删除全部文件的对话框 -->
      <AlertDialog
        :visible="showClearDialog"
        is-confirmation
        :title="knowledgeBaseMessage('knowledgeBase.manage.clearDialog.title')"
        :message="knowledgeBaseMessage('knowledgeBase.manage.clearDialog.message', { knowledgeBaseName: selectedKbName })"
        :confirm-text="knowledgeBaseMessage('knowledgeBase.manage.clearDialog.confirm')"
        @confirm="handleClearAll"
        @cancel="showClearDialog = false"
      />

      <!-- 清空失败的提示 -->
      <AlertDialog
        :visible="showErrorDialog"
        :title="knowledgeBaseMessage('knowledgeBase.manage.errorDialog.title')"
        :message="errorMessage"
        @close="showErrorDialog = false"
      />
    </div>
  </template>
  
  <script setup>
  import { computed, ref } from 'vue'
  import { useKnowledgeBaseStore } from '../stores/knowledgeBase'
  import { AlertDialog } from '@linnya/renderer-ui'
  import { confirm } from '@shared/composables/confirmDialog'
  import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization'
  
  // --- Props ---
  const props = defineProps({
    selectedKbId: String
  })
  
  // --- Store ---
  const kbStore = useKnowledgeBaseStore()
  const { currentLocale, knowledgeBaseMessage } = useKnowledgeBaseLocalization()
  
  // --- Refs for Dialogs and Loading State ---
  const showClearDialog = ref(false)
  const showErrorDialog = ref(false)
  const errorMessage = ref('')
  const isClearing = ref(false)
  const clearProgress = ref(0)
  const totalToDelete = ref(0)
  const continuingDocIds = ref(new Set())
  
  // --- Computed ---
  const managedFiles = computed(() => {
    // 功能 (What): 仅展示“已完成”的文档（duplicate 与 failed 均不展示）
    // 输入 (Input): 来自 store 的 documents 数组
    // 输出 (Output): UI 所需的简化文件对象数组
    // 副作用 (Side-effects): 无
    const filteredDocs = kbStore.documents
      .filter(doc => doc.status === 'completed' && (!props.selectedKbId || doc.kbId === props.selectedKbId))
    
    const result = filteredDocs.map(doc => ({
        id: doc.id,
        name: doc.filename,
        size: formatFileSize(doc.fileSize || 0),
        category: getKbNameById(doc.kbId),
        parseStatus: resolveParseStatus(doc),
        canContinueFailedPages: canContinueFailedPages(doc),
        uploadTime: formatDate(doc.createdAt)
      }));
    
    return result;
  })

  // 功能 (What): 统计当前知识库下的所有文档数量（不受 UI 过滤影响）
  // 输入 (Input): store.documents 与 props.selectedKbId
  // 输出 (Output): 当前知识库文档总数（包含 completed/duplicate/failed 等）
  // 副作用 (Side-effects): 无
  const kbDocsCount = computed(() => {
    if (!props.selectedKbId) return 0
    return kbStore.documents.filter(d => d.kbId === props.selectedKbId).length
  })
  
  const selectedKbName = computed(() => {
    if (!props.selectedKbId) {
      return ''
    }
    const kb = kbStore.getKnowledgeBaseById(props.selectedKbId)
    return kb ? kb.name : knowledgeBaseMessage('knowledgeBase.common.unknown')
  })
  
  // --- Methods ---
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
  
  const formatDate = (dateInSeconds) => {
    if (!dateInSeconds) return ''
    try {
      // [修复] 后端返回的是秒级时间戳，而 JS 的 Date 对象需要毫秒级
      const date = new Date(dateInSeconds * 1000)
      return date.toLocaleString(currentLocale.value)
    } catch (e) {
      return String(dateInSeconds)
    }
  }
  
  const getKbNameById = (kbId) => {
    const kb = kbStore.getKnowledgeBaseById(kbId)
    return kb ? kb.name : knowledgeBaseMessage('knowledgeBase.common.unknown')
  }

  const resolveParseStatus = (doc) => {
    const diagnostics = doc?.parseDiagnostics
    if (!diagnostics || diagnostics.isPartial !== true) {
      return {
        isPartial: false,
        label: knowledgeBaseMessage('knowledgeBase.manage.parseStatus.completed')
      }
    }

    const total = diagnostics.totalPages
    const parsed = diagnostics.parsedPages.length

    return {
      isPartial: true,
      label: knowledgeBaseMessage('knowledgeBase.manage.parseStatus.partial', { parsed, total })
    }
  }

  const canContinueFailedPages = (doc) => {
    return (
      doc?.parseDiagnostics?.isPartial === true &&
      Array.isArray(doc.parseDiagnostics.failedPages) &&
      doc.parseDiagnostics.failedPages.length > 0 &&
      typeof doc.filename === 'string' &&
      doc.filename.toLowerCase().endsWith('.pdf')
    )
  }

  const isContinuing = (docId) => continuingDocIds.value.has(docId)

  const continueFailedPages = async (docId) => {
    if (!props.selectedKbId || isContinuing(docId)) return
    continuingDocIds.value = new Set([...continuingDocIds.value, docId])

    try {
      await kbStore.continueFailedPdfPages(props.selectedKbId, docId)
    } catch (error) {
      console.error('[FileManageTab] 继续解析失败页失败:', error)
      errorMessage.value = knowledgeBaseMessage('knowledgeBase.manage.continueFailedPages.failed')
      showErrorDialog.value = true
    } finally {
      const next = new Set(continuingDocIds.value)
      next.delete(docId)
      continuingDocIds.value = next
    }
  }
  
  const deleteManagedFile = async (id) => {
    const doc = kbStore.documents.find(d => d.id === id);
    if (!doc || !props.selectedKbId) return
    const confirmed = await confirm({
      message: knowledgeBaseMessage('knowledgeBase.manage.deleteDocument.confirm', { fileName: doc.filename }),
      isDangerousAction: true,
    })
    if (!confirmed) return

    try {
      await kbStore.deleteDocument(props.selectedKbId, id)
    } catch (error) {
      console.error('[FileManageTab] 删除文档失败:', error)
      errorMessage.value = knowledgeBaseMessage('knowledgeBase.manage.deleteDocument.failed')
      showErrorDialog.value = true
    }
  }
  
  const onClearAllClick = () => {
    // 功能 (What): 仅当当前KB确实有文档时才弹出清空确认
    if (kbDocsCount.value > 0) {
      showClearDialog.value = true
    }
  }
  
  const handleClearAll = async () => {
    showClearDialog.value = false
    isClearing.value = true
    
    // 功能 (What): 清空当前KB中“所有文档”，而非仅 UI 显示的 completed
    // 输入 (Input): 当前KB ID，store.documents
    // 输出 (Output): 逐个调用后端删除 API
    const realDocs = kbStore.documents.filter(d => d.kbId === props.selectedKbId)
    const filesToDelete = realDocs.map(d => ({ id: d.id, name: d.filename }))
    totalToDelete.value = filesToDelete.length
    clearProgress.value = 0
    
    let failedCount = 0
    const failedFiles = []
    
    for (const file of filesToDelete) {
      try {
        await kbStore.deleteDocument(props.selectedKbId, file.id)
      } catch (error) {
        failedCount++
        failedFiles.push({ name: file.name, error: error.message })
        console.error(`[FileManageTab] 删除文件失败 ${file.name}:`, error)
        
        // 如果连续3个文件删除失败，则中止操作
        if (failedCount >= 3) {
           console.error(`[FileManageTab] 连续发生错误过多，中止清空操作。`)
           break
        }
      }
      clearProgress.value++
    }
    
    if (failedCount > 0) {
      const failedNames = failedFiles.map(f => f.name).join(', ')
      errorMessage.value = knowledgeBaseMessage('knowledgeBase.manage.clearPartialFailed', {
        deletedCount: clearProgress.value - failedCount,
        failedCount,
        failedNames
      })
      showErrorDialog.value = true
    }
    
    // 重置状态
    isClearing.value = false
    totalToDelete.value = 0
    clearProgress.value = 0
  }

  </script>
