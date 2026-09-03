export function setOptionalAttribute(
  el: HTMLElement,
  name: string,
  value: unknown
): void {
  if (
    value === null ||
    value === undefined ||
    value === false ||
    value === '' ||
    (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
  ) {
    el.removeAttribute(name)
    return
  }

  el.setAttribute(name, String(value))
}
