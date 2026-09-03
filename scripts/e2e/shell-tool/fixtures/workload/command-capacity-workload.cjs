'use strict';

/* global Buffer, process, require, setTimeout */

const { createHash } = require('node:crypto');
const { createWriteStream, writeFileSync } = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

function requirePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function writeAll(stream, bytes) {
  if (stream.write(bytes)) return;
  await new Promise((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

async function run() {
  const scenario = process.argv[2];
  process.stdout.write(`__LINNYA_FIXTURE_PID__:${process.pid}\n`);
  if (scenario === 'quiet') {
    await wait(requirePositiveInteger(process.argv[3], 'hold milliseconds'));
    return;
  }
  if (scenario === 'output') {
    const byteCount = requirePositiveInteger(process.argv[3], 'output byte count');
    const holdMilliseconds = requirePositiveInteger(process.argv[4], 'hold milliseconds');
    const chunk = Buffer.alloc(Math.min(byteCount, 64 * 1024), 0x78);
    let written = 0;
    while (written < byteCount) {
      const size = Math.min(chunk.length, byteCount - written);
      await writeAll(process.stdout, chunk.subarray(0, size));
      written += size;
    }
    await wait(holdMilliseconds);
    return;
  }
  if (scenario === 'file') {
    const filePath = process.argv[3];
    const byteCount = requirePositiveInteger(process.argv[4], 'file byte count');
    const stream = createWriteStream(filePath, { flags: 'wx' });
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(Math.min(byteCount, 1024 * 1024), 0x5a);
    let written = 0;
    while (written < byteCount) {
      const size = Math.min(chunk.length, byteCount - written);
      const view = chunk.subarray(0, size);
      hash.update(view);
      await writeAll(stream, view);
      written += size;
    }
    await new Promise((resolve, reject) => {
      stream.once('error', reject);
      stream.end(resolve);
    });
    process.stdout.write(`${hash.digest('hex')}\n`);
    return;
  }
  if (scenario === 'tree') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    process.stdout.write(`__LINNYA_TREE_CHILD_PID__:${child.pid ?? ''}\n`);
    await new Promise(() => {});
  }
  if (scenario === 'image') {
    const sharp = require('sharp');
    const width = 4096;
    const height = 3072;
    const pixels = Buffer.alloc(width * height * 3, 0x7f);
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .resize(1920, 1080, { fit: 'cover' })
      .png({ compressionLevel: 6 })
      .toFile(process.argv[3]);
    return;
  }
  if (scenario === 'spreadsheet') {
    const XLSX = require('xlsx');
    const rows = Array.from({ length: 20_000 }, (_, row) => (
      Array.from({ length: 12 }, (_, column) => row * 12 + column)
    ));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Data');
    XLSX.writeFile(workbook, process.argv[3], { compression: true });
    const reopened = XLSX.readFile(process.argv[3]);
    if (!reopened.Sheets.Data) throw new Error('spreadsheet corpus lost the Data sheet');
    return;
  }
  if (scenario === 'slides') {
    const pptxgen = require('pptxgenjs');
    const presentation = new pptxgen();
    presentation.layout = 'LAYOUT_WIDE';
    for (let index = 0; index < 30; index += 1) {
      const slide = presentation.addSlide();
      slide.addText(`Linnya command workload slide ${index + 1}`, {
        x: 0.7, y: 0.7, w: 10.5, h: 0.6, fontSize: 24,
      });
      slide.addText('真实演示文稿写入负载 '.repeat(80), {
        x: 0.7, y: 1.6, w: 10.5, h: 4.5, fontSize: 12,
      });
    }
    await presentation.writeFile({ fileName: process.argv[3] });
    return;
  }
  if (scenario === 'pdf') {
    const textPath = `${process.argv[3]}.txt`;
    writeFileSync(textPath, Array.from({ length: 100 }, (_, page) => (
      `Linnya PDF workload page ${page + 1}\n${'document content '.repeat(200)}\f\n`
    )).join(''), 'utf8');
    const conversion = spawnSync('/usr/sbin/cupsfilter', [textPath], {
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (conversion.status !== 0 || !conversion.stdout) {
      throw new Error(`cupsfilter failed: ${conversion.stderr?.toString('utf8') ?? ''}`);
    }
    writeFileSync(process.argv[3], conversion.stdout);
    return;
  }
  if (scenario === 'external-cli-startup') {
    const executable = process.argv[3];
    const launch = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (launch.status !== 0) {
      throw new Error(`${executable} --version failed: ${launch.stderr ?? ''}`);
    }
    process.stdout.write(launch.stdout.slice(0, 512));
    return;
  }
  if (scenario === 'python') {
    const source = [
      'import hashlib',
      'payload = b"x" * (64 * 1024 * 1024)',
      'print(hashlib.sha256(payload).hexdigest())',
    ].join('; ');
    const launch = spawnSync(process.argv[3], ['-c', source], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (launch.status !== 0) throw new Error(`Python workload failed: ${launch.stderr ?? ''}`);
    process.stdout.write(launch.stdout);
    return;
  }
  throw new Error(`unknown workload scenario: ${scenario ?? '<missing>'}`);
}

run().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
