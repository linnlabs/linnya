<!-- CustomSelect.vue -->
<!-- 自定义下拉选择框组件（重构版） -->

<template>
  <div
    ref="selectRef"
    class="custom-select linnya-select-menu"
    :class="{ 'manual-mode': manualMode }"
  >
    <!-- 触发器按钮：只在非手动模式下显示 -->
    <button 
      v-if="!manualMode"
      type="button" 
      :class="['select-trigger', classNames.trigger, { 'select-trigger--minimal': variant === 'minimal', 'select-trigger--bordered': bordered }]"
      :aria-expanded="computedIsOpen"
      :aria-haspopup="semanticRole"
      :aria-controls="computedIsOpen ? optionsPanelId : undefined"
      :aria-label="triggerAriaLabel || triggerTitle"
      :title="triggerTitle"
      :disabled="disabled"
      :style="{ fontSize: fontSize }"
      @click="toggleDropdown"
      @keydown.down.prevent="openFromKeyboard"
      @keydown.up.prevent="openFromKeyboard"
    >
      <span :class="['selected-value', classNames.selectedValue]">{{ displayValue }}</span>
      <slot
        name="arrow-icon"
        :is-open="computedIsOpen"
      >
        <ChevronIcon
          direction="down"
          :class="['arrow-icon', classNames.arrowIcon]"
        />
      </slot>
    </button>

    <!-- Portal 只改变渲染位置，菜单结构和交互始终共用同一份模板。 -->
    <Teleport
      to="body"
      :disabled="!isPortalMode"
    >
      <transition
        name="select-fade"
        appear
      >
        <div 
          v-if="computedIsOpen" 
          ref="optionsRef"
          :class="[
            'custom-select__options',
            'select-options', 
            { 
              'select-options--minimal': variant === 'minimal',
              'select-options--panel': hasPanelSlot,
              'select-options--portal': isPortalMode,
            },
            classNames.options,
          ]"
          :style="optionsPanelStyle"
          :id="optionsPanelId"
          :role="hasPanelSlot ? undefined : semanticRole"
          :aria-label="hasPanelSlot ? undefined : (triggerAriaLabel || triggerTitle)"
          :aria-orientation="hasPanelSlot ? undefined : 'vertical'"
          @mouseenter="keepSubmenuOpen"
          @mouseleave="handleMainMenuLeave"
          @keydown="handleOptionsKeydown"
        >
          <!-- 自定义面板模式：父组件通过 panel 插槽完全接管内容渲染 -->
          <slot
            v-if="hasPanelSlot"
            name="panel"
          />

          <!-- 默认模式：渲染 options 列表 -->
          <template v-else>
            <div
              v-if="$slots['options-header']"
              :class="['select-options-header', classNames.optionsHeader]"
              @keydown.stop
            >
              <slot name="options-header" />
            </div>
            <!-- @vue-generic {Value} -->
            <CustomSelectOptionList
              :options="options"
              :model-value="modelValue"
              :semantic-role="semanticRole"
              :enable-keyboard-nav="enableKeyboardNav"
              :selected-index="selectedIndex"
              :hovered-option-with-children="hoveredOptionWithChildren"
              :submenu-panel-id="submenuPanelId"
              :show-submenu-state="true"
              :class-names="classNames"
              @activate="activateOption"
              @hover="handleOptionHover"
              @open-submenu="handleOptionSubmenuOpen"
              @update-inline-number="updateInlineNumberValueDirect"
              @adjust-inline-number="adjustInlineNumber"
              @confirm-inline-number="confirmInlineNumber"
            />
          </template>
        </div>
      </transition>
    </Teleport>
    
    <!-- 子菜单面板
         中文说明：子菜单用 position: fixed 定位，必须 Teleport 到 body 才能脱离
         祖先的 container-type / transform / filter 等 containing block 干扰。
         manual 模式下保持原地渲染（workflow 菜单靠外层 wrapper 自己 Teleport 整包，
         且其子菜单宽度 CSS 依赖 wrapper 作为祖先选择器，不能脱离）。 -->
    <Teleport
      to="body"
      :disabled="manualMode"
    >
      <transition name="submenu-fade">
        <div
          v-if="hoveredOptionWithChildren && hoveredOptionWithChildren.children"
          ref="submenuRef"
          class="custom-select__submenu select-submenu"
          :class="[{
            // 中文说明：子菜单也需要跟随主菜单的变体（否则 minimal 菜单会出现视觉不一致）
            'select-submenu--minimal': variant === 'minimal',
            'is-panel': hoveredOptionWithChildren.isPanel,
            'is-custom-component': hoveredOptionWithChildren.isColorPicker
          }, classNames.submenu]"
          :style="submenuPosition"
          :id="submenuPanelId"
          role="menu"
          :aria-label="hoveredOptionWithChildren.text || hoveredOptionWithChildren.label"
          aria-orientation="vertical"
          @mouseenter="keepSubmenuOpen"
          @mouseleave="handleMainMenuLeave"
          @keydown="handleSubmenuKeydown"
        >
          <!-- 自定义组件插槽（用于颜色选择器等） -->
          <slot
            v-if="hoveredOptionWithChildren.isColorPicker"
            name="color-picker"
            :option="hoveredOptionWithChildren"
          />
        
          <template v-else-if="hoveredOptionWithChildren.isPanel">
            <!-- 面板模式：直接渲染 children 内容 -->
            <div class="submenu-panel-content">
              <div
                v-for="(item, idx) in hoveredOptionWithChildren.children"
                :key="idx"
                class="panel-item"
              >
                <div class="panel-item-label">
                  {{ item.label }}
                </div>
                <div
                  class="panel-item-value"
                  :class="{ 'is-clickable': item.clickable }"
                  :title="item.title || String(item.value ?? '')"
                  @click="item.onClick ? item.onClick() : null"
                >
                  {{ item.value }}
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <!-- 与主菜单共用同一份选项渲染合同，避免子菜单能力和视觉独立演化。 -->
            <!-- @vue-generic {Value} -->
            <CustomSelectOptionList
              :options="hoveredOptionWithChildren.children"
              :model-value="modelValue"
              semantic-role="menu"
              :hovered-option-with-children="nestedHoveredOptionWithChildren"
              :submenu-panel-id="nestedSubmenuPanelId"
              :show-submenu-state="true"
              :class-names="classNames"
              @activate="activateSubmenuOption"
              @hover="handleNestedOptionHover"
              @open-submenu="handleNestedOptionSubmenuOpen"
              @update-inline-number="updateInlineNumberValueDirect"
              @adjust-inline-number="adjustInlineNumber"
              @confirm-inline-number="confirmInlineNumber"
            />
          </template>
        </div>
      </transition>
    </Teleport>

    <!-- 第二级子菜单用于 Provider → 模型 → 模型参数，不承载模型业务规则。 -->
    <Teleport
      to="body"
      :disabled="manualMode"
    >
      <transition name="submenu-fade">
        <div
          v-if="nestedHoveredOptionWithChildren?.children"
          ref="nestedSubmenuRef"
          class="custom-select__submenu custom-select__submenu--nested select-submenu"
          :class="[{ 'select-submenu--minimal': variant === 'minimal' }, classNames.submenu, classNames.nestedSubmenu]"
          :id="nestedSubmenuPanelId"
          :style="nestedSubmenuPosition"
          role="menu"
          :aria-label="nestedHoveredOptionWithChildren.text || nestedHoveredOptionWithChildren.label"
          aria-orientation="vertical"
          @mouseenter="handleNestedSubmenuEnter"
          @mouseleave="handleNestedSubmenuLeave"
          @keydown="handleNestedSubmenuKeydown"
        >
          <!-- @vue-generic {Value} -->
          <CustomSelectOptionList
            :options="nestedHoveredOptionWithChildren.children"
            :model-value="modelValue"
            semantic-role="menu"
            :class-names="classNames"
            @activate="selectOption"
            @update-inline-number="updateInlineNumberValueDirect"
            @adjust-inline-number="adjustInlineNumber"
            @confirm-inline-number="confirmInlineNumber"
          />
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts" generic="Value extends CustomSelectOptionValue = CustomSelectOptionValue">
import { computed, nextTick, ref, toRef, useId, useSlots, watch } from 'vue';
import type {
  CustomSelectClassNames,
  CustomSelectInlineNumberConfirm,
  CustomSelectOption,
  CustomSelectOptionValue,
  CustomSelectSemanticRole,
  CustomSelectVariant,
  DropdownElementReference,
} from '../definitions/selectMenu';
import { adjustInlineNumberValue, findSelectedOption, normalizeInlineNumberValue } from '../functions/selectOptionValue';
import { useDropdown } from '../composables/useDropdown';
import { useDropdownPanelPosition } from '../composables/useDropdownPanelPosition';
import { useSubmenu } from '../composables/useSubmenu';
import { useKeyboardNavigation } from '../composables/useKeyboardNavigation';
import { useSelectFocusNavigation } from '../composables/useSelectFocusNavigation';
import CustomSelectOptionList from './CustomSelectOptionList.vue';
import { ChevronIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';

interface CustomSelectProps {
  modelValue?: Value | null;
  options: readonly CustomSelectOption<Value>[];
  placeholder?: string;
  title?: string;
  triggerAriaLabel?: string;
  semanticRole?: CustomSelectSemanticRole;
  manualMode?: boolean;
  fontSize?: string;
  minWidth?: string;
  optionsMaxHeight?: string;
  optionsOverflow?: string;
  variant?: CustomSelectVariant;
  disabled?: boolean;
  bordered?: boolean;
  externalTriggerRef?: DropdownElementReference;
  enableKeyboardNav?: boolean;
  usePortalToBody?: boolean;
  onSelect?: ((value: Value) => void) | null;
  parentIsOpen?: boolean;
  classNames?: CustomSelectClassNames;
}

const props = withDefaults(defineProps<CustomSelectProps>(), {
  modelValue: null,
  placeholder: '',
  title: '',
  triggerAriaLabel: '',
  semanticRole: 'listbox',
  manualMode: false,
  fontSize: '13px',
  minWidth: '100%',
  optionsMaxHeight: '',
  optionsOverflow: '',
  variant: 'default',
  disabled: false,
  bordered: true,
  externalTriggerRef: null,
  enableKeyboardNav: false,
  usePortalToBody: false,
  onSelect: null,
  parentIsOpen: true,
  classNames: () => ({}),
});

const emit = defineEmits<{
  'update:modelValue': [value: Value];
  close: [];
  'inline-number-confirm': [payload: CustomSelectInlineNumberConfirm<Value>];
}>();
const { sharedComponentMessage } = useSharedComponentLocalization();

// 插槽：用于支持完全自定义的面板内容（例如颜色选择器面板）
const slots = useSlots();
const hasPanelSlot = computed(() => !!slots.panel);
const selectInstanceId = useId();
const optionsPanelId = `${selectInstanceId}-options`;
const submenuPanelId = `${selectInstanceId}-submenu`;
const nestedSubmenuPanelId = `${selectInstanceId}-nested-submenu`;

// Refs
const selectRef = ref<HTMLElement | null>(null);
const optionsRef = ref<HTMLElement | null>(null);
const submenuRef = ref<HTMLElement | null>(null);
const nestedSubmenuRef = ref<HTMLElement | null>(null);
const externalTriggerRefProp = toRef(props, 'externalTriggerRef');

// 使用下拉框核心逻辑
const { isOpen, toggle, close } = useDropdown({
  manualMode: props.manualMode,
  containerRef: selectRef,
  externalTriggerRef: externalTriggerRefProp,
  dropdownRef: optionsRef,
  onClose: () => emit('close'),
});

// 手动模式由父组件控制可见性；自动模式使用组件内部状态。
const computedIsOpen = computed(() => (props.manualMode ? true : isOpen.value));

// 使用子菜单逻辑
const {
  hoveredOptionWithChildren,
  submenuPosition,
  handleOptionHover: submenuHandleOptionHover,
  openSubmenu,
  handleMainMenuLeave,
  keepSubmenuOpen,
  closeSubmenu,
  forceCloseSubmenu,
} = useSubmenu<Value>({
  optionsRef,
  submenuRef,
});

const {
  hoveredOptionWithChildren: nestedHoveredOptionWithChildren,
  submenuPosition: nestedSubmenuPosition,
  handleOptionHover: nestedSubmenuHandleOptionHover,
  openSubmenu: openNestedSubmenu,
  handleMainMenuLeave: handleNestedMenuLeave,
  keepSubmenuOpen: keepNestedSubmenuOpen,
  forceCloseSubmenu: forceCloseNestedSubmenu,
} = useSubmenu<Value>({
  optionsRef: submenuRef,
  submenuRef: nestedSubmenuRef,
});

// Portal 只负责把同一个面板移到 body，定位规则独立于菜单渲染与选择逻辑。
const isPortalMode = computed(() => !props.manualMode && props.usePortalToBody);
const { optionsPanelStyle } = useDropdownPanelPosition({
  isPortalMode,
  isOpen: computedIsOpen,
  selectRef,
  optionsRef,
  minWidth: toRef(props, 'minWidth'),
  optionsMaxHeight: toRef(props, 'optionsMaxHeight'),
  optionsOverflow: toRef(props, 'optionsOverflow'),
});

const {
  focusCurrentOption,
  focusCurrentSubmenuOption,
  focusCurrentNestedSubmenuOption,
  handleOptionsKeydown,
  handleSubmenuKeydown,
  handleNestedSubmenuKeydown,
  openFromKeyboard,
  restoreTriggerFocus,
} = useSelectFocusNavigation({
  manualMode: toRef(props, 'manualMode'),
  disabled: toRef(props, 'disabled'),
  isOpen: computedIsOpen,
  selectRef,
  optionsRef,
  submenuRef,
  nestedSubmenuRef,
  externalTriggerRef: externalTriggerRefProp,
  submenuPanelId,
  nestedSubmenuPanelId,
  toggle,
  close,
  closeSubmenu,
  closeNestedSubmenu: forceCloseNestedSubmenu,
});

// 使用键盘导航逻辑
const {
  selectedIndex,
  onKeyDown,
  updateSelectedIndex,
} = useKeyboardNavigation({
  // 中文说明：把 props.options 以 ref 形式传入，确保选项更新（例如 SlashMenu 输入 query 过滤）时
  // 键盘导航能拿到最新 options，而不是初始快照。
  options: toRef(props, 'options'),
  optionsRef,
  onSelect: selectOption,
  enabled: props.enableKeyboardNav,
});

const resolvedPlaceholder = computed(() => (
  props.placeholder || sharedComponentMessage('shared.customSelect.placeholder')
));
const resolvedTitle = computed(() => (
  props.title || sharedComponentMessage('shared.customSelect.title')
));

const selectedOption = computed(() => findSelectedOption(props.options, props.modelValue));

const displayValue = computed(() => (
  selectedOption.value ? selectedOption.value.text : resolvedPlaceholder.value
));

// 计算按钮的 title
const triggerTitle = computed(() => {
  return selectedOption.value
    ? `${resolvedTitle.value}: ${selectedOption.value.text}`
    : resolvedTitle.value;
});

// 切换下拉框显示
const toggleDropdown = () => {
  if (!props.manualMode && !props.disabled) {
    toggle();
  }
};

// 选择选项
function selectOption(option: CustomSelectOption<Value>) {
  // 确保选择的不是组标题、分隔符或禁用项
  if (option.isGroup || option.isSeparator || option.disabled) {
    return;
  }
  
  // 如果选项有子菜单，点击它时不关闭菜单；allowDirectSelect 为 true 时仍可选中父项本身
  if (option.children && option.children.length > 0 && !option.allowDirectSelect) {
    return;
  }
  // 行内数字输入项（如“插入 N 行/列”）：
  // - 支持按 Enter 提交
  // - 也支持直接点击整行提交（与原版菜单交互更接近）
  if (option.inlineNumberInput && option.inlineNumberInput.enabled) {
    confirmInlineNumber(option);
    return;
  }

  // 可选择项必须拥有明确值；组标题、分隔符和纯面板项不能泄漏 undefined。
  if (option.value === undefined || option.value === null) return;

  // 选择选项时，立即清理子菜单
  forceCloseNestedSubmenu();
  forceCloseSubmenu();

  // 直接回调（如果提供）
  if (typeof props.onSelect === 'function') {
    props.onSelect(option.value);
  }

  emit('update:modelValue', option.value);

  if (props.manualMode) {
    window.setTimeout(() => {
      emit('close');
      restoreTriggerFocus();
    }, 0);
  } else {
    close();
    restoreTriggerFocus();
  }
}

/** 带 children 的父项由 hover、右方向键和 Enter/Space 共同打开，不产生伪选择值。 */
function activateOption(option: CustomSelectOption<Value>, event: MouseEvent) {
  if (option.children?.length && !option.allowDirectSelect && !option.disabled) {
    openSubmenu(option, event.currentTarget);
    void nextTick(focusCurrentSubmenuOption);
    return;
  }
  selectOption(option);
}

function activateSubmenuOption(option: CustomSelectOption<Value>, event: MouseEvent) {
  if (option.children?.length && !option.allowDirectSelect && !option.disabled) {
    openNestedSubmenu(option, event.currentTarget);
    void nextTick(focusCurrentNestedSubmenuOption);
    return;
  }
  selectOption(option);
}

// 处理选项悬停（结合键盘导航）
const handleOptionHover = (option: CustomSelectOption<Value>, event: MouseEvent, index: number) => {
  if (option.disabled) {
    forceCloseSubmenu();
    return;
  }
  // 处理子菜单
  submenuHandleOptionHover(option, event);

  // 更新键盘导航的选中索引
  if (props.enableKeyboardNav && !option.isSeparator && !option.isGroup && !option.disabled) {
    updateSelectedIndex(index);
  }
};

const handleOptionSubmenuOpen = (option: CustomSelectOption<Value>, event: KeyboardEvent) => {
  if (option.disabled || !option.children?.length) return;
  event.preventDefault();
  openSubmenu(option, event.currentTarget);
  void nextTick(focusCurrentSubmenuOption);
};

const handleNestedOptionHover = (option: CustomSelectOption<Value>, event: MouseEvent) => {
  if (option.disabled) {
    forceCloseNestedSubmenu();
    return;
  }
  nestedSubmenuHandleOptionHover(option, event);
};

const handleNestedOptionSubmenuOpen = (option: CustomSelectOption<Value>, event: KeyboardEvent) => {
  if (option.disabled || !option.children?.length) return;
  event.preventDefault();
  openNestedSubmenu(option, event.currentTarget);
  void nextTick(focusCurrentNestedSubmenuOption);
};

const handleNestedSubmenuEnter = () => {
  keepSubmenuOpen();
  keepNestedSubmenuOpen();
};

const handleNestedSubmenuLeave = () => {
  handleNestedMenuLeave();
  handleMainMenuLeave();
};

/**
 * 更新行内数字输入值（直接通过子组件 v-model 触发）。
 */
function updateInlineNumberValueDirect(
  option: CustomSelectOption<Value>,
  value: string | number | null,
) {
  if (!option.inlineNumberInput) {
    return;
  }
  option.inlineNumberInput.value = String(value);
}

/**
 * 中文说明：菜单里的微调按钮只应该修改数值，不应该冒泡成“点击整行后立即提交”。
 * 这里直接在菜单层完成步进与钳制，保持交互闭环。
 */
function adjustInlineNumber(option: CustomSelectOption<Value>, delta: number) {
  if (!option.inlineNumberInput || option.disabled) {
    return;
  }

  const nextValue = adjustInlineNumberValue(option.inlineNumberInput, delta);
  option.inlineNumberInput.value = String(nextValue);
}

/**
 * 提交行内数字输入值（按 Enter 触发）。
 */
function confirmInlineNumber(option: CustomSelectOption<Value>) {
  if (!option.inlineNumberInput || option.disabled) {
    return;
  }
  const normalizedValue = normalizeInlineNumberValue(option.inlineNumberInput);
  option.inlineNumberInput.value = String(normalizedValue);
  emit('inline-number-confirm', {
    value: normalizedValue,
    optionValue: option.value,
  });
  emit('close');
}

// 监听 isOpen 变化，关闭时清理子菜单
watch(computedIsOpen, (newValue, oldValue) => {
  if (newValue && !oldValue && !props.manualMode) {
    void nextTick(focusCurrentOption);
  }
  if (oldValue && !newValue) {
    forceCloseNestedSubmenu();
    forceCloseSubmenu();
  }
}, { flush: 'sync' });

watch(hoveredOptionWithChildren, () => {
  forceCloseNestedSubmenu();
}, { flush: 'sync' });

// 监听父组件的打开状态，在 manualMode 下同步关闭子菜单
watch(() => props.parentIsOpen, (newValue) => {
  if (!props.manualMode) return;
  if (newValue) {
    void nextTick(focusCurrentOption);
  } else {
    forceCloseNestedSubmenu();
    forceCloseSubmenu();
  }
}, { flush: 'sync', immediate: true });

// 暴露键盘导航方法
defineExpose({
  onKeyDown,
});
</script>
