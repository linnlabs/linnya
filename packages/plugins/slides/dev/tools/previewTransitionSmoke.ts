import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

async function run(): Promise<void> {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadFile(path.resolve(__dirname, 'preview-transitions/previewTransitionSmoke.html'));
    const result: unknown = await window.webContents.executeJavaScript('window.previewTransitionSmoke');
    assertFrameCount(result, 16);
    console.log('Slides live Vue/Konva transition pixels passed:', JSON.stringify(result));
    const fixtureFile = process.argv[2];
    if (fixtureFile) {
      const sequence: unknown = JSON.parse(await readFile(fixtureFile, 'utf8'));
      if (!Array.isArray(sequence)) throw new Error('Expected paint sequence array');
      const fixtureResult: unknown = await window.webContents.executeJavaScript(
        `window.verifyPreviewPaintSequence(${JSON.stringify(sequence)})`,
      );
      assertFrameCount(fixtureResult, sequence.length * 2);
      console.log('Supplied paint sequence passed:', JSON.stringify(fixtureResult));
    }
  } finally { window.destroy(); }
}

function assertFrameCount(result: unknown, expected: number): void {
  if (typeof result !== 'object' || result === null || !('frames' in result) || result.frames !== expected) {
    throw new Error(`Preview transition smoke did not finish ${expected} frame comparisons`);
  }
}

app.on('window-all-closed', () => {});
void app.whenReady().then(run).then(() => app.quit()).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
