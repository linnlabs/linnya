<template>
  <template
    v-for="(option, index) in options"
    :key="optionKey(option, index)"
  >
    <div
      v-if="option.isGroup"
      class="select-group-title"
      role="presentation"
    >
      {{ option.label }}
    </div>

    <div
      v-else-if="option.isSeparator"
      class="select-separator"
      role="separator"
    />

    <component
      v-else
      :is="optionElementTag(option)"
      :type="optionElementTag(option) === 'button' ? 'button' : undefined"
      class="select-option"
      :class="[
        {
          'is-selected': isOptionSelected(option),
          'is-keyboard-selected': enableKeyboardNav && selectedIndex === index,
          'is-disabled': option.disabled,
          'has-disabled-reason': option.disabledReason,
          'has-children': showSubmenuState && option.children?.length,
          'is-danger': option.variant === 'danger',
        },
        option.className,
        classNames.option,
      ]"
      :disabled="optionElementTag(option) === 'button' ? option.disabled : undefined"
      :role="optionSemanticRole(option)"
      :aria-selected="optionAriaSelected(option)"
      :aria-current="optionAriaCurrent(option)"
      :aria-disabled="option.disabled ? 'true' : undefined"
      :aria-haspopup="showSubmenuState && option.children?.length ? 'menu' : undefined"
      :aria-expanded="showSubmenuState && option.children?.length
        ? String(hoveredOptionWithChildren === option)
        : undefined"
      :aria-controls="showSubmenuState
        && option.children?.length
        && hoveredOptionWithChildren === option
        ? submenuPanelId
        : undefined"
      @click="emit('activate', option, $event)"
      @mouseenter="handleOptionMouseEnter(option, $event, index)"
      @mouseleave="stopOptionLabelMarquee"
      @keydown.right="emit('open-submenu', option, $event)"
    >
      <component
        :is="option.inlineNumberInput?.enabled ? 'div' : 'span'"
        class="select-option__main"
      >
        <component
          :is="option.iconComponent"
          v-if="option.iconComponent"
          :class="['option-icon', option.iconClassName, classNames.optionIcon]"
        />
        <template v-if="option.inlineNumberInput?.enabled">
          <span class="option-inline-number">
            <span class="option-inline-number__prefix">{{ option.inlineNumberInput.prefix }}</span>
            <CustomNumberInput
              :model-value="option.inlineNumberInput.value"
              :min="option.inlineNumberInput.min"
              :max="option.inlineNumberInput.max"
              :disabled="option.disabled"
              variant="inline-menu"
              align="left"
              :show-spin-buttons="true"
              :full-width="false"
              input-width="48px"
              @click.stop
              @update:model-value="emit('update-inline-number', option, $event)"
              @step-up="emit('adjust-inline-number', option, 1)"
              @step-down="emit('adjust-inline-number', option, -1)"
              @keydown.enter.stop.prevent="emit('confirm-inline-number', option)"
            />
            <span class="option-inline-number__suffix">{{ option.inlineNumberInput.suffix }}</span>
          </span>
        </template>
        <span
          v-else
          :class="[
            'option-label',
            {
              'linnya-ui-select-menu-option-label--ellipsis': optionLabelOverflow !== 'visible',
            },
            option.labelClassName,
            classNames.optionLabel,
          ]"
          :title="optionLabelOverflow === 'visible' ? undefined : optionLabelText(option)"
        >
          <span class="linnya-ui-select-menu-option-label-text">{{ optionLabelText(option) }}</span>
        </span>
        <span
          v-if="option.shortcut"
          :class="['option-shortcut', option.shortcutClassName, classNames.optionShortcut]"
        >{{ option.shortcut }}</span>
        <component
          :is="option.rightIconComponent"
          v-if="option.rightIconComponent"
          class="option-right-icon"
        />
        <span
          v-if="showSubmenuState && option.children?.length"
          :class="['option-arrow', classNames.optionArrow]"
        >›</span>
      </component>
      <span
        v-if="option.disabledReason"
        class="option-disabled-reason"
      >{{ option.disabledReason }}</span>
    </component>
  </template>
</template>

<script setup lang="ts" generic="Value extends CustomSelectOptionValue = CustomSelectOptionValue">
import type {
  CustomSelectClassNames,
  CustomSelectOption,
  CustomSelectOptionLabelOverflow,
  CustomSelectOptionValue,
  CustomSelectSemanticRole,
} from '../definitions/selectMenu';
import { CustomNumberInput } from '../../number-entry';
import type { NumberInputValue } from '../../number-entry';
import { resolveOptionLabelMarquee } from '../functions/resolveOptionLabelMarquee';

