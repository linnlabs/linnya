import {
  FontCatalogUnavailableError,
} from '@plugin/backend/fontResolution';
import {
  assessFontDelivery,
  listOfficeFontFamilies,
} from '@plugin/slides/shared';
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
      const { status, officeFamily, alternatives } = assessFontDelivery(
        command.family,
        'office',
        result.match?.scripts[0],
      );
      const report: SlidesCliFontCheckReport = {
        kind: SLIDES_CLI_FONT_CHECK_KIND,
        schemaVersion: SLIDES_CLI_FONT_REPORT_VERSION,
        cliVersion: SLIDES_CLI_VERSION,
        ...result,
        office: { status, ...(officeFamily ? { officeFamily } : {}), alternatives },
      };
      return success(report, command.format);
    }

    if (command.target === 'office') {
      const families = [];
      for (const entry of listOfficeFontFamilies(command.script)) {
        const installed = await isInstalledUnderAnyName(execution, [entry.family, ...entry.localNames]);
        signal?.throwIfAborted();
        families.push({
          family: entry.family,
          localNames: entry.localNames,
          delivery: entry.status,
          installedHere: installed,
        });
      }
      const report: SlidesCliFontListReport = {
        kind: SLIDES_CLI_FONT_LIST_KIND,
        schemaVersion: SLIDES_CLI_FONT_REPORT_VERSION,
        cliVersion: SLIDES_CLI_VERSION,
        target: 'office',
        script: command.script,
        families,
      };
      return success(report, command.format);
    }

    const result = await execution.listFontFamilies(command.request);
    signal?.throwIfAborted();
    const report: SlidesCliFontListReport = {
      kind: SLIDES_CLI_FONT_LIST_KIND,
      schemaVersion: SLIDES_CLI_FONT_REPORT_VERSION,
      cliVersion: SLIDES_CLI_VERSION,
      target: 'local',
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

async function isInstalledUnderAnyName(
  execution: SlidesCliFontExecutionPort,
  names: readonly string[],
): Promise<boolean> {
  for (const name of names) {
    if ((await execution.checkFontFamily(name)).installed) return true;
  }
  return false;
}

function success(report: SlidesCliFontCheckReport | SlidesCliFontListReport, format?: 'json' | 'pretty'): SlidesCliExecutionResult {
  return {
    exitCode: SlidesCliExitCode.SUCCESS,
    stdout: `${JSON.stringify(report, null, format === 'pretty' ? 2 : undefined)}\n`,
    stderr: '',
  };
}
