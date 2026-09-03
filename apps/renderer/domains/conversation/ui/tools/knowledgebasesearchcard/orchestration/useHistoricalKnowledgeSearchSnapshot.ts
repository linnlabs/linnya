import { computed, ref, watch, type ComputedRef } from 'vue';
import { CitationSnapshotBundleRecordV1Schema } from '@app/schemas';
import { getKnowledgeSearchHistoryPort } from '../../../../ports/knowledgeSearchHistoryPort';
import type {
  HistoricalKnowledgeSearchSnapshotPointerPresentation,
  KnowledgeSearchResultsPresentation,
} from '../definitions/knowledgeSearchPresentation';
import { projectHistoricalKnowledgeSearchResult } from '../functions/projectKnowledgeSearchPresentation';

type HistoricalSnapshotLoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly presentation: KnowledgeSearchResultsPresentation }
  | { readonly kind: 'error' };

export interface HistoricalKnowledgeSearchSnapshotController {
  readonly state: ComputedRef<HistoricalSnapshotLoadState>;
  readonly isDownloading: ComputedRef<boolean>;
  load(): Promise<void>;
  download(): Promise<void>;
}

export function useHistoricalKnowledgeSearchSnapshot(input: {
  readonly source: () => HistoricalKnowledgeSearchSnapshotPointerPresentation | null;
  readonly conversationId: () => string | null;
}): HistoricalKnowledgeSearchSnapshotController {
  const state = ref<HistoricalSnapshotLoadState>({ kind: 'idle' });
  const isDownloading = ref(false);

  watch(
    () => input.source()?.bundleId ?? null,
    () => {
      state.value = { kind: 'idle' };
    },
  );

  async function readSnapshot() {
    const source = input.source();
    const conversationId = input.conversationId();
    if (!source || !conversationId) {
      throw new Error('Historical Knowledge Search snapshot requires its pointer and conversation identity');
    }
    const raw = await getKnowledgeSearchHistoryPort().readCitationSnapshot({
      conversationId,
      bundleId: source.bundleId,
    });
    const record = CitationSnapshotBundleRecordV1Schema.parse(raw);
    return {
      source,
      record,
      presentation: projectHistoricalKnowledgeSearchResult(
        record.result,
        source.requestedDeepSearch,
      ),
    };
  }

  async function load(): Promise<void> {
    if (state.value.kind === 'loading') return;
    state.value = { kind: 'loading' };
    try {
      const loaded = await readSnapshot();
      state.value = { kind: 'ready', presentation: loaded.presentation };
    } catch (error: unknown) {
      const source = input.source();
      console.error('[KnowledgeSearchCard] 读取历史 Citation Snapshot 失败', {
        bundleId: source?.bundleId,
        conversationId: input.conversationId(),
        error,
      });
      state.value = { kind: 'error' };
    }
  }

  async function download(): Promise<void> {
    if (isDownloading.value) return;
    isDownloading.value = true;
    try {
      const loaded = await readSnapshot();
      downloadJson(`citation_snapshot_${loaded.source.bundleId}.json`, loaded.record);
    } catch (error: unknown) {
      const source = input.source();
      console.error('[KnowledgeSearchCard] 导出历史 Citation Snapshot 失败', {
        bundleId: source?.bundleId,
        conversationId: input.conversationId(),
        error,
      });
      state.value = { kind: 'error' };
    } finally {
      isDownloading.value = false;
    }
  }

  return {
    state: computed(() => state.value),
    isDownloading: computed(() => isDownloading.value),
    load,
    download,
  };
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