interface CustomSelectOptionListProps {
  options: readonly CustomSelectOption<Value>[];
  modelValue?: Value | null;
  semanticRole?: CustomSelectSemanticRole;
  enableKeyboardNav?: boolean;
  selectedIndex?: number;
  hoveredOptionWithChildren?: CustomSelectOption<Value> | null;
  submenuPanelId?: string;
  showSubmenuState?: boolean;
  classNames?: CustomSelectClassNames;
  optionLabelOverflow?: CustomSelectOptionLabelOverflow;
}

const props = withDefaults(defineProps<CustomSelectOptionListProps>(), {
  modelValue: null,
  semanticRole: 'listbox',
  enableKeyboardNav: false,
  selectedIndex: -1,
  hoveredOptionWithChildren: null,
  submenuPanelId: '',
  showSubmenuState: false,
  classNames: () => ({}),
  optionLabelOverflow: 'visible',
});

const emit = defineEmits<{
  activate: [option: CustomSelectOption<Value>, event: MouseEvent];
  hover: [option: CustomSelectOption<Value>, event: MouseEvent, index: number];
  'open-submenu': [option: CustomSelectOption<Value>, event: KeyboardEvent];
  'update-inline-number': [option: CustomSelectOption<Value>, value: NumberInputValue];
  'adjust-inline-number': [option: CustomSelectOption<Value>, delta: number];
  'confirm-inline-number': [option: CustomSelectOption<Value>];
}>();

function optionKey(option: CustomSelectOption<Value>, index: number): string | number {
  if (typeof option.value === 'string' || typeof option.value === 'number') return option.value;
  return `${option.label ?? option.text ?? 'option'}-${index}`;
}

function optionLabelText(option: CustomSelectOption<Value>): string {
  return option.text ?? option.label ?? '';
}

function handleOptionMouseEnter(
  option: CustomSelectOption<Value>,
  event: MouseEvent,
  index: number
): void {
  if (props.optionLabelOverflow === 'marquee-on-hover') startOptionLabelMarquee(event);
  emit('hover', option, event, index);
}

function startOptionLabelMarquee(event: MouseEvent): void {
  const optionElement = event.currentTarget;
  if (!(optionElement instanceof HTMLElement)) return;
  const label = optionElement.querySelector('.option-label');
  const labelText = optionElement.querySelector('.linnya-ui-select-menu-option-label-text');
  if (!(label instanceof HTMLElement) || !(labelText instanceof HTMLElement)) return;

  const metrics = resolveOptionLabelMarquee(labelText.scrollWidth, labelText.clientWidth);
  if (!metrics) return;

  label.style.setProperty(
    '--linnya-ui-select-menu-label-scroll-distance',
    `${metrics.distancePx}px`
  );
  label.style.setProperty(
    '--linnya-ui-select-menu-label-scroll-duration',
    `${metrics.durationMs}ms`
  );
  label.classList.add('linnya-ui-select-menu-option-label--scrolling');
}

function stopOptionLabelMarquee(event: MouseEvent): void {
  const optionElement = event.currentTarget;
  if (!(optionElement instanceof HTMLElement)) return;
  const label = optionElement.querySelector('.option-label');
  if (!(label instanceof HTMLElement)) return;

  label.classList.remove('linnya-ui-select-menu-option-label--scrolling');
  label.style.removeProperty('--linnya-ui-select-menu-label-scroll-distance');
  label.style.removeProperty('--linnya-ui-select-menu-label-scroll-duration');
}

/**
 * 行内数字项包含真实输入控件，不能再包一层 button；其它菜单项统一使用原生按钮。
 */
function optionElementTag(option: CustomSelectOption<Value>): 'div' | 'button' {
  return option.inlineNumberInput?.enabled ? 'div' : 'button';
}

function optionSemanticRole(option: CustomSelectOption<Value>): 'group' | 'menuitem' | 'option' {
  if (option.inlineNumberInput?.enabled) return 'group';
  return props.semanticRole === 'menu' ? 'menuitem' : 'option';
}

function isOptionSelected(option: CustomSelectOption<Value>): boolean {
  return option.selected === true
    || option.value === props.modelValue
    || option.children?.some(isOptionSelected) === true;
}

function optionAriaSelected(option: CustomSelectOption<Value>): string | undefined {
  return props.semanticRole === 'listbox' && !option.inlineNumberInput?.enabled
    ? String(isOptionSelected(option))
    : undefined;
}

function optionAriaCurrent(option: CustomSelectOption<Value>): 'true' | undefined {
  return props.semanticRole === 'menu' && isOptionSelected(option)
    ? 'true'
    : undefined;
}
</script>
