import { parentPort } from 'node:worker_threads';
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
  const pdf = createTextPdf([Array.from({ length: 15 }, (_, index) => `Text line ${index} has sufficient ordinary content for direct PDF extraction.`)]);
  const count = await countPluginPdfPages(pdf);
  const parsed = await parsePluginDocument({
    bytes: pdf, documentId: 'worker-pdf', filename: 'worker.pdf', temporaryDirectory: process.cwd(),
  }, inference);
  const text = await parsePluginDocument({
    bytes: new TextEncoder().encode('Worker owns no credentials'), documentId: 'worker-text', filename: 'worker.md', temporaryDirectory: process.cwd(),
  }, inference);
  parentPort?.postMessage({ count, pipeline: parsed.diagnostics?.pipeline, pages: parsed.diagnostics?.parsedPages, text: text.blocks[0]?.text });
  parentPort?.close();
}
void main().catch(error => { throw error; });
