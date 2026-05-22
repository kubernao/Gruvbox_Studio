export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  searchText: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export interface FlatMenuRow {
  id: string;
  label: string;
  pathLabel: string;
  accelerator?: string;
  enabled: boolean;
}

export interface CommandPalettePreviewRow {
  id: string;
  label: string;
  detail?: string;
  disabled: boolean;
  rank: number;
}

export type CommandPaletteExecuteResult =
  | { ok: true; executedLabel: string; detail?: string }
  | { ok: false; error: string };
