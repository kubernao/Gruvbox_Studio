# Git Commands Implementation

## Overview
Full implementation of git commands for the Version Control Tab. All commands execute real git operations via Node's `child_process.execFile()`.

## Implemented Commands

### Core Repository Commands

#### `is-git-repo`
Checks if a directory is a git repository by verifying `.git` exists.
- **Returns**: `boolean`
- **Example**: `true` if `.git` folder exists

#### `resolve-git-repo-root`
Resolves the git repository root directory.
- **Input**: `directoryPath` - path to check
- **Returns**: `string` - absolute path to repo root
- **Method**: Runs `git rev-parse --show-toplevel` with fallback to input path

#### `git-init`
Initializes a new git repository.
- **Returns**: `{ ok: true }` on success, `{ error: string }` on failure
- **Command**: `git init`

### Status & History Commands

#### `git-status`
Gets the working tree status in porcelain format.
- **Returns**: `Array<{ status: string, file: string }>`
- **Status codes**: 
  - `A` = Added
  - `M` = Modified
  - `D` = Deleted
  - `??` = Untracked
  - etc.
- **Example**:
  ```json
  [
    { "status": "M", "file": "src/electron-main.js" },
    { "status": "??", "file": "newfile.txt" }
  ]
  ```

#### `git-log`
Gets repository-wide commit history (100 most recent).
- **Returns**: `Array<GitLogEntry>`
- **Fields per commit**:
  - `hash` - full commit hash
  - `abbrevHash` - 7-char abbreviated hash
  - `subject` - commit message first line
  - `body` - commit message body
  - `author` - author name
  - `authorEmail` - author email
  - `authorDate` - timestamp (milliseconds)
  - `committer` - committer name
  - `committerEmail` - committer email
  - `committerDate` - timestamp (milliseconds)
  - `decorations` - branch/tag refs (e.g., `(HEAD -> main)`)
- **Command**: `git log --pretty=format:...  -n 100`

#### `git-log-file`
Gets commit history for a specific file.
- **Input**: `filePath` - relative path within repo
- **Returns**: `Array<GitLogEntry>` - same as git-log
- **Command**: `git log --pretty=format:... -- <file>`

### File & Branch Commands

#### `git-tracked-files`
Gets all tracked files in the repository.
- **Returns**: `Array<string>` - file paths
- **Example**: `["src/electron-main.js", "package.json", "README.md"]`
- **Command**: `git ls-files`

#### `git-branch-list-for-file`
Gets all branches that have touched a specific file.
- **Input**: `filePath` - relative path within repo
- **Returns**: `{ branches: Array<GitBranchListRow> }`
- **Branch fields**:
  - `name` - branch name (including remote prefix if applicable)
  - `isCurrent` - true if this is the current branch
  - `commit` - commit hash that modified this file
  - `commitMessage` - commit message for that commit
- **Algorithm**:
  1. Get all branches (`git branch -a`)
  2. Get current branch (`git rev-parse --abbrev-ref HEAD`)
  3. For each branch, check if it has touched the file
  4. Return matching branches with metadata

#### `git-remote-list`
Gets configured remote repositories.
- **Returns**: `{ remotes: Array<GitRemoteListRow> }`
- **Remote fields**:
  - `name` - remote name (usually "origin")
  - `fetchUrl` - fetch URL
  - `pushUrl` - push URL
- **Example**:
  ```json
  {
    "remotes": [
      {
        "name": "origin",
        "fetchUrl": "https://github.com/user/repo.git",
        "pushUrl": "https://github.com/user/repo.git"
      }
    ]
  }
  ```
- **Command**: `git remote -v`

## Implementation Details

### Process Execution
Uses Node's `child_process.execFile()` for safety:
- No shell injection risks
- Direct program execution
- Better error handling
- Promisified with `util.promisify()` for async/await

### Error Handling
All commands include try-catch blocks:
- Execution errors → `{ error: string }`
- Git errors → captured and returned safely
- Missing parameters → checked upfront

### Data Parsing

#### Git Log Format
Custom format string combining multiple fields:
```bash
git log --pretty=format:%H%n%h%n%s%n%B%n%an%n%ae%n%aI%n%cn%n%ce%n%cI%n%d
```

Where:
- `%H` = full hash
- `%h` = abbreviated hash
- `%s` = subject (first line)
- `%B` = body (full message)
- `%an` = author name
- `%ae` = author email
- `%aI` = author date (ISO format)
- `%cn` = committer name
- `%ce` = committer email
- `%cI` = committer date (ISO format)
- `%d` = decorations (branch/tag names)

