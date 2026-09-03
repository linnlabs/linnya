import path from 'node:path';
import type {
  ExportArtifactTargetRequest,
} from '@linnya/plugin-host-contract';
import { ExportArtifactRequestInvalidError } from '../definitions/exportErrors';

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const EXTENSION_PATTERN = /^[a-z0-9]{1,16}$/u;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function requireString(
  record: Readonly<Record<string, unknown>>,
  field: string,
  maximumLength: number,
): string {
  const value = record[field];
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > maximumLength
    || CONTROL_CHARACTERS.test(value)
  ) {
    throw new ExportArtifactRequestInvalidError(field);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeExportArtifactRequest(
  value: unknown,
): ExportArtifactTargetRequest {
  if (!isRecord(value) || !isRecord(value.labels)) {
    throw new ExportArtifactRequestInvalidError('request');
  }

  const pluginId = requireString(value, 'pluginId', 128);
  const suggestedFileName = requireString(value, 'suggestedFileName', 240);
  const extension = requireString(value, 'extension', 16).toLowerCase();
  const mediaType = requireString(value, 'mediaType', 128).toLowerCase();

  if (!PLUGIN_ID_PATTERN.test(pluginId)) {
    throw new ExportArtifactRequestInvalidError('pluginId');
  }
  if (!EXTENSION_PATTERN.test(extension)) {
    throw new ExportArtifactRequestInvalidError('extension');
  }
  if (!MEDIA_TYPE_PATTERN.test(mediaType)) {
    throw new ExportArtifactRequestInvalidError('mediaType');
  }
  if (
    path.basename(suggestedFileName) !== suggestedFileName
    || suggestedFileName === '.'
    || suggestedFileName === '..'
  ) {
    throw new ExportArtifactRequestInvalidError('suggestedFileName');
  }

  return {
    pluginId,
    suggestedFileName: ensureExportArtifactExtension(suggestedFileName, extension),
    extension,
    mediaType,
    labels: {
      title: requireString(value.labels, 'title', 200),
      buttonLabel: requireString(value.labels, 'buttonLabel', 80),
      filterName: requireString(value.labels, 'filterName', 120),
    },
  };
}

export function ensureExportArtifactExtension(
  filePath: string,
  extension: string,
): string {
  const expectedSuffix = `.${extension}`;
  return filePath.toLowerCase().endsWith(expectedSuffix)
    ? filePath
    : `${filePath}${expectedSuffix}`;
}
