import type { ConversationImageIngressPort } from 'src/features/conversation/attachments/features/image-ingress';

/** Flow 只消费已签发草稿；选择文件与接收上传字节属于外层入口职责。 */
export type FlowImageDraftCommitPort = Pick<
  ConversationImageIngressPort,
  'resolveDraftBatch' | 'commitDraftFile' | 'releaseDraft'
>;
