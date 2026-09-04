import { computed, nextTick, reactive, ref, watch } from 'vue'
import { createMarkdownAnnotation, MarkdownAnnotationSchema } from '@app/schemas'

import { generateannotationId, generatePrefixedId } from '../../../../shared/utils/idUtils'
import {
  mergeDocumentAnnotations,
  readAnnotationsFromDocument,
  replaceRootBlockAnnotations,
} from './functions/annotationDocumentState'
import { resolveAnnotationRootBlockId } from './functions/rootBlockIdResolver'

export class AnnotationError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'AnnotationError'
    this.code = code
  }
}

/** 创建批注 read model。creating/editing 是 Renderer 临时态，不会进入文档。 */
export function createAnnotation({ blockId, content, id, position, author, state, meta }) {
  if (!blockId) {
    throw new AnnotationError('创建批注失败：缺少 blockId', 'MISSING_BLOCK_ID')
  }
  if (content === undefined || content === null) {
    throw new AnnotationError('创建批注失败：缺少 content 参数', 'MISSING_CONTENT')
  }

  const timestamp = new Date().toISOString()
  const annotationId = id || generateannotationId()
  const annotationAuthor = author || 'User'
  const annotationMeta = meta || { source: 'manual' }
  const annotationState = state || 'confirmed'
  if (isTransientState(annotationState)) {
    return {
      id: annotationId,
      blockId,
      content,
      position: position || { top: 0, left: 0 },
      author: annotationAuthor,
      state: annotationState,
      replies: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      meta: annotationMeta,
    }
  }
  if (annotationState !== 'confirmed') {
    throw new AnnotationError('创建批注失败：持久化初态必须是 confirmed', 'INVALID_INITIAL_STATE')
  }
  const persisted = createMarkdownAnnotation({
    id: annotationId,
    content,
    author: annotationAuthor,
    timestamp,
    meta: annotationMeta,
  })
  return {
    ...persisted,
    blockId,
    position: position || { top: 0, left: 0 },
  }
}

function isTransientState(state) {
  return state === 'creating' || state === 'editing'
}

function isPosition(value) {
  return value
    && typeof value.top === 'number'
    && typeof value.left === 'number'
    && Number.isFinite(value.top)
    && Number.isFinite(value.left)
}

function omitBlockId(annotation) {
  const payload = { ...annotation }
  delete payload.blockId
  return payload
}

/**
 * Annotation 的唯一事实源是 rootBlock.attrs.annotations。
 * store 只保留创建/编辑/布局等 Renderer 临时态，并从 editor.state.doc 派生读模型。
 */
