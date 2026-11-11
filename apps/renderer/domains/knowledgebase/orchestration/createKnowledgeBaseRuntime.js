import { storeToRefs } from 'pinia'
import { effectScope, watch } from 'vue'
import { getKnowledgeBaseById, getDocumentById, getKbNameById } from '../functions/knowledgeBaseQueries.js'
import { createCurrentKbComputed, createUploadTasksComputed } from '../composables/knowledgeBaseReadModel.js'
import {
  createFetchKnowledgeBases, createSetCurrentKnowledgeBase, createFetchDocuments,
  createDeleteDocument, createContinueFailedPdfPages, createUpdateKbModelSettings, createDeleteKnowledgeBase,
} from '../features/catalog/orchestration/fetchers.js'
import { createSetupIpcStatusListener } from '../features/upload-queue/orchestration/ipcBridge.js'
import { createFetchInitialTaskStatus, createReplayPendingUpdates, createUpdateTaskState } from '../features/upload-queue/orchestration/statusSync.js'
import { createMapBackendToRealProgress } from '../functions/uploadTaskProgress.js'
import {
  createAddFilesToQueue, createPerformUpload, createStartParsing, createScheduleNext,
  createCancelUploadTask, createRetryUploadTask, createDeleteUploadTask,
} from '../features/upload-queue/orchestration/uploadQueue.js'
import { createPollingManager } from '../features/upload-queue/orchestration/polling.js'
import { resolveCurrentKnowledgeBaseMessage } from '../functions/resolveCurrentKnowledgeBaseMessage'
import { projectCurrentKnowledgeBaseDocumentCount } from '../functions/projectCurrentKnowledgeBaseDocumentCount.js'

