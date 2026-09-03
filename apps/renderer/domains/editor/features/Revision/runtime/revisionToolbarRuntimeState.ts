export interface RevisionToolbarRuntimeSnapshot {
  toolbarBlockIds: readonly string[]
}

export type RevisionToolbarRuntimeListener = (snapshot: RevisionToolbarRuntimeSnapshot) => void

let toolbarBlockIds: readonly string[] = []
const listeners = new Set<RevisionToolbarRuntimeListener>()

function getSnapshot(): RevisionToolbarRuntimeSnapshot {
  return {
    toolbarBlockIds,
  }
}

function normalizeBlockIds(blockIds: readonly string[]): string[] {
  const normalizedBlockIds: string[] = []
  const seen = new Set<string>()

  blockIds.forEach((blockId) => {
    const normalized = blockId.trim()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    normalizedBlockIds.push(normalized)
  })

  return normalizedBlockIds
}

function areSameBlockIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((blockId, index) => blockId === right[index])
}

function notifyListeners(): void {
  const snapshot = getSnapshot()
  listeners.forEach((listener) => {
    listener(snapshot)
  })
}

export function publishRevisionToolbarBlockIds(blockIds: readonly string[]): void {
  const nextBlockIds = normalizeBlockIds(blockIds)
  if (areSameBlockIds(toolbarBlockIds, nextBlockIds)) return

  toolbarBlockIds = nextBlockIds
  notifyListeners()
}

export function getRevisionToolbarRuntimeSnapshot(): RevisionToolbarRuntimeSnapshot {
  return getSnapshot()
}

export function subscribeRevisionToolbarRuntimeState(
  listener: RevisionToolbarRuntimeListener,
  options: { replayCurrent?: boolean } = {}
): () => void {
  listeners.add(listener)
  if (options.replayCurrent) listener(getSnapshot())

  return () => {
    listeners.delete(listener)
  }
}

export function resetRevisionToolbarRuntimeState(): void {
  toolbarBlockIds = []
  notifyListeners()
}
