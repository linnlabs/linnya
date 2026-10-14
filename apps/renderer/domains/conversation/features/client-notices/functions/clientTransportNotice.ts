import type { ConversationClientNoticeCommand } from '@app/schemas';
import type { ConversationTransportError } from '../../../definitions/conversationTransport';

export function clientTransportNotice(failure: ConversationTransportError): Pick<ConversationClientNoticeCommand, 'error_kind' | 'http_status'> {
  // 服务器 transport_error 是前接纳事实，尚没有 Runtime run；不保存任意 event.error。
  if (failure.source === 'server') return { error_kind: 'http' };
  const status = failure.details?.status;
  const httpStatus = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
  return {
    error_kind: failure.kind === 'network' ? 'connection' : failure.kind === 'protocol' ? 'projection' : failure.kind,
    ...(httpStatus === undefined ? {} : { http_status: httpStatus }),
  };
}
