import { countPluginPdfPages, parsePluginDocument } from '@plugin/backend/documentParsingRuntime';
import { tokenizeForSearch } from '@plugin/backend/textSegmentationRuntime';
import { readdir } from 'node:fs/promises';
import { Logger } from '@plugin/backend/loggingRuntime';
import type { PluginInferencePort } from '@plugin/backend/inferenceRuntime';
import { createTextPdf } from '../../../../../../features/parsers/pdfParser/testkit/createTextPdf';

export async function runNativeProcessingFixture(job: unknown, inference: Pick<PluginInferencePort, 'textGeneration' | 'documentOcr'>) {
  if (typeof job !== 'object' || !job || !('images' in job) || !Array.isArray(job.images) ||
      !('temporaryDirectory' in job) || typeof job.temporaryDirectory !== 'string' ||
      !('modelId' in job) || typeof job.modelId !== 'string') throw new Error('Invalid native fixture');
  const pdf = createTextPdf([Array.from({ length: 15 }, (_, index) => `Native PDF text line ${index} with enough characters for normal extraction.`)]);
  const count = await countPluginPdfPages(pdf);
  const parsed = await parsePluginDocument({ bytes: pdf, filename: 'source.pdf', documentId: 'native-pdf', temporaryDirectory: job.temporaryDirectory }, inference);
  const images: string[] = [];
  for (const value of job.images) {
    const image: unknown = value;
    if (typeof image !== 'object' || !image || !('bytes' in image) || !(image.bytes instanceof Uint8Array) ||
        !('filename' in image) || typeof image.filename !== 'string') throw new Error('Invalid image');
    const output = await parsePluginDocument({ bytes: image.bytes, filename: image.filename, documentId: image.filename, temporaryDirectory: job.temporaryDirectory, imageVisionModelId: job.modelId }, inference);
    images.push(output.blocks[0]?.text ?? '');
  }
  const scanned = await parsePluginDocument({ bytes: createTextPdf([null]), filename: 'scanned.pdf', documentId: 'native-scanned', temporaryDirectory: job.temporaryDirectory, pdfOcrModelId: job.modelId, forceVisionMode: true }, inference);
  const tokens = await tokenizeForSearch('人工智能知识检索与数据库');
  new Logger('native-fixture').info('native processing complete');
  return { count, pipeline: parsed.diagnostics?.pipeline, images, tokens, scanned: scanned.blocks[0]?.text, temporaryFiles: await readdir(job.temporaryDirectory) };
}
