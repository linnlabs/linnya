import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'

/** @typedef {import('../../definitions/knowledgeBaseRuntime').KnowledgeBaseCatalogItem} KnowledgeBaseCatalogItem */
/** @typedef {import('../../definitions/knowledgeBaseRuntime').KnowledgeBaseUploadTask} KnowledgeBaseUploadTask */

/** 只持有知识库事实；请求、队列调度、订阅与本地持久化由运行编排持有。 */
export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
  /** @type {import('vue').Ref<KnowledgeBaseCatalogItem[]>} */
  const knowledgeBases = ref([])
  /** @type {import('vue').Ref<unknown[]>} */
  const documents = ref([])
  /** @type {Map<string, KnowledgeBaseUploadTask>} */
  const uploadTasks = reactive(new Map())
  /** @type {import('vue').Ref<KnowledgeBaseUploadTask[]>} */
  const uploadQueue = ref([])
  /** @type {Map<string, KnowledgeBaseUploadTask>} */
  const activeUploads = reactive(new Map())
  /** @type {import('vue').Ref<string | null>} */
  const currentKbId = ref(null)
  const isLoading = ref(false)
  /** @type {import('vue').Ref<string | null>} */
  const error = ref(null)
  const isParsing = ref(false)
  const parsingSettings = reactive({ forceVisionMode: false })
  /** @type {Map<string, Record<string, unknown>>} */
  const pendingUpdatesByDocId = reactive(new Map())
  /** @type {Map<string, Record<string, unknown>>} */
  const pendingUpdatesByTaskId = reactive(new Map())

  function setKnowledgeBases(value) { knowledgeBases.value = value }
  function replaceKnowledgeBaseAt(index, value) { knowledgeBases.value[index] = value }
  function setDocuments(value) { documents.value = value }
  function setCurrentKbId(value) { currentKbId.value = value }
  function setLoading(value) { isLoading.value = value }
  function setError(value) { error.value = value }
  function setParsing(value) { isParsing.value = value }
  function setUploadTask(id, task) { uploadTasks.set(id, task) }
  function patchUploadTask(task, changes) { Object.assign(task, changes) }
  function removeUploadTask(id) { uploadTasks.delete(id) }
  function enqueueTask(task) { uploadQueue.value.push(task) }
  function shiftQueuedTask() { return uploadQueue.value.shift() }
  function removeQueuedTaskAt(index) { uploadQueue.value.splice(index, 1) }
  function setActiveUpload(id, task) { activeUploads.set(id, task) }
  function removeActiveUpload(id) { activeUploads.delete(id) }
  function setPendingTaskUpdate(id, update) { pendingUpdatesByTaskId.set(id, update) }
  function removePendingTaskUpdate(id) { pendingUpdatesByTaskId.delete(id) }
  function setPendingDocumentUpdate(id, update) { pendingUpdatesByDocId.set(id, update) }
  function removePendingDocumentUpdate(id) { pendingUpdatesByDocId.delete(id) }
  function setParsingSettings(settings) { Object.assign(parsingSettings, settings) }

  return {
    knowledgeBases, documents, uploadTasks, uploadQueue, activeUploads, currentKbId,
    isLoading, error, isParsing, parsingSettings, pendingUpdatesByDocId, pendingUpdatesByTaskId,
    setKnowledgeBases, replaceKnowledgeBaseAt, setDocuments, setCurrentKbId, setLoading, setError, setParsing,
    setUploadTask, patchUploadTask, removeUploadTask, enqueueTask, shiftQueuedTask,
    removeQueuedTaskAt, setActiveUpload, removeActiveUpload, setPendingTaskUpdate,
    removePendingTaskUpdate, setPendingDocumentUpdate, removePendingDocumentUpdate, setParsingSettings,
  }
})
