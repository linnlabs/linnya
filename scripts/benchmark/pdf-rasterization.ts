import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { readFile, writeFile } from 'node:fs/promises';

import { createCanvas } from '@napi-rs/canvas';

import { openPdfRasterDocumentFromBytes } from '../../src/features/parsers/pdfParser/adapters/PdfRasterAdapter';
import { PDF_RASTER_DEFAULT_TARGET_PIXELS } from '../../src/features/parsers/pdfParser/definitions/pdfRaster';

const inputPath = readStringArgument('--input');
const requestedPageCount = readOptionalPositiveIntegerArgument('--pages');
const syntheticPageCount = requestedPageCount ?? 100;
const syntheticScanOutputPath = readStringArgument('--write-synthetic-scans');
if (syntheticScanOutputPath) {
  await writeFile(syntheticScanOutputPath, await createSyntheticScannedPdf(syntheticPageCount));
  process.exit(0);
}
const targetPixels = readPositiveIntegerArgument(
  '--target-pixels',
  PDF_RASTER_DEFAULT_TARGET_PIXELS
);
const syntheticScans = process.argv.includes('--synthetic-scans');
const sourceLabel = readStringArgument('--source-label');
const traceMemory = process.argv.includes('--trace-memory');
const pdfBytes = inputPath
  ? new Uint8Array(await readFile(inputPath))
  : syntheticScans
    ? await createSyntheticScannedPdf(syntheticPageCount)
    : createSyntheticPdf(syntheticPageCount);
// 合成扫描件会临时创建 Canvas 和对象编码缓冲区。测量前回收这些基准生成器对象，
// 但保留完整 PDF 输入，避免把“生成 fixture”的瞬时内存误算为产品栅格化内存。
globalThis.gc?.();
const eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
const baselineMemory = process.memoryUsage();
let peakRssBytes = baselineMemory.rss;
let peakExternalBytes = baselineMemory.external;
let eventLoopTicks = 0;
let jpegBytes = 0;

const memorySampler = setInterval(() => {
  eventLoopTicks += 1;
  const memory = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
  peakExternalBytes = Math.max(peakExternalBytes, memory.external);
}, 2);
eventLoopDelay.enable();
const startedAt = performance.now();
const document = await openPdfRasterDocumentFromBytes(pdfBytes);
const pageCount = inputPath
  ? Math.min(requestedPageCount ?? document.pageCount, document.pageCount)
  : syntheticPageCount;
traceMemorySample('document-opened');

try {
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.renderPageToJpeg(pageNumber, { targetPixels });
    jpegBytes += page.jpegBytes.byteLength;
    if (pageNumber <= 3 || pageNumber === pageCount) {
      traceMemorySample(`page-${pageNumber}`);
    }
  }
} finally {
  await document.close();
  clearInterval(memorySampler);
  eventLoopDelay.disable();
}

const durationMs = performance.now() - startedAt;
const finalMemory = process.memoryUsage();
peakRssBytes = Math.max(peakRssBytes, finalMemory.rss);
peakExternalBytes = Math.max(peakExternalBytes, finalMemory.external);

console.log(
  JSON.stringify(
    {
      pages: pageCount,
      targetPixels,
      source:
        sourceLabel ??
        (inputPath ? 'file' : syntheticScans ? 'synthetic-scans' : 'synthetic-vectors'),
      inputMiB: toMiB(pdfBytes.byteLength),
      jpegTotalMiB: toMiB(jpegBytes),
      durationMs: Math.round(durationMs),
      pagesPerSecond: Number((pageCount / (durationMs / 1_000)).toFixed(2)),
      baselineRssMiB: toMiB(baselineMemory.rss),
      peakRssMiB: toMiB(peakRssBytes),
      peakRssDeltaMiB: toMiB(peakRssBytes - baselineMemory.rss),
      peakExternalDeltaMiB: toMiB(peakExternalBytes - baselineMemory.external),
      eventLoopTicks,
      eventLoopDelayP99Ms: toMilliseconds(eventLoopDelay.percentile(99)),
      eventLoopDelayMaxMs: toMilliseconds(eventLoopDelay.max),
    },
    null,
    2
  )
);

function readPositiveIntegerArgument(name: string, fallback: number): number {
  return readOptionalPositiveIntegerArgument(name) ?? fallback;
}

