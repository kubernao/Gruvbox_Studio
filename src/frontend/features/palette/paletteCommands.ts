/**
 * Curated command palette rows (workspace, editor, AI, Git, diff).
 * Menu-derived rows are merged separately in execute.ts (see main process application menu).
 *
 * Inventory — UI / handler / disabled:
 * - Open folder… → runOpenFolder → always
 * - Refresh file tree → runRefreshTree → no workspace
 * - New Markdown file → PALETTE editor.newMarkdown → !workspace
 * - Save active file → PALETTE editor.save → EditorPane.handleSave → !editorCanSave
 * - Listen / stop speech / export cloud audio / audiobook wizard → PALETTE editor.listen* / editor.stopSpeech / editor.exportSpeechAudio / editor.generateAudiobook → EditorPane
 * - Open AI / Version Control tab → runOpen*Tab → always
 * - Open AI assistant settings → tab + PALETTE ai.openSettings → always
 * - Clear AI chat / Stop AI / Reload models → PALETTE ai.* → AIAssistantTab
 * - Git refresh* / init / recheck → tab + PALETTE git.* → VersionControlTab (see prereqs.git*)
 * - Save version… → runOpenCommitMessagePalette → no workspace
 * - Close diff → runCloseDiff → !hasDiffOpen
 * - Diff HEAD~1..HEAD → runOpenGitDiff → no file selected
 */

import type { FileTreeNode } from '../explorer/types';
import type { PaletteItem } from './types';
import type { PalettePrereqs } from './palettePrereqStore';
import { dispatchPaletteAction } from './paletteActionEvents';
import { isDarwin } from './platform';
import { selectedFileRepoRelative } from './palettePathUtils';

export type CuratedPaletteBuildOptions = {
  rootPath: string;
  selectedFile: string | null;
  /** Reserved for future palette items (e.g. open file by tree); kept for call-site compatibility. */
  fileTree: FileTreeNode | null;
  hasDiffOpen: boolean;
  prereqs: PalettePrereqs;
  runOpenFolder: () => Promise<void>;
  runRefreshTree: () => Promise<void>;
  runOpenAiTab: () => void;
  runOpenVersionControlTab: () => void;
  runCloseDiff: () => void;
  runOpenGitDiff: (args: { filePath: string; hash1: string; hash2: string }) => void;
  runOpenCommitMessagePalette: () => void;
};

function modShortcut(key: string): string {
  return `${isDarwin() ? 'Cmd' : 'Ctrl'}+${key}`;
}

function dispatchLayoutToggle(kind: 'zen' | 'all' | 'left' | 'right' | 'top'): void {
  window.dispatchEvent(new CustomEvent('app:layout-toggle', { detail: { kind } }));
}

