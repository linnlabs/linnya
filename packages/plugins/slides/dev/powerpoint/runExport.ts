import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { manifestSchema, slideFile } from './definitions';
import { exportEvidenceSchema } from './compareReport';
import { rasterizeOfficePdf } from './rasterizeOfficePdf';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: runExport.ts OUTPUT_DIRECTORY');
const root = path.resolve(directory);
const manifest = manifestSchema.parse(
  JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
);
const bytes = await readFile(path.join(root, 'sample.pptx'));
if (createHash('sha256').update(bytes).digest('hex') !== manifest.deckSha256)
  throw new Error('Sample changed since preview generation');
if (process.platform !== 'darwin' && process.platform !== 'win32')
  throw new Error('Real PowerPoint export requires macOS or Windows');
const office = path.join(root, 'office');
await mkdir(office); // 拒绝复用旧图片，避免失败导出被上一轮结果掩盖。
const method =
  process.platform === 'darwin' ? 'powerpoint-macos-pdf' : 'powerpoint-windows-slide-export';
const run = promisify(execFile);
const evidence: ExportEvidence = {
  deckSha256: manifest.deckSha256,
  method,
  version: '',
  status: 'failed',
};
type ExportEvidence = ReturnType<typeof exportEvidenceSchema.parse>;
try {
  const sampleName = `synthetic-${randomUUID()}.pptx`;
  const sample = path.join(office, sampleName);
  await copyFile(path.join(root, 'sample.pptx'), sample);
  const scriptRoot = fileURLToPath(new URL('.', import.meta.url));
  const result =
    process.platform === 'darwin'
      ? await run(
          '/usr/bin/osascript',
          [
            path.join(scriptRoot, 'export-macos.applescript'),
            sample,
            path.join(office, 'office.pdf'),
            sampleName,
          ],
          { timeout: 130_000 }
        )
      : await run(
          'powershell.exe',
          [
            '-NoProfile',
            '-File',
            path.join(scriptRoot, 'export-windows.ps1'),
            sample,
            office,
            String(manifest.width),
            String(manifest.height),
            String(manifest.pages.length),
          ],
          { timeout: 130_000 }
        );
  evidence.version = result.stdout.trim();
  await writeFile(path.join(office, 'driver.log'), `${result.stdout}\n${result.stderr}`);
  if (process.platform === 'darwin')
    await rasterizeOfficePdf(path.join(office, 'office.pdf'), office, manifest);
  for (let index = 0; index < manifest.pages.length; index++) {
    const metadata = await sharp(path.join(office, slideFile(index))).metadata();
    if (metadata.width !== manifest.width || metadata.height !== manifest.height)
      throw new Error(`Office image dimensions differ at page ${index + 1}`);
  }
  evidence.status = 'complete';
} catch (error) {
  evidence.error = String(error);
  await writeFile(path.join(office, 'driver.log'), String(error));
  throw error;
} finally {
  await writeFile(path.join(office, 'export.json'), JSON.stringify(evidence, null, 2));
}
