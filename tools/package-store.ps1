# XXT Copilot store packaging (ASCII only for PS 5.1 compatibility)
# Builds a clean zip suitable for Microsoft Edge Add-ons / Chrome Web Store:
#   - manifest.json at zip root
#   - only extension runtime files (no docs/tools/fixtures/snapshots)
# Usage:
#   pwsh -File tools/package-store.ps1 -Version 0.1.4

param(
  [string]$Version = '0.1.4'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist\store'
$zip = Join-Path $dist "xxt-copilot-$Version-store.zip"

$required = @('manifest.json', 'background.js', 'content', 'dashboard', 'icons')
$missing = $required | Where-Object { -not (Test-Path (Join-Path $root $_)) }
if ($missing.Count -gt 0) {
  throw ("missing extension files: " + ($missing -join ', '))
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }

$items = @(
  'manifest.json',
  'background.js',
  'content',
  'dashboard',
  'icons'
) | ForEach-Object { Join-Path $root $_ }

Compress-Archive -Path $items -DestinationPath $zip -CompressionLevel Optimal
Write-Output "created: $zip"
Write-Output "Upload this zip as the extension package (manifest.json is at the zip root)."
