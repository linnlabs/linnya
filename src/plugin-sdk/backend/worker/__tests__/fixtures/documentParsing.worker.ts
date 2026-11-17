import { Logger } from '@plugin/backend/worker/loggingRuntime';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { countPluginPdfPages, parsePluginDocument } from '@plugin/backend/worker/documentParsingRuntime';
import type { DocumentParsingInference } from '@plugin/backend/worker/documentParsingRuntime';
import { createTextPdf } from '../../../../../features/parsers/pdfParser/testkit/createTextPdf';

const inference: DocumentParsingInference = {
  textGeneration: { async generate() { throw new Error('Unexpected model request'); } },
  documentOcr: {
    async resolveModelProfile() { throw new Error('Unexpected model profile lookup'); },
    async recognizeDocument() { throw new Error('Unexpected OCR request'); },
  },
};

async function main(): Promise<void> {
  const input: unknown = workerData;
  if (typeof input !== 'string') throw new Error('Missing task directory');
  const temporaryDirectory = input;
  const logger = new Logger('parser-worker');
  logger.info('starting parse');
  const pdf = createTextPdf([Array.from({ length: 15 }, (_, index) => `Text line ${index} has sufficient ordinary content for direct PDF extraction.`)]);
  const count = await countPluginPdfPages(pdf);
  const parsed = await parsePluginDocument({
    bytes: pdf, documentId: 'worker-pdf', filename: 'worker.pdf', temporaryDirectory,
  }, inference);
  const text = await parsePluginDocument({
    bytes: new TextEncoder().encode('Worker owns no credentials'), documentId: 'worker-text', filename: 'worker.md', temporaryDirectory,
  }, inference);
  const scanned = createTextPdf([null]);
  let uploads = 0;
  const ocr = await parsePluginDocument({
    bytes: scanned, documentId: 'worker-ocr', filename: 'scanned.pdf', temporaryDirectory,
    pdfOcrModelId: 'frozen-ocr', forceVisionMode: true,
  }, {
    textGeneration: inference.textGeneration,
    documentOcr: {
      async resolveModelProfile() { return { modelId: 'frozen-ocr', displayName: 'OCR', mode: 'document_upload', supportsAbortSignal: true, attemptTimeoutMs: 5000 }; },
      async recognizeDocument(request) {
        if (request.input.kind !== 'pdf_path') throw new Error('Expected document upload');
        if (path.relative(temporaryDirectory, request.input.path).startsWith('..')) throw new Error('Wrong task scope');
        if (!(await readFile(request.input.path)).equals(Buffer.from(scanned))) throw new Error('Wrong source bytes');
        uploads += 1;
        return { pages: [{ pageNumber: 1, markdown: 'Saved OCR source' }] };
      },
    },
  });
  logger.info('finished parse');
  parentPort?.postMessage({ count, pipeline: parsed.diagnostics?.pipeline, pages: parsed.diagnostics?.parsedPages, text: text.blocks[0]?.text, ocr: ocr.blocks[0]?.text, uploads, temporaryFiles: await readdir(temporaryDirectory) });
  parentPort?.close();
}
void main().catch(error => { throw error; });
