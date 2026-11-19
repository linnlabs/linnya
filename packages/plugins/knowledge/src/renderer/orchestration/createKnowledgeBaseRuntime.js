import { storeToRefs } from 'pinia'
import { effectScope, watch } from 'vue'
import { createTimer } from '@linnya/renderer-ui'
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
import { stopAllAnimations } from '../services/progressAnimator.js'

/** 每个 Pinia owner 只装配一次；技术计数、请求代次、订阅与定时器都不进入业务状态。 */
export function createKnowledgeBaseRuntime(store) {
  const { knowledgeBases, documents, currentKbId, isLoading, error } = storeToRefs(store)
  let taskCounter = 0
  let hasDataLoaded = false
  let loadingCatalog = null
  let ipcCleanup = null
  const scope = effectScope(true)
  let disposed = false
  // 旧请求可以晚于停用返回，但只能向它所属的活动运行 owner 发布状态。
  /** @template {unknown[]} Args @template Result
   * @param {(...args: Args) => Result} action
   * @returns {(...args: Args) => Result | undefined} */
  const publish = action => (...args) => disposed ? undefined : action(...args)
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
    setKnowledgeBases: publish(store.setKnowledgeBases),
    replaceKnowledgeBaseAt: publish(store.replaceKnowledgeBaseAt),
    setDocuments: publish(store.setDocuments),
    setCurrentKbId: publish(store.setCurrentKbId),
    setLoading: publish(store.setLoading),
    setError: publish(store.setError),
    setParsing: publish(store.setParsing),
    setUploadTask: publish(store.setUploadTask),
    patchUploadTask: publish(store.patchUploadTask),
    removeUploadTask: publish(store.removeUploadTask),
    enqueueTask: publish(store.enqueueTask),
    shiftQueuedTask: publish(store.shiftQueuedTask),
    removeQueuedTaskAt: publish(store.removeQueuedTaskAt),
    setActiveUpload: publish(store.setActiveUpload),
    removeActiveUpload: publish(store.removeActiveUpload),
    setPendingTaskUpdate: publish(store.setPendingTaskUpdate),
    removePendingTaskUpdate: publish(store.removePendingTaskUpdate),
    setPendingDocumentUpdate: publish(store.setPendingDocumentUpdate),
    removePendingDocumentUpdate: publish(store.removePendingDocumentUpdate),
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
  const updateTaskState = publish(createUpdateTaskState(state, () => scheduleNext(), fetchDocuments, createMapBackendToRealProgress()))
  const fetchInitialTaskStatus = createFetchInitialTaskStatus(updateTaskState)
  const replayPendingUpdates = createReplayPendingUpdates(state, store.pendingUpdatesByDocId, updateTaskState)
  const performUpload = createPerformUpload(state, updateTaskState, fetchInitialTaskStatus, replayPendingUpdates)
  const scheduleNext = publish(createScheduleNext(state, performUpload, updateTaskState))
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

  // preload 的 electronAPI 是同步暴露的，没有“稍后就绪”的事件可等：首次没挂上订阅时只补一次有界重试，
  // 应用退出时取消。运行时与应用同寿命，不随组件卸载，所以用 createTimer 而不是 useTimer。
  const ipcSetupRetryTimer = createTimer()

  // 清理真实的 IPC 订阅，而不是把 cleanupIpcListener 本身存回全局后递归调用。
  function cleanupIpcListener() {
    if (disposed) return
    disposed = true
    ipcSetupRetryTimer.cancel()
    store.setParsing(false)
    store.setLoading(false)
    stopAllAnimations()
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
  ipcSetupRetryTimer.start(() => {
    if (!ipcCleanup && !disposed) setupIpcStatusListener()
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
    if (hasDataLoaded) return
    if (!loadingCatalog) loadingCatalog = fetchKnowledgeBases().then(() => {
      if (error.value) throw new Error(error.value)
      hasDataLoaded = true
    }).finally(() => { loadingCatalog = null })
    await loadingCatalog
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
