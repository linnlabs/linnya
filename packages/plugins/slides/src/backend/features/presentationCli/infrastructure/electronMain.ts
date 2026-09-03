import { app } from 'electron';
import path from 'node:path';
import {
  formatConversationFileLocator,
} from '@app/schemas/file-locator';
import {
  SlidesCliError,
  SlidesCliExitCode,
  type SlidesCliExecutionResult,
} from '../definitions/slidesCli';
import { parseSlidesCliArgs } from '../functions/parseSlidesCliArgs';
import { createManagedSlidesRenderDirectory } from '../functions/createManagedSlidesRenderDirectory';
import { openSlidesCliDatabase } from './openSlidesCliDatabase';

redirectOperationalLogsToStderr();

void main().then(
  (exitCode) => app.exit(exitCode),
  async () => {
    await writeResult({
      exitCode: SlidesCliExitCode.INTERNAL_ERROR,
      stdout: '',
      stderr: 'slides.cli.internal_error: Slides CLI failed unexpectedly\n',
    });
    app.exit(SlidesCliExitCode.INTERNAL_ERROR);
  },
);

async function main(): Promise<number> {
  let invocation;
  try {
    const conversationRoot = process.env.LINNYA_CONVERSATION_ROOT
      ? readConversationRoot(process.env.LINNYA_CONVERSATION_ROOT)
      : undefined;
    invocation = parseSlidesCliArgs(process.argv.slice(2), {
      ...(conversationRoot
        ? {
            resolveManagedRenderOutput(presentationId: string) {
              const relativeRoot = createManagedSlidesRenderDirectory(presentationId);
              return {
                root: path.join(conversationRoot, ...relativeRoot.split('/')),
                directoryReference: formatConversationFileLocator(relativeRoot),
              };
            },
          }
        : {}),
    });
  } catch (error) {
    const result = resultFromStartupError(error);
    await writeResult(result);
    return result.exitCode;
  }

  if (invocation.kind === 'help') {
    await writeStream(process.stdout, invocation.text);
    return SlidesCliExitCode.SUCCESS;
  }
  await app.whenReady();
  if (invocation.command.kind === 'fonts-check' || invocation.command.kind === 'fonts-list') {
    const [fontRuntimeModule, executionModule] = await Promise.all([
      import('@plugin/backend/fontResolution'),
      import('../orchestration/executeSlidesCliFontCommand'),
    ]);
    const runtime = fontRuntimeModule.createSystemFontCatalogQueryRuntime({
      runtimeDataDirectory: app.getPath('userData'),
    });
    void runtime.scan();
    const result = await executionModule.executeSlidesCliFontCommand(invocation.command, runtime);
    await writeResult(result);
    return result.exitCode;
  }
  if (process.platform === 'linux' && !hasLinuxDisplay()) {
    const result = resultFromStartupError(new SlidesCliError(
      'slides.cli.environment_unavailable',
      SlidesCliExitCode.ENVIRONMENT_UNAVAILABLE,
      'Electron display is unavailable; run the Slides CLI under Xvfb or provide WAYLAND_DISPLAY',
    ));
    await writeResult(result);
    return result.exitCode;
  }

  // help 与参数错误必须脱离原生数据库和完整 Slides 引擎，避免轻量命令被运行时装配阻塞。
  const [
    databaseRuntime,
    workspaceDatabasePathRuntime,
    hiddenWorkerRuntime,
    fontResolutionRuntime,
    textMeasurementRuntime,
    standaloneRuntimeModule,
    rasterWorkerModule,
    executionModule,
  ] = await Promise.all([
    import('./loadDatabaseConstructor'),
    import('@plugin/backend/workspaceDatabasePath'),
    import('@plugin/backend/hiddenWorkerRuntime'),
    import('@plugin/backend/fontResolution'),
    import('@plugin/backend/textMeasurement'),
    import('../orchestration/StandaloneSlidesCliExecutionRuntime'),
    import('../../slideRasterWorker'),
    import('../orchestration/executeSlidesCliCommand'),
  ]);
  const databasePath = invocation.command.databasePath
    ?? workspaceDatabasePathRuntime.getWorkspaceDatabasePath();
  const Database = databaseRuntime.getSlidesCliDatabaseConstructor();
  let db: ReturnType<typeof openSlidesCliDatabase>;
  try {
    db = openSlidesCliDatabase(Database, databasePath);
  } catch (error) {
    const result = resultFromStartupError(error);
    await writeResult(result);
    return result.exitCode;
  }
  let workerRegistered = false;
  const fontRuntime = fontResolutionRuntime.createSystemFontResolutionRuntime({
    runtimeDataDirectory: app.getPath('userData'),
  });
  const measurementRuntime = textMeasurementRuntime.createSystemTextMeasurementRuntime();

  try {
    // standalone CLI 不会经过 platform plugin runtime effects；必须在任何
    // RenderModel/inspection 生成前等待字体解析和 cluster advance 就绪。
    await fontRuntime.initialize();
    await measurementRuntime.initialize();
    if (invocation.command.kind === 'render') {
      await hiddenWorkerRuntime.registerHiddenWorker(
        rasterWorkerModule.createSlidesRasterWorkerDefinition({
          runtime: {
            mode: 'artifact-runtime',
            packageRoot: path.resolve(__dirname, '../..'),
            rootSource: 'standalone-cli',
          },
        }),
      );
      workerRegistered = true;
    }
    const runtime = new standaloneRuntimeModule.StandaloneSlidesCliExecutionRuntime(db);
    const result = await executionModule.executeSlidesCliCommand(invocation.command, runtime);
    await writeResult(result);
    return result.exitCode;
  } finally {
    if (workerRegistered) {
      await hiddenWorkerRuntime.unregisterHiddenWorker('slides-raster');
    }
    measurementRuntime.dispose();
    fontRuntime.dispose();
    db.close();
  }
}

function readConversationRoot(value: string | undefined): string {
  if (!value || !path.isAbsolute(value)) {
    throw new SlidesCliError(
      'slides.cli.invalid_arguments',
      SlidesCliExitCode.INVALID_ARGUMENTS,
      'Managed Slides invocation requires an absolute conversation root',
    );
  }
  return path.resolve(value);
}

function resultFromStartupError(error: unknown): SlidesCliExecutionResult {
  if (error instanceof SlidesCliError) {
    return {
      exitCode: error.exitCode,
      stdout: '',
      stderr: `${error.code}: ${error.message}\n`,
    };
  }
  return {
    exitCode: SlidesCliExitCode.INTERNAL_ERROR,
    stdout: '',
    stderr: 'slides.cli.internal_error: Slides CLI failed unexpectedly\n',
  };
}

async function writeResult(result: SlidesCliExecutionResult): Promise<void> {
  await Promise.all([
    writeStream(process.stdout, result.stdout),
    writeStream(process.stderr, result.stderr),
  ]);
}

function writeStream(stream: NodeJS.WriteStream, content: string): Promise<void> {
  if (!content) return Promise.resolve();
  return new Promise((resolve, reject) => {
    stream.write(content, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function hasLinuxDisplay(): boolean {
  return Boolean(process.env.DISPLAY?.trim() || process.env.WAYLAND_DISPLAY?.trim());
}

function redirectOperationalLogsToStderr(): void {
  const write = (message?: unknown, ...optional: unknown[]): void => {
    console.error(message, ...optional);
  };
  console.log = write;
  console.info = write;
  console.debug = write;
}
