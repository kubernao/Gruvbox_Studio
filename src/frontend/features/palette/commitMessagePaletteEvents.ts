/** Dispatched to open the command palette in “Save version” / commit message mode. */
export const OPEN_COMMIT_MESSAGE_PALETTE_EVENT = 'app:open-commit-message-palette';

/** Dispatched when the user confirms a commit message from that palette view. */
export const COMMIT_MESSAGE_PALETTE_CONFIRM_EVENT = 'app:commit-message-palette-confirm';

export type CommitMessagePaletteConfirmDetail = { message: string };
