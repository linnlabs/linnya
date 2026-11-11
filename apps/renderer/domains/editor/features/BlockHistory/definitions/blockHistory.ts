import type { Ref, ComputedRef } from 'vue';
import type { BlockVersion, CreateBlockVersionParams } from '@/shared/ipc/blockHistoryGateway';

/** 时光机视图模式 */
export type HistoryViewMode = 'none' | 'side-by-side' | 'overlay' | 'multi-column';

/** 单个块的时光机 UI 状态 */
export interface BlockHistoryUiState {
  /** 视图模式 */
  mode: HistoryViewMode;
  /** 单版本视图下当前选中的版本（用于 side-by-side / overlay） */
  selectedVersionId?: string;
  /** 多栏视图下选中的多个版本（用于 multi-column） */
  selectedVersionIds?: string[];
  /** 当前关注的"行"下标（逻辑行索引） */
  focusedLineIndex?: number;
  /** 是否正在从后端加载 */
  isLoading: boolean;
}

/** Store 返回类型 */
export interface BlockHistoryStore {
  // 状态
  versionsByBlock: Ref<Record<string, BlockVersion[]>>;
  uiStateByBlock: Ref<Record<string, BlockHistoryUiState>>;

  // 计算属性
  hasAnyHistoryMode: ComputedRef<boolean>;

  // 方法
  loadBlockHistory: (documentNodeId: string, blockId: string) => Promise<void>;
  getVersions: (blockId: string) => BlockVersion[];
  getUiState: (blockId: string) => BlockHistoryUiState;
  setViewMode: (blockId: string, mode: HistoryViewMode) => void;
  selectVersion: (blockId: string, versionId: string) => void;
  selectMultipleVersions: (blockId: string, versionIds: string[]) => void;
  setFocusedLineIndex: (blockId: string, lineIndex: number) => void;
  restoreVersion: (
    documentNodeId: string,
    blockId: string,
    versionId: string
  ) => Promise<BlockVersion | null>;
  createVersion: (params: CreateBlockVersionParams) => Promise<BlockVersion | null>;
  exitHistoryMode: (blockId: string) => void;
  clearBlockHistory: (blockId: string) => void;
  isInHistoryMode: (blockId: string) => boolean;
  deleteVersion: (versionId: string) => Promise<void>;
}
