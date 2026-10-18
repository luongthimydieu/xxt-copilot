# XXT Copilot final integration check + packaging (ASCII only for PS 5.1 compatibility)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$node = 'C:\Users\18634\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$edgeCandidates = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)
$browser = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

$problems = New-Object System.Collections.Generic.List[string]
$checks = New-Object System.Collections.Generic.List[string]

function Add-CheckResult([bool]$ok, [string]$label) {
  if ($ok) { $checks.Add("PASS $label") }
  else { $problems.Add("FAIL $label"); $checks.Add("FAIL $label") }
}

# 1. Node syntax checks
$jsFiles = @(
  'background.js',
  'content/frames.js',
  'content/net.js',
  'content/parsers.js',
  'content/content.js',
  'dashboard/dashboard.js',
  'dashboard/export.js',
  'tools/test-parsers.js'
)
foreach ($relative in $jsFiles) {
  $full = Join-Path $root $relative
  if (-not (Test-Path $full)) { Add-CheckResult $false "file missing: $relative"; continue }
  $output = & $node --check $full 2>&1
  Add-CheckResult ($LASTEXITCODE -eq 0) "node --check $relative"
  if ($LASTEXITCODE -ne 0) { $checks.Add(($output -join "`n")) }
}

# 2. manifest JSON check via Node (UTF-8 safe)
$manifestPath = Join-Path $root 'manifest.json'
$manifestNode = & $node -e "try{const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[process.argv.length-1],'utf8'));console.log(m.manifest_version===3&&!!m.name?'OK':'BAD')}catch(e){console.log('ERR '+e.message)}" $manifestPath
$manifestResult = (($manifestNode -join '').Trim())
Add-CheckResult ($manifestResult -eq 'OK') "manifest.json parses as MV3 ($manifestResult)"

# 2b. required icons
foreach ($icon in @('icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png')) {
  Add-CheckResult (Test-Path (Join-Path $root $icon)) "icon exists: $icon"
}

# 3. headless browser offline tests
function Invoke-HeadlessPageTest([string]$relativePage, [int]$budgetMs) {
  if (-not $browser) { return @{ ok = $false; detail = 'NO_BROWSER' } }
  $page = Join-Path $root $relativePage
  if (-not (Test-Path $page)) { return @{ ok = $false; detail = 'PAGE_MISSING ' + $page } }
  $url = ([System.Uri]$page).AbsoluteUri
  $lastDetail = 'NO_OUTPUT'
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $profile = Join-Path $env:TEMP ('xxt-final-' + [guid]::NewGuid().ToString('N'))
    $outFile = Join-Path $env:TEMP ('xxt-final-out-' + [guid]::NewGuid().ToString('N') + '.html')
    $errFile = Join-Path $env:TEMP ('xxt-final-err-' + [guid]::NewGuid().ToString('N') + '.log')
    try {
      $process = Start-Process -FilePath $browser -ArgumentList @(
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--allow-file-access-from-files', "--user-data-dir=$profile",
        "--virtual-time-budget=$budgetMs", '--dump-dom', $url
      ) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
      # Edge may return before its child process finishes flushing stdout; poll + retry reading.
      $size = 0
      $html = ''
      for ($i = 0; $i -lt 50; $i++) {
        if (Test-Path $outFile) { $size = (Get-Item $outFile).Length }
        if ($size -gt 500) {
          try {
            $html = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
            if ($html -and $html.Contains('<pre')) { break }
          } catch {
            $html = ''
          }
        }
        Start-Sleep -Milliseconds 200
      }
      $match = [regex]::Match([string]$html, '<pre id="out"[^>]*>([\s\S]*?)</pre>')
      if ($match.Success) {
        $text = $match.Groups[1].Value
        $pass = $text.TrimStart().StartsWith('PASS')
        return @{ ok = $pass; detail = $text }
      }
      $lastDetail = 'NO_OUTPUT (attempt ' + $attempt + ', exit ' + $process.ExitCode + ', size ' + $size + ')'
    } catch {
      $lastDetail = 'EXCEPTION (attempt ' + $attempt + '): ' + $_.Exception.Message
    } finally {
      Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
      Remove-Item -Force $outFile, $errFile -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 800
  }
  return @{ ok = $false; detail = $lastDetail }
}

$parserTest = Invoke-HeadlessPageTest 'tools/parser-test.html' 12000
Add-CheckResult ([bool]$parserTest.ok) 'parser regression test (parser-test.html)'
if (-not $parserTest.ok) { $checks.Add([string]$parserTest.detail) }

$dashboardTest = Invoke-HeadlessPageTest 'tools/dashboard-test.html' 20000
Add-CheckResult ([bool]$dashboardTest.ok) 'dashboard demo end-to-end test (dashboard-test.html)'
if (-not $dashboardTest.ok) { $checks.Add([string]$dashboardTest.detail) }

