import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createSystemFontResolutionRuntime } from '@plugin/backend/fontResolution';
import { createSystemTextMeasurementRuntime } from '@plugin/backend/textMeasurement';
import {
  registerHiddenWorker,
  invokeHiddenWorker,
  unregisterHiddenWorker,
} from '@plugin/backend/hiddenWorkerRuntime';
import { createSlidesRasterWorkerDefinition } from '../../src/backend/features/slideRasterWorker/infrastructure/createSlidesRasterWorkerDefinition';
import { parseSlideRasterResult } from '../../src/shared/slideRasterization';
import { prepareConformance } from './prepare';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: generate OUTPUT_DIRECTORY');
const root = path.resolve(directory);
const profile = path.join(root, 'electron-profile');
mkdirSync(profile);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.on('window-all-closed', () => {});
async function generate(): Promise<void> {
  await app.whenReady();
  const fonts = createSystemFontResolutionRuntime({
    runtimeDataDirectory: path.join(root, 'font-runtime'),
  });
  const measurement = createSystemTextMeasurementRuntime();
  try {
    await fonts.initialize();
    await measurement.initialize();
    await registerHiddenWorker(
      createSlidesRasterWorkerDefinition({
        logger: { debug: console.debug, warn: console.warn },
        runtime: {
          mode: 'source-development',
          rootSource: 'workspace',
          packageRoot: path.resolve(__dirname, '../..'),
        },
      })
    );
    await prepareConformance(root, async request => {
      const result = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', request));
      if (result.status === 'failure')
        throw new Error(`${result.error.code}: ${result.error.message}`);
      return result.bytes;
    });
    console.log(`Synthetic PowerPoint samples and preview: ${root}`);
  } finally {
    await unregisterHiddenWorker('slides-raster');
    measurement.dispose();
    fonts.dispose();
  }
}
void generate().then(
  () => app.exit(0),
  (error: unknown) => {
    console.error(error);
    app.exit(1);
  }
);
