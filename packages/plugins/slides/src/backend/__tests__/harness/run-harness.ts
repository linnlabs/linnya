/**
 * Slides engine regression harness.
 *
 * 这里仅保留确定性的编译、解析、patch 与 lint 回归。真实 Agent 质量与人工视觉
 * 审核统一由 `apps/linnya-benchmark` 通过 Linnya CLI 执行，避免维护第二套假生成链。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DeckSpec } from '@plugin/slides/shared';
import { GOLDEN_FIXTURES } from '../fixtures/golden-regression/index.js';
import { DeckAssembler } from '../../engine/DeckAssembler.js';
import { FreeformCompiler } from '../../engine/FreeformCompiler.js';
import { StructuredCompiler } from '../../engine/StructuredCompiler.js';
import { PptxReader } from '../../engine/parser/PptxReader.js';
import { diffSnapshots, toSnapshotString } from '../../engine/parser/InspectSnapshot.js';
import { PatchCompiler } from '../../engine/patch/PatchCompiler.js';
import { PptxValidator } from '../../engine/pptx/PptxValidator.js';
import { LayoutLint } from '../../engine/quality/LayoutLint.js';

const structuredCompiler = new StructuredCompiler();
const freeformCompiler = new FreeformCompiler();
const deckAssembler = new DeckAssembler(structuredCompiler, freeformCompiler);
const reader = new PptxReader();
const validator = new PptxValidator();
const patchCompiler = new PatchCompiler(structuredCompiler);
const layoutLinter = new LayoutLint();

async function compileDeckSpec(deckSpec: DeckSpec): Promise<Buffer> {
  const hasFreeform = deckSpec.slides.some((slide) => slide.spec.type === 'freeform');
  return hasFreeform
    ? deckAssembler.assemble(deckSpec)
    : structuredCompiler.compileDeck(deckSpec);
}

async function generate(fixtureId?: string): Promise<void> {
  const fixtures = fixtureId
    ? GOLDEN_FIXTURES.filter((fixture) => fixture.id === fixtureId)
    : GOLDEN_FIXTURES;

  if (fixtures.length === 0) {
    throw new Error(
      `Fixture not found: ${fixtureId}. Available: ${GOLDEN_FIXTURES.map((fixture) => fixture.id).join(', ')}`,
    );
  }

  for (const fixture of fixtures) {
    const buffer = await compileDeckSpec(fixture.deckSpec);
    const filename = `${fixture.id}.pptx`;
    writeFileSync(filename, buffer);
    console.log(`Generated: ${filename} (${buffer.length} bytes)`);
  }
}

async function inspect(pptxPath: string): Promise<void> {
  const buffer = readFileSync(resolve(pptxPath));
  console.log(JSON.stringify(await reader.parse(buffer), null, 2));
}

async function validate(pptxPath: string): Promise<void> {
  const result = await validator.validate(readFileSync(resolve(pptxPath)));
  console.log(`Valid: ${result.valid}`);
  for (const error of result.errors) console.log(`ERROR: ${error}`);
  for (const warning of result.warnings) console.log(`WARN: ${warning}`);
  console.log(
    `Structure: ${result.structure.slideCount} slides, ${result.structure.slideFiles.length} slide files`,
  );
  if (!result.valid) process.exitCode = 1;
}

async function batch(outputDir: string): Promise<void> {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  let passed = 0;
  let failed = 0;
  const report: string[] = [];

  for (const fixture of GOLDEN_FIXTURES) {
    const label = `[${fixture.category}] ${fixture.id}`;
    try {
      const buffer = await compileDeckSpec(fixture.deckSpec);
      writeFileSync(join(outputDir, `${fixture.id}.pptx`), buffer);

      const validation = await validator.validate(buffer);
      if (!validation.valid) {
        report.push(`FAIL ${label}: ${validation.errors.join('; ')}`);
        failed += 1;
        continue;
      }

      const info = await reader.parse(buffer);
      if (info.slideCount !== fixture.expectations.slideCount) {
        report.push(
          `FAIL ${label}: expected ${fixture.expectations.slideCount} slides, got ${info.slideCount}`,
        );
        failed += 1;
        continue;
      }
      writeFileSync(join(outputDir, `${fixture.id}.snapshot.json`), toSnapshotString(info));

      let patchBuffer = buffer;
      let patchFailed = false;
      const patchSpecs = fixture.patchSpecs ?? [];
      for (let index = 0; index < patchSpecs.length; index += 1) {
        patchBuffer = await patchCompiler.compile(patchBuffer, patchSpecs[index]);
        const patchValidation = await validator.validate(patchBuffer);
        if (!patchValidation.valid) {
          report.push(`FAIL ${label}: patch[${index}] ${patchValidation.errors.join('; ')}`);
          failed += 1;
          patchFailed = true;
          break;
        }
      }
      if (patchFailed) continue;
      if (patchSpecs.length > 0) {
        writeFileSync(join(outputDir, `${fixture.id}.patched.pptx`), patchBuffer);
      }

      report.push(`PASS ${label}: ${info.slideCount} slides, ${buffer.length} bytes`);
      passed += 1;
    } catch (error) {
      report.push(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
    }
  }

  const summary = `\n--- Summary: ${passed} passed, ${failed} failed, ${GOLDEN_FIXTURES.length} total ---`;
  const reportText = `${report.join('\n')}${summary}`;
  writeFileSync(join(outputDir, 'report.txt'), reportText);
  console.log(reportText);
  if (failed > 0) process.exitCode = 1;
}

async function snapshotDiff(pathA: string, pathB: string): Promise<void> {
  const snapshotA = toSnapshotString(await reader.parse(readFileSync(resolve(pathA))));
  const snapshotB = toSnapshotString(await reader.parse(readFileSync(resolve(pathB))));
  const diff = diffSnapshots(snapshotA, snapshotB);

  if (diff.equal) {
    console.log('Snapshots are identical.');
    return;
  }
  for (const difference of diff.differences) {
    console.log(`${difference.path}:`);
    console.log(`  expected: ${JSON.stringify(difference.expected)}`);
    console.log(`  actual:   ${JSON.stringify(difference.actual)}`);
  }
  process.exitCode = 1;
}

async function lintLayout(pptxPath: string): Promise<void> {
  const info = await reader.parse(readFileSync(resolve(pptxPath)));
  const report = layoutLinter.lint(info);
  console.log(`Layout findings: ${report.issueCount}`);
  for (const issue of report.issues) {
    console.log(`[${issue.severity}] slide ${issue.slideNumber} ${issue.code}: ${issue.message}`);
  }
}

function requiredArg(value: string | undefined, usage: string): string {
  if (!value) throw new Error(`Usage: ${usage}`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'generate':
      await generate(args[0]);
      return;
    case 'inspect':
      await inspect(requiredArg(args[0], 'inspect <pptx-path>'));
      return;
    case 'validate':
      await validate(requiredArg(args[0], 'validate <pptx-path>'));
      return;
    case 'batch': {
      const outputIndex = args.indexOf('--output-dir');
      await batch(outputIndex >= 0 && args[outputIndex + 1] ? args[outputIndex + 1] : '/tmp/ppt-harness');
      return;
    }
    case 'snapshot-diff':
      await snapshotDiff(
        requiredArg(args[0], 'snapshot-diff <pptx-a> <pptx-b>'),
        requiredArg(args[1], 'snapshot-diff <pptx-a> <pptx-b>'),
      );
      return;
    case 'layout-lint':
      await lintLayout(requiredArg(args[0], 'layout-lint <pptx-path>'));
      return;
    default:
      console.log('Slides engine regression harness');
      console.log('Commands: generate, inspect, validate, batch, snapshot-diff, layout-lint');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
