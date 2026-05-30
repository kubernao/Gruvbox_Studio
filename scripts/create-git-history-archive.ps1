param(
    [string]$BaseBranch = "main"
)

$ErrorActionPreference = "Stop"

$resolvedBaseBranch = $BaseBranch
git rev-parse --verify --quiet $resolvedBaseBranch *> $null
if ($LASTEXITCODE -ne 0 -and $BaseBranch -eq "main") {
    git rev-parse --verify --quiet master *> $null
    if ($LASTEXITCODE -eq 0) {
        $resolvedBaseBranch = "master"
        Write-Host "Base branch 'main' not found; using 'master' instead."
    }
}
if ($LASTEXITCODE -ne 0) {
    throw "Base branch '$BaseBranch' was not found."
}

$dateStamp = Get-Date -Format "yyyy-MM-dd"
$archiveBranch = "archive/$resolvedBaseBranch-$dateStamp"
$archiveTag = "archive-pre-cleanup-$dateStamp"

Write-Host "Creating archive refs from '$resolvedBaseBranch'..."

git show-ref --verify --quiet "refs/heads/$archiveBranch"
$branchExists = $LASTEXITCODE -eq 0
if (-not $branchExists) {
    git branch $archiveBranch $resolvedBaseBranch
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create archive branch '$archiveBranch'."
    }
    Write-Host "Created branch: $archiveBranch"
} else {
    Write-Host "Branch already exists: $archiveBranch"
}

git show-ref --verify --quiet "refs/tags/$archiveTag"
$tagExists = $LASTEXITCODE -eq 0
if (-not $tagExists) {
    git tag $archiveTag $resolvedBaseBranch
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create archive tag '$archiveTag'."
    }
    Write-Host "Created tag: $archiveTag"
} else {
    Write-Host "Tag already exists: $archiveTag"
}

Write-Host ""
Write-Host "Archive snapshot complete."
Write-Host "Next steps:"
Write-Host "  git push origin $archiveBranch"
Write-Host "  git push origin $archiveTag"