/** 每个 Pinia owner 只装配一次；技术计数、请求代次、订阅与定时器都不进入业务状态。 */
export function createKnowledgeBaseRuntime(store) {
  const { knowledgeBases, documents, currentKbId, isLoading, error } = storeToRefs(store)
  let taskCounter = 0
  let hasDataLoaded = false
  let ipcCleanup = null
  const scope = effectScope(true)
  const state = {
    ...storeToRefs(store),
    uploadTasks: store.uploadTasks,
    activeUploads: store.activeUploads,
    parsingSettings: store.parsingSettings,
    pendingUpdatesByDocId: store.pendingUpdatesByDocId,
    pendingUpdatesByTaskId: store.pendingUpdatesByTaskId,
    taskCounter: () => taskCounter++,
    get ipcCleanup() { return ipcCleanup },
    set ipcCleanup(value) { ipcCleanup = value },
    setKnowledgeBases: store.setKnowledgeBases,
    replaceKnowledgeBaseAt: store.replaceKnowledgeBaseAt,
    setDocuments: store.setDocuments,
    setCurrentKbId: store.setCurrentKbId,
    setLoading: store.setLoading,
    setError: store.setError,
    setParsing: store.setParsing,
    setUploadTask: store.setUploadTask,
    patchUploadTask: store.patchUploadTask,
    removeUploadTask: store.removeUploadTask,
    enqueueTask: store.enqueueTask,
    shiftQueuedTask: store.shiftQueuedTask,
    removeQueuedTaskAt: store.removeQueuedTaskAt,
    setActiveUpload: store.setActiveUpload,
    removeActiveUpload: store.removeActiveUpload,
    setPendingTaskUpdate: store.setPendingTaskUpdate,
    removePendingTaskUpdate: store.removePendingTaskUpdate,
    setPendingDocumentUpdate: store.setPendingDocumentUpdate,
    removePendingDocumentUpdate: store.removePendingDocumentUpdate,
  }
  const currentKb = createCurrentKbComputed(currentKbId, knowledgeBases)
  const uploadTasksComputed = createUploadTasksComputed(store.uploadTasks, knowledgeBases)
  const fetchDocuments = createFetchDocuments(state)
  const fetchKnowledgeBases = createFetchKnowledgeBases(state)
  const setCurrentKnowledgeBase = createSetCurrentKnowledgeBase(state)
  const deleteDocument = createDeleteDocument(state, fetchDocuments)
  const continueFailedPdfPages = createContinueFailedPdfPages(fetchDocuments)
  const updateKbModelSettings = createUpdateKbModelSettings(state)
  const deleteKnowledgeBase = createDeleteKnowledgeBase(state)
  const updateTaskState = createUpdateTaskState(state, () => scheduleNext(), fetchDocuments, createMapBackendToRealProgress())
  const fetchInitialTaskStatus = createFetchInitialTaskStatus(updateTaskState)
  const replayPendingUpdates = createReplayPendingUpdates(state, store.pendingUpdatesByDocId, updateTaskState)
  const performUpload = createPerformUpload(state, updateTaskState, fetchInitialTaskStatus, replayPendingUpdates)
  const scheduleNext = createScheduleNext(state, performUpload, updateTaskState)
  const addFilesToQueue = createAddFilesToQueue(state)
  const startParsing = createStartParsing(state, scheduleNext)
  const cancelUploadTask = createCancelUploadTask(state, scheduleNext, updateTaskState)
  const retryUploadTask = createRetryUploadTask(state, startParsing)
  const deleteUploadTask = createDeleteUploadTask(state)
  const polling = createPollingManager(state, updateTaskState)
  const setupIpcStatusListener = createSetupIpcStatusListener(
    state, updateTaskState, store.pendingUpdatesByDocId, fetchDocuments,
    () => polling.startPolling(true), () => polling.startPolling(false),
  )

  // 清理真实的 IPC 订阅，而不是把 cleanupIpcListener 本身存回全局后递归调用。
  function cleanupIpcListener() {
    clearTimeout(retryTimer)
    if (ipcCleanup) {
      ipcCleanup()
      ipcCleanup = null
    }
    polling.stopPolling()
    scope.stop()
  }
  setupIpcStatusListener()
  if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onAppQuit) {
    window.electronAPI.onAppQuit(cleanupIpcListener)
  }
  const retryTimer = setTimeout(() => {
    if (!ipcCleanup) setupIpcStatusListener()
  }, 500)

  // 监听属于应用运行 owner，不随第一次打开它的组件卸载而停止。
  scope.run(() => {
    watch(currentKbId, async (newKbId, oldKbId) => {
      if (newKbId && newKbId !== oldKbId) await fetchDocuments(newKbId)
    })
    watch(
      () => [currentKbId.value, Array.isArray(documents.value) ? documents.value.length : 0],
      () => {
        const projection = projectCurrentKnowledgeBaseDocumentCount(knowledgeBases.value, documents.value, currentKbId.value)
        if (projection) store.replaceKnowledgeBaseAt(projection.index, projection.value)
      },
      { immediate: true },
    )
  })

  async function ensureDataLoaded() {
    if (!hasDataLoaded && knowledgeBases.value.length === 0) {
      hasDataLoaded = true
      await fetchKnowledgeBases()
    }
  }
  function updateParsingSettings(settings) {
    store.setParsingSettings(settings)
    try {
      localStorage.setItem('kb_parsing_settings', JSON.stringify(store.parsingSettings))
    } catch (error) {
      console.warn('[KnowledgeBase Store] ⚠️ 保存解析设置到本地存储失败:', error)
    }
  }
  try {
    const savedSettings = localStorage.getItem('kb_parsing_settings')
    if (savedSettings) store.setParsingSettings(JSON.parse(savedSettings))
  } catch (error) {
    console.warn('[KnowledgeBase Store] ⚠️ 从本地存储加载解析设置失败:', error)
  }

  // 公开读方法与命令的普通门面；不把异步函数挂回 Pinia store，也不复制状态。
  return {
    get knowledgeBases() { return knowledgeBases.value },
    get documents() { return documents.value },
    get uploadTasks() { return store.uploadTasks },
    get uploadTasksComputed() { return uploadTasksComputed.value },
    get currentKbId() { return currentKbId.value },
    get currentKb() { return currentKb.value },
    get isLoading() { return isLoading.value },
    get error() { return error.value },
    get pendingUpdatesByTaskId() { return store.pendingUpdatesByTaskId },
    get pendingUpdatesByDocId() { return store.pendingUpdatesByDocId },
    get parsingSettings() { return store.parsingSettings },
    fetchKnowledgeBases, ensureDataLoaded, setCurrentKnowledgeBase, fetchDocuments,
    deleteDocument, continueFailedPdfPages, updateKbModelSettings, deleteKnowledgeBase,
    addFilesToQueue, startParsing, retryUploadTask, cancelUploadTask, deleteUploadTask,
    scheduleNext, cleanupIpcListener, updateParsingSettings,
    getPollingStatus: polling.getStatus,
    getKnowledgeBaseById: id => getKnowledgeBaseById(knowledgeBases.value, id),
    getDocumentById: id => getDocumentById(documents.value, id),
    getKbNameById: id => getKbNameById(knowledgeBases.value, id, resolveCurrentKnowledgeBaseMessage('knowledgeBase.common.unknownKnowledgeBase')),
  }
}