export function useAnnotationStore(options = {}) {
  const { editor } = options
  const annotations = ref([])
  const annotationsIndexByBlockId = reactive(new Map())
  const EMPTY_ANNOTATIONS = Object.freeze([])
  const state = reactive({ batchOperationInProgress: false })
  let initialized = false

  const normalizeAnnotationBlockId = blockId => (
    resolveAnnotationRootBlockId(editor, blockId) || blockId
  )

  const calculatePosition = (blockId, currentPosition) => {
    if (isPosition(currentPosition) && (currentPosition.top !== 0 || currentPosition.left !== 0)) {
      return currentPosition
    }
    const calculate = editor?.panelPositionManager?.calculateInitialPositionCSS
    if (typeof calculate === 'function') {
      const css = calculate(blockId)
      if (css && typeof css.top === 'string' && typeof css.left === 'string') {
        const top = Number.parseFloat(css.top)
        const left = Number.parseFloat(css.left)
        if (Number.isFinite(top) && Number.isFinite(left)) return { top, left }
      }
    }
    return { top: 0, left: 0 }
  }

  const rebuildAnnotationsIndex = list => {
    annotationsIndexByBlockId.clear()
    for (const annotation of list) {
      const bucket = annotationsIndexByBlockId.get(annotation.blockId)
      if (bucket) bucket.push(annotation)
      else annotationsIndexByBlockId.set(annotation.blockId, [annotation])
    }
  }

  const replaceReadModel = nextAnnotations => {
    annotations.value = nextAnnotations
    rebuildAnnotationsIndex(nextAnnotations)
  }

  const synchronizeFromDocument = ({ preserveEditing = true } = {}) => {
    if (!editor || editor.isDestroyed) {
      replaceReadModel([])
      return
    }

    const currentById = new Map(annotations.value.map(annotation => [annotation.id, annotation]))
    const persisted = readAnnotationsFromDocument(editor.state.doc).map(annotation => {
      const current = currentById.get(annotation.id)
      return {
        ...annotation,
        state: preserveEditing && current?.state === 'editing' ? 'editing' : annotation.state,
        position: calculatePosition(annotation.blockId, current?.position),
      }
    })
    const creating = annotations.value.filter(annotation => annotation.state === 'creating')
    replaceReadModel([...persisted, ...creating])

    if (editor?.panelPositionManager?.handleOverlapsOnly) {
      nextTick(() => editor.panelPositionManager.handleOverlapsOnly())
    }
  }

  const getPersistedAnnotation = annotationId => (
    readAnnotationsFromDocument(editor.state.doc)
      .find(annotation => annotation.id === annotationId) || null
  )

  const writeBlockAnnotations = (blockId, nextAnnotations) => {
    const transaction = replaceRootBlockAnnotations(editor.state, blockId, nextAnnotations)
    editor.view.dispatch(transaction)
  }

  const persistAnnotation = annotation => {
    const { blockId, ...payload } = annotation
    const persisted = MarkdownAnnotationSchema.parse(payload)
    const blockAnnotations = readAnnotationsFromDocument(editor.state.doc)
      .filter(item => item.blockId === blockId)
      .map(omitBlockId)
    const existingIndex = blockAnnotations.findIndex(item => item.id === persisted.id)
    if (existingIndex >= 0) blockAnnotations.splice(existingIndex, 1, persisted)
    else blockAnnotations.push(persisted)
    writeBlockAnnotations(blockId, blockAnnotations)
  }

  const annotationsByBlockId = computed(() => {
    const grouped = {}
    annotationsIndexByBlockId.forEach((bucket, blockId) => {
      grouped[blockId] = bucket
    })
    return grouped
  })

  const annotationsByState = computed(() => {
    const grouped = { creating: [], editing: [], confirmed: [], resolved: [] }
    for (const annotation of annotations.value) {
      if (grouped[annotation.state]) grouped[annotation.state].push(annotation)
    }
    return grouped
  })

  /** 文档加载完成后只需重新投影；不再接收旁路 annotations payload。 */
  const loadAnnotations = () => synchronizeFromDocument({ preserveEditing: false })
  const getCurrentAnnotations = () => [...annotations.value]

  const mergeAnnotationsFromDocumentJson = content => {
    const externalDocument = editor.schema.nodeFromJSON(content)
    const plan = mergeDocumentAnnotations(
      editor.state,
      readAnnotationsFromDocument(externalDocument)
    )
    if (plan.missingBlockIds.length > 0) {
      console.warn(
        '[useAnnotationStore] 后端批注对应的块已不在当前编辑器中:',
        plan.missingBlockIds
      )
    }
    if (plan.transaction) editor.view.dispatch(plan.transaction)
    return plan.mergedCount
  }

  const addAnnotation = annotationData => {
    if (annotationData.blockId === undefined || annotationData.content === undefined) {
      console.error('[useAnnotationStore] 添加批注失败: annotationData 必须包含 blockId 和 content')
      return null
    }

    const annotation = createAnnotation({
      ...annotationData,
      blockId: normalizeAnnotationBlockId(annotationData.blockId),
    })
    if (annotations.value.some(item => item.id === annotation.id)) return annotation

    if (annotation.state === 'creating') {
      replaceReadModel([...annotations.value, annotation])
      return annotation
    }

    persistAnnotation({
      id: annotation.id,
      content: annotation.content,
      author: annotation.author,
      state: annotation.state,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
      resolvedAt: annotation.state === 'resolved' ? annotation.updatedAt : null,
      replies: annotation.replies,
      meta: annotation.meta,
      blockId: annotation.blockId,
    })
    synchronizeFromDocument({ preserveEditing: false })
    return getAnnotationById(annotation.id)
  }

  const removeAnnotation = annotationId => {
    const current = getAnnotationById(annotationId)
    if (!current) return false
    if (current.state === 'creating') {
      replaceReadModel(annotations.value.filter(annotation => annotation.id !== annotationId))
      return true
    }

    const persisted = getPersistedAnnotation(annotationId)
    if (!persisted) return false
    const remaining = readAnnotationsFromDocument(editor.state.doc)
      .filter(annotation => annotation.blockId === persisted.blockId && annotation.id !== annotationId)
      .map(omitBlockId)
    writeBlockAnnotations(persisted.blockId, remaining)
    synchronizeFromDocument({ preserveEditing: false })
    return true
  }

  const updateAnnotation = (annotationId, updates) => {
    const current = getAnnotationById(annotationId)
    if (!current) return false

    if (updates.position !== undefined) {
      if (!isPosition(updates.position)) return false
      current.position = updates.position
    }

    const hasPersistentUpdate = ['content', 'state', 'replies']
      .some(key => Object.prototype.hasOwnProperty.call(updates, key))
    if (!hasPersistentUpdate) return true

    if (
      current.state === 'editing'
      && updates.state === 'confirmed'
      && updates.content === undefined
      && updates.replies === undefined
    ) {
      synchronizeFromDocument({ preserveEditing: false })
      return true
    }

    const nextState = updates.state ?? current.state
    if (isTransientState(nextState)) {
      Object.assign(current, updates)
      return true
    }

    const persisted = getPersistedAnnotation(annotationId)
    const timestamp = new Date().toISOString()
    const base = persisted || current
    const next = !persisted && current.state === 'creating' && nextState === 'confirmed'
      ? {
          ...createMarkdownAnnotation({
            id: base.id,
            content: updates.content ?? base.content,
            author: base.author,
            timestamp,
            meta: base.meta || { source: 'manual' },
          }),
          blockId: current.blockId,
        }
      : {
          id: base.id,
          content: updates.content ?? base.content,
          author: base.author,
          state: nextState,
          createdAt: base.createdAt,
          updatedAt: timestamp,
          resolvedAt: nextState === 'resolved' ? (base.resolvedAt || timestamp) : null,
          replies: updates.replies ?? base.replies ?? [],
          meta: base.meta || { source: 'manual' },
          blockId: current.blockId,
        }
    persistAnnotation(next)
    synchronizeFromDocument({ preserveEditing: false })
    return true
  }

  const addReply = async (annotationId, replyInput) => {
    const annotation = getAnnotationById(annotationId)
    const content = replyInput?.content
    if (!annotation || typeof content !== 'string' || !content.trim()) return null

    const reply = {
      id: replyInput.id || generatePrefixedId('anno-reply'),
      content,
      author: replyInput.author || 'User',
      createdAt: replyInput.createdAt || new Date().toISOString(),
    }
    return updateAnnotation(annotationId, {
      replies: [...(annotation.replies || []), reply],
    }) ? reply : null
  }

  function getRepliesByAnnotationId(annotationId) {
    const annotation = getAnnotationById(annotationId)
    return annotation && Array.isArray(annotation.replies) ? [...annotation.replies] : []
  }

  function getAnnotationsByBlockId(blockId) {
    if (!blockId) return EMPTY_ANNOTATIONS
    return annotationsIndexByBlockId.get(normalizeAnnotationBlockId(blockId)) || EMPTY_ANNOTATIONS
  }

  function getAllAnnotations() {
    return [...annotations.value]
  }

  function getAnnotationById(annotationId) {
    return annotations.value.find(annotation => annotation.id === annotationId) || null
  }

  const handleAnnotationUpdate = event => {
    const detail = event.detail
    if (!detail) return
    if (detail.type === 'add') addAnnotation(detail)
    else if (detail.type === 'remove') removeAnnotation(detail.id)
    else if (detail.type === 'update' || detail.type === 'updateState') {
      updateAnnotation(detail.id, {
        ...(detail.content !== undefined ? { content: detail.content } : {}),
        ...(detail.state !== undefined ? { state: detail.state } : {}),
      })
    }
  }

  const handleEditorTransaction = ({ transaction }) => {
    if (transaction.docChanged) synchronizeFromDocument()
  }

  function startBatchOperation() {
    state.batchOperationInProgress = true
  }

  function endBatchOperation() {
    state.batchOperationInProgress = false
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new window.CustomEvent('annotations-batch-updated', {
        detail: { annotations: [...annotations.value] },
      }))
    }
  }

  const initialize = () => {
    if (initialized) return
    initialized = true
    editor.on('transaction', handleEditorTransaction)
    if (typeof window !== 'undefined') {
      window.addEventListener('annotation-update', handleAnnotationUpdate)
    }
    synchronizeFromDocument({ preserveEditing: false })
  }

  const cleanup = () => {
    if (!initialized) return
    initialized = false
    editor.off('transaction', handleEditorTransaction)
    if (typeof window !== 'undefined') {
      window.removeEventListener('annotation-update', handleAnnotationUpdate)
    }
  }

  watch(annotations, (next, previous) => {
    if (!state.batchOperationInProgress && typeof window !== 'undefined') {
      window.dispatchEvent(new window.CustomEvent('annotations-changed', {
        detail: {
          annotations: [...next],
          prev: previous ? [...previous] : [],
        },
      }))
    }
  }, { deep: true })

  return {
    editor,
    annotations,
    annotationsByBlockId,
    annotationsByState,
    addAnnotation,
    removeAnnotation,
    updateAnnotation,
    addReply,
    getRepliesByAnnotationId,
    getAnnotationsByBlockId,
    getAllAnnotations,
    getAnnotationById,
    startBatchOperation,
    endBatchOperation,
    createAnnotation,
    initialize,
    cleanup,
    loadAnnotations,
    getCurrentAnnotations,
    mergeAnnotationsFromDocumentJson,
  }
}

export default useAnnotationStore
