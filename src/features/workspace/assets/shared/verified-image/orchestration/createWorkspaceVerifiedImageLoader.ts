import { promises as fsp } from 'node:fs';
import type Database from 'better-sqlite3';
import {
  WorkspaceVerifiedImageError,
  type VerifiedWorkspaceImage,
  type WorkspaceVerifiedImageExpectation,
  type WorkspaceVerifiedImageFailure,
  type WorkspaceVerifiedImageLoaderPort,
  type WorkspaceVerifiedImageRequest,
  type WorkspaceVerifiedImageStorageBoundary,
} from '../definitions/workspaceVerifiedImage';
import {
  inspectImageBytes,
  ImageInspectionError,
  type SupportedImageMediaType,
} from 'src/shared/media/image-inspection';
import { isPathInsideRoot } from 'src/shared/filesystem/managedPath';

interface WorkspaceAssetImageRow {
  readonly id: string;
  readonly media_type: string | null;
  readonly size_bytes: number | null;
  readonly width_px: number | null;
  readonly height_px: number | null;
  readonly sha256: string | null;
  readonly storage_status: string;
  readonly local_path: string | null;
}

interface WorkspaceImageLedgerIdentity extends WorkspaceVerifiedImageExpectation {
  readonly localPath: string;
}

function fail(
  request: WorkspaceVerifiedImageRequest,
  requestIndex: number,
  code: 'unavailable' | 'integrity_failed',
  failure: WorkspaceVerifiedImageFailure,
): never {
  throw new WorkspaceVerifiedImageError(code, failure, request.assetId, requestIndex);
}

function isSupportedImageMediaType(value: string): value is SupportedImageMediaType {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp';
}

function readLedgerIdentity(
  row: WorkspaceAssetImageRow,
  request: WorkspaceVerifiedImageRequest,
  requestIndex: number,
): WorkspaceImageLedgerIdentity {
  const mediaType = row.media_type;
  const byteLength = row.size_bytes;
  const width = row.width_px;
  const height = row.height_px;
  const sha256 = row.sha256;
  if (
    typeof mediaType !== 'string'
    || !isSupportedImageMediaType(mediaType)
    || typeof byteLength !== 'number'
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
    || typeof width !== 'number'
    || !Number.isSafeInteger(width)
    || width <= 0
    || typeof height !== 'number'
    || !Number.isSafeInteger(height)
    || height <= 0
    || typeof sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(sha256)
  ) {
    fail(request, requestIndex, 'integrity_failed', 'ledger_incomplete');
  }
  if (!row.local_path) {
    fail(request, requestIndex, 'unavailable', 'file_missing');
  }
  return { mediaType, byteLength, width, height, sha256, localPath: row.local_path };
}

function assertExpectedIdentity(
  expected: WorkspaceVerifiedImageExpectation | undefined,
  ledger: WorkspaceImageLedgerIdentity,
  request: WorkspaceVerifiedImageRequest,
  requestIndex: number,
): void {
  if (!expected) return;
  if (
    expected.mediaType !== ledger.mediaType
    || expected.byteLength !== ledger.byteLength
    || expected.width !== ledger.width
    || expected.height !== ledger.height
    || expected.sha256 !== ledger.sha256
  ) {
    fail(request, requestIndex, 'integrity_failed', 'durable_ref_mismatch');
  }
}

