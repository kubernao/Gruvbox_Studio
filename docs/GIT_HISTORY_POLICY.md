# Git History Preservation Policy

## Goal
Preserve all historical changes while keeping future integration predictable and recoverable.

## Non-Rewrite Rules
- Do not rewrite published branch history (`main`, release branches, or any shared branch).
- Do not force-push to protected branches.
- Do not run `git rebase -i`, `git commit --amend`, or history-filtering commands on already-pushed shared branches.
- If a commit is wrong, create a new correcting commit or revert commit.

## Branch Protection Baseline
Apply these settings in your remote host (GitHub/GitLab/etc.) for `main`:
- Block force pushes.
- Block branch deletion.
- Require pull requests for `main`.
- Require at least one status check before merge.

## Default Integration Mode
This repository defaults to **maximum preservation mode**:
- Merge feature branches into `main` with `--no-ff`.
- Keep all feature-branch commits and commit boundaries intact.

Example:
```powershell
git checkout main
git pull
git merge --no-ff feature/my-change
```

## Archive Snapshot Process (Before Risky Operations)
Before any operation that could alter commit topology (rebases on local-only branches, bulk branch cleanup, or experimental rewrites), create archival refs:

```powershell
.\scripts\create-git-history-archive.ps1
```

This creates:
- Branch: `archive/main-YYYY-MM-DD`
- Tag: `archive-pre-cleanup-YYYY-MM-DD`

Push archives to remote for durable recovery:
```powershell
git push origin archive/main-YYYY-MM-DD
git push origin archive-pre-cleanup-YYYY-MM-DD
```

## Recovery Playbook
- Inspect recent ref movements:
  ```powershell
  git reflog --date=iso
  ```
- Recover a lost tip into a branch:
  ```powershell
  git checkout -b recovery/<name> <reflog-or-commit-sha>
  ```
- Restore from archive snapshot:
  ```powershell
  git checkout archive/main-YYYY-MM-DD
  git checkout -b recovery/from-archive
  ```
- Verify references:
  ```powershell
  git show-ref --heads --tags | Select-String "archive/"
  ```

## Weekly Audit Checklist
- `main` has no force-push events in remote audit logs.
- Latest archive branch/tag exists locally and on remote.
- `git fsck --no-reflogs` reports no integrity issues.
- Recovery commands are still valid in CI/dev environment.
