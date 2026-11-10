/**
 * 查询描述：在一个项目里按标签和字段筛选文档。CLI、面板和以后的界面都用这一份描述，
 * 由编译器翻译成只读 SQL。语义（空值、多值“包含”、大小写、日期比较）写在 README 并有测试。
 */

/** 内建字段：文档自身的事实，不是语义层字段。 */
export const SEMANTIC_QUERY_BUILTIN_FIELDS = ['name', 'type', 'created', 'updated'] as const;
export type SemanticQueryBuiltinField = (typeof SEMANTIC_QUERY_BUILTIN_FIELDS)[number];

export const SEMANTIC_QUERY_OPERATORS = [
  'eq', 'neq', 'contains', 'not_contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty',
] as const;
export type SemanticQueryOperator = (typeof SEMANTIC_QUERY_OPERATORS)[number];

export interface SemanticQueryFilter {
  /** 字段名或 ID，或内建字段。 */
  readonly field: string;
  readonly op: SemanticQueryOperator;
  /** `empty`、`not_empty` 不带值；多选的 `contains` 可给列表，命中任一即算。 */
  readonly value?: string | number | boolean | readonly string[];
}

export interface SemanticQuerySort {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export interface SemanticQuery {
  readonly projectId: string;
  /** 同时带有这些标签（名称或 ID）。 */
  readonly tags?: readonly string[];
  /** 全部条件同时成立。 */
  readonly where?: readonly SemanticQueryFilter[];
  readonly sort?: readonly SemanticQuerySort[];
  /** 按单选、多选、勾选字段或内建 `type` 分组计数；多选的对象出现在它的每个选项组里。 */
  readonly groupBy?: string;
  readonly limit: number;
}

export const SEMANTIC_QUERY_MAX_LIMIT = 200;

export interface SemanticQueryRow {
  readonly documentId: string;
  readonly name: string;
  readonly nodeType: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly revision: number;
  readonly tagIds: readonly string[];
  /** 键是字段 ID；只含对象当前标签带来的字段。 */
  readonly values: Readonly<Record<string, unknown>>;
}

export interface SemanticQueryGroup {
  /** 单选、多选为选项 ID，勾选为 true/false，类型为节点类型；没有值的组为 null。 */
  readonly key: string | boolean | null;
  readonly count: number;
}

export interface SemanticQueryResult {
  readonly rows: readonly SemanticQueryRow[];
  /** 满足条件的总数，不受 limit 影响。 */
  readonly total: number;
  readonly truncated: boolean;
  readonly groups?: readonly SemanticQueryGroup[];
}
