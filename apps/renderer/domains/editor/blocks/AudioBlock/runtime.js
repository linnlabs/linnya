import { useAudioContentStore } from './store/audioContent.store';
import { useAudioRuntimeStore } from './store/audioRuntime.store';
import { useAudioDeviceStore } from './store/audioDevice';
import { createAudioContentActions } from './orchestration/createAudioContentActions';
import { createAudioRuntimeActions } from './orchestration/createAudioRuntimeActions';
import { createAudioDeviceActions } from './orchestration/createAudioDeviceActions';
/** @type {WeakMap<object, import('./definitions/audioActions').AudioContentActions>} */
const contentActions = new WeakMap();
/** @type {WeakMap<object, import('./definitions/audioActions').AudioRuntimeActions>} */
const runtimeActions = new WeakMap();
/** @type {WeakMap<object, import('./definitions/audioActions').AudioDeviceActions>} */
const deviceActions = new WeakMap();
export function useAudioContentActions() {
  const state = useAudioContentStore();
  let actions = contentActions.get(state);
  if (!actions) {
    actions = createAudioContentActions(state);
    contentActions.set(state, actions);
  }
  return actions;
}
export function useAudioDeviceActions() {
  const state = useAudioDeviceStore();
  let actions = deviceActions.get(state);
  if (!actions) {
    actions = createAudioDeviceActions(state);
    deviceActions.set(state, actions);
  }
  return actions;
}
export function useAudioRuntimeActions() {
  const state = useAudioRuntimeStore();
  let actions = runtimeActions.get(state);
  if (!actions) {
    actions = createAudioRuntimeActions(state, useAudioDeviceActions());
    runtimeActions.set(state, actions);
  }
  return actions;
}
