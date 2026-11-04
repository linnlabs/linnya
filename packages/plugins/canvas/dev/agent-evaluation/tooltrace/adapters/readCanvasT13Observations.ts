import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { CanvasEvaluationCommandSchema, CanvasEvaluationResultSchema } from '../../bridge/definitions/canvasEvaluationBridge';
import type { CanvasT13BridgeExchange } from '../definitions/canvasT13Metrics';
import { readTraceJson } from './traceFiles';

const requestSchema = z.object({ command: CanvasEvaluationCommandSchema, requestedAt: z.number().finite().nonnegative() }).strict();
const responseSchema = z.object({ receivedAt: z.number().finite().nonnegative(), status: z.number().int(), raw: z.string() }).strict();

/** 原始HTTP响应与保存的typed请求重新配对；delta派生文件本身不能证明实际调用过bridge。 */
export async function readCanvasT13Observations(directory: string) {
  const names = (await readdir(directory)).sort(), evidenceFiles: string[] = [], diagnostics: string[] = [];
  const exchanges: CanvasT13BridgeExchange[] = [];
  for (const name of names.filter(name => name.endsWith('.request.json'))) {
    const requestFile = path.join(directory, name), responseFile = requestFile.replace(/\.request\.json$/, '.response.json');
    evidenceFiles.push(requestFile);
    const request = requestSchema.parse(await readTraceJson(requestFile));
    if (!names.includes(path.basename(responseFile))) { diagnostics.push(`bridge_response_missing:${name}`); continue; }
    evidenceFiles.push(responseFile);
    const response = responseSchema.parse(await readTraceJson(responseFile));
    const value: unknown = JSON.parse(response.raw), result = CanvasEvaluationResultSchema.parse(value);
    if (response.status < 200 || response.status >= 300 || !result.ok
      || result.id !== request.command.id || response.receivedAt < request.requestedAt) {
      diagnostics.push(`bridge_response_not_confirmed:${name}`); continue;
    }
    exchanges.push({ ...request, receivedAt: response.receivedAt, value: result.value, requestFile, responseFile });
  }
  for (const name of names.filter(name => name.endsWith('failed.json'))) {
    evidenceFiles.push(path.join(directory, name)); diagnostics.push(`observer_failure:${name}`);
  }
  const files = names.filter(name => /^delta-\d+\.json$/.test(name)).map(name => path.join(directory, name));
  const protocolFile = path.join(directory, 'protocol.json'), summaryFile = path.join(directory, 'summary.json');
  evidenceFiles.push(protocolFile, summaryFile, ...files);
  return { protocol: await readTraceJson(protocolFile), summary: await readTraceJson(summaryFile),
    observations: await Promise.all(files.map(readTraceJson)), exchanges, evidenceFiles, diagnostics };
}
