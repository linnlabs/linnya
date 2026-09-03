import { z } from 'zod';

/**
 * Runtime 核心身份命名空间的唯一真源。
 *
 * 这些身份虽然在线上都是字符串，但标识的实体、生命周期和唯一性作用域不同。
 * 合同层必须引用本文件的 schema，业务代码必须通过相应 creator 或生成器创建，
 * 禁止因为底层类型相同而在 event、answer、tool call 之间互相替代。
 *
 * 外部协议、SQLite 历史事实和模型供应商数据仍从 string 边界进入；边界必须通过
 * 本文件 schema strict parse，内部再保持名义类型。禁止用类型断言伪造身份。
 */
const NonEmptyIdentitySchema = z
  .string()
  .min(1)
  .refine(
    value => value === value.trim(),
    'identity must not contain leading or trailing whitespace'
  );

/** 不可变 Runtime 事实身份；全局唯一。 */
export const RuntimeEventIdSchema = NonEmptyIdentitySchema;
/** 进入模型上下文的一条消息身份；可以保留来源 Runtime fact ID，也可以由上下文 owner 创建。 */
export const AiMessageIdSchema = NonEmptyIdentitySchema;
/** Conversation 聚合根身份；全局唯一。 */
export const ConversationIdSchema = NonEmptyIdentitySchema;
/** 一次用户输入及其后续工作的逻辑轮次身份；conversation 内唯一。 */
export const TurnIdSchema = NonEmptyIdentitySchema;
/** 一次 Agent run 身份；全局唯一。 */
export const RunIdSchema = NonEmptyIdentitySchema.brand<'RunId'>();
/** 一次前端传输/执行会话身份；全局唯一。 */
export const ExecutionIdSchema = NonEmptyIdentitySchema;
/** 一条可观察性链路身份；全局唯一，由 execution sequencer 持有。 */
export const TraceIdSchema = NonEmptyIdentitySchema;
/** 一个可流式聚合的答案段身份；全局唯一。 */
export const AnswerSegmentIdSchema = NonEmptyIdentitySchema;
/** 一段可增量合并的思考消息身份；run 内唯一。 */
export const ThoughtMessageIdSchema = NonEmptyIdentitySchema;
/** 一次工具调用身份；run 内唯一。 */
export const ToolCallIdSchema = NonEmptyIdentitySchema.brand<'ToolCallId'>();
/** 一次需要用户继续操作的交互身份；run 内唯一。 */
export const InteractionIdSchema = NonEmptyIdentitySchema;
/** 一个 child/subrun 身份；全局唯一。 */
export const SubrunIdSchema = NonEmptyIdentitySchema;
/** 一次等待用户交互的恢复凭据；全局唯一且不可复用。 */
export const ResumeTokenSchema = NonEmptyIdentitySchema;
/** 一次等待用户交互恢复操作的互斥 claim 身份；全局唯一。 */
export const RunResumeClaimIdSchema = NonEmptyIdentitySchema;
/** 一份追加只读审计信封的身份；全局唯一。 */
export const AuditEnvelopeIdSchema = NonEmptyIdentitySchema;
/** 一条上下文构建账本记录的身份；全局唯一。 */
export const ContextLedgerEntryIdSchema = NonEmptyIdentitySchema;

/**
 * 指向已有 Runtime fact 的关系字段，不创建新的身份命名空间。
 * 采用单独名称是为了让字段语义清楚，而不是允许生成独立 source event ID。
 */
export const SourceEventIdSchema = RuntimeEventIdSchema;

/** 历史摘要替换目标；必须引用已有 Runtime fact 的正式 ID。 */
export const HistoryMessageReferenceIdSchema = AiMessageIdSchema;

/**
 * control 事件操作目标的多态引用。
 *
 * 目标可能是 event、message 或 branch anchor，所以它不是新的实体身份，也不能被收窄成
 * 某一个具体 ID 类型；创建 control 事件的业务边界必须根据 op 解释并校验目标类别。
 */
export const ControlTargetReferenceIdSchema = NonEmptyIdentitySchema;

export type RuntimeEventId = z.infer<typeof RuntimeEventIdSchema>;
export type AiMessageId = z.infer<typeof AiMessageIdSchema>;
export type ConversationId = z.infer<typeof ConversationIdSchema>;
export type TurnId = z.infer<typeof TurnIdSchema>;
export type RunId = z.infer<typeof RunIdSchema>;
export type ExecutionId = z.infer<typeof ExecutionIdSchema>;
export type TraceId = z.infer<typeof TraceIdSchema>;
export type AnswerSegmentId = z.infer<typeof AnswerSegmentIdSchema>;
export type ThoughtMessageId = z.infer<typeof ThoughtMessageIdSchema>;
export type ToolCallId = z.infer<typeof ToolCallIdSchema>;
export type InteractionId = z.infer<typeof InteractionIdSchema>;
export type SubrunId = z.infer<typeof SubrunIdSchema>;
export type ResumeToken = z.infer<typeof ResumeTokenSchema>;
export type RunResumeClaimId = z.infer<typeof RunResumeClaimIdSchema>;
export type AuditEnvelopeId = z.infer<typeof AuditEnvelopeIdSchema>;
export type ContextLedgerEntryId = z.infer<typeof ContextLedgerEntryIdSchema>;
export type SourceEventId = z.infer<typeof SourceEventIdSchema>;
export type HistoryMessageReferenceId = z.infer<typeof HistoryMessageReferenceIdSchema>;
export type ControlTargetReferenceId = z.infer<typeof ControlTargetReferenceIdSchema>;
