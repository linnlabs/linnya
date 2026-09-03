import type { BaseMessage } from '../../types';
import {
  ConversationHistorySummaryPayloadSchema,
  ConversationThoughtMessageMetadataSchema,
  ConversationToolMessageMetadataSchema,
  ConversationUserMessageMetadataSchema,
  parseConversationAnswerMessageMetadata,
} from '@app/schemas';
import type { WindowMessageRow } from '../definitions/messageWindow';
import type { UiMessageDto, UiMessagesWindowReadyDto } from '../definitions/uiMessagesDto';
import type { ConversationCitationDependencySnapshot } from '@app/schemas';
import { projectToolCardPresentation } from '../../ports/toolPresentationProjectionPort';
import { buildToolResultFromMessage } from '../../services/message/tool/buildToolResultFromMessage';

export function mapUiMessageDtoToWindowRow(
  dto: UiMessageDto,
  revision: number,
  citationDependencies?: ConversationCitationDependencySnapshot,
): WindowMessageRow {
  const message = mapUiMessageDtoToConversationMessage(dto, citationDependencies);
  return {
    conversationId: dto.conversation_id,
    messageId: dto.message_id,
    sortSeq: dto.sort_seq,
    revision,
    dto,
    message,
  };
}

export function mapUiMessagesWindowDtoToRows(dto: UiMessagesWindowReadyDto): WindowMessageRow[] {
  return dto.messages.map(message => mapUiMessageDtoToWindowRow(
    message,
    dto.revision,
    dto.citation_dependencies[message.message_id],
  ));
}

export function mapUiMessageDtoToConversationMessage(
  dto: UiMessageDto,
  citationDependencies?: ConversationCitationDependencySnapshot,
): BaseMessage {
  const common = {
    id: dto.message_id,
    content: dto.content ?? '',
    ...(dto.attachments?.length ? { attachments: [...dto.attachments] } : {}),
    timestamp: dto.timestamp,
    ...(citationDependencies ? { citationDependencies } : {}),
  };
  const identityScope = {
    turn_id: dto.turn_id,
    run_id: dto.run_id,
    ...(dto.merge_key === null ? {} : { merge_key: dto.merge_key }),
  };
  const scope = {
    ...identityScope,
    ...(dto.presentation === null
      ? {}
      : { ui: { presentation: dto.presentation } }),
  };

  switch (dto.message_type) {
    case 'user_input': {
      const metadata = ConversationUserMessageMetadataSchema.parse({
        ...(dto.payload ?? {}),
        ...scope,
      });
      return {
        ...common,
        role: dto.role,
        type: dto.message_type,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      };
    }
    case 'thought':
      return {
        ...common,
        role: dto.role,
        type: dto.message_type,
        metadata: ConversationThoughtMessageMetadataSchema.parse({
          ...dto.payload,
          ...scope,
        }),
      };
    case 'tool_calls': {
      const metadata = ConversationToolMessageMetadataSchema.parse({
        ...dto.payload,
        ...identityScope,
      });
      const toolResult = buildToolResultFromMessage(common.content, metadata);
      const toolPresentation = projectToolCardPresentation({
        sourceToolName: metadata.tool_name,
        toolCallId: metadata.tool_call_id,
        args: metadata.args ?? {},
        result: toolResult,
        interaction: metadata.interaction,
        subrunSummary: metadata.subrun_summary,
        status: metadata.status,
        phase: metadata.phase,
      });
      return {
        ...common,
        role: dto.role,
        type: dto.message_type,
        metadata,
        ...(toolPresentation ? { toolPresentation } : {}),
      };
    }
    case 'final_answer':
      return {
        ...common,
        role: dto.role,
        type: dto.message_type,
        metadata: parseConversationAnswerMessageMetadata(dto.message_type, {
          ...dto.payload,
          ...scope,
        }),
      };
    case 'tool_preamble':
      return {
        ...common,
        role: dto.role,
        type: dto.message_type,
        metadata: parseConversationAnswerMessageMetadata(dto.message_type, {
          ...dto.payload,
          ...scope,
        }),
      };
    case 'partial_answer':
      return {
        ...common,
        role: dto.role,
        type: dto.message_type,
        metadata: parseConversationAnswerMessageMetadata(dto.message_type, {
          ...dto.payload,
          ...scope,
        }),
      };
    case 'history_summary':
      return {
        ...common,
        role: dto.role,
        type: dto.message_type,
        metadata: {
          ...ConversationHistorySummaryPayloadSchema.parse(dto.payload),
          ...scope,
        },
      };
  }
}
