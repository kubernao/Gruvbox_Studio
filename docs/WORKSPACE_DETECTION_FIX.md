# Workspace Detection Fix - Version Control Tab

## Problem
The Version Control Tab was showing "Open a workspace folder to use version control" even when a directory with a `.git` folder was open, because the component's `repoPath` was not being initialized from the application's workspace state.

## Root Cause
1. **Missing Workspace Connection**: The `useGitTab` hook initialized `repoPath` as an empty string with no way to get the actual workspace root from the app's state.
2. **Missing IPC Handlers**: The main process did not have `git-provider` and `github-git-auth-provider` IPC handlers implemented, so all git operations were silently failing.
3. **Lost Context Integration**: The component was not accessing the FileExplorer's context to know what workspace was currently open.

## Solution Implemented

### 1. Connected Version Control Tab to FileExplorer Context
**File: `VersionControlTab.tsx`**
```typescript
const fileExplorerContext = useContext(FileExplorerContext);
const workspaceRoot = fileExplorerContext?.rootPath || '';

// Update repo path when workspace changes
useEffect(() => {
  if (workspaceRoot && gitTab.repoPath !== workspaceRoot) {
    gitTab.setRepoPath(workspaceRoot);
  }
}, [workspaceRoot, gitTab.repoPath, gitTab]);
```

This ensures that whenever the FileExplorer's root path changes (user opens a folder), the Version Control Tab automatically updates its repository path.

### 2. Added Git Provider IPC Handlers
**File: `src/electron-main/main.js`**

Added two new IPC handler groups:

#### `git-provider` Handler
Implements basic git operations:
- **`is-git-repo`**: Checks if `.git` directory exists in the path
- **`resolve-git-repo-root`**: Returns the repository root path
- **`git-status`, `git-log`, `git-tracked-files`, etc.**: Stub implementations (ready for real git command execution)

```javascript
ipcMain.handle('git-provider', async (event, { command, repoPath, ...payload }) => {
  // Implementation with:
  // - fs.existsSync() to check for .git
  // - Proper error handling
  // - Stubs for commands needing full git integration
});
```

#### `github-git-auth-provider` Handler
Implements GitHub authentication:
- **`get-status`**: Returns GitHub auth status (currently returns not_configured)
- **`logout`**: Handles logout

```javascript
ipcMain.handle('github-git-auth-provider', async (event, { command, payload }) => {
  // Implementation for GitHub auth operations
});
```

### 3. Improved State Management
**File: `useGitTab.ts`**
- Removed `getWorkspaceRoot()` function (now handled by FileExplorer integration)
- Kept reactive state updates that respond to `repoPath` changes
- Maintained proper error handling for failed IPC calls

## How It Works Now

1. **User opens a folder** in the FileExplorer
2. **FileExplorer context updates** its `rootPath`
3. **VersionControlTab listens** to FileExplorer context changes
4. **Workspace path is synced** to `useGitTab` hook
5. **IPC check is performed** via `git-provider is-git-repo` command
6. **UI updates** based on git repo detection:
   - If no folder: "Open a workspace folder to use version control"
   - If folder but not git repo: "This folder is not yet tracked..."
   - If git repo: Shows status, files, branches, etc.

## Diagram

```
FileExplorer (opens folder)
    ↓
FileExplorerContext updates rootPath
    ↓
VersionControlTab listens to context change
    ↓
setRepoPath(workspaceRoot)
    ↓
useGitTab.checkRepo() triggered
    ↓
IPC: git-provider is-git-repo
    ↓
Main process checks fs.existsSync(.git)
    ↓
Result returned to component
    ↓
UI renders appropriate state
```

## Testing Checklist

- [x] App starts successfully with handlers
- [x] No TypeScript errors
- [x] FileExplorer integration compiles
- [x] IPC handlers are properly registered
- [x] Error handling works gracefully
- [ ] Open folder → Version Control shows "Open a workspace"
- [ ] Open folder with .git → Version Control detects repo
- [ ] Open folder without .git → Shows "Start tracking this folder"
- [ ] Switch folders → Detection updates accordingly

## Files Modified

1. **`src/renderer/features/versionControl/VersionControlTab.tsx`**
   - Added FileExplorer context import
   - Added workspace root detection
   - Added effect to sync workspace path

2. **`src/renderer/features/versionControl/hooks/useGitTab.ts`**
   - Removed getWorkspaceRoot() function
   - Simplified initialization (now done in VersionControlTab)
   - Kept all git operation methods intact

3. **`src/electron-main/main.js`** (NEW)
   - Added `git-provider` IPC handler
   - Added `github-git-auth-provider` IPC handler
   - Uses Node's `fs` module to check for `.git` existence
   - Includes console logging for debugging

## Next Steps for Full Git Integration

To implement actual git commands (beyond just detecting repo existence):

1. Use Node's `child_process.exec()` to run git commands:
   ```javascript
   const { exec } = require('child_process');
   // Run: git status, git log, etc.
   ```

2. Or use a Node git library like `simple-git`:
   ```javascript
   const SimpleGit = require('simple-git');
   const git = SimpleGit(repoPath);
   ```

3. Update each git command handler to return real data instead of stubs

## Debugging

To debug workspace detection:

1. **Check browser console**: Look for `[git-provider] is-git-repo called on ...` messages
2. **Check Electron console**: Should show IPC handler logs
3. **Verify FileExplorer**: Confirm that rootPath is updating when folder is opened
4. **Check .git existence**: Manually verify `.git` folder exists in the target directory

## Known Limitations

- Git commands are stubbed (return empty results)
- Full git operation implementation requires additional work
- GitHub auth is stubbed
- No actual git status/log/branch data yet

All of these are architecturally ready for implementation - the IPC structure is in place.
