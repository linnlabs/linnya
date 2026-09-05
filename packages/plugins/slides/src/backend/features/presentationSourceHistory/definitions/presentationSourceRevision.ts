export const PRESENTATION_SOURCE_CHECKPOINT_INTERVAL = 25;

export type PresentationRevisionStorageKind = 'checkpoint' | 'patch';

export interface PresentationSourceRevisionPayload {
  readonly storageKind: PresentationRevisionStorageKind;
  readonly sourceHash: string;
  readonly baseSourceHash: string | null;
  readonly sourceCheckpoint: string | null;
  readonly sourcePatch: string | null;
  readonly patchBytes: number;
}

export interface PresentationStoredSourceRevision extends PresentationSourceRevisionPayload {
  readonly revisionId: string;
  readonly revision: number;
  readonly parentRevisionId: string | null;
}

export interface BuildPresentationSourceRevisionInput {
  readonly revision: number;
  readonly source: string;
  readonly parentSource: string | null;
  readonly accumulatedPatchBytes: number;
}

export interface PresentationSourceCompactionPlan {
  readonly retained: readonly PresentationStoredSourceRevision[];
  readonly removedRevisionIds: readonly string[];
}

export class PresentationSourceConsistencyError extends Error {
  readonly code = 'PRESENTATION_SOURCE_CONSISTENCY_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'PresentationSourceConsistencyError';
  }
}
