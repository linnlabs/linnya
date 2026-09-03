import { SlidesScreenshotError } from '../../presentationScreenshot/definitions/presentationScreenshot';
import {
  SlidesCliError,
  SlidesCliExitCode,
  type SlidesCliExecutionPort,
  type SlidesCliExecutionResult,
  type SlidesCliPresentationCommand,
} from '../definitions/slidesCli';
import { buildSlidesCliInspectionReport } from '../functions/buildSlidesCliInspectionReport';
import { buildSlidesCliRenderReport } from '../functions/buildSlidesCliRenderReport';

export async function executeSlidesCliCommand(
  command: SlidesCliPresentationCommand,
  execution: SlidesCliExecutionPort,
  signal?: AbortSignal,
): Promise<SlidesCliExecutionResult> {
  try {
    signal?.throwIfAborted();
    if (command.kind === 'render') {
      const result = await execution.renderScreenshots({
        presentationId: command.presentationId,
        ...command.request,
      }, signal ? { signal } : undefined);
      signal?.throwIfAborted();
      const report = buildSlidesCliRenderReport(command, result);
      return {
        exitCode: SlidesCliExitCode.SUCCESS,
        stdout: `${JSON.stringify(report)}\n`,
        stderr: '',
      };
    }

    const inspection = await execution.inspectPresentation({
      presentationId: command.presentationId,
      ...command.request,
    });
    signal?.throwIfAborted();
    const report = buildSlidesCliInspectionReport(inspection);
    return {
      exitCode: SlidesCliExitCode.SUCCESS,
      stdout: `${JSON.stringify(report)}\n`,
      stderr: '',
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof SlidesCliError) {
      return {
        exitCode: error.exitCode,
        stdout: '',
        stderr: formatError(error.code, error.message),
      };
    }
    if (error instanceof SlidesScreenshotError) {
      return {
        exitCode: mapScreenshotExitCode(error.code),
        stdout: '',
        stderr: formatError(error.code, error.message),
      };
    }
    return {
      exitCode: SlidesCliExitCode.INTERNAL_ERROR,
      stdout: '',
      stderr: formatError(
        'slides.cli.internal_error',
        'Slides command failed unexpectedly',
      ),
    };
  }
}

function mapScreenshotExitCode(
  code: SlidesScreenshotError['code'],
): SlidesCliExitCode {
  return code === 'slides.screenshot.output_conflict'
    || code === 'slides.screenshot.output_write_failed'
    ? SlidesCliExitCode.OUTPUT_FAILED
    : SlidesCliExitCode.RENDER_FAILED;
}

function formatError(code: string, message: string): string {
  return `${code}: ${message}\n`;
}
