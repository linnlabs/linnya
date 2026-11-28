import type {
  BackendPluginCliAccessPlan,
  BackendPluginCliPreparation,
  BackendPluginCliResult,
} from '@linnya/plugin-host-contract/backend';
import {
  convertInkToAlpha,
  createTexture,
  cutoutForeground,
  frostImageRegion,
  measureImageTrim,
  overlayImageGrid,
  renderTitle,
  sliceSheet,
  warpImageToQuad,
  type EncodedImage,
  type ForegroundMaskPort,
  type ImageProcessingOutcome,
} from 'src/domains/image-processing';
import type { PhysicalFileReaderPort } from '../../file-read';
import { formatCutout, formatGrid, formatSlice, formatTitle, formatTrim, formatWrittenImage } from '../functions/formatImage';
import { imageUsageFor, parseImageCommand, type ImageCommand } from '../functions/parseImageCommand';
import {
  ConversationAssetWriteError,
  readConversationFont,
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
  readonly foregroundMask: ForegroundMaskPort;
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
  command: Exclude<ProcessingCommand, { kind: 'trim' | 'texture' | 'slice' | 'cutout' | 'title' }>,
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

/** 一张宫格切出多张：每块一个文件，序号与检查图上的一致。 */
async function slice(
  context: ImageCliContext, command: Extract<ProcessingCommand, { kind: 'slice' }>,
): Promise<BackendPluginCliResult> {
  const bytes = await readConversationImage(context.reader, context.root, command.image, context.signal);
  if (!bytes) return failed('image_unreadable', `读不出 ${command.image}：不在当前对话工作目录里，或不是 JPEG、PNG、WebP`);
  const outcome = await sliceSheet({ bytes, key: command.key, ...(command.grid === undefined ? {} : { grid: command.grid }) });
  if (outcome.status === 'failed') return failed(outcome.code, outcome.message);
  const pieces: { locator: string; image: EncodedImage }[] = [];
  for (const [index, image] of outcome.value.pieces.entries()) {
    pieces.push({ locator: await writeResult(context, command.image, `slice${index + 1}`, image), image });
  }
  const check = { locator: await writeResult(context, command.image, 'slice-check', outcome.value.check), image: outcome.value.check };
  return { exitCode: 0, stdout: formatSlice({ ...outcome.value, pieces, check }), stderr: '' };
}

/** 去背：结果图和检查图各写一个文件。 */
async function cutout(
  context: ImageCliContext, command: Extract<ProcessingCommand, { kind: 'cutout' }>,
): Promise<BackendPluginCliResult> {
  const bytes = await readConversationImage(context.reader, context.root, command.image, context.signal);
  if (!bytes) return failed('image_unreadable', `读不出 ${command.image}：不在当前对话工作目录里，或不是 JPEG、PNG、WebP`);
  const outcome = await cutoutForeground({ bytes, method: command.method, foregroundMask: context.foregroundMask, signal: context.signal });
  if (outcome.status === 'failed') return failed(outcome.code, outcome.message);
  const { image, check, ...measurement } = outcome.value;
  const written = { locator: await writeResult(context, command.image, 'cutout', image), image };
  const checked = { locator: await writeResult(context, command.image, 'cutout-check', check), image: check };
  return { exitCode: 0, stdout: formatCutout({ ...measurement, image: written, check: checked }), stderr: '' };
}

/** 标题字：读字体、渲染，PNG 和 SVG 各写一个文件，文件名取标题文字。 */
async function title(
  context: ImageCliContext, command: Extract<ProcessingCommand, { kind: 'title' }>,
): Promise<BackendPluginCliResult> {
  const fontBytes = await readConversationFont(context.root, command.font, context.signal);
  if (!fontBytes) return failed('font_unreadable', `读不出 ${command.font}：不在当前对话工作目录里、不是普通文件，或超过 32MB`);
  const outcome = await renderTitle({
    fontBytes, text: command.text, color: command.color, size: command.size,
    direction: command.direction, thicken: command.thicken,
  });
  if (outcome.status === 'failed') return failed(outcome.code, outcome.message);
  const png = await writeResult(context, command.text, 'title', outcome.value.image);
  const svgBytes = new TextEncoder().encode(outcome.value.svg.text);
  const svg = await writeConversationAsset({
    root: context.root, stem: command.text, operation: 'title', extension: 'svg', bytes: svgBytes, signal: context.signal,
  });
  return { exitCode: 0, stdout: formatTitle({ rendering: outcome.value, png, svg, svgBytes: svgBytes.byteLength }), stderr: '' };
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
    if (command.kind === 'slice') return await slice(context, command);
    if (command.kind === 'cutout') return await cutout(context, command);
    if (command.kind === 'title') return await title(context, command);
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
  readonly foregroundMask: ForegroundMaskPort;
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
      execute: async ({ signal }) => await execute({
        reader: input.fileReader, foregroundMask: input.foregroundMask, root: input.conversationRoot, signal,
      }, processing),
    },
  };
}
