import { EmbeddingFailure } from '@plugin/backend/inferenceFailures';
import { parentPort, workerData } from 'node:worker_threads';
import { createPluginWorkerInferencePort } from 'src/plugin-sdk/backend/worker/inferenceRuntime';

const input: unknown = workerData;
if (typeof input !== 'object' || input === null || !('inputPath' in input) || typeof input.inputPath !== 'string') {
  throw new Error('fixture missing inputPath');
}
const inference = createPluginWorkerInferencePort();
try {
  const embedding = await inference.embedding.embed({ modelId: 'embedding', values: ['first', 'second'], expectedSpaceId: 'space-one' });
  const text = await inference.textGeneration.generate({ modelId: 'language', messages: [{ role: 'system', content: 'extract' }] });
  const profile = await inference.documentOcr.resolveModelProfile('ocr');
  const progress: string[] = [];
  const ocr = await inference.documentOcr.recognizeDocument({ modelId: 'ocr', input: {
    kind: 'pdf_path', path: input.inputPath,
  }, options: { onProgress: value => progress.push(value.state) } });
  parentPort?.postMessage({ type: 'completed', result: { embedding, text, profile, ocr, progress } });
} catch (error) {
  if (error instanceof EmbeddingFailure) {
    parentPort?.postMessage({ type: 'completed', result: { failure: { kind: error.kind, code: error.code, retryable: error.retryable } } });
  } else {
    parentPort?.postMessage({ type: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
} finally { inference.dispose(); }
