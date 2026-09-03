import path from 'node:path';
import {
  formatConversationFileLocator,
  formatHostFileLocator,
  parseFileLocator,
  type FileLocator,
} from '@app/schemas/file-locator';
import type { PresentationScreenshotResult } from '../../presentationScreenshot';
import {
  SLIDES_CLI_RENDER_REPORT_KIND,
  SLIDES_CLI_RENDER_REPORT_VERSION,
  SLIDES_CLI_VERSION,
  type SlidesCliRenderCommand,
  type SlidesCliRenderReport,
} from '../definitions/slidesCli';

export function buildSlidesCliRenderReport(
  command: SlidesCliRenderCommand,
  result: PresentationScreenshotResult,
): SlidesCliRenderReport {
  return {
    kind: SLIDES_CLI_RENDER_REPORT_KIND,
    schemaVersion: SLIDES_CLI_RENDER_REPORT_VERSION,
    cliVersion: SLIDES_CLI_VERSION,
    presentation: {
      id: result.presentation.presentationId,
      versionId: result.presentation.versionId,
      versionNumber: result.presentation.versionNumber,
    },
    slides: result.slides.map((slide) => ({
      slideNumber: slide.slideNumber,
      locator: resolveSlideLocator(command, slide.relativePath),
    })),
  };
}

function resolveSlideLocator(
  command: SlidesCliRenderCommand,
  relativePath: string,
): FileLocator {
  if (!command.outputDirectoryReference) {
    if (command.request.output.kind !== 'directory') {
      throw new Error('Standalone Slides output must use an explicit directory.');
    }
    return formatHostFileLocator(path.join(command.request.output.root, relativePath));
  }

  const outputDirectory = parseFileLocator(command.outputDirectoryReference);
  if (outputDirectory.kind !== 'conversation') {
    throw new Error('Managed Slides output directory must use a conversation locator.');
  }
  return formatConversationFileLocator(
    path.posix.join(outputDirectory.relativePath, relativePath),
  );
}
