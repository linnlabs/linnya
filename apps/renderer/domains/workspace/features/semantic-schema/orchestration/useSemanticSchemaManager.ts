import { ref, shallowRef } from 'vue';
import type {
  SemanticSchemaChangeItem,
  SemanticSchemaManageRequest,
  SemanticSchemaManageResult,
  SemanticSchemaOperation,
  SemanticSchemaOverview,
  SemanticSchemaPreview,
  SemanticSchemaUsage,
} from '@app/schemas';
import { manageSemanticSchema } from '../infrastructure/semanticSchemaGateway';

export type SemanticSchemaFailure = Extract<SemanticSchemaManageResult, { ok: false }>;
type Success<A> = Extract<SemanticSchemaManageResult, { ok: true; action: A }>;

/**
 * 标签管理弹窗的数据：整份概览随每次写入一起换回；用在哪里、预览按需读。
 * 写入失败（重名、撤回冲突等）以失败结果返回给界面显示，不抛出。
 */
export function useSemanticSchemaManager(input: { readonly onChanged: (overview: SemanticSchemaOverview) => void }) {
  const overview = shallowRef<SemanticSchemaOverview | null>(null);
  const loadFailed = ref(false);
  const busy = ref(false);

  async function send<A extends SemanticSchemaManageRequest['action']>(
    request: SemanticSchemaManageRequest & { action: A },
  ): Promise<Success<A> | SemanticSchemaFailure> {
    const result = await manageSemanticSchema(request);
    if (result.ok && result.action !== request.action) throw new Error(`标签管理返回了别的动作：${result.action}`);
    return result as Success<A> | SemanticSchemaFailure;
  }

  async function load(): Promise<void> {
    try {
      const result = await send({ action: 'read' });
      if (result.ok) {
        overview.value = result.overview;
        loadFailed.value = false;
      }
    } catch (error: unknown) {
      console.error('[SemanticSchema] 读取标签失败:', error);
      loadFailed.value = true;
    }
  }

  async function usage(kind: 'tag' | 'property', id: string): Promise<SemanticSchemaUsage | null> {
    const result = await send({ action: 'usage', kind, id });
    return result.ok ? result.usage : null;
  }

  async function preview(operation: SemanticSchemaOperation): Promise<SemanticSchemaPreview | SemanticSchemaFailure> {
    const result = await send({ action: 'preview', operation });
    return result.ok ? result.preview : result;
  }

  type WriteResult = Success<'apply' | 'undo' | 'set_tag_fields'> | SemanticSchemaFailure;

  /** 写入期间 busy；成功后换回整份概览并通知文件页刷新。 */
  async function write<T extends WriteResult>(run: () => Promise<T>): Promise<T> {
    busy.value = true;
    try {
      const result = await run();
      const settled: WriteResult = result;
      if (settled.ok) {
        overview.value = settled.overview;
        input.onChanged(settled.overview);
      }
      return result;
    } finally {
      busy.value = false;
    }
  }

  return {
    overview,
    loadFailed,
    busy,
    load,
    usage,
    preview,
    apply: (operation: SemanticSchemaOperation) => write(() => send({ action: 'apply', operation })),
    undo: (changeId: string) => write(() => send({ action: 'undo', change_id: changeId })),
    setTagFields: (tag: string, fieldIds: readonly string[]) => write(() => send({ action: 'set_tag_fields', tag, field_ids: [...fieldIds] })),
  };
}

export type SemanticSchemaManager = ReturnType<typeof useSemanticSchemaManager>;
export type { SemanticSchemaChangeItem };