#### Status Parsing
Porcelain format (2-digit status codes):
```
 M file.js        # modified
A  newfile.txt    # added
D  deleted.js     # deleted
?? untracked.txt  # untracked
```

## Command Flow Example

### Opening a Git Repository
```
1. User opens folder (FileExplorer)
2. VersionControlTab detects change
3. IPC: git-provider is-git-repo
   → execFile('git', ['rev-parse', '--is-inside-work-tree'])
   → returns: true
4. UI shows "ready" state
5. IPC: git-provider git-status
   → execFile('git', ['status', '--porcelain'])
   → returns: [{ status: "M", file: "src/electron-main.js" }]
6. UI renders status list
7. IPC: git-provider git-tracked-files
   → execFile('git', ['ls-files'])
   → returns: ["src/electron-main.js", "package.json", ...]
8. UI renders file picker
```

## Error Scenarios

### Git Not Installed
- `execFile` throws error
- Error caught and returned as `{ error: "git not found" }`
- UI displays error message

### Invalid Repository
- `is-git-repo` returns `false`
- UI prompts to initialize repository

### Permission Denied
- `execFile` throws error
- Error message includes details
- UI displays error

### Large Repository
- Git commands may take time
- No timeout (should add for UX)
- UI remains responsive (commands run in main process thread)

## Performance Considerations

### Optimization Opportunities
1. **Caching**: Cache tracked files list (expensive for large repos)
2. **Timeouts**: Add timeouts to prevent hanging on slow operations
3. **Async**: Run heavy operations in worker thread (planned for future)
4. **Batch Operations**: Combine multiple git commands to reduce calls

### Current Behavior
- Each command runs sequentially
- VersionControlTab handles await for all calls
- No caching between calls
- Good enough for typical repositories

## Future Enhancements

### Branch Operations
```javascript
case 'git-branch-create':
case 'git-branch-delete':
case 'git-switch-branch':
// Implement branch management
```

### Commit Operations
```javascript
case 'git-commit':
case 'git-add':
case 'git-reset':
// Implement commit workflow
```

### Advanced Operations
```javascript
case 'git-diff':
case 'git-merge':
case 'git-rebase':
case 'git-stash':
// Implement advanced workflows
```

## Testing the Implementation

### Manual Testing Steps

1. **Start the app**: `npm start`
2. **Open DevTools**: F12
3. **Open a git repository**: Use FileExplorer to open folder with .git
4. **Monitor console**: Watch for `[git-provider]` logs
5. **Check results**: 
   - Status should show files
   - File picker should populate
   - Branches should appear

### Console Output Example
```
[git-provider] is-git-repo called on /path/to/repo
[git-provider] git-status called on /path/to/repo
[git-provider] git-tracked-files called on /path/to/repo
[git-provider] git-log-file called on /path/to/repo with filePath src/electron-main.js
```

## Debugging

### Enable Verbose Output
Add logging to command execution:
```javascript
console.log(`Executing: git ${args.join(' ')} in ${cwd}`);
```

### Check Git Installation
```bash
git --version  # Should show git version
```

### Test Individual Commands
```bash
cd /path/to/repo
git status --porcelain
git log --pretty=format:%H%n%h%n%s -n 5
git ls-files
```

## API Reference

### Command Parameters Format
```typescript
interface GitProviderRequest {
  command: string;
  repoPath: string;
  [key: string]: any; // command-specific params
}
```

### Response Format
```typescript
type GitProviderResponse = 
  | boolean
  | string
  | Array<any>
  | { [key: string]: any }
  | { error: string };
```

## Known Limitations

1. **Windows Line Endings**: Git may return CRLF on Windows
2. **Large Files**: No special handling for large outputs
3. **Encoding**: Assumes UTF-8 encoding
4. **Submodules**: Not specifically handled
5. **Worktrees**: See `git worktree`; branch rows use `*` / `+` markers. Always normalize `git branch` output through `electron-main/utils/gitBranchListLine.js` before passing names into git commands or UI pickers. See **[git-branch-parsing.md](./git-branch-parsing.md)** for conventions.
6. **Performance**: Heavy operations block main thread (should be improved)

### Branch list normalization

Electron IPC and scripts share `normalizeGitBranchListLine` (`src/electron-main/utils/gitBranchListLine.js`) so `+ `-prefixed branches checked out elsewhere never leak into destructive commands. Keep new consumers aligned with that helper rather than substring hacks.

## Security Considerations

1. **Input Validation**: repoPath checked but could be more robust
2. **Command Injection**: Safe via execFile (no shell)
3. **Sensitive Data**: Git URLs may contain credentials
4. **Access Control**: No permission checks (Electron has access control)
