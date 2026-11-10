import type { DocumentReferenceUiPort } from '../definitions/documentReferenceUi';
import type { DocumentReferenceCandidate } from '@app/schemas';

export function createDocumentReferenceSuggestionView(port: Pick<DocumentReferenceUiPort, 'renderIcon'>) {
  let panel: HTMLElement | null = null;
  let selected = 0;
  let choose: ((candidate: DocumentReferenceCandidate) => void) | null = null;
  let candidates: readonly DocumentReferenceCandidate[] = [];
  let disposeIcons: (() => void)[] = [];
  function clearIcons() { for (const dispose of disposeIcons) dispose(); disposeIcons = []; }
  function update(input: { readonly items: readonly DocumentReferenceCandidate[]; readonly command: (item: DocumentReferenceCandidate) => void; readonly clientRect?: (() => DOMRect | null) | null }) {
    candidates = input.items; choose = input.command; selected = Math.min(selected, Math.max(0, candidates.length - 1));
    panel ??= document.createElement('div'); panel.className = 'document-reference-suggestions'; panel.setAttribute('role', 'listbox'); clearIcons(); panel.replaceChildren();
    candidates.forEach((candidate, index) => { const option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(index === selected)); const icon = document.createElement('span'); icon.className = 'document-reference-candidate-icon'; icon.setAttribute('aria-hidden', 'true'); disposeIcons.push(port.renderIcon(candidate.nodeType, icon)); const label = document.createElement('span'); label.textContent = `${candidate.title} · ${candidate.path}`; option.append(icon, label); option.addEventListener('mousedown', event => { event.preventDefault(); choose?.(candidate); }); panel?.append(option); });
    const bounds = input.clientRect?.();
    if (bounds) { panel.style.left = `${bounds.left}px`; panel.style.top = `${bounds.bottom + 6}px`; }
    if (!panel.isConnected) document.body.append(panel);
  }
  function close() { clearIcons(); panel?.remove(); panel = null; selected = 0; }
  return {
    onStart: update, onUpdate: update, onExit: close,
    onKeyDown({ event }: { readonly event: KeyboardEvent }) {
      if (event.isComposing) return false;
      if (event.key === 'Escape') { close(); return true; }
      if (event.key === 'Enter') { const candidate = candidates[selected]; if (!candidate) return false; choose?.(candidate); return true; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % Math.max(1, candidates.length); panel?.querySelectorAll('[role=option]').forEach((option, index) => option.setAttribute('aria-selected', String(index === selected))); return true; }
      return false;
    },
  };
}
