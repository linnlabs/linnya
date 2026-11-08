import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseFileLocator, type ColorPaletteSuggestion } from '@app/schemas';
import type {
  BackendPluginCliAccessPlan,
  BackendPluginCliPreparation,
  BackendPluginCliResult,
} from '@linnya/plugin-host-contract/backend';
import { checkColorPalette, renderPalettePreview, suggestColorPalettes } from 'src/domains/color-palette';
import { encodeRgbaPng } from 'src/shared/media/image-pixels';
import { PhysicalFileReadError, type PhysicalFileReaderPort } from '../../file-read';
import { formatPaletteCheck, formatPaletteSuggestion } from '../functions/formatPalette';
import { PALETTE_USAGE, parsePaletteCommand, type PaletteCommand } from '../functions/parsePaletteCommand';

const UNREADABLE = new Uint8Array();

function access(conversationFiles: BackendPluginCliAccessPlan['conversationFiles']): BackendPluginCliAccessPlan {
  return {
    internalDataAccess: 'none', conversationFiles, externalFiles: 'denied',
    network: 'denied', guiControl: 'denied', localIpcControl: 'denied',
  };
}

function completed(exitCode: number, stdout: string, stderr: string): BackendPluginCliPreparation {
  return { status: 'completed', result: { exitCode, stdout, stderr } };
}

/** 只认当前对话工作目录；Workspace 文档和宿主文件不是这里的图片来源。 */
function conversationPath(root: string, reference: string): string | null {
  if (!/^[a-z]+:/iu.test(reference)) return path.resolve(root, reference);
  try {
    const parsed = parseFileLocator(reference);
    return parsed.kind === 'conversation' ? path.resolve(root, ...parsed.relativePath.split('/')) : null;
  } catch {
    return null;
  }
}

/** 读不出的图片交回空 bytes，由 domain 统一按跳过处理并判断是否全军覆没。 */
async function readImage(
  reader: PhysicalFileReaderPort, root: string, reference: string, signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const absolutePath = conversationPath(root, reference);
  if (!absolutePath) return UNREADABLE;
  try {
    const physical = await reader.readFile({ absolutePath, scope: { kind: 'conversation', rootPath: root } });
    return physical.kind === 'image_source' ? await readFile(physical.resolvedPath, { signal }) : UNREADABLE;
  } catch (error) {
    if (error instanceof PhysicalFileReadError) return UNREADABLE;
    throw error;
  }
}

/** 文件名带随机后缀、独占创建，工作目录里预先放好的符号链接不能把写入带到目录外。 */
async function writePreview(root: string, suggestion: ColorPaletteSuggestion, signal: AbortSignal): Promise<string> {
  const png = await encodeRgbaPng(renderPalettePreview(suggestion.palettes));
  const name = `palette-${suggestion.id}-${randomBytes(3).toString('hex')}.png`;
  await writeFile(path.join(root, name), png, { flag: 'wx', mode: 0o600, signal });
  return `conversation:/${name}`;
}

async function executeSuggest(
  command: Extract<PaletteCommand, { kind: 'suggest' }>,
  reader: PhysicalFileReaderPort,
  root: string,
  signal: AbortSignal,
): Promise<BackendPluginCliResult> {
  const images: Uint8Array[] = [];
  for (const reference of command.images) images.push(await readImage(reader, root, reference, signal));
  const outcome = await suggestColorPalettes({ ...command.options, images, signal });
  if (outcome.status === 'failed') return { exitCode: 1, stdout: '', stderr: `${outcome.code} ${outcome.message}\n` };
  const preview = command.preview ? await writePreview(root, outcome.suggestion, signal) : null;
  const skippedImages = outcome.skippedImages.flatMap(index => command.images[index] ?? []);
  const stdout = command.json
    ? `${JSON.stringify({ ...outcome.suggestion, skippedImages, ...(preview ? { preview } : {}) })}\n`
    : formatPaletteSuggestion({ suggestion: outcome.suggestion, skippedImages, preview });
  return { exitCode: 0, stdout, stderr: '' };
}

function executeCheck(command: Extract<PaletteCommand, { kind: 'check' }>): BackendPluginCliResult {
  const outcome = checkColorPalette(command.input);
  if (outcome.status === 'failed') return { exitCode: 1, stdout: '', stderr: `${outcome.code} ${outcome.message}\n` };
  const stdout = command.json ? `${JSON.stringify(outcome.check)}\n` : formatPaletteCheck(outcome.check);
  return { exitCode: outcome.check.ok ? 0 : 1, stdout, stderr: '' };
}

/** prepare 只解析参数；读图和写预览在通过父 Shell 权限校验后才发生。 */
export function preparePaletteCli(input: {
  readonly argv: readonly string[];
  readonly conversationRoot: string;
  readonly fileReader: PhysicalFileReaderPort;
}): BackendPluginCliPreparation {
  let command: PaletteCommand;
  try {
    command = parsePaletteCommand(input.argv);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '参数无效';
    return completed(2, '', `${reason}\n${PALETTE_USAGE}\n`);
  }
  switch (command.kind) {
    case 'help':
      return completed(0, `${PALETTE_USAGE}\n`, '');
    case 'check': {
      const check = command;
      return {
        status: 'ready',
        plan: { access: access('none'), execute: async () => executeCheck(check) },
      };
    }
    case 'suggest': {
      const suggest = command;
      return {
        status: 'ready',
        plan: {
          access: access(suggest.preview ? 'write' : 'none'),
          execute: async ({ signal }) => await executeSuggest(suggest, input.fileReader, input.conversationRoot, signal),
        },
      };
    }
  }
}
