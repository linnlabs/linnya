/**
 * PatchCompiler
 *
 * 第三层编译器：对已有 PPTX 执行 patch 操作
 * 使用 pptx-automizer 重建模型：加载源 PPTX，按顺序重新添加 slide，
 * 在 callback 中应用元素修改，跳过删除的 slide，在适当位置插入新 slide。
 */

import Automizer from 'pptx-automizer';
import JSZip from 'jszip';

import type {
  PatchSpec,
} from '@plugin/slides/shared';
import type {
  PatchCompilerPort,
  PptxReaderPort,
  StructuredCompilerPort,
  TemplateManagerPort,
} from '../types';
import { PptxPackageSanitizer } from '../pptx/PptxPackageSanitizer';
import { PatchPlanBuilder } from './PatchPlanBuilder';
import { PatchXmlEditor } from './PatchXmlEditor';
import { buildSlideSequence, loadApplyMasterSources, loadInsertionSources } from './PatchAutomizerSupport';
import type { AutomizerPort, AutomizerSlidePort } from './types';

// ─── PatchCompiler ──────────────────────────────────────────────────────────

export class PatchCompiler implements PatchCompilerPort {
  private readonly packageSanitizer = new PptxPackageSanitizer();
  private readonly xmlEditor = new PatchXmlEditor();

  constructor(
    private readonly structuredCompiler: StructuredCompilerPort,
    private readonly templateManager?: TemplateManagerPort,
    private readonly pptxReader?: PptxReaderPort,
  ) {}

  private createAutomizer(): AutomizerPort {
    const ctor = (
      Automizer as unknown as {
        default?: new (options: {
          removeExistingSlides: boolean;
          autoImportSlideMasters: boolean;
        }) => {
          loadRoot(buffer: Buffer): AutomizerPort;
          load(buffer: Buffer, name: string): AutomizerPort;
          addSlide(sourceLabel: string, slideNumber: number, callback?: (slide: AutomizerSlidePort) => void): void;
          addMaster(sourceLabel: string, masterIndex: number): void;
          getJSZip(): Promise<JSZip>;
        };
      }
    ).default ?? (Automizer as unknown as new (options: {
      removeExistingSlides: boolean;
      autoImportSlideMasters: boolean;
    }) => {
      loadRoot(buffer: Buffer): AutomizerPort;
      load(buffer: Buffer, name: string): AutomizerPort;
      addSlide(sourceLabel: string, slideNumber: number, callback?: (slide: AutomizerSlidePort) => void): void;
      addMaster(sourceLabel: string, masterIndex: number): void;
      getJSZip(): Promise<JSZip>;
    });

    return new ctor({
      removeExistingSlides: true,
      autoImportSlideMasters: true,
    });
  }

  async compile(sourcePptxBuffer: Buffer, patchSpec: PatchSpec): Promise<Buffer> {
    if (patchSpec.operations.length === 0) {
      return sourcePptxBuffer;
    }

    const slideCount = await this.getSlideCount(sourcePptxBuffer);
    const plan = PatchPlanBuilder.build(patchSpec, slideCount);
    const preparedSourceBuffer = await this.xmlEditor.applyDirectXmlOpsToBuffer(sourcePptxBuffer, patchSpec);
    if (PatchPlanBuilder.canReturnPreparedSource(plan)) {
      return this.packageSanitizer.sanitize(preparedSourceBuffer);
    }

    const automizer = this.createAutomizer();

    automizer.loadRoot(preparedSourceBuffer).load(preparedSourceBuffer, 'src');

    await loadInsertionSources(automizer, this.structuredCompiler, plan);
    await loadApplyMasterSources(automizer, plan, this.templateManager, this.pptxReader);

    const slideOrder = PatchPlanBuilder.resolveSlideOrder(plan, slideCount);
    buildSlideSequence(automizer, plan, slideOrder);

    const zip = await automizer.getJSZip();
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    return this.packageSanitizer.sanitize(buffer);
  }

  private async getSlideCount(buffer: Buffer): Promise<number> {
    const zip = await JSZip.loadAsync(buffer);
    const presXml = zip.file('ppt/presentation.xml');
    if (!presXml) {
      throw new Error('Invalid PPTX: missing ppt/presentation.xml');
    }
    const xml = await presXml.async('text');
    // Count <p:sldId> entries in <p:sldIdLst> — this is the authoritative slide count
    const matches = xml.match(/<p:sldId /g);
    return matches ? matches.length : 0;
  }

}
