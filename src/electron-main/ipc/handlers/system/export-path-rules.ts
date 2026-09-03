import fs from 'fs/promises';
import path from 'path';
import { Buffer } from 'buffer';
import {
  ExportBatchFileNameInvalidError,
  ExportBatchLimitExceededError,
  ExportDirectoryPathRequiredError,
  ExportFilesRequiredError,
  ExportInvalidPayloadError,
} from '../../../../features/system/export/definitions/exportErrors';

export type BatchExportFile = {
  readonly fileName: string;
  readonly content: string;
};

const ALLOWED_EXPORT_EXTENSIONS: readonly string[] = ['.md'];

export const BATCH_EXPORT_LIMITS = {
  maxFiles: 5000,
  maxSingleFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  allowedExtensions: ALLOWED_EXPORT_EXTENSIONS,
} as const;

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const WINDOWS_INVALID_CHARACTERS = /[<>:"|?*]/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeForComparison(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, 'utf8');
}

export function normalizeExportDirectoryPath(directoryPath: string): string {
  if (directoryPath.trim().length === 0 || !path.isAbsolute(directoryPath)) {
    throw new ExportDirectoryPathRequiredError();
  }
  return path.resolve(directoryPath);
}

export function validateBatchExportFileName(fileName: string): string {
  if (fileName.trim().length === 0) {
    throw new ExportBatchFileNameInvalidError(fileName, 'empty file name');
  }

  if (path.isAbsolute(fileName)) {
    throw new ExportBatchFileNameInvalidError(fileName, 'absolute path is not allowed');
  }

  if (fileName.includes('/') || fileName.includes('\\')) {
    throw new ExportBatchFileNameInvalidError(fileName, 'path separator is not allowed');
  }

  if (fileName === '.' || fileName === '..') {
    throw new ExportBatchFileNameInvalidError(fileName, 'dot segment is not allowed');
  }

  if (CONTROL_CHARACTERS.test(fileName)) {
    throw new ExportBatchFileNameInvalidError(fileName, 'control character is not allowed');
  }

  if (WINDOWS_INVALID_CHARACTERS.test(fileName)) {
    throw new ExportBatchFileNameInvalidError(fileName, 'reserved character is not allowed');
  }

  if (/[.\s]$/u.test(fileName)) {
    throw new ExportBatchFileNameInvalidError(fileName, 'trailing dot or space is not allowed');
  }

  if (WINDOWS_RESERVED_NAMES.test(fileName)) {
    throw new ExportBatchFileNameInvalidError(fileName, 'windows reserved device name is not allowed');
  }

  const extension = path.extname(fileName).toLowerCase();
  if (!BATCH_EXPORT_LIMITS.allowedExtensions.includes(extension)) {
    throw new ExportBatchFileNameInvalidError(fileName, 'file extension is not allowed');
  }

  return fileName;
}

export function validateBatchExportFiles(files: unknown): BatchExportFile[] {
  if (!Array.isArray(files)) {
    throw new ExportFilesRequiredError();
  }

  if (files.length === 0) {
    throw new ExportFilesRequiredError();
  }

  if (files.length > BATCH_EXPORT_LIMITS.maxFiles) {
    throw new ExportBatchLimitExceededError('maxFiles', BATCH_EXPORT_LIMITS.maxFiles);
  }

  let totalBytes = 0;
  const validated: BatchExportFile[] = [];

  for (const file of files) {
    if (!isRecord(file)) {
      throw new ExportInvalidPayloadError('export-files-to-directory');
    }

    const { fileName, content } = file;
    if (typeof fileName !== 'string' || typeof content !== 'string') {
      throw new ExportInvalidPayloadError('export-files-to-directory');
    }

    const validatedFileName = validateBatchExportFileName(fileName);
    const fileBytes = byteLength(content);
    if (fileBytes > BATCH_EXPORT_LIMITS.maxSingleFileBytes) {
      throw new ExportBatchLimitExceededError('maxSingleFileBytes', BATCH_EXPORT_LIMITS.maxSingleFileBytes);
    }

    totalBytes += fileBytes;
    if (totalBytes > BATCH_EXPORT_LIMITS.maxTotalBytes) {
      throw new ExportBatchLimitExceededError('maxTotalBytes', BATCH_EXPORT_LIMITS.maxTotalBytes);
    }

    validated.push({ fileName: validatedFileName, content });
  }

  return validated;
}

export function assertPathInsideDirectory(targetPath: string, directoryRealPath: string): void {
  const normalizedTarget = normalizeForComparison(path.resolve(targetPath));
  const normalizedDirectory = normalizeForComparison(path.resolve(directoryRealPath));
  const relativePath = path.relative(normalizedDirectory, normalizedTarget);

  if (relativePath === '') {
    return;
  }

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new ExportBatchFileNameInvalidError(path.basename(targetPath), 'target path escapes export directory');
  }
}

export function resolveExportTargetPath(directoryRealPath: string, fileName: string): string {
  const validatedFileName = validateBatchExportFileName(fileName);
  const targetPath = path.resolve(directoryRealPath, validatedFileName);
  assertPathInsideDirectory(targetPath, directoryRealPath);
  return targetPath;
}

function buildCollisionName(fileName: string, counter: number): string {
  const extension = path.extname(fileName);
  const stem = extension ? fileName.slice(0, -extension.length) : fileName;
  return `${stem}(${counter})${extension}`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveUniqueExportFilePath(params: {
  readonly directoryRealPath: string;
  readonly desiredFileName: string;
  readonly usedNamesSet: Set<string>;
}): Promise<string> {
  const { directoryRealPath, desiredFileName, usedNamesSet } = params;
  const validatedFileName = validateBatchExportFileName(desiredFileName);
  let candidateName = validatedFileName;
  let counter = 0;

  while (counter <= BATCH_EXPORT_LIMITS.maxFiles) {
    const lowerKey = candidateName.toLowerCase();
    const candidatePath = resolveExportTargetPath(directoryRealPath, candidateName);

    if (!usedNamesSet.has(lowerKey) && !(await pathExists(candidatePath))) {
      usedNamesSet.add(lowerKey);
      return candidatePath;
    }

    counter += 1;
    candidateName = buildCollisionName(validatedFileName, counter);
  }

  throw new ExportBatchLimitExceededError('uniqueNameAttempts', BATCH_EXPORT_LIMITS.maxFiles);
}
