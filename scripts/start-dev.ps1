param(
  [ValidateSet('backend', 'frontend')]
  [string]$Service
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

function Get-ToolPath {
  param([string]$Name)
  $tool = Get-Command -Name $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
  if (-not $tool -or -not $tool.Source) {
    throw "找不到 $Name；請確認 Node.js 已安裝且命令位於 PATH。"
  }
  return $tool.Source
}

function Get-PortOwner {
  param([int]$Port)
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) {
    return $null
  }
  $ownerPids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($ownerPids.Count -ne 1) {
    throw "埠 $Port 有多個監聽程序，請先檢查。"
  }
  $ownerPid = [int]$ownerPids[0]
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$ownerPid" -ErrorAction Stop
  if (-not $owner) {
    throw "無法辨識埠 $Port 的監聽程序 PID $ownerPid。"
  }
  return $owner
}

function Assert-ExpectedOwner {
  param([int]$Port, [object]$Owner)
  if (-not $Owner) {
    return
  }
  $expected = if ($Port -eq 3001) { 'vercel' } else { 'vite' }
  if ($Owner.Name -ne 'node.exe' -or $Owner.CommandLine -notmatch $expected) {
    throw "埠 $Port 已由其他程序 PID $($Owner.ProcessId) 占用；不會覆蓋或停止它。"
  }
}

function Get-HttpStatus {
  param([string]$Uri)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 8
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }
    return 0
  }
}

if ($Service) {
  Set-Location -LiteralPath $repoRoot
  try {
    if ($Service -eq 'backend') {
      Write-Host '啟動後端：Vercel dev（3001）'
      & (Get-ToolPath 'npx.cmd') vercel dev --listen 3001
    } else {
      Write-Host '啟動前端：Vite（3000）'
      & (Get-ToolPath 'npm.cmd') run dev
    }
    exit [int]$LASTEXITCODE
  } catch {
    Write-Error $_.Exception.Message
    exit 1
  }
}

try {
  # 受限執行環境可能開出視窗，卻讓視窗內的命令立即失敗。先確認可查主機程序。
  try {
    $self = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop
  } catch {
    throw '無法查詢主機程序；請在這台電腦的 PowerShell 執行 start-dev。'
  }
  if (-not $self) {
    throw '無法取得目前 PowerShell 的主機程序。'
  }

  $envPath = Join-Path $repoRoot '.env'
  if (-not (Test-Path -LiteralPath $envPath)) {
    throw '專案根目錄缺少 .env。'
  }
  $envNames = @(Get-Content -LiteralPath $envPath -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=') { $matches[1] }
  })
  $required = @('GEMINI_API_KEY', 'GEMINI_MODEL_FAST', 'GEMINI_MODEL_THINKING', 'ALLOWED_ORIGIN')
  $missing = @($required | Where-Object { $envNames -notcontains $_ })
  if ($missing.Count -gt 0) {
    throw "缺少必要環境變數名稱：$($missing -join ', ')。"
  }

  $null = Get-ToolPath 'npx.cmd'
  $null = Get-ToolPath 'npm.cmd'

  $backendOwner = Get-PortOwner 3001
  $frontendOwner = Get-PortOwner 3000
  Assert-ExpectedOwner 3001 $backendOwner
  Assert-ExpectedOwner 3000 $frontendOwner

  $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  foreach ($serviceName in @('backend', 'frontend')) {
    if (($serviceName -eq 'backend' -and $backendOwner) -or
        ($serviceName -eq 'frontend' -and $frontendOwner)) {
      continue
    }
    $arguments = '-NoExit -NoProfile -ExecutionPolicy RemoteSigned -File "{0}" -Service {1}' -f $PSCommandPath, $serviceName
    $window = Start-Process -FilePath $powershellPath -WorkingDirectory $repoRoot `
      -ArgumentList $arguments -WindowStyle Normal -PassThru
    Write-Host "已開啟 $serviceName PowerShell 視窗（PID $($window.Id)）。"
  }

  $deadline = (Get-Date).AddSeconds(90)
  do {
    $backendReady = [bool](Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue)
    $frontendReady = [bool](Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)
    if ($backendReady -and $frontendReady) { break }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)

  if (-not ($backendReady -and $frontendReady)) {
    throw "等待 90 秒後仍未就緒：後端 3001=$backendReady、前端 3000=$frontendReady。請看兩個 PowerShell 視窗的錯誤訊息。"
  }

  Assert-ExpectedOwner 3001 (Get-PortOwner 3001)
  Assert-ExpectedOwner 3000 (Get-PortOwner 3000)
  $frontendStatus = Get-HttpStatus 'http://localhost:3000/'
  $backendStatus = Get-HttpStatus 'http://localhost:3001/'
  if ($frontendStatus -ne 200 -or $backendStatus -eq 0 -or $backendStatus -ge 500) {
    throw "埠已監聽，但 HTTP 尚未正常回應：前端=$frontendStatus、後端=$backendStatus。請看 PowerShell 視窗的日誌。"
  }

  Write-Host "就緒：前端 3000（HTTP $frontendStatus）、後端 3001（HTTP $backendStatus）。"
  Write-Host '瀏覽器開啟 http://localhost:3000'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
