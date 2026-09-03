/**
 * @file src/electron-main/services/mediaService.ts
 *
 * @brief 媒体文件处理服务
 *
 * @description
 * 此模块提供所有媒体文件（图片、音频）相关的业务逻辑。
 * 从 file-handlers.js 中提取媒体相关功能，使其成为独立的服务层。
 *
 * 核心职责:
 * - 图片文件的读取和转换（Data URL）
 * - 音频文件的保存和加载
 * - MIME 类型的识别和处理
 * - 媒体文件的路径管理
 *
 * 设计原则:
 * - 单一职责: 专注于媒体文件处理
 * - 类型安全: 使用 TypeScript
 * - 依赖 pathManager: 统一路径管理
 * - 错误处理: 详细的错误信息
 */

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';
import type { UserFacingMessage } from '@app/schemas';
import {
  getAudioRecordingsPath,
  getDocumentMediaPath,
  getDocumentMediaDirForNode,
} from '../../shared/utils/pathManager.js';
import {
  buildDocImageLocator,
  buildDocImageRelativePath,
  DOC_IMAGE_MEDIA_OPERATION,
} from '../../features/system/media/functions/docImageLocator.js';
import {
  MediaAudioDataEmptyError,
  MediaFileExtensionNotAllowedError,
  MediaInvalidFilePathError,
  MediaUnknownMimeTypeError,
} from '../../features/system/media/definitions/mediaErrors.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 保存音频文件的结果
 */
export interface SaveAudioResult {
  success: boolean;
  filePath?: string;
  error?: string;
  userMessage?: UserFacingMessage;
}

/**
 * 加载文件为 Data URL 的结果
 */
export interface LoadDataUrlResult {
  success: boolean;
  dataUrl?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  userMessage?: UserFacingMessage;
}

export interface EmbedImageResult {
  success: boolean;
  locator?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  userMessage?: UserFacingMessage;
}

const EMBEDDABLE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
// ============================================================================
// MIME 类型处理
// ============================================================================

/**
 * 根据文件扩展名获取 MIME 类型
 *
 * @param filePath - 文件路径
 * @returns MIME 类型字符串，如果无法识别则返回 null
 *
 * @remarks
 * 优先使用自定义映射，确保常见图片格式的正确识别
 */
export function getMimeType(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return null;
  }
}

function normalizeImageExtension(extension: string): string {
  const ext = extension.trim().toLowerCase();
  if (!ext) {
    throw new MediaInvalidFilePathError('embedImage');
  }
  const normalized = ext.startsWith('.') ? ext : `.${ext}`;
  if (!EMBEDDABLE_IMAGE_EXTENSIONS.has(normalized)) {
    throw new MediaFileExtensionNotAllowedError(normalized, DOC_IMAGE_MEDIA_OPERATION);
  }
  return normalized;
}

function buildDocImageMediaUrl(documentMediaFilePath: string): string {
  const relativePath = buildDocImageRelativePath({
    documentMediaRoot: getDocumentMediaPath(),
    documentMediaFilePath,
  });
  return buildDocImageLocator(relativePath);
}

function buildEmbeddedImageFilePath(params: { documentNodeId: string; extension: string }): string {
  const imageDir = getDocumentMediaDirForNode(params.documentNodeId);
  const uniqueId = uuidv4();
  return path.join(imageDir, `${uniqueId}${params.extension}`);
}

// ============================================================================
// 图片处理
// ============================================================================

export async function embedImageBytes(params: {
  documentNodeId: string;
  imageDataBuffer: ArrayBuffer;
  extension: string;
  fileName?: string;
}): Promise<EmbedImageResult> {
  if (!params.imageDataBuffer || params.imageDataBuffer.byteLength === 0) {
    throw new MediaInvalidFilePathError('embedImageBytes');
  }

  const extension = normalizeImageExtension(params.extension);
  const filePath = buildEmbeddedImageFilePath({
    documentNodeId: params.documentNodeId,
    extension,
  });
  const buffer = Buffer.from(params.imageDataBuffer);
  await fs.writeFile(filePath, buffer);

  return {
    success: true,
    locator: buildDocImageMediaUrl(filePath),
    fileName: params.fileName || path.basename(filePath),
    fileSize: buffer.length,
  };
}

