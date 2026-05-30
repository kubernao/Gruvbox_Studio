import React from 'react';
import { Menu, Toolbar } from '@base-ui/react';
import {
  AlignLeft,
  Bold,
  CheckSquare,
  FilePlus,
  FolderOpen,
  GitBranch,
  Highlighter,
  ImagePlus,
  Link2,
  Italic,
  List,
  ListOrdered,
  MessageSquarePlus,
  PaintBucket,
  Printer,
  FileDown,
  RefreshCw,
  Search,
  Save,
  Strikethrough,
  Type,
  Underline,
  Undo2,
  Redo2,
} from 'lucide-react';
import AppTopToolbar from './AppTopToolbar';
import { FileExplorerContext } from '../../features/explorer/FileExplorerContext';
import { openWorkspaceFolder } from '../../features/editor/openWorkspaceFolder';
import { OPEN_COMMAND_PALETTE_EVENT } from '../../features/palette/CommandPalette';
import { dispatchPaletteAction } from '../../features/palette/paletteActionEvents';
import { getPalettePrereqsSnapshot, subscribePalettePrereqs } from '../../features/palette/palettePrereqStore';
import { openQuickOpenModal } from '../../features/editor/QuickOpenModal';
import './AppToolbar.css';

const AppToolbar: React.FC = () => {
  const fileExplorer = React.useContext(FileExplorerContext);
  const prereqs = React.useSyncExternalStore(
    subscribePalettePrereqs,
    getPalettePrereqsSnapshot,
    getPalettePrereqsSnapshot,
  );
  const workspaceOpen = (fileExplorer?.rootPath ?? '').trim() !== '';

  const openPalette = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
  }, []);

  const openFolder = React.useCallback(async () => {
    await openWorkspaceFolder(fileExplorer);
  }, [fileExplorer]);

  const refreshWorkspace = React.useCallback(async () => {
    await fileExplorer?.refreshFileTree();
    dispatchPaletteAction({ kind: 'git.refreshStatus' });
    dispatchPaletteAction({ kind: 'git.refreshLog' });
    dispatchPaletteAction({ kind: 'git.refreshBranchesAndHistory' });
  }, [fileExplorer]);

  const openAiTab = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('app:right-sidebar-tab', { detail: { tab: 'ai' } }));
  }, []);

  const openVersionControlTab = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('app:right-sidebar-tab', { detail: { tab: 'version-control' } }));
  }, []);

  return (
    <AppTopToolbar>
      <Toolbar.Root className="app-toolbar app-toolbar-modern" aria-label="Application toolbar">
        <Toolbar.Group className="app-toolbar-group app-toolbar-group-left app-toolbar-zone app-toolbar-zone-left">
          <Toolbar.Button
            className="app-toolbar-button app-toolbar-button-search"
            onClick={openPalette}
            title="Open command palette"
            aria-label="Open command palette"
          >
            <Search size={16} aria-hidden="true" />
            <span className="app-toolbar-button-label">Command Palette</span>
            <kbd className="app-toolbar-kbd">Ctrl+Shift+P</kbd>
          </Toolbar.Button>
        </Toolbar.Group>

        <Toolbar.Separator className="app-toolbar-separator" />

        <Toolbar.Group className="app-toolbar-group app-toolbar-group-center app-toolbar-zone app-toolbar-zone-center">
          <div className="app-toolbar-center-scroll">
            <div className="app-toolbar-ribbon">
              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-file">
              <div className="app-toolbar-icon-stack">
                <div className="app-toolbar-icon-row">
                <Toolbar.Button className="app-toolbar-button" onClick={openFolder} title="Open folder" aria-label="Open folder">
                  <FolderOpen size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.newMarkdown' })}
                  title="New Markdown file"
                  aria-label="New Markdown file"
                  disabled={!workspaceOpen}
                >
                  <FilePlus size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.save' })}
                  title="Save"
                  aria-label="Save"
                  disabled={!prereqs.editorCanSave}
                >
                  <Save size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => openQuickOpenModal()}
                  title="Go to file"
                  aria-label="Go to file"
                  disabled={!workspaceOpen}
                >
                  <Search size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.print' })}
                  title="Print"
                  aria-label="Print"
                >
                  <Printer size={16} aria-hidden="true" />
                </Toolbar.Button>
                </div>
                <div className="app-toolbar-icon-row app-toolbar-icon-row-balanced">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={refreshWorkspace}
                  title="Refresh workspace"
                  aria-label="Refresh workspace"
                >
                  <RefreshCw size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.exportPdf' })}
                  title="Export PDF"
                  aria-label="Export PDF"
                >
                  <FileDown size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={openVersionControlTab}
                  title="Open version control tab"
                  aria-label="Open version control tab"
                >
                  <GitBranch size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={openAiTab}
                  title="Open AI tab"
                  aria-label="Open AI tab"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M390-120q-51 0-88-35.5T260-241q-60-8-100-53t-40-106q0-21 5.5-41.5T142-480q-11-18-16.5-38t-5.5-42q0-61 40-105.5t99-52.5q3-51 41-86.5t90-35.5q26 0 48.5 10t41.5 27q18-17 41-27t49-10q52 0 89.5 35t40.5 86q59 8 99.5 53T840-560q0 22-5.5 42T818-480q11 18 16.5 38.5T840-400q0 62-40.5 106.5T699-241q-5 50-41.5 85.5T570-120q-25 0-48.5-9.5T480-156q-19 17-42 26.5t-48 9.5Zm130-590v460q0 21 14.5 35.5T570-200q20 0 34.5-16t15.5-36q-21-8-38.5-21.5T550-306q-10-14-7.5-30t16.5-26q14-10 30-7.5t26 16.5q11 16 28 24.5t37 8.5q33 0 56.5-23.5T760-400q0-5-.5-10t-2.5-10q-17 10-36.5 15t-40.5 5q-17 0-28.5-11.5T640-440q0-17 11.5-28.5T680-480q33 0 56.5-23.5T760-560q0-33-23.5-56T680-640q-11 18-28.5 31.5T613-587q-16 6-31-1t-20-23q-5-16 1.5-31t22.5-20q15-5 24.5-18t9.5-30q0-21-14.5-35.5T570-760q-21 0-35.5 14.5T520-710Zm-80 460v-460q0-21-14.5-35.5T390-760q-21 0-35.5 14.5T340-710q0 16 9 29.5t24 18.5q16 5 23 20t2 31q-6 16-21 23t-31 1q-21-8-38.5-21.5T279-640q-32 1-55.5 24.5T200-560q0 33 23.5 56.5T280-480q17 0 28.5 11.5T320-440q0 17-11.5 28.5T280-400q-21 0-40.5-5T203-420q-2 5-2.5 10t-.5 10q0 33 23.5 56.5T280-320q20 0 37-8.5t28-24.5q10-14 26-16.5t30 7.5q14 10 16.5 26t-7.5 30q-14 19-32 33t-39 22q1 20 16 35.5t35 15.5q21 0 35.5-14.5T440-250Zm40-230Z" />
                  </svg>
                </Toolbar.Button>
                </div>
              </div>
              <div className="app-toolbar-ribbon-label">File</div>
            </div>

              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-insert">
              <div className="app-toolbar-icon-row">
                <Menu.Root>
                  <Menu.Trigger
                    className="app-toolbar-button app-toolbar-button-header"
                    aria-label="Insert heading"
                    title="Insert heading"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      height="16"
                      viewBox="0 -960 960 960"
                      width="16"
                      fill="currentColor"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M120-760v-80h720v80H120Zm640 80q33 0 56.5 23.5T840-600v400q0 33-23.5 56.5T760-120H200q-33 0-56.5-23.5T120-200v-400q0-33 23.5-56.5T200-680h560Zm0 80H200v400h560v-400Zm-560 0v400-400Z" />
                    </svg>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner className="app-toolbar-menu-positioner" sideOffset={8}>
                      <Menu.Popup className="app-toolbar-menu-popup">
                        {[1, 2, 3, 4, 5, 6].map((level) => (
                          <Menu.Item
                            key={`header-${level}`}
                            className="app-toolbar-menu-item"
                            onClick={() =>
                              dispatchPaletteAction({
                                kind: 'editor.insertHeader',
                                level: level as 1 | 2 | 3 | 4 | 5 | 6,
                              })
                            }
                          >
                            <span>{`H${level}`}</span>
                          </Menu.Item>
                        ))}
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertTable' })}
                  title="Insert table"
                  aria-label="Insert table"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M200-440h240v-160H200v160Zm0-240h560v-80H200v80Zm0 560q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v252q-19-8-39.5-10.5t-40.5.5q-21 4-40.5 13.5T684-479l-39 39-205 204v116H200Zm0-80h240v-160H200v160Zm320-240h125l39-39q16-16 35.5-25.5T760-518v-82H520v160Zm0 360v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T863-300L643-80H520Zm300-263-37-37 37 37ZM580-140h38l121-122-37-37-122 121v38Zm141-141-19-18 37 37-18-19Z" />
                  </svg>
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertMath' })}
                  title="Insert math"
                  aria-label="Insert math"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M400-240v-80h62l105-120-105-120h-66l-64 344q-8 45-37 70.5T221-120q-45 0-73-24t-28-64q0-32 17-51.5t43-19.5q25 0 42.5 17t17.5 41q0 5-.5 9t-1.5 9q5-1 8.5-5.5T252-221l62-339H200v-80h129l21-114q7-38 37.5-62t72.5-24q44 0 72 26t28 65q0 30-17 49.5T500-680q-25 0-42.5-17T440-739q0-5 .5-9t1.5-9q-6 2-9 6t-5 12l-17 99h189v80h-32l52 59 52-59h-32v-80h200v80h-62L673-440l105 120h62v80H640v-80h32l-52-60-52 60h32v80H400Z" />
                  </svg>
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button app-toolbar-mermaid-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertMermaid' })}
                  title="Insert Mermaid diagram"
                  aria-label="Insert Mermaid diagram"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M296-270q-42 35-87.5 32T129-269q-34-28-46.5-73.5T99-436l75-124q-25-22-39.5-53T120-680q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47q-9 0-18-1t-17-3l-77 130q-11 18-7 35.5t17 28.5q13 11 31 12.5t35-12.5l420-361q42-35 88-31.5t80 31.5q34 28 46 73.5T861-524l-75 124q25 22 39.5 53t14.5 67q0 66-47 113t-113 47q-66 0-113-47t-47-113q0-66 47-113t113-47q9 0 17.5 1t16.5 3l78-130q11-18 7-35.5T782-630q-13-11-31-12.5T716-630L296-270Zm40.5-353.5Q360-647 360-680t-23.5-56.5Q313-760 280-760t-56.5 23.5Q200-713 200-680t23.5 56.5Q247-600 280-600t56.5-23.5Zm400 400Q760-247 760-280t-23.5-56.5Q713-360 680-360t-56.5 23.5Q600-313 600-280t23.5 56.5Q647-200 680-200t56.5-23.5ZM280-680Zm400 400Z" />
                  </svg>
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-ribbon-label">Insert</div>
            </div>

              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-format">
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.toggleBold' })}
                  title="Bold"
                  aria-label="Bold"
                >
                  <Bold size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.toggleItalic' })}
                  title="Italic"
                  aria-label="Italic"
                >
                  <Italic size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.toggleStrikethrough' })}
                  title="Strikethrough"
                  aria-label="Strikethrough"
                >
                  <Strikethrough size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertFontColor' })}
                  title="Font color"
                  aria-label="Font color"
                >
                  <PaintBucket size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-ribbon-label">Format</div>
            </div>

              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-text">
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertFontFamily' })}
                  title="Font"
                  aria-label="Font"
                >
                  <Type size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertTextSize' })}
                  title="Text size"
                  aria-label="Text size"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M280-280v-80h120v-320h-120v-80h360v80H520v320h120v80H280Zm-120 0v-80h80v80h-80Zm560 0v-80h80v80h-80Z" />
                  </svg>
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.toggleUnderline' })}
                  title="Underline"
                  aria-label="Underline"
                >
                  <Underline size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.toggleHighlight' })}
                  title="Highlight"
                  aria-label="Highlight"
                >
                  <Highlighter size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-ribbon-label">Text</div>
            </div>

              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-content">
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertLink' })}
                  title="Insert link"
                  aria-label="Insert link"
                >
                  <Link2 size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertInlineComment' })}
                  title="Inline comment"
                  aria-label="Inline comment"
                >
                  <MessageSquarePlus size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertImage' })}
                  title="Insert image"
                  aria-label="Insert image"
                >
                  <ImagePlus size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertTextAlign' })}
                  title="Text align"
                  aria-label="Text align"
                >
                  <AlignLeft size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-ribbon-label">Content</div>
            </div>

              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-lists">
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertBulletList' })}
                  title="Insert bullet list"
                  aria-label="Insert bullet list"
                >
                  <List size={16} aria-hidden="true" />
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertChecklist' })}
                  title="Insert check box"
                  aria-label="Insert check box"
                >
                  <CheckSquare size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.insertNumberedList' })}
                  title="Insert numbered list"
                  aria-label="Insert numbered list"
                >
                  <ListOrdered size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-ribbon-label">Lists</div>
            </div>

              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-review">
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.spellCheck' })}
                  title="Spell check"
                  aria-label="Spell check"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M360-240h80v-80h-80v80Zm-120 0h80v-80h-80v80Zm240 0h80v-80h-80v80Zm-120-120h80v-80h-80v80Zm-120 0h80v-80h-80v80Zm240 0h80v-80h-80v80Zm-120-120h80v-80h-80v80Zm-120 0h80v-80h-80v80Zm240 0h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Z" />
                  </svg>
                </Toolbar.Button>
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.grammarCheck' })}
                  title="Grammar check"
                  aria-label="Grammar check"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M140-200v-80h680v80H140Zm120-160v-80h440v80H260Zm40-160 116-320h88l116 320h-84l-24-72H428l-24 72h-84Zm152-140h136l-66-196h-4l-66 196Z" />
                  </svg>
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-icon-row">
                <Toolbar.Button
                  className="app-toolbar-button"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.readabilityCheck' })}
                  title="Readability check"
                  aria-label="Readability check"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="16"
                    viewBox="0 -960 960 960"
                    width="16"
                    fill="currentColor"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="M160-160v-640h80v640h-80Zm560 0-56-56 64-64H320v-80h408l-64-64 56-56 160 160-160 160Z" />
                  </svg>
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-ribbon-label">Review</div>
            </div>

              <div className="app-toolbar-ribbon-group app-toolbar-ribbon-group-undo-redo app-toolbar-ribbon-group-history">
              <div className="app-toolbar-icon-row app-toolbar-icon-row-single">
                <Toolbar.Button
                  className="app-toolbar-button app-toolbar-button-compact"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.undo' })}
                  title="Undo"
                  aria-label="Undo"
                >
                  <Undo2 size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-icon-row app-toolbar-icon-row-single">
                <Toolbar.Button
                  className="app-toolbar-button app-toolbar-button-compact"
                  onClick={() => dispatchPaletteAction({ kind: 'editor.redo' })}
                  title="Redo"
                  aria-label="Redo"
                >
                  <Redo2 size={16} aria-hidden="true" />
                </Toolbar.Button>
              </div>
              <div className="app-toolbar-ribbon-label">History</div>
            </div>
            </div>
          </div>
        </Toolbar.Group>

      </Toolbar.Root>
    </AppTopToolbar>
  );
};

export default AppToolbar;
