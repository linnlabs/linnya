import type {
  ExportArtifactTargetRequest,
  ExportArtifactTargetResult,
} from '@linnya/plugin-host-contract/renderer/exportArtifact';
import { parseExportArtifactTargetResult } from './parseExportArtifactTargetResult';

type ExportArtifactTargetRequester = (
  request: ExportArtifactTargetRequest,
) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getExportArtifactTargetRequester(): ExportArtifactTargetRequester {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (!isRecord(api)) {
    throw new Error('[exportArtifact] window.electronAPI is not available');
  }
  const requestTarget = api.requestExportArtifactTarget;
  if (typeof requestTarget !== 'function') {
    throw new Error('[exportArtifact] requestExportArtifactTarget is not available');
  }
  return request => Reflect.apply(requestTarget, api, [request]);
}

export async function requestExportArtifactTarget(
  request: ExportArtifactTargetRequest,
): Promise<ExportArtifactTargetResult> {
  const result = await getExportArtifactTargetRequester()(request);
  return parseExportArtifactTargetResult(result);
}

export type {
  ExportArtifactDescriptor,
  ExportArtifactDialogLabels,
  ExportArtifactTarget,
  ExportArtifactTargetRequest,
  ExportArtifactTargetResult,
} from '@linnya/plugin-host-contract/renderer/exportArtifact';
