import { shallowReadonly, shallowRef } from 'vue';
export function createCanvasWheelSuggestionState() {
  const visible = shallowRef(false);
  return {
    visible: shallowReadonly(visible),
    show() {
      visible.value = true;
    },
    hide() {
      visible.value = false;
    },
  };
}
