import type {
  ExportArtifactCommitRequest,
  ExportArtifactCommitResult,
} from '@plugin/backend/exportArtifact';
import type { ExportedPresentationFile } from '../../../engine/types';
import type { DeckSpec, PresentationImageExportProgress } from '@plugin/slides/shared';
import type {
  PresentationPageRasterizationOptions,
  PresentationPageRasterRequest,
  PresentationPageRasterResult,
  PresentationPageRasterSource,
} from '../../presentationPageRasterization';
import type { RasterPdfDocumentRequest } from '@plugin/backend/pdfDocumentRuntime';

export interface PresentationExportRasterSource extends PresentationPageRasterSource {
  readonly deckSpec: DeckSpec;
}

export interface PresentationExportRuntimePorts {
  readonly loadNativePptx: (nodeId: string) => Promise<ExportedPresentationFile>;
  readonly loadRasterSource: (nodeId: string) => Promise<PresentationExportRasterSource>;
  readonly rasterizePages: (
    request: PresentationPageRasterRequest,
    options?: PresentationPageRasterizationOptions,
  ) => Promise<PresentationPageRasterResult>;
  readonly reportImageProgress: (progress: PresentationImageExportProgress) => void;
  readonly renderRasterPdf: (request: RasterPdfDocumentRequest) => Promise<Uint8Array>;
  readonly assembleDeck: (nodeId: string, deckSpec: DeckSpec) => Promise<Uint8Array>;
  readonly commitArtifact: (
    request: ExportArtifactCommitRequest,
  ) => Promise<ExportArtifactCommitResult>;
}
