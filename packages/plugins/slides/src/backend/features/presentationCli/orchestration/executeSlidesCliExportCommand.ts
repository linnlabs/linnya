import path from 'node:path';

import { formatConversationFileLocator, parseFileLocator } from '@app/schemas/file-locator';

import {
  SLIDES_CLI_EXPORT_REPORT_KIND,
  SLIDES_CLI_EXPORT_REPORT_VERSION,
  SLIDES_CLI_VERSION,
  SlidesCliError,
  SlidesCliExitCode,
  type SlidesCliExecutionResult,
  type SlidesCliExportCommand,
  type SlidesCliExportPort,
  type SlidesCliExportReport,
  type WriteManagedSlidesExportFile,
} from '../definitions/slidesCli';
import { buildSlidesExportFileName } from '../functions/buildSlidesExportFileName';

/**
 * 导出当前成功版本的原生 PPTX（文字、形状、图表保持可编辑），写进会话目录并回报定位符。
 * 与编辑器菜单导出共用 coordinator.export，不另建一套 PPTX 生成规则。
 */
export async function executeSlidesCliExportCommand(
  command: SlidesCliExportCommand,
  port: SlidesCliExportPort,
  writeFile: WriteManagedSlidesExportFile,
  signal?: AbortSignal,
): Promise<SlidesCliExecutionResult> {
  try {
    signal?.throwIfAborted();
    const state = await port.getDocumentBuildState(command.presentationId);
    if (state.state === 'draft') {
      // 草稿时导出的会是上一个成功版本，和调用方刚写入的源码不一致，必须先修好再导。
      throw new SlidesCliError(
        'slides.cli.unresolved_draft',
        SlidesCliExitCode.PRESENTATION_UNAVAILABLE,
        `Presentation ${command.presentationId} has an unresolved deck.js draft (version ${state.versionNumber} is the last successful build). Read the source with read_file, fix it with edit_file or write_file, then export again.`,
      );
    }
    signal?.throwIfAborted();
    const exported = await port.exportPptx(command.presentationId);
    signal?.throwIfAborted();
    const fileName = buildSlidesExportFileName(exported.fileName, state.versionNumber);
    await writeFile({ root: command.output.root, fileName, bytes: exported.buffer });
    const directory = parseFileLocator(command.output.directoryReference);
    if (directory.kind !== 'conversation') {
      throw new Error('Managed Slides export directory must use a conversation locator.');
    }
    const report: SlidesCliExportReport = {
      kind: SLIDES_CLI_EXPORT_REPORT_KIND,
      schemaVersion: SLIDES_CLI_EXPORT_REPORT_VERSION,
      cliVersion: SLIDES_CLI_VERSION,
      presentation: {
        id: state.presentationId,
        versionId: state.versionId,
        versionNumber: state.versionNumber,
      },
      file: {
        format: 'pptx',
        fileName,
        sizeBytes: exported.buffer.byteLength,
        locator: formatConversationFileLocator(path.posix.join(directory.relativePath, fileName)),
      },
    };
    return {
      exitCode: SlidesCliExitCode.SUCCESS,
      stdout: `${JSON.stringify(report, null, command.format === 'pretty' ? 2 : undefined)}\n`,
      stderr: '',
    };
  } catch (error) {
    if (error instanceof SlidesCliError && !signal?.aborted) {
      return { exitCode: error.exitCode, stdout: '', stderr: `${error.code}: ${error.message}\n` };
    }
    // 未知异常交给宿主的插件命令诊断：宿主日志记下真实原因，命令输出只给关联号。
    throw error;
  }
}
