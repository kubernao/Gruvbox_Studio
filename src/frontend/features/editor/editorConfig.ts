import { EditorView } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { ThemeColors } from '../../features/theme/lib';

/**
 * Get the file language extension from file path
 * @param filePath Full file path or extension
 * @returns CodeMirror language extension
 */
export function getLanguageExtension(filePath: string): Extension {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  const extensionMap: Record<string, Extension> = {
    // JavaScript/TypeScript
    js: javascript({ jsx: false, typescript: false }),
    jsx: javascript({ jsx: true, typescript: false }),
    ts: javascript({ jsx: false, typescript: true }),
    tsx: javascript({ jsx: true, typescript: true }),
    mts: javascript({ jsx: false, typescript: true }),
    cts: javascript({ jsx: false, typescript: true }),

    // Markup/HTML
    html: javascript({ jsx: true, typescript: false }),
    htm: javascript({ jsx: true, typescript: false }),

    // Markdown
    md: markdown(),
    markdown: markdown(),
    mdx: markdown(),

    // Data formats
    json: json(),
    jsonc: json(),
  };

  return extensionMap[ext] || [];
}

/**
 * Get display language name from file extension
 */
export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    mts: 'typescript',
    cts: 'typescript',

    // Markup
    html: 'html',
    htm: 'html',
    xml: 'xml',
    svg: 'xml',

    // Styles
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',

    // Markdown
    md: 'markdown',
    markdown: 'markdown',
    mdx: 'mdx',

    // Data formats
    json: 'json',
    jsonc: 'jsonc',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'plaintext',

    // Config files
    env: 'plaintext',
    'env.local': 'plaintext',

    // Text
    txt: 'plaintext',
    text: 'plaintext',

    // Shell scripts
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',

    // Other languages
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'cpp',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    php: 'php',
    sql: 'sql',
  };

  return languageMap[ext] || 'plaintext';
}

/**
 * Create CodeMirror theme from Gruvbox colors
 */
export function createGruvboxTheme(_colors: ThemeColors, isDark: boolean) {
  return EditorView.theme(
    {
      '.cm-content': {
        backgroundColor: 'transparent',
        color: 'var(--text-primary)',
        fontSize: '15px',
      },
      '.cm-activeLine': {
        backgroundColor: 'transparent',
      },
      '.cm-gutters': {
        backgroundColor: 'color-mix(in srgb, var(--bg-secondary) 82%, transparent)',
        borderRight: '1px solid var(--border-default)',
      },
      '.cm-linenumber': {
        color: 'var(--text-muted)',
        minWidth: '3ch',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--text-primary)',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'var(--editor-selection)',
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
        {
          backgroundColor: 'var(--editor-tabstop)',
        },
      '.cm-string': {
        color: 'var(--green-dim)',
      },
      '.cm-number': {
        color: 'var(--purple)',
      },
      '.cm-atom': {
        color: 'var(--purple)',
      },
      '.cm-keyword': {
        color: 'var(--red-dim)',
      },
      '.cm-variableName': {
        color: 'var(--blue-dim)',
      },
      '.cm-operator': {
        color: 'var(--orange-dim)',
      },
      '.cm-comment': {
        color: 'var(--text-muted)',
        fontStyle: 'italic',
      },
      '.cm-tagName': {
        color: 'var(--red-dim)',
      },
      '.cm-attributeName': {
        color: 'var(--yellow-dim)',
      },
    },
    { dark: isDark }
  );
}

/**
 * CodeMirror editor configuration
 */
export const DEFAULT_EDITOR_OPTIONS = {
  fontSize: 14,
  indentUnit: 2,
  tabSize: 2,
  lineNumbers: false,
  lineWrapping: true,
};
