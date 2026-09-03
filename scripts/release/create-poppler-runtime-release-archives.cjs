#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const JSZip = require('jszip');

const {
  readPopplerRuntimeCatalog,
} = require('../build/poppler-runtime/definitions/poppler-runtime-catalog.cjs');
const {
  inspectPreparedPopplerRuntime,
  readRuntimeFiles,
  resolvePreparedPopplerDirectory,
  sha256,
} = require('../build/poppler-runtime/functions/poppler-runtime-integrity.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const outputDirectory = path.join(rootDir, 'dist_release', 'poppler-runtime');
const fixedArchiveDate = new Date('1980-01-01T00:00:00.000Z');

async function createArchive(target) {
  const inspected = inspectPreparedPopplerRuntime(rootDir, target);
  if (!inspected.ready) {
    throw new Error(
      `不能从未通过 catalog 校验的 runtime 生成 release：` +
        `${target.platform}/${target.architecture} reason=${inspected.reason}`
    );
  }

  const sourceDirectory = resolvePreparedPopplerDirectory(rootDir, target);
  const archive = new JSZip();
  for (const relativePath of readRuntimeFiles(sourceDirectory)) {
    archive.file(relativePath, fs.readFileSync(path.join(sourceDirectory, relativePath)), {
      createFolders: false,
      date: fixedArchiveDate,
      unixPermissions: relativePath === target.executableFileName ? 0o100755 : 0o100644,
    });
  }

  const bytes = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'UNIX',
    streamFiles: false,
  });
  const actualSha256 = sha256(bytes);
  if (bytes.byteLength !== target.archiveSizeBytes || actualSha256 !== target.archiveSha256) {
    throw new Error(
      `生成的 Poppler release archive 与 catalog 不一致：${target.archiveFileName} ` +
        `size=${bytes.byteLength} sha256=${actualSha256}`
    );
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, target.archiveFileName);
  fs.writeFileSync(outputPath, bytes, { mode: 0o644 });
  process.stdout.write(`[poppler-runtime] 已生成 ${outputPath}\n`);
}

async function main() {
  const catalog = readPopplerRuntimeCatalog();
  for (const target of catalog.targets) await createArchive(target);
}

main().catch(error => {
  process.stderr.write(
    `[poppler-runtime] release archive 生成失败：${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
