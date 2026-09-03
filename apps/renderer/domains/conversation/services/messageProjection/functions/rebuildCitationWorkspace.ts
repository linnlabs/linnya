import {
  admitCitationsFromConversationSubrunOutput,
  admitCitationsFromConversationToolOutput,
} from '@linnya/citation-domain/conversation-presentation';
import { SSEEvent as SSEEventSchema } from 'linnkit/contracts';

import type { BaseMessage } from '../../../types';
import {
  createConversationCitationProjectionWorkspace,
  projectConversationCitationRegistration,
  type ConversationCitationProjectionWorkspace,
} from '../../../features/citation-presentation';
import { buildToolResultFromMessage } from '../../message/tool/buildToolResultFromMessage';
import { readSubrunTraceBuckets } from '../../../features/subrun-trace';

/** 从已提交 tool messages 重建 live workspace；只消费 canonical result，不读取展示快照猜来源。 */
export function rebuildConversationCitationWorkspace(
  messages: readonly BaseMessage[],
): ConversationCitationProjectionWorkspace {
  let workspace = createConversationCitationProjectionWorkspace();
  for (const message of messages) {
    if (message.type !== 'tool_calls') continue;

    const rawTrace = message.metadata.subrunTrace;
    if (rawTrace) {
      const buckets = readSubrunTraceBuckets(rawTrace);
      if (Object.keys(buckets).length !== Object.keys(rawTrace).length) {
        throw new Error(`[CitationWorkspaceRebuild] tool message=${message.id} 包含非法 subrun bucket`);
      }
      for (const bucket of Object.values(buckets)) {
        for (const rawEvent of bucket.events) {
          const event = SSEEventSchema.parse(rawEvent);
          if (event.type !== 'subrun_trace') {
            throw new Error(
              `[CitationWorkspaceRebuild] tool message=${message.id} trace 中出现 ${event.type}`,
            );
          }
          if (event.kind !== 'tool_output' || typeof event.tool_name !== 'string') continue;
          const subrunAdmission = admitCitationsFromConversationSubrunOutput({
            toolName: event.tool_name,
            status: event.status === 'success'
              ? 'success'
              : event.status === 'error'
                ? 'error'
                : 'loading',
            output: event.output,
          });
          if (!subrunAdmission) continue;
          workspace = projectConversationCitationRegistration(
            workspace,
            event.turn_id,
            subrunAdmission.citations,
          );
        }
      }
    }

    const admission = admitCitationsFromConversationToolOutput({
      toolName: message.metadata.tool_name,
      status: message.metadata.status,
      result: buildToolResultFromMessage(message.content, message.metadata),
    });
    if (!admission) continue;
    workspace = projectConversationCitationRegistration(
      workspace,
      message.metadata.turn_id,
      admission.citations,
    );
  }
  return workspace;
}
