# PowerShell script to automatically sync program IDs from keypairs to source code
# This updates the declare_id!() macros in lib.rs files

Write-Host "🔄 Syncing program IDs from keypairs to source code..." -ForegroundColor Cyan
Write-Host ""

# Navigate to project root
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptPath "..")

# Use Anchor's built-in keys sync command
# This automatically updates declare_id!() in source files based on Anchor.toml
anchor keys sync

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Program IDs synced successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Updated program IDs:"
    $anchorToml = Get-Content "Anchor.toml" -Raw
    if ($anchorToml -match 'governance = "([^"]+)"') {
        Write-Host "  - governance: $($matches[1])"
    }
    if ($anchorToml -match 'spl_project = "([^"]+)"') {
        Write-Host "  - spl_project: $($matches[1])"
    }
    if ($anchorToml -match 'presale = "([^"]+)"') {
        Write-Host "  - presale: $($matches[1])"
    }
} else {
    Write-Host ""
    Write-Host "❌ Failed to sync program IDs" -ForegroundColor Red
    exit 1
}

