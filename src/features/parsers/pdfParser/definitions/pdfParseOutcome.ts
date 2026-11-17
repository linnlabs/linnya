import type { ParsedBlock } from '../../types';
import type { PdfParseDiagnostics, PdfPageDiagnostic, PdfParsePipeline } from '@linnya/plugin-host-contract/backend/documentParsingRuntime';
export type { PdfParseDiagnostics, PdfPageDiagnostic, PdfParsePipeline, PdfParseOutcome } from '@linnya/plugin-host-contract/backend/documentParsingRuntime';

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
