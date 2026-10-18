# XXT Copilot packaging script (ASCII only for PS 5.1 compatibility)
# Produces a zip whose root contains manifest.json, so users can unzip and
# "Load unpacked" the extracted folder.
param(
  [string]$Version = '0.1.4'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$zip = Join-Path $dist "xxt-copilot-$Version.zip"

if (-not (Test-Path (Join-Path $root 'manifest.json'))) {
  throw "manifest.json not found: $root"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }

$items = @(
  'manifest.json',
  'background.js',
  'content',
  'dashboard',
  'icons',
  'README.md',
  'INSTALL.md',
  'docs'
) | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }

Compress-Archive -Path $items -DestinationPath $zip -CompressionLevel Optimal
Write-Output "created: $zip"
