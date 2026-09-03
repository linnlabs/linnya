import { getFlag } from '../../../ui/services/editorFeatureFlags'

export function shouldLogRevisionDebug(): boolean {
  return getFlag('revisionDebugLogging')
}

export function logRevisionDebug(...args: readonly unknown[]): void {
  if (!shouldLogRevisionDebug()) return
  console.log(...args)
}

export function infoRevisionDebug(...args: readonly unknown[]): void {
  if (!shouldLogRevisionDebug()) return
  console.info(...args)
}
