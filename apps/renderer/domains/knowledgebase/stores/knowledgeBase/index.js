/**
 * @file apps/renderer/features/KnowledgeBase/stores/knowledgeBase/index.js
 * 
 * @brief 知识库Store主入口
 * 
 * @description
 * 功能 (What): 知识库Store的主入口，组装所有功能模块
 * 输入 (Input): Pinia defineStore
 * 输出 (Output): 完整的知识库Store
 * 副作用 (Side-effects): 管理知识库列表、文档列表、上传任务等状态
 * 
 * 注意：本文件只负责组装，具体业务逻辑在各个子模块中实现
 */

import { defineStore } from 'pinia'
import { ref, reactive, watch } from 'vue'

// 工具函数和计算属性
import { getKnowledgeBaseById, getDocumentById, getKbNameById, formatFileSize } from './utils.js'
import { createCurrentKbComputed, createUploadTasksComputed } from './computed.js'

// 业务操作模块
import { 
  createFetchKnowledgeBases, 
  createSetCurrentKnowledgeBase, 
  createFetchDocuments, 
  createDeleteDocument, 
  createContinueFailedPdfPages,
  createUpdateKbModelSettings,
  createDeleteKnowledgeBase
} from './actions/fetchers.js'

import { createSetupIpcStatusListener } from './actions/ipcBridge.js'

import {
  createFetchInitialTaskStatus,
  createReplayPendingUpdates,
  createUpdateTaskState,
  createMapBackendToRealProgress
} from './actions/statusSync.js'

import {
  createAddFilesToQueue,
  createPerformUpload,
  createStartParsing,
  createScheduleNext,
  createCancelUploadTask,
  createRetryUploadTask,
  createDeleteUploadTask
} from './actions/uploadQueue.js'

import { createPollingManager } from './actions/polling.js'
import { resolveCurrentKnowledgeBaseMessage } from '../../functions/resolveCurrentKnowledgeBaseMessage'

// --- 全局初始化状态管理 ---
let isIpcListenerInitialized = false // 保证IPC监听只设置一次
let globalPollingManager = null
let globalIpcCleanup = null

