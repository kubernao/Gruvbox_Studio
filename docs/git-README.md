# Version Control Tab - Implementation Guide

## Overview
The Version Control Tab has been successfully converted from Vue to React and is now integrated as Tab 2 in the RightSidebar. This provides Git repository status, file tracking, branch management, and commit history visualization.

## Architecture

### Core Component Hierarchy
```
VersionControlTab (main container)
├── GitStateNotice (no workspace / non-repo states)
├── GitStatusSection (uncommitted changes + GitHub auth)
├── DocumentDropdown (file picker combobox)
├── Scroll Container (for branches + history)
    ├── BranchSection (branch picker + controls)
    └── Git History Section (commit graph - placeholder)
```

### State Management
The main state is managed through a single custom hook `useGitTab()` which provides:
- Repository detection and initialization
- Status, log, branches, and remotes tracking
- GitHub authentication state
- Document/file selection
- IPC communication with main process
- All git operations (refresh, init, etc.)

## File Structure

### Components
- **VersionControlTab.tsx** - Main entry point, orchestrates all sub-components
- **GitStateNotice.tsx** - Handles initial states (no workspace, non-git repo)
- **GitStatusSection.tsx** - Displays uncommitted changes and GitHub auth UI
- **DocumentDropdown.tsx** - Interactive combobox for selecting tracked files
- **BranchSection.tsx** - Branch controls and create overlay

### Hooks
- **useGitTab.ts** - Main reactive state management
  - 50+ state properties
  - 15+ methods for git operations
  - IPC invoke wrapper
  - Computed values (hasGithubRemote, showPublishToGithub, etc.)

### Utilities
- **gitHelpers.ts** - Display formatting (shortPath, shortHash, statusClass, etc.)
- **gitProviderUtils.ts** - IPC result parsing and validation
- **gitGraphUtils.ts** - Graph context builders (extensible for future @gitgraph/js integration)
- **git.ts** - TypeScript type definitions

### Styling
- **VersionControlTab.css** - Complete styling (~1000 lines)
  - Layout and spacing
  - Combobox styling
  - Status badges
  - Branch toolbar
  - GitHub auth row
  - Graph container styles

## Key Features Implemented

### ✅ State Management
- Repo detection and initialization
- Git status monitoring
- Tracked files list
- Branches and remotes tracking
- GitHub authentication state
- Error handling and user feedback

### ✅ UI Components
- Three-state interface (no workspace → initialize repo → full git UI)
- Status list with colored badges (Added, Modified, Deleted)
- File picker combobox with filtering and keyboard navigation
- Branch section with toolbar (create, refresh buttons)
- Document selection with dropdown
- GitHub authentication UI

### ✅ Data Synchronization
- Automatic status refresh on file changes
- IPC communication with main git-provider
- Error messages from git operations
- Loading states

### 📋 Placeholders for Future Work
- Commit graph visualization (@gitgraph/js integration)
- Branch creation dialog (overlay ready)
- Branch picker visual (hub→branches graph)
- Merge conflict handling
- GitHub sync and publish flows

## Usage

### Accessing the Component
The component is automatically available as Tab 2 in the RightSidebar:
```typescript
import VersionControlTab from '../features/versionControl/VersionControlTab';
// Already integrated in RightSidebar.tsx
```

### Direct Hook Usage
For other components needing git state:
```typescript
import { useGitTab } from '../features/versionControl';

const MyComponent = () => {
  const gitTab = useGitTab();
  // Use gitTab.statusEntries, gitTab.selectedDocument, etc.
};
```

## IPC Communication

The tab communicates with the main process through these git-provider commands:
- `git-init` - Initialize a new repository
- `is-git-repo` - Check if path is a git repo
- `git-status` - Get working tree status
- `git-log` - Get repository commit history
- `git-tracked-files` - Get list of tracked files
- `git-log-file` - Get file-specific commit history
- `git-branch-list-for-file` - Get branches that touch a file
- `git-remote-list` - Get configured remotes
- `resolve-git-repo-root` - Resolve worktree root

GitHub authentication commands:
- `github-git-auth-provider` - Get/set GitHub auth status

## Testing

All components have `data-testid` attributes for integration testing:
- `git-tab-root` - Main container
- `git-state-no-workspace` - No workspace notice
- `git-state-non-repo` - Non-repo notice
- `git-status-section` - Status section
- `git-status-list` - Status list
- `git-document-section` - Document picker section
- `git-document-combobox` - Combobox input
- `git-branches-section` - Branch section
- `git-commit-graph-section` - Graph section
- And many more...

## Type Safety

All components and hooks are fully typed with TypeScript:
- Git types in `types/git.ts`
- Component props interfaces
- IPC payload types
- Return type specifications

## Next Steps for Enhancement

1. **Graph Integration** - Connect @gitgraph/js for commit visualization
2. **Branch Operations** - Implement create, delete, switch branch flows
3. **Diff Viewer** - Integration with existing DiffViewer component
4. **GitHub Features** - Implement sync, publish, and auth flows
5. **Keyboard Shortcuts** - Add vim/vscode-style shortcuts
6. **Merge Conflict UI** - Special handling for merge conflicts
7. **Performance** - Virtualize long lists if needed
8. **Caching** - Add git operation result caching

## Troubleshooting

### Component Not Showing
- Check RightSidebar.tsx - Tab 2 should render VersionControlTab
- Verify VersionControlTab import path
- Check browser console for errors

### Git Operations Failing
- Verify IPC channel names match main process
- Check main process git-provider implementation
- Look for error messages in `branchError`, `repoWideLogError`, etc.

### IPC Errors
- Ensure `window.ipc` is available
- Check main process event handlers
- Verify command names and payloads match expected format

## Code Style Notes

- React Hooks for state management (no Redux/Zustand)
- Functional components throughout
- Callback memoization with useCallback
- Proper TypeScript strict mode compliance
- CSS modules naming convention (BEM-like)
- Comprehensive error handling
- Accessible components (ARIA labels, roles)
