import type { ParsedBlock } from '../../types';
import type { OcrErrorKind } from './ocrErrors';

export type PdfParsePipeline =
  | 'text_extraction'
  | 'geometric_analysis'
  | 'vision_document_upload'
  | 'vision_page_image';

export interface PdfPageDiagnostic {
  pageNumber: number;
  errorKind: OcrErrorKind;
  message: string;
  retryable: boolean;
  shouldReduceConcurrency: boolean;
  shouldSplitSmaller: boolean;
}

export interface PdfParseDiagnostics {
  parser: 'pdf';
  pipeline: PdfParsePipeline;
  totalPages: number;
  parsedPages: number[];
  failedPages: PdfPageDiagnostic[];
  isPartial: boolean;
  createdAt: number;
}

export interface PdfParseOutcome {
  blocks: ParsedBlock[];
  diagnostics: PdfParseDiagnostics;
}

function readPageNumber(block: ParsedBlock): number | undefined {
  const pageNumber = block.source_info?.page_number;
  if (typeof pageNumber !== 'number' || !Number.isFinite(pageNumber) || pageNumber <= 0) {
    return undefined;
  }
  return Math.floor(pageNumber);
}

export function collectParsedPages(blocks: ParsedBlock[]): number[] {
  return Array.from(
    new Set(
      blocks
        .map(readPageNumber)
        .filter((pageNumber): pageNumber is number => typeof pageNumber === 'number')
    )
  ).sort((a, b) => a - b);
}

export function createPdfParseDiagnostics(args: {
  pipeline: PdfParsePipeline;
  totalPages: number;
  blocks: ParsedBlock[];
  failedPages?: PdfPageDiagnostic[];
}): PdfParseDiagnostics {
  const failedPages = args.failedPages ?? [];

  return {
    parser: 'pdf',
    pipeline: args.pipeline,
    totalPages: args.totalPages,
    parsedPages: collectParsedPages(args.blocks),
    failedPages,
    isPartial: failedPages.length > 0 && args.blocks.length > 0,
    createdAt: Date.now(),
  };
}
