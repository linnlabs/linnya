/**
 * 语义层公共合同：工作区级的标签与字段定义，以及对象（种类，ID）上的标签和字段值。
 *
 * 用户只看到“标签”：标签可以带字段，打上标签后字段出现在对象的属性里。
 * 字段列表实时跟随标签，值只在填写时存；标签增删字段不迁移数据。
 */

/** 对象种类由 Core 登记，插件不能新增。第一版只开放文档；对话的表结构已预留。 */
export const SEMANTIC_OBJECT_KINDS = ['document', 'conversation'] as const;
export type SemanticObjectKind = (typeof SEMANTIC_OBJECT_KINDS)[number];

/** 第一版字段类型。关系字段随来龙去脉（关系表）一起做，公式与 AI 字段后置。 */
export const SEMANTIC_VALUE_TYPES = [
  'text', 'number', 'date', 'datetime', 'checkbox', 'select', 'multi_select', 'url',
] as const;
export type SemanticValueType = (typeof SEMANTIC_VALUE_TYPES)[number];

/** 存储值：文本、网址、日期、日期时间、单选（选项 ID）为字符串；多选为选项 ID 列表。 */
export type SemanticValue = string | number | boolean | readonly string[];

export interface SemanticSelectOption {
  readonly id: string;
  readonly name: string;
}

export interface SemanticPropertyDefinition {
  readonly id: string;
  readonly name: string;
  readonly valueType: SemanticValueType;
  readonly options: readonly SemanticSelectOption[];
  /** 插件声明的字段带命名空间（如 `slides.pageCount`），只由该插件写入。 */
  readonly ownerPluginId: string | null;
  readonly createdAt: number;
}

export interface SemanticTagField {
  readonly propertyId: string;
  /** 只在打标签时写一次（对象还没有这个值时）。 */
  readonly defaultValue?: SemanticValue;
}

/** 新建标签的是谁：用户直接建的只有种类；Agent 建的带对话与 Agent，迁移前建的没有记录。 */
export interface SemanticCreator {
  readonly kind: 'user' | 'run' | 'subrun' | 'plugin' | 'external';
  readonly conversationId: string | null;
  readonly agentId: string | null;
}

export interface SemanticTagDefinition {
  readonly id: string;
  readonly name: string;
  readonly fields: readonly SemanticTagField[];
  readonly createdAt: number;
  readonly createdBy?: SemanticCreator;
}

export interface SemanticObjectRef {
  readonly kind: SemanticObjectKind;
  readonly id: string;
}

export interface SemanticObjectField {
  readonly property: SemanticPropertyDefinition;
  /** 带来这个字段的标签；多个标签共用同一字段时都列出。 */
  readonly tagIds: readonly string[];
}

export interface SemanticObjectState {
  readonly ref: SemanticObjectRef;
  /** 每次改标签或值加一；写入时作为期望版本，从未写过为 0。 */
  readonly revision: number;
  readonly tags: readonly SemanticTagDefinition[];
  /** 全部标签字段的并集，按打标签的先后与标签内字段顺序。 */
  readonly fields: readonly SemanticObjectField[];
  /** 只含当前字段里已设置的值；去掉标签后它的字段值保留但不显示，重新打上即恢复。 */
  readonly values: Readonly<Record<string, SemanticValue>>;
}

export type SemanticLayerErrorCode =
  | 'invalid_name'
  | 'name_conflict'
  | 'similar_name'
  | 'reserved_name'
  | 'unknown_tag'
  | 'unknown_property'
  | 'field_not_available'
  | 'readonly_property'
  | 'invalid_value'
  | 'invalid_definition'
  | 'invalid_query'
  | 'revision_conflict'
  | 'object_not_found'
  | 'outside_project'
  | 'unsupported_kind'
  | 'change_not_found'
  | 'undo_conflict'
  | 'already_undone';

export class SemanticLayerError extends Error {
  constructor(
    readonly code: SemanticLayerErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
    this.name = 'SemanticLayerError';
  }
}

/** 文档身份由 Workspace 提供；语义层不读 Workspace 内部表。 */
export interface SemanticDocumentPort {
  read(documentId: string): {
    readonly projectId: string | null;
    readonly nodeType: string;
    readonly deletedAt: number | null;
  } | null;
}

export interface DefineSemanticPropertyInput {
  readonly name: string;
  readonly valueType: SemanticValueType;
  /** 单选、多选的选项名；ID 由语义层生成。 */
  readonly options?: readonly string[];
  /** 名称与已有定义相近时默认拒绝并列出候选；确认不是同一个时传 true。 */
  readonly allowSimilar?: boolean;
}

export interface DefineSemanticTagInput {
  readonly name: string;
  readonly fields?: readonly SemanticTagField[];
  readonly allowSimilar?: boolean;
}

/** 写对象时的范围：文档必须在这个项目里。 */
export interface SemanticObjectWrite {
  readonly projectId: string;
  readonly ref: SemanticObjectRef;
  readonly expectedRevision: number;
}
