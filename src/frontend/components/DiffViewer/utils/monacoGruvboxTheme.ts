import type * as monaco from 'monaco-editor';

let gruvboxDiffThemeRegistered = false;

/**
 * Registers and selects the Gruvbox diff theme once per renderer session so nested
 * Monaco editors do not each duplicate module-level registration guards.
 */
export function ensureGruvboxDiffTheme(monacoApi: typeof monaco): void {
  if (gruvboxDiffThemeRegistered) {
    return;
  }
  defineGruvboxMonacoTheme(monacoApi);
  monacoApi.editor.setTheme('gruvbox-studio-diff');
  gruvboxDiffThemeRegistered = true;
}

function readRootCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback;
  }
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw || fallback;
}

/**
 * Registers a dark Gruvbox-aligned Monaco theme (uses CSS variables where supported at runtime).
 */
export function defineGruvboxMonacoTheme(monacoApi: typeof monaco): void {
  const editorSurround = readRootCssVar('--bg-editor-surround', '#181b1c');
  monacoApi.editor.defineTheme('gruvbox-studio-diff', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': editorSurround,
      'editor.foreground': '#ebdbb2',
      'editorLineNumber.foreground': '#665c54',
      'editorLineNumber.activeForeground': '#a89984',
      'editorGutter.background': editorSurround,
      'diffEditor.insertedTextBackground': '#3d422066',
      'diffEditor.removedTextBackground': '#cc241d33',
      'diffEditor.border': '#504945',
      'scrollbarSlider.background': '#50494599',
      'scrollbarSlider.hoverBackground': '#665c54aa',
      'scrollbarSlider.activeBackground': '#7c6f64cc',
    },
  });
}
