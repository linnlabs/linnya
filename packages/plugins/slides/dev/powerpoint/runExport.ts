import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, copyFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
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

/**
 * 坏 PPTX 会让 PowerPoint 崩溃，连带用户开着的文稿。PowerPoint 没在运行时不查询（避免把它拉起来）；
 * 在运行且有打开的文稿就停下，请用户先保存。导出脚本只关自己的文稿，留下空的 PowerPoint 不影响下一次。
 */
async function assertNoOpenPresentations() {
  const running = await run('/usr/bin/pgrep', ['-x', 'Microsoft PowerPoint']).then(() => true, () => false);
  if (!running) return;
  const { stdout } = await run('/usr/bin/osascript', ['-e', 'tell application "Microsoft PowerPoint" to count presentations']);
  const open = Number(stdout.trim());
  if (open !== 0) {
    throw new Error(`PowerPoint 里开着 ${stdout.trim()} 份文稿。坏 PPTX 可能让 PowerPoint 崩溃并丢失未保存内容；请用户先保存并关闭这些文稿，再运行一致性导出。`);
  }
}

/** 沙箱版 PowerPoint 访问容器外路径会弹授权框，因此样稿和 PDF 都经容器内目录中转。 */
async function exportThroughMacPowerPoint(
  sample: string,
  sampleName: string,
  pdf: string,
  scriptRoot: string
) {
  const container = path.join(
    homedir(),
    'Library/Containers/com.microsoft.Powerpoint/Data/tmp',
    `linnya-conformance-${randomUUID()}`
  );
  await assertNoOpenPresentations();
  await mkdir(container, { recursive: true });
  try {
    const stagedSample = path.join(container, sampleName);
    const stagedPdf = path.join(container, 'office.pdf');
    await copyFile(sample, stagedSample);
    await run('/usr/bin/open', ['-a', 'Microsoft PowerPoint', stagedSample]);
    const result = await run(
      '/usr/bin/osascript',
      [path.join(scriptRoot, 'export-macos.applescript'), stagedPdf, sampleName],
      { timeout: 130_000 }
    );
    await copyFile(stagedPdf, pdf);
    return result;
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}
try {
  const sampleName = `synthetic-${randomUUID()}.pptx`;
  const sample = path.join(office, sampleName);
  await copyFile(path.join(root, 'sample.pptx'), sample);
  const scriptRoot = fileURLToPath(new URL('.', import.meta.url));
  const result =
    process.platform === 'darwin'
      ? await exportThroughMacPowerPoint(sample, sampleName, path.join(office, 'office.pdf'), scriptRoot)
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
