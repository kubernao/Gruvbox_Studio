/**
 * Command palette → feature wiring (same pattern as app:right-sidebar-tab).
 *
 * Inventory (UI → handler → event):
 * - Editor save → EditorPane.handleSave → editor.save
 * - AI clear / abort / refresh models / settings gear → AIAssistantTab → ai.*
 * - Git refresh / init / re-check → VersionControlTab gitTab.* → git.*
 */

export const PALETTE_ACTION_EVENT = 'app:palette-action';

export type PaletteAction =
  | { kind: 'editor.save' }
  | { kind: 'editor.newMarkdown' }
  | { kind: 'editor.undo' }
  | { kind: 'editor.redo' }
  | { kind: 'editor.print' }
  | { kind: 'editor.exportHtml' }
  | { kind: 'editor.exportPdf' }
  | { kind: 'editor.exportDocx' }
  | { kind: 'editor.exportFileCopy' }
  | { kind: 'editor.openPdfExternal' }
  | { kind: 'editor.listenDocument' }
  | { kind: 'editor.listenSelection' }
  | { kind: 'editor.stopSpeech' }
  | { kind: 'editor.exportSpeechAudio' }
  | { kind: 'editor.generateAudiobook' }
  | { kind: 'editor.insertHeader'; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: 'editor.insertFontFamily' }
  | { kind: 'editor.insertTextSize' }
  | { kind: 'editor.toggleBold' }
  | { kind: 'editor.toggleItalic' }
  | { kind: 'editor.toggleUnderline' }
  | { kind: 'editor.toggleStrikethrough' }
  | { kind: 'editor.toggleHighlight' }
  | { kind: 'editor.insertFontColor' }
  | { kind: 'editor.insertLink' }
  | { kind: 'editor.insertInlineComment' }
  | { kind: 'editor.insertImage' }
  | { kind: 'editor.insertTextAlign' }
  | { kind: 'editor.insertBulletList' }
  | { kind: 'editor.insertChecklist' }
  | { kind: 'editor.insertNumberedList' }
  | { kind: 'editor.spellCheck' }
  | { kind: 'editor.grammarCheck' }
  | { kind: 'editor.readabilityCheck' }
  | { kind: 'editor.insertMath' }
  | { kind: 'editor.insertTable' }
  | { kind: 'editor.insertMermaid' }
  | { kind: 'ai.clearChat' }
  | { kind: 'ai.abort' }
  | { kind: 'ai.reloadModels' }
  | { kind: 'ai.openSettings' }
  | { kind: 'git.refreshStatus' }
  | { kind: 'git.refreshLog' }
  | { kind: 'git.refreshBranchesAndHistory' }
  | { kind: 'git.initRepo' }
  | { kind: 'git.recheckRepo' };

export type PaletteActionEventDetail = { action: PaletteAction };

export function dispatchPaletteAction(action: PaletteAction): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<PaletteActionEventDetail>(PALETTE_ACTION_EVENT, {
      detail: { action },
    }),
  );
}
