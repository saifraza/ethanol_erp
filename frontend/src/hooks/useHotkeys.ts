import { useEffect } from 'react';

export interface Hotkey {
  key: string;              // Single char like 'n', '/', '?', or 'Escape', 'ArrowDown', etc.
  ctrl?: boolean;           // Cmd on Mac
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
  allowInInputs?: boolean;  // Default false — most shortcuts should NOT fire while typing
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      const inInput = isEditableTarget(e.target);
      for (const hk of hotkeys) {
        if (inInput && !hk.allowInInputs) continue;
        const ctrl = hk.ctrl ?? false;
        const shift = hk.shift ?? false;
        const alt = hk.alt ?? false;
        const ctrlPressed = e.ctrlKey || e.metaKey;
        if (ctrlPressed !== ctrl) continue;
        if (e.shiftKey !== shift) continue;
        if (e.altKey !== alt) continue;
        if (e.key.toLowerCase() === hk.key.toLowerCase()) {
          hk.handler(e);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkeys, enabled]);
}
