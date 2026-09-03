import {
  HistoricalWorkspaceReadFileEventResultSchema,
  WorkspaceReadFileEventResultSchema,
} from '@app/schemas';

export const WORKSPACE_READ_FILE_UI_KEY = 'workspace_read_file';
export const IMAGE_READ_UI_KEY = 'image_read';

export function isSupportedReadFileImageContentType(contentType: string): boolean {
  return contentType === 'image/jpeg' || contentType === 'image/png' || contentType === 'image/webp';
}

function isLiveImageReadResult(result: unknown): boolean {
  const parsed = WorkspaceReadFileEventResultSchema.safeParse(result);
  if (!parsed.success) return false;
  const data = parsed.data.data;
  return (
    (data.source_kind === 'conversation_file' || data.source_kind === 'host_file')
    && isSupportedReadFileImageContentType(data.content_type)
  );
}

function isHistoricalImageReadResult(result: unknown): boolean {
  const parsed = HistoricalWorkspaceReadFileEventResultSchema.safeParse(result);
  if (!parsed.success) return false;
  const data = parsed.data.data;
  return (
    'source' in data
    && data.source === 'conversation_file'
    && isSupportedReadFileImageContentType(data.content_type)
  );
}

/**
 * read_file 在结果到达前始终使用普通文件展示；成功结果只按正式 owner schema 分类。
 * 无法接纳的结果仍进入 Workspace projector 并在那里显式失败，禁止按字段或扩展名猜测图片。
 */
export function resolveReadFileUiKey(_args: unknown, result?: unknown): string {
  return isLiveImageReadResult(result) || isHistoricalImageReadResult(result)
    ? IMAGE_READ_UI_KEY
    : WORKSPACE_READ_FILE_UI_KEY;
}
