import { describe, expect, it } from 'vitest';
import { createPresentationBuildFailure } from './createPresentationBuildFailure';
import { readPresentationBuildFailureCode } from './readPresentationBuildFailureCode';

describe('createPresentationBuildFailure', () => {
  it('把源码错误与环境错误投影成不同恢复策略', () => {
    expect(
      createPresentationBuildFailure({
        code: 'slides.asset.external_url_not_supported',
        summary: 'Remote image URL is not supported.',
      })
    ).toMatchObject({ phase: 'asset', retryable: false, sourceFixable: true });
    expect(
      createPresentationBuildFailure({
        code: 'slides.asset.store_unavailable',
        summary: 'Managed image store is unavailable.',
      })
    ).toMatchObject({ phase: 'asset', retryable: true, sourceFixable: false });
    expect(
      createPresentationBuildFailure({
        code: 'slides.materialization.contract_invalid',
        summary: 'Materialization contract mismatch.',
      })
    ).toMatchObject({ phase: 'materialization', retryable: false, sourceFixable: false });
    expect(
      createPresentationBuildFailure({
        code: 'slides.formula.unsupported_syntax',
        summary: 'Unsupported formula command.',
      })
    ).toMatchObject({ phase: 'source_contract', retryable: false, sourceFixable: true });
    expect(
      createPresentationBuildFailure({
        code: 'slides.formula.pptx_patch_failed',
        summary: 'Formula marker was not unique.',
      })
    ).toMatchObject({ phase: 'materialization', retryable: false, sourceFixable: false });
  });

  it('只接纳合同中声明的稳定 code', () => {
    expect(readPresentationBuildFailureCode('slides.codegen.typecheck')).toBe(
      'slides.codegen.typecheck'
    );
    expect(readPresentationBuildFailureCode('slides.formula.unsupported_syntax')).toBe(
      'slides.formula.unsupported_syntax'
    );
    expect(readPresentationBuildFailureCode('slides.codegen.made_up')).toBeNull();
    expect(readPresentationBuildFailureCode('typecheck')).toBeNull();
  });
});
