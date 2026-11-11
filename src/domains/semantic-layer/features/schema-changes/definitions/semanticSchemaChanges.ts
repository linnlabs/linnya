import type {
  SemanticObjectRef,
  SemanticSelectOption,
  SemanticValueType,
} from '../../../definitions/semanticLayer';

/**
 * 标签与字段本身的改动：改名、合并、删除、改类型、改选项。每次是一批，记一行，可整批撤回。
 * 给对象打标签、改值不在这里，那些按对象版本和行动账本撤回。
 */
export const SEMANTIC_SCHEMA_CHANGE_KINDS = [
  'rename_tag',
  'merge_tags',
  'delete_tag',
  'rename_property',
  'delete_property',
  'change_property_type',
  'update_options',
] as const;
export type SemanticSchemaChangeKind = (typeof SEMANTIC_SCHEMA_CHANGE_KINDS)[number];

/** 改动由谁做的。身份来自入口绑定的执行者；没有绑定时按用户。Agent 由运行记录查出。 */
export interface SemanticChangeActor {
  readonly kind: 'user' | 'run' | 'subrun' | 'plugin' | 'external';
  readonly conversationId: string | null;
  readonly runId: string | null;
  readonly agentId: string | null;
}

/** 列表里显示用的摘要：名称取改动当时的名称，计数是受影响的对象数。 */
export type SemanticSchemaChangeSummary =
  | { readonly kind: 'rename_tag'; readonly from: string; readonly to: string }
  | { readonly kind: 'merge_tags'; readonly source: string; readonly target: string; readonly objects: number }
  | { readonly kind: 'delete_tag'; readonly tag: string; readonly objects: number }
  | { readonly kind: 'rename_property'; readonly from: string; readonly to: string }
  | { readonly kind: 'delete_property'; readonly property: string }
  | {
    readonly kind: 'change_property_type';
    readonly property: string;
    readonly fromType: SemanticValueType;
    readonly toType: SemanticValueType;
    readonly objects: number;
    readonly failed: number;
  }
  | {
    readonly kind: 'update_options';
    readonly property: string;
    readonly added: readonly string[];
    readonly renamed: readonly { readonly from: string; readonly to: string }[];
    readonly removed: readonly string[];
    readonly objects: number;
  };

export interface SemanticSchemaChange {
  readonly id: string;
  readonly summary: SemanticSchemaChangeSummary;
  readonly actor: SemanticChangeActor;
  readonly createdAt: number;
  readonly undoneAt: number | null;
  /** 调用方附在这批改动上的自己的部分（如保存的筛选改写前的定义），撤回时原样交还。 */
  readonly attachments: Readonly<Record<string, unknown>>;
}

/** 选项编辑：带 ID 的是已有选项（可改名、调顺序），不带的是新选项；没列出的已有选项被删除。 */
export interface SemanticOptionInput {
  readonly id?: string;
  readonly name: string;
}

export interface SemanticConversionSample {
  readonly ref: SemanticObjectRef;
  /** 原值的文字形式。 */
  readonly from: string;
  /** 转换后的文字形式；转不了或变空为 null。 */
  readonly to: string | null;
}

/**
 * 改类型前的预览：每个已填的值是能转、转不了还是会变空。
 * 转不了与变空的值转换后都被清除，原值记在这批改动里，撤回时恢复。
 */
export interface SemanticTypeChangePreview {
  readonly property: { readonly id: string; readonly name: string; readonly valueType: SemanticValueType };
  readonly toType: SemanticValueType;
  /** 转换后的选项（改成单选、多选时）；原来就是单选或多选的沿用原选项与 ID。 */
  readonly toOptions: readonly SemanticSelectOption[];
  readonly total: number;
  readonly converted: number;
  readonly failed: number;
  readonly emptied: number;
  readonly samples: {
    readonly converted: readonly SemanticConversionSample[];
    readonly failed: readonly SemanticConversionSample[];
    readonly emptied: readonly SemanticConversionSample[];
  };
}

/** 合并、删除标签前的影响范围（对象 ID，由调用方按自己的范围解释成文档）。 */
export interface SemanticTagImpact {
  readonly tag: { readonly id: string; readonly name: string };
  readonly objects: readonly SemanticObjectRef[];
  /** 合并时：已经带有目标标签的对象。 */
  readonly alreadyTarget: readonly SemanticObjectRef[];
  /** 合并时：目标标签要加上的字段名。 */
  readonly addedFields: readonly string[];
}

export interface SemanticUndoResult {
  readonly change: SemanticSchemaChange;
  readonly attachments: Readonly<Record<string, unknown>>;
}
