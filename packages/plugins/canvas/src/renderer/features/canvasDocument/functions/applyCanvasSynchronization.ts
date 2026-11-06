import type { CanvasSnapshot, CanvasSynchronization } from '@plugin/canvas/shared';

/** 后端提交序号是唯一同步顺序，旧推送不能覆盖新事实。 */
export function applyCanvasSynchronization(
  current: CanvasSnapshot,
  update: CanvasSynchronization
): CanvasSnapshot {
  if (update.kind === 'snapshot') {
    if (update.snapshot.documentId !== current.documentId)
      throw new Error('Canvas snapshot belongs to another document');
    return update.snapshot.sequence < current.sequence ? current : update.snapshot;
  }
  if (update.documentId !== current.documentId || update.fromSequence !== current.sequence) {
    throw new Error('Canvas delta does not continue the installed snapshot');
  }
  const elements = new Map(current.elements.map(element => [element.id, element]));
  let sequence = current.sequence;
  for (const commit of update.commits) {
    if (commit.sequence !== sequence + 1) throw new Error('Canvas delta sequence has a gap');
    for (const change of commit.changes) {
      if (change.after) elements.set(change.id, change.after);
      else elements.delete(change.id);
    }
    sequence = commit.sequence;
  }
  if (sequence !== update.sequence)
    throw new Error('Canvas delta terminal sequence is inconsistent');
  return { ...current, sequence, elements: [...elements.values()] };
}
