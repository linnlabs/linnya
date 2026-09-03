/**
 * @typedef {Object} HandlerContext
 * @property {import('prosemirror-view').EditorView} view
 * @property {KeyboardEvent} event
 * @property {import('prosemirror-state').EditorState} state
 * @property {(transaction: import('prosemirror-state').Transaction) => void} dispatch
 * @property {import('prosemirror-state').Selection} selection
 * @property {import('prosemirror-model').ResolvedPos} $cursor
 * @property {boolean} empty
 * @property {import('@tiptap/core').Editor} editor
 * @property {() => any} getPosUtils - Function to get PositionUtils instance
 * @property {() => any} getUIStore - Function to get UI store instance
 * @property {() => any} getAnnotationStore - Function to get Annotation store instance
 * @property {(...args: any[]) => void} debugLog - Function for debug logging
 */

/**
 * @typedef {'pre' | 'normal' | 'post'} KeyHandlerPhase
 */

/**
 * @typedef {Object} KeyHandlerEntry
 * @property {string | string[]} keys - Key or keys to match (e.g., 'Enter', 'Mod-S').
 * @property {(context: HandlerContext) => boolean} handler - The function to execute when keys match.
 * @property {KeyHandlerPhase} [phase='normal'] - Execution phase ('pre', 'normal', 'post').
 * @property {number} [priority=0] - Priority within the phase (higher number means higher priority).
 * @property {string | Symbol} id - Unique identifier for the handler entry.
 */

export class KeyboardRegistry {
  /** @type {KeyHandlerEntry[]} */
  #handlers = [];

  constructor() {
    this.#handlers = [];
  }

  /**
   * Registers a keyboard handler entry.
   * The internal list of handlers will be sorted by phase and then by priority.
   * @param {KeyHandlerEntry} entry - The handler entry to register.
   */
  register(entry) {
    if (!entry || typeof entry.handler !== 'function' || !entry.id) {
      console.warn('[KeyboardRegistry] Attempted to register an invalid handler entry:', entry);
      return;
    }
    const newEntry = {
      phase: 'normal',
      priority: 0,
      ...entry,
    };

    this.#handlers.push(newEntry);
    this.#handlers.sort((a, b) => {
      const phaseOrder = { 'pre': 0, 'normal': 1, 'post': 2 };
      if (phaseOrder[a.phase] !== phaseOrder[b.phase]) {
        return phaseOrder[a.phase] - phaseOrder[b.phase];
      }
      return b.priority - a.priority; 
    });
  }

  /**
   * Unregisters a keyboard handler entry by its ID.
   * @param {string | Symbol} id - The ID of the handler entry to unregister.
   */
  unregister(id) {
    const initialLength = this.#handlers.length;
    this.#handlers = this.#handlers.filter(entry => entry.id !== id);
  }

  /**
   * Dispatches a keyboard event to the registered handlers.
   * It iterates through handlers sorted by phase and priority, and executes the first one whose `keys` match.
   * @param {KeyboardEvent} event - The keyboard event.
   * @param {HandlerContext} context - The handler context.
   * @returns {boolean} - True if a handler processed the event, false otherwise.
   */
  dispatch(event, context) {
    const eventKey = this.normalizeKey(event);

    for (const entry of this.#handlers) {
      const entryKeys = Array.isArray(entry.keys) ? entry.keys : [entry.keys];
      for (const k of entryKeys) {
        if (this.matchKey(k, event, eventKey)) {
          if (entry.handler(context)) {
            return true; 
          }
        }
      }
    }
    return false; 
  }

  /**
   * Normalizes the pressed key for matching against registered key patterns.
   * Prioritizes event.code for physical key mapping, falls back to event.key.
   * @param {KeyboardEvent} event
   * @returns {string}
   */
  normalizeKey(event) {
    let key = '';
    if (event.code) {
      if (event.code.startsWith('Key')) {
        key = event.code.substring(3); // e.g., "KeyA" -> "A"
      } else if (event.code.startsWith('Digit')) {
        key = event.code.substring(5); // e.g., "Digit1" -> "1"
      } else if (event.code === 'Space') {
        key = 'Space';
      } else if (event.code === 'Escape') {
        key = 'Escape';
      } else if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        key = 'Enter';
      } else if (event.code === 'Backspace') {
        key = 'Backspace';
      } else if (event.code === 'Delete') {
        key = 'Delete';
      } else if (event.code === 'Tab') {
        key = 'Tab';
      } else if (event.code.startsWith('Arrow')) {
        key = event.code; // ArrowUp, ArrowDown, etc.
      }
      // Add more event.code mappings as needed, e.g., for Numpad keys, special symbols if desired by code
    }

    // Fallback or if specific event.key logic is still preferred for some cases
    if (!key) {
      key = event.key;
      if (key === ' ') key = 'Space'; // Still normalize space from event.key if falling back
      // 'Escape' from event.key is usually 'Escape', so direct use is fine
    }
    // console.log(`[KeyboardRegistry] normalizeKey: event.key="${event.key}", event.code="${event.code}" -> normalized="${key}"`);
    return key;
  }

  /**
   * Matches a registered key pattern (e.g., 'Mod-S', 'Enter', 'Shift-Tab') against a keyboard event.
   * @param {string} pattern - The key pattern (e.g., "Mod-S", "Enter").
   * @param {KeyboardEvent} event - The DOM keyboard event.
   * @param {string} normalizedEventKey - The already normalized key from the event.
   * @returns {boolean}
   */
  matchKey(pattern, event, normalizedEventKey) {
    const parts = pattern.split(/-(?!$)/); 
    let keyToMatch = parts.pop(); 

    const requiredModifiers = {
      Shift: false,
      Alt: false,
      Ctrl: false,
      Meta: false, 
      Mod: false, 
    };

    parts.forEach(part => {
      const modifier = part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(); 
      if (modifier in requiredModifiers) {
        requiredModifiers[modifier] = true;
      }
    });

    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    if (requiredModifiers.Mod) {
      if (isMac) {
        requiredModifiers.Meta = true;
      } else {
        requiredModifiers.Ctrl = true;
      }
    }

    if (requiredModifiers.Shift !== event.shiftKey) return false;
    if (requiredModifiers.Alt !== event.altKey) return false;
    if (requiredModifiers.Ctrl !== event.ctrlKey) return false;
    if (requiredModifiers.Meta !== event.metaKey) return false;
    
    if (keyToMatch.toLowerCase() === 'space') { 
      keyToMatch = 'Space';
    }
    if (keyToMatch.toLowerCase() === 'escape') {
      keyToMatch = 'Escape';
    }

    let matchResult = (keyToMatch.toUpperCase() === normalizedEventKey.toUpperCase());
    
    return matchResult;
  }
}
