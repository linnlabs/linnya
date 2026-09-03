export function createPresentationPageImageFileName(slideNumber: number): string {
  return `slide-${String(slideNumber).padStart(3, '0')}.png`;
}
