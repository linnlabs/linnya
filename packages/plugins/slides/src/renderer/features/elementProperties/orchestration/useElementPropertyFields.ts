import { wholeTextStyle, SLIDES_MANUAL_FONT_SIZE_PT, type SlidesTextSelectionStyle, type SlidesTextStylePatch } from '@plugin/slides/shared/authoringEditing';
import { computed, ref, watch, type Ref } from 'vue';
import type { NumberInputValue } from '@linnya/renderer-ui';
import type { ManualEditableTarget } from '../../manualEditing';
import type { ElementPropertyOperation } from '../definitions/elementPropertyTypes';
import type { ElementPropertyNumberField } from '../definitions/elementPropertyToolbar';
import { createFillColorOperation, createTextStyleOperation, createVisualSizeOperation, resolveVisualSizeAfterDimensionChange } from '../functions/elementPropertyOperations';

export function useElementPropertyFields(options: {
  readonly target: Readonly<Ref<ManualEditableTarget>>;
  readonly busy: Readonly<Ref<boolean>>;
  readonly submit: (operation: ElementPropertyOperation) => void;
  readonly textSelection?: Readonly<Ref<SlidesTextSelectionStyle | undefined>>;
  readonly submitTextSelection?: (patch: SlidesTextStylePatch) => void;
}) {
  const textStyle = computed(() => options.textSelection?.value ?? (options.target.value.textEditing
    ? wholeTextStyle(options.target.value.textEditing.content, options.target.value.textEditing) : undefined));
  const fontSize = ref<NumberInputValue>(14);
  const width = ref<NumberInputValue>(1);
  const height = ref<NumberInputValue>(1);
  const identity = computed(() => `${options.target.value.authoringRef.slideKey}/${options.target.value.authoringRef.editKey}`);
  // 其他属性／旧回执更新不能重置正在输入的独立字段。
  watch([identity, () => textStyle.value?.fontSizePt], () => { fontSize.value = baseline('fontSize'); }, { immediate: true });
  watch([identity, () => options.target.value.visualSize?.width], () => { width.value = baseline('width'); }, { immediate: true });
  watch([identity, () => options.target.value.visualSize?.height], () => { height.value = baseline('height'); }, { immediate: true });
  function baseline(field: ElementPropertyNumberField): NumberInputValue {
    if (field === 'fontSize' && textStyle.value) return textStyle.value.fontSizePt ?? '';
    return field === 'fontSize' ? options.target.value.textEditing?.fontSizePt ?? 14 : options.target.value.visualSize?.[field] ?? 1;
  }
  function draft(field: ElementPropertyNumberField) { return field === 'fontSize' ? fontSize : field === 'width' ? width : height; }
  function submit(operation: ElementPropertyOperation | null): void {
    if (!options.busy.value && operation) options.submit(operation);
  }
  function commitNumber(field: ElementPropertyNumberField): void {
    const value = draft(field).value;
    if (value === baseline(field)) return;
    const numeric = value === '' ? Number.NaN : Number(value);
    if (field === 'fontSize' && options.textSelection?.value) {
      if (!Number.isFinite(numeric) || numeric < SLIDES_MANUAL_FONT_SIZE_PT.min || numeric > SLIDES_MANUAL_FONT_SIZE_PT.max) {
        fontSize.value = baseline(field); return;
      }
      if (!options.busy.value) options.submitTextSelection?.({ fontSizePt: numeric });
      return;
    }
    const target = options.target.value;
    const nextSize = target.visualSize && field !== 'fontSize'
      ? resolveVisualSizeAfterDimensionChange(target.targetKind, target.visualSize, field, numeric)
      : null;
    const operation = field === 'fontSize'
      ? createTextStyleOperation(target, { fontSizePt: numeric })
      : nextSize ? createVisualSizeOperation(target, nextSize) : null;
    if (!operation) { draft(field).value = baseline(field); return; }
    submit(operation);
  }
  function cancelNumber(field: ElementPropertyNumberField, event: KeyboardEvent): void {
    draft(field).value = baseline(field);
    // 同步恢复 DOM，避免 Escape 后 blur 的原生 change 重新提交已取消的值。
    if (event.target instanceof HTMLInputElement) event.target.value = String(baseline(field));
  }
  return {
    textStyle, fontSize, width, height, commitNumber, cancelNumber,
    submitTextColor: (color: string) => {
      if (options.textSelection?.value) { if (!options.busy.value) options.submitTextSelection?.({ color }); }
      else submit(createTextStyleOperation(options.target.value, { color }));
    },
    submitFillColor: (color: string) => submit(createFillColorOperation(options.target.value, color)),
  };
}
