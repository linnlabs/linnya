import { Logger } from '@plugin/backend/workspaceRuntime';
import { DECK_LAYOUT_VERSION, type DeckSpec } from '@plugin/slides/shared/deckSpec';
import type { ThemeSpec } from '@plugin/slides/shared';
import type {
  PresentationLayoutRefreshPort,
  PresentationRenderSourceRecord,
} from '../../../persistence/index.js';

export interface PresentationLayoutRefreshRuntimeDeps {
  readonly repository: PresentationLayoutRefreshPort & {
    getPresentationRenderSource(nodeId: string): Promise<PresentationRenderSourceRecord | null>;
  };
  /** 与正式编译同一入口：精确源码加原主题，产出带当前版本号的 DeckSpec。 */
  buildDeckSpecFromSource(input: { nodeId: string; source: string; theme: ThemeSpec | undefined }): Promise<DeckSpec>;
}

/**
 * 排版合同升级后，已存物化仍是旧规则算出的外框（例如按 1.0 倍行距定高的文字框）。
 * 查询入口先调用 {@link ensureCurrent}：版本落后就从同一份源码重编译，按 current revision CAS 写回，
 * 并作废 PPTX 缓存。不产生用户修订、不改源码；编译失败只记日志并沿用旧物化，同一 revision 不再重试。
 */
export class PresentationLayoutRefreshRuntime {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly failedRevisions = new Set<string>();
  private readonly logger = new Logger('SlidesLayoutRefresh');

  constructor(private readonly deps: PresentationLayoutRefreshRuntimeDeps) {}

  async ensureCurrent(nodeId: string): Promise<void> {
    const state = await this.deps.repository.getPresentationLayoutState(nodeId);
    if (!state || state.layoutVersion === DECK_LAYOUT_VERSION) return;
    const key = `${nodeId}:${state.currentRevisionId}`;
    if (this.failedRevisions.has(key)) return;
    const active = this.inFlight.get(key);
    if (active) return active;
    const refresh = this.refresh(nodeId, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, refresh);
    return refresh;
  }

  private async refresh(nodeId: string, key: string): Promise<void> {
    const source = await this.deps.repository.getPresentationRenderSource(nodeId);
    if (!source || `${nodeId}:${source.currentRevisionId}` !== key) return;
    try {
      const deckSpec = await this.deps.buildDeckSpecFromSource({
        nodeId,
        source: source.deckSource,
        theme: source.deckSpec.theme,
      });
      // CAS 落空表示 current 已前进，新 revision 由正式编译产生，无需再刷新本次读取的旧 revision。
      await this.deps.repository.refreshPresentationDeckSpec(nodeId, source.currentRevisionId, deckSpec);
    } catch (error) {
      this.failedRevisions.add(key);
      this.logger.warn('slides.layout_refresh.failed', {
        nodeId,
        revisionId: source.currentRevisionId,
        fromVersion: source.deckSpec.layoutVersion ?? null,
        toVersion: DECK_LAYOUT_VERSION,
        error,
      });
    }
  }
}
