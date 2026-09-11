import {
  FontCatalogUnavailableError,
} from '@plugin/backend/fontResolution';
import {
  SLIDES_CLI_FONT_CHECK_KIND,
  SLIDES_CLI_FONT_LIST_KIND,
  SLIDES_CLI_FONT_REPORT_VERSION,
  SLIDES_CLI_VERSION,
  SlidesCliExitCode,
  type SlidesCliExecutionResult,
  type SlidesCliFontCheckReport,
  type SlidesCliFontCommand,
  type SlidesCliFontExecutionPort,
  type SlidesCliFontListReport,
} from '../definitions/slidesCli';

export async function executeSlidesCliFontCommand(
  command: SlidesCliFontCommand,
  execution: SlidesCliFontExecutionPort,
  signal?: AbortSignal,
): Promise<SlidesCliExecutionResult> {
  try {
    signal?.throwIfAborted();
    if (command.kind === 'fonts-check') {
      const result = await execution.checkFontFamily(command.family);
      signal?.throwIfAborted();
      const report: SlidesCliFontCheckReport = {
        kind: SLIDES_CLI_FONT_CHECK_KIND,
        schemaVersion: SLIDES_CLI_FONT_REPORT_VERSION,
        cliVersion: SLIDES_CLI_VERSION,
        ...result,
      };
      return success(report, command.format);
    }

    const result = await execution.listFontFamilies(command.request);
    signal?.throwIfAborted();
    const report: SlidesCliFontListReport = {
      kind: SLIDES_CLI_FONT_LIST_KIND,
      schemaVersion: SLIDES_CLI_FONT_REPORT_VERSION,
      cliVersion: SLIDES_CLI_VERSION,
      ...result,
    };
    return success(report, command.format);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (!(error instanceof FontCatalogUnavailableError)) {
      return {
        exitCode: SlidesCliExitCode.INTERNAL_ERROR,
        stdout: '',
        stderr: 'slides.cli.internal_error: Font query failed unexpectedly\n',
      };
    }
    return {
      exitCode: SlidesCliExitCode.ENVIRONMENT_UNAVAILABLE,
      stdout: '',
      stderr: 'slides.cli.font_catalog_unavailable: System font catalog is unavailable\n',
    };
  }
}

function success(report: SlidesCliFontCheckReport | SlidesCliFontListReport, format?: 'json' | 'pretty'): SlidesCliExecutionResult {
  return {
    exitCode: SlidesCliExitCode.SUCCESS,
    stdout: `${JSON.stringify(report, null, format === 'pretty' ? 2 : undefined)}\n`,
    stderr: '',
  };
}