function readOptionalPositiveIntegerArgument(name: string): number | undefined {
  const raw = readStringArgument(name);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

function readStringArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数`);
  return value;
}

function toMiB(bytes: number): number {
  return Number((bytes / 1024 / 1024).toFixed(2));
}

function toMilliseconds(nanoseconds: number): number {
  return Number((nanoseconds / 1_000_000).toFixed(2));
}

function traceMemorySample(stage: string): void {
  if (!traceMemory) return;
  const memory = process.memoryUsage();
  console.error(
    `[pdf-raster-memory] ${stage} rss=${toMiB(memory.rss)}MiB external=${toMiB(memory.external)}MiB`
  );
}

function createSyntheticPdf(pages: number): Uint8Array {
  const objects: Array<string | Buffer> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from(
      { length: pages },
      (_, index) => `${4 + index * 2} 0 R`
    ).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const contentObjectId = 5 + pageIndex * 2;
    const content = [
      'q',
      '0.95 0.95 0.95 rg 36 720 523 80 re f',
      '0 0 0 rg BT /F1 24 Tf 54 755 Td',
      `(Linnya PDF raster benchmark page ${pageIndex + 1}) Tj ET`,
      '0.2 0.4 0.8 RG 2 w',
      ...Array.from({ length: 120 }, (_, lineIndex) => {
        const y = 690 - lineIndex * 5;
        return `48 ${y} m ${547 - (lineIndex % 7) * 10} ${y} l S`;
      }),
      'Q',
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
    );
  }

  return serializePdfObjects(objects);
}

async function createSyntheticScannedPdf(pages: number): Promise<Uint8Array> {
  const width = 1200;
  const height = 1600;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fdfbf7';
  context.fillRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#e7eef9');
  gradient.addColorStop(0.5, '#f8efe2');
  gradient.addColorStop(1, '#dbe9df');
  context.fillStyle = gradient;
  context.fillRect(40, 40, width - 80, height - 80);
  context.fillStyle = '#18283b';
  context.font = '32px sans-serif';
  context.fillText('Linnya synthetic scanned PDF benchmark', 80, 110);
  context.font = '18px sans-serif';
  for (let line = 0; line < 58; line += 1) {
    const y = 170 + line * 22;
    context.fillText(
      `Line ${String(line + 1).padStart(2, '0')}  PDF.js raster memory and event-loop evidence`,
      90 + (line % 3) * 8,
      y
    );
  }
  for (let index = 0; index < 240; index += 1) {
    const x = 70 + ((index * 73) % 1040);
    const y = 180 + ((index * 97) % 1300);
    context.fillStyle = `rgba(${60 + (index % 140)}, ${80 + (index % 120)}, ${100 + (index % 100)}, 0.22)`;
    context.fillRect(x, y, 18 + (index % 43), 8 + (index % 17));
  }
  const jpeg = await canvas.encode('jpeg', 82);
  const pageWidth = 612;
  const pageHeight = 792;
  const objects: Array<string | Buffer> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from(
      { length: pages },
      (_, index) => `${3 + index * 3} 0 R`
    ).join(' ')}] >>`,
  ];

  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    const pageObjectId = 3 + pageIndex * 3;
    const imageObjectId = pageObjectId + 1;
    const contentObjectId = pageObjectId + 2;
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Scan Do\nQ`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Scan ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`,
          'ascii'
        ),
        jpeg,
        Buffer.from('\nendstream', 'ascii'),
      ]),
      `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`
    );
  }

  return serializePdfObjects(objects);
}

function serializePdfObjects(objects: readonly (string | Buffer)[]): Uint8Array {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  let byteLength = chunks[0].byteLength;
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(byteLength);
    const objectBody = Buffer.isBuffer(objects[index])
      ? objects[index]
      : Buffer.from(objects[index], 'binary');
    const objectChunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'ascii'),
      objectBody,
      Buffer.from('\nendobj\n', 'ascii'),
    ]);
    chunks.push(objectChunk);
    byteLength += objectChunk.byteLength;
  }
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${byteLength}\n%%EOF\n`,
  ].join('');
  chunks.push(Buffer.from(xref, 'ascii'));
  return new Uint8Array(Buffer.concat(chunks));
}
