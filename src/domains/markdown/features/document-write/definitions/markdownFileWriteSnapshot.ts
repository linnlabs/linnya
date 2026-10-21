import type { CitationSource } from '../../../../citation';

/** 同次读取的文档事实；会话别名不进入并发基线。 */
export interface MarkdownFileWriteSnapshot {
  readonly currentText: string;
  readonly sourceKey: string;
  /** 当前投影优先，补齐旧 URL-only Pending 已接纳的完整来源。 */
  readonly sources: readonly CitationSource[];
  /** 隐藏的基线来源仍保留身份，恢复原稿时复用原 ref 与完整快照。 */
  readonly reservedSources: readonly CitationSource[];
  /** 包含基线和 pending 隐藏的占位，新增来源不能借走拒绝修订后会恢复的 ref。 */
  readonly reservedRefs: readonly string[];
}
