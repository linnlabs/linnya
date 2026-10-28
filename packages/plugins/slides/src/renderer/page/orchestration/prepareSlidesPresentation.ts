import { resolveSlideStructureTargetIndex } from '../../features/deckNavigator/structureSelection';
import type { SlidesManualEditCommandOperation } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditQueueSnapshot } from '../../features/manualEditing';
import { useSlidesDocumentRuntime } from '../../features/documentRuntime';

/** 页面工作流连接队列和选页：重试期间保留同一意图，终态只确认一次。 */
export function prepareSlidesPresentation(operation: SlidesManualEditCommandOperation, snapshot: ManualEditQueueSnapshot) {
  const target = resolveSlideStructureTargetIndex(operation);
  if (target !== null && snapshot.buildState?.state === 'ready') {
    return useSlidesDocumentRuntime().prepareStructureSelection(
      target, snapshot.buildState.versionNumber,
    );
  }
  return (_revision: number | null): void => {};
}
