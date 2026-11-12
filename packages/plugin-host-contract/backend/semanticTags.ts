import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

/**
 * 工作区标签（语义层“#标签”）的只读投影。插件可以在自己的内容里存标签 ID，
 * 显示与查询时经这里换成当前名称；新建、改名、合并、删除仍只走 Host 的标签入口。
 */
export interface SemanticTagName {
  readonly id: string;
  readonly name: string;
}

export interface SemanticTagResolution {
  /** 以调用方给的输入为键。 */
  readonly found: ReadonlyMap<string, SemanticTagName>;
  /** 找不到的输入，附名称相近的现有标签，供提示复用。 */
  readonly missing: readonly { readonly name: string; readonly similar: readonly string[] }[];
}

/** 现有标签，按新建先后。 */
export declare function listSemanticTagNames(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>
): readonly SemanticTagName[];

/** 按 ID 读当前标签：已合并的跟到合并目标，已删除的不返回；键是调用方给的 ID。 */
export declare function readSemanticTagNames(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>,
  ids: readonly string[]
): ReadonlyMap<string, SemanticTagName>;

/** 按 ID 或名称解析现有标签（与语义层同一套名称归一化），不新建。 */
export declare function resolveSemanticTagNames(
  db: Pick<PluginSqliteDatabaseLike, 'prepare'>,
  inputs: readonly string[]
): SemanticTagResolution;
