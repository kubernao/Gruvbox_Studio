import { useEffect } from 'react';
import { isDarwin } from './platform';

function shouldIgnoreCommandPaletteHotkey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('.cm-editor') !== null) {
    return false;
  }
  if (target.closest('.command-palette-panel') !== null) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useCommandPaletteHotkey(onToggle: () => void): void {
  useEffect(() => {
    const onKeydown = (event: KeyboardEvent): void => {
      const mod = isDarwin() ? event.metaKey : event.ctrlKey;
      if (!mod || !event.shiftKey) {
        return;
      }
      if (event.key !== 'p' && event.key !== 'P') {
        return;
      }
      if (shouldIgnoreCommandPaletteHotkey(event.target)) {
        return;
      }
      event.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  }, [onToggle]);
}