export async function embedImageFile(params: {
  documentNodeId: string;
  sourcePath: string;
}): Promise<EmbedImageResult> {
  if (!params.sourcePath || typeof params.sourcePath !== 'string') {
    throw new MediaInvalidFilePathError('embedImageFile');
  }

  const extension = normalizeImageExtension(path.extname(params.sourcePath));
  const filePath = buildEmbeddedImageFilePath({
    documentNodeId: params.documentNodeId,
    extension,
  });
  await fs.copyFile(params.sourcePath, filePath);
  const stats = await fs.stat(filePath);

  return {
    success: true,
    locator: buildDocImageMediaUrl(filePath),
    fileName: path.basename(params.sourcePath),
    fileSize: stats.size,
  };
}

/**
 * 加载图片文件为 Data URL
 *
 * @param filePath - 图片文件路径（绝对路径）
 * @returns 加载结果
 *
 * @remarks
 * 读取图片文件并转换为 base64 编码的 Data URL，
 * 适用于在渲染进程中直接使用的场景
 */
export async function loadImageAsDataUrl(filePath: string): Promise<LoadDataUrlResult> {
  if (!filePath || typeof filePath !== 'string') {
    throw new MediaInvalidFilePathError('loadImageAsDataUrl');
  }

  const fileBuffer = await fs.readFile(filePath);
  const mimeType = getMimeType(filePath);

  if (!mimeType) {
    throw new MediaUnknownMimeTypeError(filePath);
  }

  const base64Data = fileBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  const fileName = path.basename(filePath);

  return {
    success: true,
    dataUrl,
    fileName,
    fileSize: fileBuffer.length,
  };
}

// ============================================================================
// 音频处理
// ============================================================================

/**
 * 保存音频文件
 *
 * @param audioDataBuffer - 音频数据的 ArrayBuffer
 * @param clientMimeType - 客户端提供的 MIME 类型
 * @returns 保存结果
 *
 * @remarks
 * - 使用 pathManager 获取音频录音目录
 * - 生成唯一的文件名（时间戳 + UUID）
 * - 自动确定文件扩展名（基于 MIME 类型）
 */
export async function saveAudioFile(
  audioDataBuffer: ArrayBuffer,
  clientMimeType?: string
): Promise<SaveAudioResult> {
  if (!audioDataBuffer) {
    throw new MediaAudioDataEmptyError();
  }

  // 使用 pathManager 获取音频录音目录
  const audioDir = getAudioRecordingsPath();
  console.log(`[MediaService] 使用音频录音目录: ${audioDir}`);

  // 根据MIME类型确定文件扩展名，优先使用自定义映射
  let extension: string;
  const mimeTypeLower = (clientMimeType || '').toLowerCase().split(';')[0].trim();

  // 自定义扩展名映射（优先使用更通用的扩展名）
  const customExtensionMap: Record<string, string> = {
    'audio/webm': 'webm', // 使用 .webm 而不是 .weba，兼容性更好
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
  };

  extension = customExtensionMap[mimeTypeLower] || mime.extension(clientMimeType || '') || 'webm';

  // 生成一个唯一的文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const uniqueId = uuidv4().slice(0, 8); // 取UUID前8位增加独特性
  const filename = `recording-${timestamp}-${uniqueId}.${extension}`;
  const filePath = path.join(audioDir, filename);

  console.log(`[MediaService] 正在保存音频文件到: ${filePath}`);

  // 将 ArrayBuffer 转换为 Node.js 的 Buffer
  const buffer = Buffer.from(audioDataBuffer);

  // 写入文件
  await fs.writeFile(filePath, buffer);

  console.log(`[MediaService] 音频文件保存成功: ${filePath}`);
  return { success: true, filePath };
}

/**
 * 加载音频文件为 Data URL
 *
 * @param filePath - 音频文件路径（绝对路径）
 * @returns 加载结果
 *
 * @remarks
 * 用于在渲染进程中播放音频
 */
export async function loadAudioFileAsDataUrl(filePath: string): Promise<LoadDataUrlResult> {
  const fileBuffer = await fs.readFile(filePath);
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';

  const dataUrl = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
  return { success: true, dataUrl };
}
