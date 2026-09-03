import { z } from 'zod';

export const CONVERSATION_WORK_DIRECTORY_KIND = 'linnya_conversation_work_directory' as const;
export const CONVERSATION_WORK_DIRECTORY_INITIALIZED_KIND = 'linnya_conversation_work_directory_initialized' as const;
export const CONVERSATION_WORK_DIRECTORY_REVISION = 1 as const;
export const CONVERSATION_WORK_DIRECTORY_NAMESPACE = 'ConversationWorkDirectories' as const;
export const CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY = 'metadata' as const;
export const CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY = 'workspaces' as const;
export const CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX = '.owner.json' as const;
export const CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX = '.initialized.json' as const;

const NonEmptyConversationIdentitySchema = z.string()
  .min(1)
  .refine(
    value => value === value.trim(),
    'conversation identity must not contain surrounding whitespace',
  )
  .refine(
    value => !value.includes('\0'),
    'conversation identity must not contain NUL',
  );

/**
 * Conversation files 拥有自己的名义身份，不能直接依赖 Commands 的 wire identity。
 * 两者是否指向同一对话，由 app host 在跨 domain 编排边界显式校验。
 */
export const ConversationWorkDirectoryConversationIdSchema = NonEmptyConversationIdentitySchema
  .brand<'ConversationWorkDirectoryConversationId'>();
export type ConversationWorkDirectoryConversationId = z.infer<
  typeof ConversationWorkDirectoryConversationIdSchema
>;

export const ConversationWorkDirectoryDigestSchema = z.string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<'ConversationWorkDirectoryDigest'>();
export type ConversationWorkDirectoryDigest = z.infer<
  typeof ConversationWorkDirectoryDigestSchema
>;

export const ConversationWorkDirectoryKeySchema = z.string()
  .regex(/^conversation_[a-f0-9]{64}$/)
  .brand<'ConversationWorkDirectoryKey'>();
export type ConversationWorkDirectoryKey = z.infer<
  typeof ConversationWorkDirectoryKeySchema
>;

export interface ConversationWorkDirectoryIdentity {
  readonly kind: typeof CONVERSATION_WORK_DIRECTORY_KIND;
  readonly revision: typeof CONVERSATION_WORK_DIRECTORY_REVISION;
  readonly conversationId: ConversationWorkDirectoryConversationId;
  readonly conversationIdDigest: ConversationWorkDirectoryDigest;
  readonly directoryKey: ConversationWorkDirectoryKey;
}

export const ConversationWorkDirectoryOwnerMarkerV1Schema = z.object({
  kind: z.literal(CONVERSATION_WORK_DIRECTORY_KIND),
  revision: z.literal(CONVERSATION_WORK_DIRECTORY_REVISION),
  conversation_id_digest: ConversationWorkDirectoryDigestSchema,
}).strict();
export type ConversationWorkDirectoryOwnerMarkerV1 = z.infer<
  typeof ConversationWorkDirectoryOwnerMarkerV1Schema
>;

export const ConversationWorkDirectoryInitializedMarkerV1Schema = z.object({
  kind: z.literal(CONVERSATION_WORK_DIRECTORY_INITIALIZED_KIND),
  revision: z.literal(CONVERSATION_WORK_DIRECTORY_REVISION),
  conversation_id_digest: ConversationWorkDirectoryDigestSchema,
}).strict();
export type ConversationWorkDirectoryInitializedMarkerV1 = z.infer<
  typeof ConversationWorkDirectoryInitializedMarkerV1Schema
>;

/**
 * status 描述本次 resolve 观察到的持久生命周期：
 * - created：此前没有 initialized 事实，本轮建立首次可用目录；并发 joiner 可共享该结果。
 * - existing：initialized 事实与工作目录都存在。
 * - recreated_missing：initialized 事实存在，但工作目录缺失，本轮只重建空目录。
 */
export type ConversationWorkDirectoryResolutionStatus =
  | 'created'
  | 'existing'
  | 'recreated_missing';

/** 绝对路径只在 backend 运行时流转，不进入数据库、事件、renderer 或 Agent tool 参数。 */
export interface ConversationWorkDirectoryResolution {
  readonly identity: ConversationWorkDirectoryIdentity;
  readonly absolutePath: string;
  readonly status: ConversationWorkDirectoryResolutionStatus;
}
