import type { ConversationWorkDirectoryAdmissionPort } from '../../application/conversation-lifecycle';
import type { WebFileStore } from '../../../../tools/web/webread/file-acquisition/definitions/webFileAcquisition';
import { saveConversationWebFile } from '../../../../infra/adapters/web-files/conversationWebFileStore';

/** Web 不持有会话路径算法；文件写入在已有删除准入内完成。 */
export function createWebFileStore(
  admission: ConversationWorkDirectoryAdmissionPort,
  conversationId: string
): WebFileStore {
  return {
    save: input =>
      admission.withAdmission({ conversationId }, directory =>
        saveConversationWebFile(directory.absolutePath, input)
      ),
  };
}
