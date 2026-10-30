import type { PresentationSelectionInput } from '../definitions/documentPresentation';

export function resolvePresentationSelection(input: PresentationSelectionInput): number {
  // 旧数字页序只属于确认的那一修订；用户等待期间的新选择优先。
  const intent = input.intent;
  const target = intent && input.confirmedRevision === input.revision && intent.selectionEpoch === input.selectionEpoch
    ? intent.target : input.currentIndex;
  return Math.max(0, Math.min(target, input.slideCount - 1));
}

export function resolveRequestedSlideIndex(slideNumber: number, slideCount: number): number {
  return Math.min(Math.max(0, Math.trunc(slideNumber) - 1), Math.max(0, slideCount - 1));
}
