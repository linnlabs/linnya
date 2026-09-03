import type { ModelInputPlacement } from 'linnkit/runtime-kernel';

export interface DurableAttachmentPresence {
  readonly found: boolean;
  readonly placements: readonly ModelInputPlacement[];
}