$fixturePage = Join-Path $root 'tools/parser-fixture-test.html'
if (Test-Path $fixturePage) {
  $fixtureTest = Invoke-HeadlessPageTest 'tools/parser-fixture-test.html' 12000
  Add-CheckResult ([bool]$fixtureTest.ok) 'real review-page parser test (parser-fixture-test.html)'
  if (-not $fixtureTest.ok) { $checks.Add([string]$fixtureTest.detail) }
} else {
  $checks.Add('SKIP real review-page parser test (private fixture not included in public repo)')
}

$cardsPage = Join-Path $root 'tools/cards-fixture-test.html'
if (Test-Path $cardsPage) {
  $cardsTest = Invoke-HeadlessPageTest 'tools/cards-fixture-test.html' 10000
  Add-CheckResult ([bool]$cardsTest.ok) 'cards discovery test (cards-fixture-test.html)'
  if (-not $cardsTest.ok) { $checks.Add([string]$cardsTest.detail) }
} else {
  $checks.Add('SKIP cards discovery test (private fixture not included in public repo)')
}

# 4. pack-extension validation (non-blocking warning)
$crxPath = Join-Path (Split-Path -Parent $root) ((Split-Path -Leaf $root) + '.crx')
$pemPath = Join-Path (Split-Path -Parent $root) ((Split-Path -Leaf $root) + '.pem')
if ($browser) {
  try {
    $packOut = Join-Path $env:TEMP ('xxt-pack-' + [guid]::NewGuid().ToString('N') + '.log')
    $packErr = Join-Path $env:TEMP ('xxt-pack-err-' + [guid]::NewGuid().ToString('N') + '.log')
    Start-Process -FilePath $browser -ArgumentList @(
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      "--pack-extension=`"$root`""
    ) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $packOut -RedirectStandardError $packErr | Out-Null
    if (Test-Path $crxPath) {
      $checks.Add('PASS extension pack check (manifest valid)')
    } else {
      $checks.Add('WARN --pack-extension produced no crx (non-blocking)')
      $packText = (Get-Content $packErr -Raw -ErrorAction SilentlyContinue)
      if ($packText) { $checks.Add(('pack output: ' + $packText.Substring(0, [Math]::Min(400, $packText.Length)))) }
    }
    Remove-Item -Force $packOut, $packErr, $crxPath, $pemPath -ErrorAction SilentlyContinue
  } catch {
    $checks.Add('WARN pack check exception (non-blocking): ' + $_.Exception.Message)
  }
} else {
  $checks.Add('SKIP pack check (no Edge/Chrome found)')
}

# 5. build normal zip + clean store zip
& (Join-Path $root 'tools\package.ps1') -Version '0.1.4'
$zip = Join-Path $root 'dist\xxt-copilot-0.1.4.zip'
Add-CheckResult (Test-Path $zip) 'dist/xxt-copilot-0.1.4.zip generated'

& (Join-Path $root 'tools\package-store.ps1') -Version '0.1.4'
$storeZip = Join-Path $root 'dist\store\xxt-copilot-0.1.4-store.zip'
Add-CheckResult (Test-Path $storeZip) 'dist/store/xxt-copilot-0.1.4-store.zip generated'
if (Test-Path $zip) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $entryNames = $archive.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }
    Add-CheckResult ($entryNames -contains 'manifest.json') 'zip root contains manifest.json'
    Add-CheckResult (($entryNames | Where-Object { $_ -like 'dashboard/dashboard.js' }).Count -eq 1) 'zip contains dashboard/dashboard.js'
    Add-CheckResult (($entryNames | Where-Object { $_ -like 'content/content.js' }).Count -eq 1) 'zip contains content/content.js'
    Add-CheckResult (($entryNames | Where-Object { $_ -like 'README.md' }).Count -eq 1) 'zip contains README.md'
  } finally {
    $archive.Dispose()
  }
}

if (Test-Path $storeZip) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $storeArchive = [System.IO.Compression.ZipFile]::OpenRead($storeZip)
  try {
    $storeNames = $storeArchive.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }
    Add-CheckResult ($storeNames -contains 'manifest.json') 'store zip root contains manifest.json'
    Add-CheckResult (($storeNames | Where-Object { $_ -like 'icons/icon128.png' }).Count -eq 1) 'store zip contains icons/icon128.png'
    Add-CheckResult (-not ($storeNames | Where-Object { $_ -like 'tools/*' -or $_ -like 'docs/*' -or $_ -like 'store-assets/*' })) 'store zip excludes tools/docs/store-assets'
    Add-CheckResult (-not ($storeNames | Where-Object { $_ -like '*xxt-snapshot*' -or $_ -like '*fixtures*' })) 'store zip excludes snapshots/fixtures'
  } finally {
    $storeArchive.Dispose()
  }
}

Write-Output '================ CHECK RESULTS ================'
$checks | ForEach-Object { Write-Output $_ }
Write-Output '==============================================='
if ($problems.Count -gt 0) {
  Write-Output ('CONCLUSION: FAILED ' + $problems.Count)
  exit 1
}
Write-Output 'CONCLUSION: ALL PASS'
