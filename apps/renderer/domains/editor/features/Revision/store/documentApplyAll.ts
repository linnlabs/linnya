/**
 * @file documentApplyAll.ts
 * @description Revision 文档级 Accept/Reject All 的后端 apply-all 门面。
 *
 * 中文说明：
 * - `useRevisionStore` 负责状态编排，本文件只负责“调用后端一次性合并 + 严格原子装载”；
 * - 这样避免把性能敏感 IPC 细节继续堆在 store 主文件里。
 */

import type { Editor } from '@tiptap/core';
import {
  workspaceGateway,
  type ApplyAllPendingMode,
  type ApplyAllPendingResultDTO,
  type OperationResult,
} from '../../../../../shared/ipc/workspaceGateway';
import {
  countRootBlocksInDocJson,
  loadDocumentJsonAtomically,
} from '../../../services/editorDocumentStateLoader';
import { createRevisionActionPerfSession } from './revisionActionPerf';
import type { DocumentApplyAllStatus } from './types';

export interface BackendApplyAllParams {
  editor: Editor;
  documentId: string | null;
  mode: ApplyAllPendingMode;
  setDirty: (value: boolean) => void;
  clearRuntimeCaches: () => void;
  pendingCountBefore?: number;
}

export async function applyAllPendingInBackend(params: BackendApplyAllParams): Promise<DocumentApplyAllStatus> {
  const {
    editor,
    documentId,
    mode,
    setDirty,
    clearRuntimeCaches,
    pendingCountBefore,
  } = params;
  const perf = createRevisionActionPerfSession({
    kind: mode === 'accept' ? 'document-accept-all' : 'document-reject-all',
    documentId: documentId ?? undefined,
    pendingCountBefore,
  });

  if (!documentId) {
    perf.finish({ path: 'backend-blocked', result: 'skipped', error: 'missing documentId' });
    return 'blocked';
  }

  let response: OperationResult<ApplyAllPendingResultDTO>;
  try {
    response = await perf.measureAsync('backendIpc', () =>
      workspaceGateway['apply-all-pending-revisions']({ documentId, mode })
    );
  } catch (error) {
    console.error('[RevisionStore] apply-all-pending-revisions IPC 异常:', {
      documentId,
      mode,
      error,
    });
    perf.finish({ path: 'backend-blocked', result: 'failed', error });
    return 'blocked';
  }

  if (!response.success) {
    console.error('[RevisionStore] apply-all-pending-revisions IPC 失败:', {
      documentId,
      mode,
      error: response.error,
    });
    perf.finish({ path: 'backend-blocked', result: 'failed', error: response.error });
    return 'blocked';
  }

  const result = response.data;
  if (result.status !== 'ok') {
    console.error('[RevisionStore] apply-all-pending-revisions 后端合并失败:', {
      documentId,
      mode,
      errors: result.errors,
    });
    perf.finish({ path: 'backend-blocked', result: 'failed', error: result.errors?.[0]?.reason ?? 'backend apply failed' });
    return 'blocked';
  }

  const previousRootBlockCount = editor.state.doc.childCount;
  const nextRootBlockCount = countRootBlocksInDocJson(result.docJson);
  try {
    perf.measure('replaceDocument', () => {
      loadDocumentJsonAtomically(editor, result.docJson);
    });
  } catch (error) {
    console.error('[RevisionStore] apply-all-pending-revisions 后端已提交，但 Editor 严格装载失败:', {
      documentId,
      mode,
      previousRootBlockCount,
      nextRootBlockCount,
      error,
    });
    perf.finish({ path: 'backend-applied-renderer-failed', result: 'failed', error });
    return 'reload-required';
  }

  perf.measure('clearRuntime', () => clearRuntimeCaches());
  perf.measure('setDirty', () => setDirty(false));
  console.info('[RevisionStore] apply-all-pending-revisions 端到端完成:', {
    documentId,
    mode,
    previousRootBlockCount,
    nextRootBlockCount,
    appliedCount: result.appliedCount,
    skippedCount: result.skippedCount,
  });
  perf.finish({ path: 'backend-apply-all', result: 'success' });
  return 'applied';
}