export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
  // --- State ---
  const knowledgeBases = ref([])
  const documents = ref([])
  const uploadTasks = reactive(new Map())
  // [V166 修复] 引入专门的队列和活动任务池来管理并发
  const uploadQueue = ref([]) 
  const activeUploads = reactive(new Map())
  const currentKbId = ref(null)
  const isLoading = ref(false)
  const error = ref(null)
  const isParsing = ref(false)
  
  // 🔥 新增：解析设置状态
  const parsingSettings = reactive({
    forceVisionMode: false
  })
  
  let taskCounter = 0; // V44 Fix: Add a counter for unique task IDs
  let hasDataLoaded = false // Store实例级别的加载状态，防止重复加载

  // [新增] 未知 docId 的状态缓冲区：用于在任务尚未绑定 docId 时临时存放进度推送
  const pendingUpdatesByDocId = reactive(new Map())
  const pendingUpdatesByTaskId = reactive(new Map())

  // --- IPC状态推送监听器 ---
  let ipcCleanup = null;

  // 将状态打包为对象，便于传递给各个功能模块
  const state = {
    knowledgeBases,
    documents,
    uploadTasks,
    uploadQueue,
    activeUploads,
    currentKbId,
    isLoading,
    error,
    isParsing,
    parsingSettings, // 🔥 新增：包含解析设置状态
    taskCounter: () => taskCounter++, // 包装为函数
    pendingUpdatesByDocId,
    get ipcCleanup() { return ipcCleanup; },
    set ipcCleanup(value) { ipcCleanup = value; }
  }

  // --- 创建计算属性 ---
  const currentKb = createCurrentKbComputed(currentKbId, knowledgeBases)
  const uploadTasksComputed = createUploadTasksComputed(uploadTasks, knowledgeBases)

  // --- 创建功能函数（按依赖关系排序） ---
  
  // 1. 核心工具函数
  const mapBackendToRealProgress = createMapBackendToRealProgress()
  
  // 2. 基础数据获取
  const fetchDocuments = createFetchDocuments(state)
  const fetchKnowledgeBases = createFetchKnowledgeBases(state, fetchDocuments)
  const setCurrentKnowledgeBase = createSetCurrentKnowledgeBase(state, fetchDocuments)
  const deleteDocument = createDeleteDocument(state, fetchDocuments)
  const continueFailedPdfPages = createContinueFailedPdfPages(state, fetchDocuments)
  const updateKbModelSettings = createUpdateKbModelSettings(state)
  const deleteKnowledgeBase = createDeleteKnowledgeBase(state)

  // 3. 状态同步系统
  const updateTaskState = createUpdateTaskState(state, () => scheduleNext(), fetchDocuments, mapBackendToRealProgress)
  const fetchInitialTaskStatus = createFetchInitialTaskStatus(updateTaskState)
  const replayPendingUpdates = createReplayPendingUpdates(pendingUpdatesByDocId, updateTaskState)

  // 4. 队列管理系统
  const performUpload = createPerformUpload(state, updateTaskState, () => scheduleNext(), fetchInitialTaskStatus, replayPendingUpdates)
  const scheduleNext = createScheduleNext(state, performUpload, updateTaskState)
  const addFilesToQueue = createAddFilesToQueue(state)
  const startParsing = createStartParsing(state, scheduleNext)
  const cancelUploadTask = createCancelUploadTask(state, scheduleNext, updateTaskState)
  const retryUploadTask = createRetryUploadTask(state, startParsing, updateTaskState)
  const deleteUploadTask = createDeleteUploadTask(state)

  // [重构] 使用统一轮询管理器，确保全局只初始化一次
  if (!globalPollingManager) {
    globalPollingManager = createPollingManager(state, updateTaskState)
  }

  const setupPollingFallback = () => {
    globalPollingManager.startPolling(true) // true = 兜底模式
  }

  const setupCalibrationPolling = () => {
    globalPollingManager.startPolling(false) // false = 校准模式
  }

  const setupIpcStatusListener = createSetupIpcStatusListener(
    state, 
    updateTaskState, 
    pendingUpdatesByDocId, 
    fetchDocuments, 
    setupPollingFallback, 
    setupCalibrationPolling // 替代startWatchdog
  )
  
  const cleanupIpcListener = () => {
    if (globalIpcCleanup) {
      globalIpcCleanup()
      globalIpcCleanup = null
    }
    if (globalPollingManager) {
      globalPollingManager.stopPolling()
    }
  }

  // --- 工具函数包装（为了保持API兼容性） ---
  const getKnowledgeBaseByIdWrapper = (id) => getKnowledgeBaseById(knowledgeBases.value, id)
  const getDocumentByIdWrapper = (id) => getDocumentById(documents.value, id)
  const getKbNameByIdWrapper = (id) => getKbNameById(
    knowledgeBases.value,
    id,
    resolveCurrentKnowledgeBaseMessage('knowledgeBase.common.unknownKnowledgeBase')
  )

  // --- 全局初始化逻辑（确保只执行一次） ---
  if (!isIpcListenerInitialized) {
    // 设置IPC监听器（全局单例）
    setupIpcStatusListener()
    
    // 将清理函数保存到全局变量
    globalIpcCleanup = cleanupIpcListener
    
    // 在Electron环境中，监听应用退出事件
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.onAppQuit) {
      window.electronAPI.onAppQuit(() => {
        cleanupIpcListener()
      })
    }
    
    // 延迟重试机制（如果首次失败）
    setTimeout(() => {
      if (!globalIpcCleanup || !state.ipcCleanup) {
        setupIpcStatusListener()
      }
    }, 500)
    
    isIpcListenerInitialized = true
  }
  
  // --- 统一文档加载触发（单通道，避免双重触发） ---
  watch(currentKbId, async (newKbId, oldKbId) => {
    if (newKbId && newKbId !== oldKbId) {
      await fetchDocuments(newKbId)
    }
  }, { immediate: false }) // 不立即执行，避免初始化时的重复调用

  /**
   * 功能 (What): 同步“当前知识库”的文档数量到 knowledgeBases 列表中
   *
   * 背景：
   * - UI（列表页/详情页头部）展示用的是 knowledgeBases[].documentCount；
   * - 但上传/删除/清理时，store 更频繁更新的是 documents（当前KB文档列表）；
   * - 若不做同步，用户在上传/删除/清理后会看到“文档数量不变化”，造成误导。
   *
   * 约定：
   * - 文档数量语义为“该知识库下文档记录总数”（包含 completed/failed/duplicate 等状态）；
   * - 这里仅同步“当前选中 KB”，避免在未加载其它 KB 文档列表时做不可靠的推断。
   */
  const syncCurrentKbDocumentCountToKnowledgeBases = () => {
    const kbId = currentKbId.value
    if (!kbId) return
    if (!Array.isArray(knowledgeBases.value)) return
    if (!Array.isArray(documents.value)) return

    // documents 在当前架构里本就是“当前KB”的文档列表，这里仍按 kbId 过滤一次，防止未来数据结构调整带来误判
    const count = documents.value.filter((d) => d && d.kbId === kbId).length

    const index = knowledgeBases.value.findIndex((kb) => kb && kb.id === kbId)
    if (index === -1) return

    const oldKb = knowledgeBases.value[index] || {}
    // 用“替换数组项”的方式触发响应式更新，保证依赖方（computed/UI）能稳定刷新
    knowledgeBases.value[index] = {
      ...oldKb,
      documentCount: Math.max(0, Math.trunc(count)),
    }
  }

  // 响应式同步：切换KB或 documents 数量变化时都更新一次
  watch(
    () => [currentKbId.value, Array.isArray(documents.value) ? documents.value.length : 0],
    () => syncCurrentKbDocumentCountToKnowledgeBases(),
    { immediate: true }
  )

  // --- 懒加载机制（避免无限递归） ---
  const ensureDataLoaded = async () => {
    if (!hasDataLoaded && knowledgeBases.value.length === 0) {
      hasDataLoaded = true
      await fetchKnowledgeBases()
    }
  }

  // 🔥 新增：解析设置管理
  const updateParsingSettings = (newSettings) => {
    Object.assign(parsingSettings, newSettings)
    
    // 持久化到本地存储
    try {
      const settingsToSave = JSON.stringify(parsingSettings)
      localStorage.setItem('kb_parsing_settings', settingsToSave)
    } catch (error) {
      console.warn('[KnowledgeBase Store] ⚠️ 保存解析设置到本地存储失败:', error)
    }
  }

  const loadParsingSettings = () => {
    try {
      const savedSettings = localStorage.getItem('kb_parsing_settings')
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings)
        Object.assign(parsingSettings, parsedSettings)
      }
    } catch (error) {
      console.warn('[KnowledgeBase Store] ⚠️ 从本地存储加载解析设置失败:', error)
    }
  }

  // 初始化时加载保存的设置
  loadParsingSettings()

  return {
    // --- 状态 ---
    knowledgeBases,
    documents,
    uploadTasks,
    uploadTasksComputed,
    currentKbId,
    currentKb,
    isLoading,
    error,
    pendingUpdatesByTaskId,
    
    // --- 业务操作 ---
    fetchKnowledgeBases,
    ensureDataLoaded,  // 安全的懒加载函数
    setCurrentKnowledgeBase,
    fetchDocuments,
    deleteDocument,
    continueFailedPdfPages,
    updateKbModelSettings,
    
    // --- 上传队列管理 ---
    addFilesToQueue,
    startParsing,
    retryUploadTask,
    cancelUploadTask,
    deleteUploadTask,
    
    // --- 队列调度诊断 ---
    scheduleNext,
    
    // --- 系统管理 ---
    cleanupIpcListener,
    
    // --- 轮询状态查询（调试用） ---
    getPollingStatus: () => globalPollingManager ? globalPollingManager.getStatus() : null,
    
    // --- 便捷导出给调试工具 ---
    getKnowledgeBaseById: getKnowledgeBaseByIdWrapper,
    getDocumentById: getDocumentByIdWrapper,
    getKbNameById: getKbNameByIdWrapper,
    
    // --- 状态同步调试 ---
    pendingUpdatesByDocId,

    // --- 解析设置 ---
    parsingSettings,
    updateParsingSettings,

    // --- 知识库删除 ---
    deleteKnowledgeBase
  }
})
