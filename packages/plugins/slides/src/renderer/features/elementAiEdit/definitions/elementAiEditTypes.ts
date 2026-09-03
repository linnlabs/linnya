import type {
  PptSourceSliceTargetInput,
  PptSourceSlicesOutput,
} from '../../../types/api';
import type {
  SourceSelectionEditSubmitPayload,
  SourceSelectableElement,
} from '../../sourceSelection';
import type { RendererAiInvocationUserQuote } from '@plugin/renderer/aiInvocationPort';

export type SlidesElementAiEditSubmitPayload = SourceSelectionEditSubmitPayload;

export interface SlidesElementAiEditSourceTarget extends PptSourceSliceTargetInput {
  summary?: string;
}

export interface SlidesElementAiEditFence {
  kind: string;
  content: string;
  attrs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SlidesElementAiEditContextInput {
  presentationId: string;
  payload: SlidesElementAiEditSubmitPayload;
  sourceSlices: PptSourceSlicesOutput;
}

export interface SlidesElementAiEditContext {
  visiblePrompt: string;
  selectedSlidesElementFence: SlidesElementAiEditFence;
  userQuote: RendererAiInvocationUserQuote;
}

export type SlidesElementAiEditTarget = SourceSelectableElement;