export function buildCuratedPaletteItems(options: CuratedPaletteBuildOptions): PaletteItem[] {
  const selectedRelative = selectedFileRepoRelative(options.selectedFile, options.rootPath);
  const { prereqs } = options;
  const workspaceOpen = options.rootPath.trim() !== '';
  const gitDataRefreshOk =
    workspaceOpen && prereqs.gitIsRepo && prereqs.gitSelectedDocument.trim() !== '';

  return [
    {
      id: 'open-folder',
      label: 'Open folder…',
      detail: 'File Explorer',
      shortcut: modShortcut('O'),
      searchText: 'open folder workspace directory file explorer',
      run: options.runOpenFolder,
    },
    {
      id: 'refresh-tree',
      label: 'Refresh file tree',
      detail: 'File Explorer',
      searchText: 'refresh reload file tree explorer',
      disabled: !workspaceOpen,
      run: options.runRefreshTree,
    },
    {
      id: 'editor-new-markdown',
      label: 'New Markdown file',
      detail: 'File Explorer',
      searchText: 'new markdown file create md',
      disabled: !workspaceOpen,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.newMarkdown' });
      },
    },
    {
      id: 'editor-save',
      label: 'Save active file',
      detail: 'Editor',
      shortcut: modShortcut('S'),
      searchText: 'save file editor disk write',
      disabled: !prereqs.editorCanSave,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.save' });
      },
    },
    {
      id: 'editor-export-html',
      label: 'Export rendered document as HTML',
      detail: 'Editor',
      searchText: 'export rendered html markdown document',
      disabled: !prereqs.editorCanSave,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.exportHtml' });
      },
    },
    {
      id: 'editor-export-pdf',
      label: 'Export rendered document as PDF',
      detail: 'Editor',
      searchText: 'export rendered pdf markdown document',
      disabled: !prereqs.editorCanSave,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.exportPdf' });
      },
    },
    {
      id: 'editor-export-docx',
      label: 'Export rendered document as DOCX',
      detail: 'Editor',
      searchText: 'export rendered docx markdown document word',
      disabled: !prereqs.editorCanSave,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.exportDocx' });
      },
    },
    {
      id: 'editor-export-file-copy',
      label: 'Export file copy…',
      detail: 'Editor',
      searchText: 'export save copy file disk download duplicate',
      disabled: !prereqs.editorCanExportFile,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.exportFileCopy' });
      },
    },
    {
      id: 'editor-open-pdf-external',
      label: 'Open current PDF externally',
      detail: 'Editor',
      searchText: 'pdf open external system default viewer',
      disabled: !prereqs.editorActiveIsPdf,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.openPdfExternal' });
      },
    },
    {
      id: 'editor-listen-document',
      label: 'Listen to document (spoken)',
      detail: 'Editor',
      searchText: 'listen audiobook text to speech tts read aloud document speech',
      disabled: !prereqs.editorCanListenDocument,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.listenDocument' });
      },
    },
    {
      id: 'editor-listen-selection',
      label: 'Listen to selection (spoken)',
      detail: 'Editor',
      searchText: 'listen selection read aloud tts speech',
      disabled: !prereqs.editorCanListenSelection,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.listenSelection' });
      },
    },
    {
      id: 'editor-stop-speech',
      label: 'Stop spoken playback',
      detail: 'Editor',
      searchText: 'stop speech listen audiobook tts cancel',
      run: () => {
        dispatchPaletteAction({ kind: 'editor.stopSpeech' });
      },
    },
    {
      id: 'editor-export-speech-audio',
      label: 'Export document audio (cloud TTS)…',
      detail: 'Editor',
      searchText: 'export mp3 audio speech cloud tts audiobook',
      disabled: !prereqs.editorCanListenDocument,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.exportSpeechAudio' });
      },
    },
    {
      id: 'editor-generate-audiobook',
      label: 'Generate audiobook (cloud, chapters)…',
      detail: 'Editor',
      searchText: 'generate audiobook chapters mp3 manifest neural hd export folder',
      disabled: !prereqs.editorCanListenDocument,
      run: () => {
        dispatchPaletteAction({ kind: 'editor.generateAudiobook' });
      },
    },
    {
      id: 'open-ai-tab',
      label: 'Open AI Assistant tab',
      detail: 'Right sidebar',
      searchText: 'open ai assistant pi right sidebar',
      run: () => {
        options.runOpenAiTab();
      },
    },
    {
      id: 'open-vc-tab',
      label: 'Open Version Control tab',
      detail: 'Right sidebar',
      searchText: 'open version control git right sidebar',
      run: () => {
        options.runOpenVersionControlTab();
      },
    },
    {
      id: 'toggle-all-layout',
      label: 'Toggle all layout regions',
      detail: 'Layout',
      shortcut: modShortcut('Shift+A'),
      searchText: 'toggle all layout regions sidebars toolbar visible collapsed',
      run: () => dispatchLayoutToggle('all'),
    },
    {
      id: 'toggle-zen-mode',
      label: 'Focus editor (Zen)',
      detail: 'Layout',
      shortcut: modShortcut('Shift+Z'),
      searchText: 'zen mode focus editor hide sidebars toolbar layout',
      run: () => dispatchLayoutToggle('zen'),
    },
    {
      id: 'toggle-left-sidebar',
      label: 'Toggle left sidebar',
      detail: 'Layout',
      shortcut: modShortcut('Shift+L'),
      searchText: 'toggle left sidebar file explorer layout',
      run: () => dispatchLayoutToggle('left'),
    },
    {
      id: 'toggle-right-sidebar',
      label: 'Toggle right sidebar',
      detail: 'Layout',
      shortcut: modShortcut('Shift+R'),
      searchText: 'toggle right sidebar ai version control layout',
      run: () => dispatchLayoutToggle('right'),
    },
    {
      id: 'toggle-top-toolbar',
      label: 'Toggle top toolbar',
      detail: 'Layout',
      shortcut: modShortcut('Shift+T'),
      searchText: 'toggle top toolbar layout',
      run: () => dispatchLayoutToggle('top'),
    },
    {
      id: 'ai-open-settings',
      label: 'Open AI assistant settings',
      detail: 'Gruvie',
      searchText: 'ai assistant settings api key model gruvie',
      run: () => {
        options.runOpenAiTab();
        dispatchPaletteAction({ kind: 'ai.openSettings' });
      },
    },
    {
      id: 'ai-clear-chat',
      label: 'New AI conversation',
      detail: 'Gruvie',
      searchText: 'new ai conversation clear chat history save',
      run: () => {
        dispatchPaletteAction({ kind: 'ai.clearChat' });
      },
    },
    {
      id: 'ai-abort',
      label: 'Stop AI response',
      detail: 'Gruvie',
      searchText: 'stop abort ai gruvie streaming cancel',
      run: () => {
        dispatchPaletteAction({ kind: 'ai.abort' });
      },
    },
    {
      id: 'ai-reload-models',
      label: 'Reload AI models list',
      detail: 'Gruvie',
      searchText: 'reload refresh models list gruvie',
      run: () => {
        options.runOpenAiTab();
        dispatchPaletteAction({ kind: 'ai.reloadModels' });
      },
    },
    {
      id: 'git-refresh-status',
      label: 'Refresh git status',
      detail: 'Version control',
      searchText: 'git status refresh working tree',
      disabled: !workspaceOpen || !prereqs.gitIsRepo,
      run: () => {
        options.runOpenVersionControlTab();
        dispatchPaletteAction({ kind: 'git.refreshStatus' });
      },
    },
    {
      id: 'git-refresh-log',
      label: 'Refresh repository history',
      detail: 'Version control',
      searchText: 'git log history refresh commits',
      disabled: !workspaceOpen || !prereqs.gitIsRepo,
      run: () => {
        options.runOpenVersionControlTab();
        dispatchPaletteAction({ kind: 'git.refreshLog' });
      },
    },
    {
      id: 'git-refresh-branches-history',
      label: 'Refresh branches and file history',
      detail: 'Version control',
      searchText: 'git branches refresh file history log',
      disabled: !gitDataRefreshOk || prereqs.gitIsBusy,
      run: () => {
        options.runOpenVersionControlTab();
        dispatchPaletteAction({ kind: 'git.refreshBranchesAndHistory' });
      },
    },
    {
      id: 'git-init-repo',
      label: 'Initialize git repository',
      detail: 'Version control',
      searchText: 'git init new repository',
      disabled: !workspaceOpen || prereqs.gitIsRepo || prereqs.gitIsBusy,
      run: () => {
        options.runOpenVersionControlTab();
        dispatchPaletteAction({ kind: 'git.initRepo' });
      },
    },
    {
      id: 'git-recheck-repo',
      label: 'Re-check git repository',
      detail: 'Version control',
      searchText: 'git detect repository refresh check',
      disabled: !workspaceOpen || prereqs.gitIsBusy,
      run: () => {
        options.runOpenVersionControlTab();
        dispatchPaletteAction({ kind: 'git.recheckRepo' });
      },
    },
    {
      id: 'save-version-commit-message',
      label: 'Save version…',
      detail: 'Version control',
      searchText: 'save version commit message git stage',
      disabled: !workspaceOpen,
      run: options.runOpenCommitMessagePalette,
    },
    {
      id: 'close-diff',
      label: 'Close diff viewer',
      detail: 'Editor',
      searchText: 'close diff viewer compare file',
      disabled: !options.hasDiffOpen,
      run: () => {
        options.runCloseDiff();
      },
    },
    {
      id: 'diff-selected-head',
      label: 'Diff selected file: HEAD~1 -> HEAD',
      detail: selectedRelative ?? 'Select a file first',
      searchText: 'diff selected file head head~1 compare git',
      disabled: selectedRelative == null || selectedRelative === '',
      run: () => {
        if (selectedRelative == null || selectedRelative === '') {
          return;
        }
        options.runOpenGitDiff({
          filePath: selectedRelative,
          hash1: 'HEAD~1',
          hash2: 'HEAD',
        });
      },
    },
  ];
}
