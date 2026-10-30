import type { GeneratedLayoutComputedRatios, GeneratedLayoutDeclaredConstraints } from '../definitions/generatedLayoutConstraintEvidence';

/** 必须使用量化前的尺寸计算比例；编译与人工尺寸投影共享这一事实规则。 */
export function computeGeneratedLayoutRatios(
  declared: GeneratedLayoutDeclaredConstraints, box: { readonly w: number; readonly h: number },
): GeneratedLayoutComputedRatios {
  const ratio = (value: number, original: number) => Math.round(value / original * 10_000) / 10_000;
  return {
    ...(declared.widthInches !== undefined && declared.widthInches > 0 ? { widthToDeclared: ratio(box.w, declared.widthInches) } : {}),
    ...(declared.heightInches !== undefined && declared.heightInches > 0 ? { heightToDeclared: ratio(box.h, declared.heightInches) } : {}),
  };
}
