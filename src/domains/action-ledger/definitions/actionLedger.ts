/**
 * 行动账本的公共合同：谁、在哪次运行里、改了哪份用户内容。
 *
 * 账本只存身份与版本引用，不复制正文；撤回与审阅仍由各文档 owner 执行。
 */

/** 执行者种类。系统维护（迁移、索引、清理）不入账，因此没有 system。 */
export type ActionActorKind = 'user' | 'run' | 'subrun' | 'plugin' | 'external';

/**
 * 入口在 Host 侧确定的执行者。owner 只拿到绑定了执行者的登记端口，
 * 不能在登记时改写或自报身份。
 */
export type ActionActor =
  | { readonly kind: 'user' }
  | { readonly kind: 'plugin'; readonly pluginId: string }
  | ActionExternalActor
  | ActionRunActor;

/**
 * 经外部控制桥（Linnya CLI）进来的改动。分不出调用方是人、脚本还是外部 Agent，只证明来自这个入口。
 * CLI 的工具调用由一次无模型运行执行，此时带上该运行身份，便于按对话和运行追溯。
 */
export interface ActionExternalActor {
  readonly kind: 'external';
  readonly run?: ActionRunActor;
}

/** Agent 运行。subrun 记录直接父运行，所有运行都记录用户这次请求的根运行。 */
export interface ActionRunActor {
  readonly kind: 'run' | 'subrun';
  readonly runId: string;
  readonly rootRunId: string;
  readonly parentRunId: string | null;
  readonly conversationId: string | null;
  readonly toolCallId: string | null;
}

/** 当前入账的动作。删除、移动、改名、属性和关系由对应入口接入时扩展。 */
export type ActionLedgerAction = 'create' | 'update';

/**
 * coarse：Host 分发口按文档记的一条，只证明这次调用成功写入了这份文档。
 * fine：owner 在自己的提交事务里记的细账，可带部分、版本引用和摘要计数。
 */
export type ActionLedgerGranularity = 'coarse' | 'fine';

export interface ActionLedgerEntryInput {
  readonly projectId: string;
  readonly documentId: string;
  readonly documentType: string;
  readonly action: ActionLedgerAction;
  /** owner 定义的文档内部分身份，例如某一页或某组元素。 */
  readonly part?: string;
  /** owner 的版本引用；被文档历史清理后读取方按版本不存在处理。 */
  readonly beforeRef?: string;
  readonly afterRef?: string;
  /** 少量计数，例如改了几处；不放正文片段。 */
  readonly summary?: Readonly<Record<string, number>>;
  /** 作者与执行者不同时填写，例如用户接受运行 R 的建议时作者是 R。 */
  readonly authorRunId?: string;
}

/** 同一数据库连接上的同步写入；在 owner 事务里调用时随该事务提交或回滚。 */
export interface ActionLedgerRecorder {
  record(entry: ActionLedgerEntryInput): void;
}

export interface ActionLedgerChangeQuery {
  readonly projectId: string;
  /** 根运行：包含它的全部子运行。 */
  readonly rootRunId?: string;
  /** 毫秒时间戳，含起点。 */
  readonly since?: number;
  /** 毫秒时间戳，不含终点。 */
  readonly until?: number;
  readonly limit: number;
}

/** 同一执行者对同一文档的改动合成一项，按最近一次改动倒序。 */
export interface ActionLedgerDocumentChange {
  readonly documentId: string;
  readonly documentType: string;
  readonly actorKind: ActionActorKind;
  readonly pluginId: string | null;
  readonly runId: string | null;
  readonly rootRunId: string | null;
  readonly parentRunId: string | null;
  readonly conversationId: string | null;
  /** 执行这次运行的 Agent（注册表 ID）；用户、插件和没有 Agent 的运行为 null。 */
  readonly agentId: string | null;
  readonly actions: readonly ActionLedgerAction[];
  readonly entryCount: number;
  readonly granularity: ActionLedgerGranularity | 'mixed';
  readonly firstRecordedAt: number;
  readonly lastRecordedAt: number;
}

export interface ActionLedgerChangeList {
  readonly changes: readonly ActionLedgerDocumentChange[];
  /** 超出 limit 时为 true；调用方必须明说结果不完整。 */
  readonly truncated: boolean;
}

export const ACTION_LEDGER_MAX_QUERY_LIMIT = 200;

/** 一份文档在账本里的首尾两条：谁新建的，最近一次是谁改的。 */
export interface ActionLedgerDocumentSummary {
  readonly documentId: string;
  /** 账本里最早的一条是新建时给出；文档早于账本或新建没有入账时为 null。 */
  readonly creator: {
    readonly actorKind: ActionActorKind;
    readonly pluginId: string | null;
    /** 新建发生在别的项目（文档后来转入）时为 null，与按运行查询的可见规则一致。 */
    readonly conversationId: string | null;
    readonly agentId: string | null;
  } | null;
  readonly last: {
    readonly actorKind: ActionActorKind;
    readonly pluginId: string | null;
    readonly agentId: string | null;
    readonly recordedAt: number;
  };
}
