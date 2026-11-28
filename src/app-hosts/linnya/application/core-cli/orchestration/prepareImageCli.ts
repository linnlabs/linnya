import type {
  BackendPluginCliAccessPlan,
  BackendPluginCliPreparation,
  BackendPluginCliResult,
} from '@linnya/plugin-host-contract/backend';
import {
  convertInkToAlpha,
  createTexture,
  frostImageRegion,
  measureImageTrim,
  overlayImageGrid,
  warpImageToQuad,
  type EncodedImage,
  type ImageProcessingOutcome,
} from 'src/domains/image-processing';
import type { PhysicalFileReaderPort } from '../../file-read';
import { formatGrid, formatTrim, formatWrittenImage } from '../functions/formatImage';
import { imageUsageFor, parseImageCommand, type ImageCommand } from '../functions/parseImageCommand';
import {
  ConversationAssetWriteError,
  readConversationImage,
  writeConversationAsset,
} from './conversationImageFiles';

type ProcessingCommand = Exclude<ImageCommand, { kind: 'help' }>;

function access(conversationFiles: 'read' | 'write'): BackendPluginCliAccessPlan {
  return {
    internalDataAccess: 'none', conversationFiles, externalFiles: 'denied',
    network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
  };
}

function failed(code: string, message: string): BackendPluginCliResult {
  return { exitCode: 1, stdout: '', stderr: `${code} ${message}\n` };
}

interface ImageCliContext {
  readonly reader: PhysicalFileReaderPort;
  readonly root: string;
  readonly signal: AbortSignal;
}

async function writeResult(
  context: ImageCliContext, stem: string, operation: string, image: EncodedImage,
): Promise<string> {
  return await writeConversationAsset({
    root: context.root, stem, operation,
    extension: image.format === 'png' ? 'png' : 'jpg',
    bytes: image.bytes, signal: context.signal,
  });
}

/** 一张输入图、一张输出图的子命令共用：读图 → 处理 → 写进 assets/。 */
async function processOne(
  context: ImageCliContext,
  command: Exclude<ProcessingCommand, { kind: 'trim' | 'texture' }>,
): Promise<BackendPluginCliResult> {
  const bytes = await readConversationImage(context.reader, context.root, command.image, context.signal);
  if (!bytes) return failed('image_unreadable', `读不出 ${command.image}：不在当前对话工作目录里，或不是 JPEG、PNG、WebP`);
  let outcome: ImageProcessingOutcome<EncodedImage>;
  switch (command.kind) {
    case 'ink':
      outcome = await convertInkToAlpha({ bytes, ink: command.color });
      break;
    case 'frost':
      outcome = await frostImageRegion({
        bytes, region: command.region, blur: command.blur, radius: command.radius,
        ...(command.aspect === undefined ? {} : { aspect: command.aspect }),
      });
      break;
    case 'perspective':
      outcome = await warpImageToQuad({
        bytes, quad: command.quad,
        ...(command.width === undefined ? {} : { width: command.width }),
        ...(command.height === undefined ? {} : { height: command.height }),
      });
      break;
    case 'grid':
      outcome = await overlayImageGrid({ bytes, divisions: command.divisions });
      break;
  }
  if (outcome.status === 'failed') return failed(outcome.code, outcome.message);
  const locator = await writeResult(context, command.image, command.kind, outcome.value);
  const stdout = command.kind === 'grid'
    ? formatGrid(locator, outcome.value, command.divisions)
    : formatWrittenImage(locator, outcome.value);
  return { exitCode: 0, stdout, stderr: '' };
}

async function execute(context: ImageCliContext, command: ProcessingCommand): Promise<BackendPluginCliResult> {
  try {
    if (command.kind === 'texture') {
      const outcome = await createTexture({
        kind: command.texture, width: command.width, height: command.height,
        ...(command.color === undefined ? {} : { color: command.color }),
      });
      if (outcome.status === 'failed') return failed(outcome.code, outcome.message);
      const locator = await writeResult(context, 'texture', command.texture, outcome.value);
      return { exitCode: 0, stdout: formatWrittenImage(locator, outcome.value), stderr: '' };
    }
    if (command.kind === 'trim') {
      const bytes = await readConversationImage(context.reader, context.root, command.image, context.signal);
      if (!bytes) return failed('image_unreadable', `读不出 ${command.image}：不在当前对话工作目录里，或不是 JPEG、PNG、WebP`);
      const outcome = await measureImageTrim({ bytes, tolerance: command.tolerance, save: command.save });
      if (outcome.status === 'failed') return failed(outcome.code, outcome.message);
      const { image, ...measurement } = outcome.value;
      const saved = image ? { locator: await writeResult(context, command.image, 'trim', image), image } : null;
      return { exitCode: 0, stdout: formatTrim({ ...measurement, saved }), stderr: '' };
    }
    return await processOne(context, command);
  } catch (error) {
    // 写不进 assets/ 是可预期的业务失败（例如它被换成了指向别处的链接），其余异常照常抛给 Shell 桥记录。
    if (error instanceof ConversationAssetWriteError) return failed('output_unwritable', error.message);
    throw error;
  }
}

/**
 * `linnya image`：Agent 在 Shell 里处理对话工作目录里的图片。prepare 只解析参数；
 * 读图和写结果在父 Shell 权限校验通过后才发生。只有 `trim` 不带 `--save` 是只读的。
 */
export function prepareImageCli(input: {
  readonly argv: readonly string[];
  readonly conversationRoot: string;
  readonly fileReader: PhysicalFileReaderPort;
}): BackendPluginCliPreparation {
  let command: ImageCommand;
  try {
    command = parseImageCommand(input.argv);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '参数无效';
    return { status: 'completed', result: { exitCode: 2, stdout: '', stderr: `${reason}\n${imageUsageFor(input.argv)}\n` } };
  }
  if (command.kind === 'help') return { status: 'completed', result: { exitCode: 0, stdout: `${command.text}\n`, stderr: '' } };
  const processing = command;
  const readOnly = processing.kind === 'trim' && !processing.save;
  return {
    status: 'ready',
    plan: {
      access: access(readOnly ? 'read' : 'write'),
      execute: async ({ signal }) => await execute({ reader: input.fileReader, root: input.conversationRoot, signal }, processing),
    },
  };
}