async function loadImage(params: {
  readonly request: WorkspaceVerifiedImageRequest;
  readonly requestIndex: number;
  readonly row: WorkspaceAssetImageRow | undefined;
  readonly contentRootRealPaths: readonly string[];
  readonly maxImagePixels: number;
}): Promise<VerifiedWorkspaceImage> {
  const { request, requestIndex, row } = params;
  if (!row) {
    fail(request, requestIndex, 'unavailable', 'asset_not_found');
  }
  if (row.storage_status !== 'local') {
    fail(request, requestIndex, 'unavailable', 'asset_not_local');
  }

  const ledger = readLedgerIdentity(row, request, requestIndex);
  assertExpectedIdentity(request.expected, ledger, request, requestIndex);

  let fileRealPath: string;
  try {
    fileRealPath = await fsp.realpath(ledger.localPath);
  } catch {
    fail(request, requestIndex, 'unavailable', 'file_missing');
  }
  if (!params.contentRootRealPaths.some(root => isPathInsideRoot(root, fileRealPath))) {
    fail(request, requestIndex, 'integrity_failed', 'managed_path_escape');
  }

  let fileStat;
  try {
    fileStat = await fsp.lstat(ledger.localPath);
  } catch {
    fail(request, requestIndex, 'unavailable', 'file_missing');
  }
  if (!fileStat.isFile()) {
    fail(request, requestIndex, 'unavailable', 'file_not_regular');
  }
  if (fileStat.size !== ledger.byteLength) {
    fail(request, requestIndex, 'integrity_failed', 'byte_length_mismatch');
  }

  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(ledger.localPath);
  } catch {
    fail(request, requestIndex, 'unavailable', 'file_missing');
  }

  let inspected;
  try {
    inspected = await inspectImageBytes({
      bytes,
      maxImagePixels: params.maxImagePixels,
    });
  } catch (error) {
    if (error instanceof ImageInspectionError) {
      fail(request, requestIndex, 'integrity_failed', 'image_decode_failed');
    }
    throw error;
  }

  if (inspected.byteLength !== ledger.byteLength) {
    fail(request, requestIndex, 'integrity_failed', 'byte_length_mismatch');
  }
  if (inspected.sha256 !== ledger.sha256) {
    fail(request, requestIndex, 'integrity_failed', 'hash_mismatch');
  }
  if (inspected.mediaType !== ledger.mediaType) {
    fail(request, requestIndex, 'integrity_failed', 'media_type_mismatch');
  }
  if (inspected.width !== ledger.width || inspected.height !== ledger.height) {
    fail(request, requestIndex, 'integrity_failed', 'dimensions_mismatch');
  }

  return {
    assetId: request.assetId,
    mediaType: inspected.mediaType,
    byteLength: inspected.byteLength,
    width: inspected.width,
    height: inspected.height,
    sha256: inspected.sha256,
    bytes,
  };
}

async function resolveContentRootRealPaths(
  boundaries: readonly WorkspaceVerifiedImageStorageBoundary[],
  request: WorkspaceVerifiedImageRequest,
): Promise<readonly string[]> {
  const resolved: string[] = [];
  for (const boundary of boundaries) {
    let boundaryRootRealPath: string;
    let contentRootRealPath: string;
    try {
      [boundaryRootRealPath, contentRootRealPath] = await Promise.all([
        fsp.realpath(boundary.boundaryRoot),
        fsp.realpath(boundary.contentRoot),
      ]);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      fail(request, 0, 'unavailable', 'file_missing');
    }
    if (!isPathInsideRoot(boundaryRootRealPath, contentRootRealPath)) {
      fail(request, 0, 'integrity_failed', 'managed_path_escape');
    }
    resolved.push(contentRootRealPath);
  }
  if (resolved.length === 0) {
    fail(request, 0, 'unavailable', 'file_missing');
  }
  return resolved;
}

export function createWorkspaceVerifiedImageLoader(params: {
  readonly db: Database.Database;
  readonly storageBoundaries: readonly WorkspaceVerifiedImageStorageBoundary[];
  readonly maxImagePixels: number;
}): WorkspaceVerifiedImageLoaderPort {
  if (!Number.isSafeInteger(params.maxImagePixels) || params.maxImagePixels <= 0) {
    throw new Error('maxImagePixels must be a positive safe integer');
  }

  if (params.storageBoundaries.length === 0) {
    throw new Error('storageBoundaries must contain at least one managed root');
  }
  const getAsset = params.db.prepare<[string], WorkspaceAssetImageRow>(`
    SELECT id, media_type, size_bytes, width_px, height_px, sha256,
           storage_status, local_path
    FROM assets
    WHERE id = ?
  `);

  return {
    async loadImages(requests): Promise<readonly VerifiedWorkspaceImage[]> {
      if (requests.length === 0) return [];

      const contentRootRealPaths = await resolveContentRootRealPaths(
        params.storageBoundaries,
        requests[0],
      );

      const resolved: VerifiedWorkspaceImage[] = [];
      for (const [requestIndex, request] of requests.entries()) {
        resolved.push(await loadImage({
          request,
          requestIndex,
          row: getAsset.get(request.assetId),
          contentRootRealPaths,
          maxImagePixels: params.maxImagePixels,
        }));
      }
      return resolved;
    },
  };
}
