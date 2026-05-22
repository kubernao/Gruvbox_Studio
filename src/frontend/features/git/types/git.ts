/**
 * Git-related types
 */

export interface GitStatusEntry {
  file: string;
  status: string;
}

export interface GitLogEntry {
  hash: string;
  abbrevHash: string;
  subject: string;
  body: string;
  author: string;
  authorEmail: string;
  authorDate: number;
  committer: string;
  committerEmail: string;
  committerDate: number;
  decorations: string;
  /** Full parent commit hashes (first parent first). */
  parents: string[];
}

export interface GitBranchListRow {
  name: string;
  isCurrent: boolean;
  commit: string;
  commitMessage: string;
}

export interface GitRemoteListRow {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export type GithubTabAuthState = {
  connected: boolean;
  login: string;
  encryptionAvailable: boolean;
  reason?: 'not_configured' | 'no_encryption' | 'signed_out';
};

export type GithubAuthStatusInvokePayload = Pick<GithubTabAuthState, 'encryptionAvailable'> & {
  connected: boolean;
  login?: string;
  reason?: GithubTabAuthState['reason'];
};
