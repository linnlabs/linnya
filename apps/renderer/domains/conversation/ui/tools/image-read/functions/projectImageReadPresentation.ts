import {
  HistoricalResourceImageReadResultSchema,
  HistoricalResourceReadArgsSchema,
  HistoricalWorkspaceReadFileArgsSchema,
  HistoricalWorkspaceReadFileEventResultSchema,
  WorkspaceReadFileArgsSchema,
  WorkspaceReadFileEventResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import type {
  ImageReadPresentationData,
  ImageReadSource,
} from '../definitions/imageReadPresentation';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import { isSupportedReadFileImageContentType } from './resolveReadFileUiKey';

const ASSET_IMAGE_PREFIX = 'asset://assets/';
const CONVERSATION_FILE_IMAGE_PREFIX = 'conversation_file://files/';

function createImageReadTitle() {
  return createConversationToolTitleDescriptor('conversation.tool.imageRead.title');
}

function readHistoricalResourceImageSource(uri: string): ImageReadSource | undefined {
  if (uri.startsWith(ASSET_IMAGE_PREFIX)) return 'asset';
  if (uri.startsWith(CONVERSATION_FILE_IMAGE_PREFIX)) return 'conversation_file';
  return undefined;
}

function projectHistoricalResourceImage(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ImageReadPresentationData> {
  if (input.status !== 'success') {
    return {
      data: { kind: 'lifecycle' },
      title: createImageReadTitle(),
    };
  }

  const args = HistoricalResourceReadArgsSchema.parse(input.args);
  const source = readHistoricalResourceImageSource(args.uri);
  if (!source) {
    throw new Error(`Historical Resource image read received a non-image URI: ${args.uri}`);
  }
  const result = HistoricalResourceImageReadResultSchema.parse(input.result);
  if (result.data.uri !== args.uri || readHistoricalResourceImageSource(result.data.uri) !== source) {
    throw new Error('Historical Resource image result identity does not match its tool arguments.');
  }
  if (source === 'asset' && (result.data.relative_path || result.data.file_name)) {
    throw new Error('Historical asset image result must not contain conversation file fields.');
  }
  if (source === 'conversation_file' && !result.data.file_name) {
    throw new Error('Historical conversation image result is missing its file name.');
  }

  return {
    title: createImageReadTitle(),
    data: {
      kind: 'image',
      source,
      ...(result.data.file_name ? { fileName: result.data.file_name } : {}),
    },
  };
}

function projectReadFileImage(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ImageReadPresentationData> {
  if (input.status !== 'success') {
    throw new Error('read_file can enter image_read only after a successful image result.');
  }

  const live = WorkspaceReadFileEventResultSchema.safeParse(input.result);
  if (live.success) {
    WorkspaceReadFileArgsSchema.parse(input.args);
    const data = live.data.data;
    if (
      (data.source_kind !== 'conversation_file' && data.source_kind !== 'host_file')
      || !isSupportedReadFileImageContentType(data.content_type)
    ) {
      throw new Error('read_file image presentation received a non-image live result.');
    }
    return {
      title: createImageReadTitle(),
      data: {
        kind: 'image',
        source: data.source_kind,
        fileName: data.file_name,
      },
    };
  }

  HistoricalWorkspaceReadFileArgsSchema.parse(input.args);
  const historical = HistoricalWorkspaceReadFileEventResultSchema.parse(input.result);
  if (
    !('source' in historical.data)
    || historical.data.source !== 'conversation_file'
    || !isSupportedReadFileImageContentType(historical.data.content_type)
  ) {
    throw new Error('read_file image presentation received a non-image historical result.');
  }
  return {
    title: createImageReadTitle(),
    data: {
      kind: 'image',
      source: 'conversation_file',
      fileName: historical.data.file_name,
    },
  };
}

/**
 * 历史 Resource 图片与当前 read_file 图片共用展示数据，但各自保留独立 strict schema 分支。
 */
export function projectImageReadPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ImageReadPresentationData> {
  if (input.uiKey !== 'image_read') {
    throw new Error(`Unsupported image read UI key: ${input.uiKey}`);
  }
  if (input.sourceToolName === 'resource_read') {
    return projectHistoricalResourceImage(input);
  }
  if (input.sourceToolName === 'read_file') {
    return projectReadFileImage(input);
  }
  throw new Error(`Unsupported image read source tool: ${input.sourceToolName}`);
}
