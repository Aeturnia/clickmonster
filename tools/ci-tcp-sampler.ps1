# Windows CI M2 (docs/ci-windows-reliability-plan.md, section 4): the runner's TCP table, for the
# browser job's ERR_NO_BUFFER_SPACE investigation. Observation only: it reads the TCP table and the
# dynamic port range, and writes aggregate counts. It changes no setting, opens no connection, and
# never prints addresses or ports of individual connections.
#
#   -Mode snapshot -Label start|end   one line, with the dynamic port ranges and the runner image
#   -Mode loop                        a line every -IntervalSeconds, until the stop file appears
#                                     (<Out>/stop) or -MaxMinutes pass, then a closing line with the
#                                     sampler's own CPU time (its overhead)
#
# Output: <Out>/tcp.jsonl, one JSON object per line, each with a UTC timestamp ("t"), so it can be
# lined up with the M1/M3 metrics (tests/ui/artifacts/metrics/, "endedAt") and a failure's diag.json
# ("capturedAt"). Counts are by TCP state, for the whole machine ("all") and for connections whose
# local address is the loopback ("loopback", 127.0.0.1 or ::1): the harness's server and Chromium's
# connections to it are all on the loopback.
# Runs on Windows PowerShell 5.1 and PowerShell 7.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [ValidateSet('loop', 'snapshot')][string]$Mode = 'loop',
  [string]$Label = 'sample',
  [int]$IntervalSeconds = 5,
  [int]$MaxMinutes = 35
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$file = Join-Path $Out 'tcp.jsonl'
$stopFile = Join-Path $Out 'stop'
$loopback = @('127.0.0.1', '::1')

function Get-StateCounts($connections) {
  $h = [ordered]@{}
  foreach ($g in ($connections | Group-Object -Property State | Sort-Object -Property Name)) { $h[[string]$g.Name] = $g.Count }
  return $h
}
function Get-TcpSample([string]$kind) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $rec = [ordered]@{ kind = $kind; t = (Get-Date).ToUniversalTime().ToString('o') }
  try {
    $all = @(Get-NetTCPConnection -ErrorAction Stop)
    $lb = @($all | Where-Object { $loopback -contains $_.LocalAddress })
    $rec.all = [ordered]@{ total = $all.Count; byState = (Get-StateCounts $all) }
    $rec.loopback = [ordered]@{ total = $lb.Count; byState = (Get-StateCounts $lb) }
  } catch {
    $rec.error = $_.Exception.Message
  }
  $rec.sampleMs = [int]$sw.ElapsedMilliseconds
  return $rec
}
function Get-DynamicPorts([string]$family) {
  $text = (netsh int $family show dynamicport tcp | Out-String)
  $start = if ($text -match 'Start Port\s*:\s*(\d+)') { [int]$Matches[1] } else { $null }
  $count = if ($text -match 'Number of Ports\s*:\s*(\d+)') { [int]$Matches[1] } else { $null }
  return [ordered]@{ startPort = $start; numberOfPorts = $count }
}
# One line, UTF-8 without a byte-order mark, appended.
function Write-JsonLine($obj) {
  [IO.File]::AppendAllText($file, (($obj | ConvertTo-Json -Compress -Depth 6) + "`n"))
}

if ($Mode -eq 'snapshot') {
  $s = Get-TcpSample $Label
  try { $s.dynamicPorts = [ordered]@{ ipv4 = (Get-DynamicPorts 'ipv4'); ipv6 = (Get-DynamicPorts 'ipv6') } } catch { $s.dynamicPortsError = $_.Exception.Message }
  $s.runner = [ordered]@{ os = $env:RUNNER_OS; image = $env:ImageOS; imageVersion = $env:ImageVersion }
  Write-JsonLine $s
  exit 0
}

$deadline = (Get-Date).AddMinutes($MaxMinutes)
$samples = 0
while (-not (Test-Path -LiteralPath $stopFile) -and (Get-Date) -lt $deadline) {
  try { Write-JsonLine (Get-TcpSample 'sample'); $samples++ } catch { }
  Start-Sleep -Seconds $IntervalSeconds
}
$me = Get-Process -Id $PID
$reason = if (Test-Path -LiteralPath $stopFile) { 'stop file' } else { 'time limit' }
Write-JsonLine ([ordered]@{
  kind = 'sampler done'; t = (Get-Date).ToUniversalTime().ToString('o'); reason = $reason; samples = $samples
  intervalSeconds = $IntervalSeconds; cpuSeconds = [math]::Round($me.TotalProcessorTime.TotalSeconds, 2); workingSetMB = [math]::Round($me.WorkingSet64 / 1MB)
})
