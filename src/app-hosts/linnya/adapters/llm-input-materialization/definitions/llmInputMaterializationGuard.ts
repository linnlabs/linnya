import type { ModelInputPlacement } from '@linnlabs/linnkit/runtime-kernel';

export interface DurableAttachmentPresence {
  readonly found: boolean;
  readonly placements: readonly ModelInputPlacement[];
}
