import type { ReasoningEffort } from '@linnlabs/linnkit/contracts';

import type { AuxiliaryModelSelections } from './modelPurposes';

export interface ModelPurposeSelections {
  readonly primaryModelId: string | null;
  readonly primaryReasoningEffort: ReasoningEffort | null;
  readonly auxiliaryModelIds: AuxiliaryModelSelections;
  readonly embeddingModelId: string | null;
  readonly rerankModelId: string | null;
  readonly pdfOcrModelId: string | null;
  readonly imageVisionModelId: string | null;
  readonly imageGenerationModelId: string | null;
  readonly transcriptionModelId: string | null;
}

export type ModelBindingSlot =
  | 'primary'
  | 'embedding'
  | 'rerank'
  | 'pdf_ocr'
  | 'image_vision'
  | 'image_generation'
  | 'transcription';
