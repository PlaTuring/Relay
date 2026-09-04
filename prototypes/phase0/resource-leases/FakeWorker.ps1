[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][string]$EventDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Name,
    [ValidateSet('hold', 'reverse-order')][string]$Action = 'hold',

    [Parameter(Mandatory = $true)]
    [ValidateSet('artifact', 'volume', 'runtime', 'gpu', 'project-run')]
    [string]$ResourceType,
    [Parameter(Mandatory = $true)][string]$ResourceKey,
    [Parameter(Mandatory = $true)]
    [ValidateSet('write', 'reserve', 'read', 'exclusive')]
    [string]$Mode,
    [long]$Bytes = 0,
    [long]$CapacityBytes = 0,
    [ValidateRange(0, 60000)][int]$TimeoutMilliseconds = 5000,
    [ValidateRange(0, 60000)][int]$HoldMilliseconds = 0,

    [ValidateSet('artifact', 'volume', 'runtime', 'gpu', 'project-run')]
    [string]$SecondResourceType,
    [string]$SecondResourceKey,
    [ValidateSet('write', 'reserve', 'read', 'exclusive')]
    [string]$SecondMode,
    [long]$SecondBytes = 0,
    [long]$SecondCapacityBytes = 0
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-WorkerEvent {
    param(
        [Parameter(Mandatory = $true)][string]$Phase,
        [Parameter(Mandatory = $true)][hashtable]$Data
    )

    if (-not [System.IO.Directory]::Exists($EventDirectory)) {
        [void][System.IO.Directory]::CreateDirectory($EventDirectory)
    }
    $record = [ordered]@{
        worker     = $Name
        phase      = $Phase
        pid        = [int]$PID
        atUtc      = [DateTime]::UtcNow.ToString('o')
        atUtcTicks = [DateTime]::UtcNow.Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }
    foreach ($key in $Data.Keys) { $record[$key] = $Data[$key] }

    $target = [System.IO.Path]::Combine($EventDirectory, "$Name.$Phase.json")
    $temporary = "$target.$PID.tmp"
    $json = [pscustomobject]$record | ConvertTo-Json -Depth 8
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
    if ([System.IO.File]::Exists($target)) {
        [System.IO.File]::Replace($temporary, $target, $null)
    }
    else {
        [System.IO.File]::Move($temporary, $target)
    }
}

$modulePath = Join-Path $PSScriptRoot 'ResourceLeases.psm1'
try {
    Import-Module -Name $modulePath -Force -DisableNameChecking -ErrorAction Stop
    $owner = New-ResourceLeaseOwner
    Write-WorkerEvent -Phase 'started' -Data @{
        action = $Action; resourceType = $ResourceType; resourceKey = $ResourceKey; mode = $Mode
    }

    $first = Acquire-ResourceLease `
        -StateRoot $StateRoot -Owner $owner -ResourceType $ResourceType `
        -ResourceKey $ResourceKey -Mode $Mode -Bytes $Bytes -CapacityBytes $CapacityBytes `
        -TimeoutMilliseconds $TimeoutMilliseconds -PollMilliseconds 20

    if (-not $first.success) {
        Write-WorkerEvent -Phase 'result' -Data @{
            success = $false; status = $first.status; waitedMilliseconds = $first.waitedMilliseconds
            reclaimedStaleCount = $first.reclaimedStaleCount; detail = $first.detail
        }
        exit 3
    }

    Write-WorkerEvent -Phase 'acquired' -Data @{
        status = $first.status; leaseId = $first.lease.leaseId
        waitedMilliseconds = $first.waitedMilliseconds; reclaimedStaleCount = $first.reclaimedStaleCount
        resourceType = $first.lease.resourceType; resourceKey = $first.lease.resourceKey; mode = $first.lease.mode
    }

    if ($Action -eq 'reverse-order') {
        if ([string]::IsNullOrWhiteSpace($SecondResourceType) -or
            [string]::IsNullOrWhiteSpace($SecondResourceKey) -or
            [string]::IsNullOrWhiteSpace($SecondMode)) {
            throw 'reverse-order requires the second resource type, key, and mode.'
        }

        $second = Acquire-ResourceLease `
            -StateRoot $StateRoot -Owner $owner -ResourceType $SecondResourceType `
            -ResourceKey $SecondResourceKey -Mode $SecondMode `
            -Bytes $SecondBytes -CapacityBytes $SecondCapacityBytes `
            -TimeoutMilliseconds $TimeoutMilliseconds -PollMilliseconds 20
        Write-WorkerEvent -Phase 'second' -Data @{
            success = $second.success; status = $second.status
            waitedMilliseconds = $second.waitedMilliseconds; detail = $second.detail
        }

        [void](Release-ResourceLease -StateRoot $StateRoot -Owner $owner -LeaseId $first.lease.leaseId)
        Write-WorkerEvent -Phase 'released' -Data @{ leaseId = $first.lease.leaseId }
        $expected = (-not $second.success -and $second.status -eq 'order-violation')
        Write-WorkerEvent -Phase 'result' -Data @{
            success = $expected; status = if ($expected) { 'expected-order-violation' } else { 'unexpected-second-result' }
            firstStatus = $first.status; secondStatus = $second.status
            secondWaitedMilliseconds = $second.waitedMilliseconds
        }
        if ($expected) { exit 0 }
        exit 4
    }

    if ($HoldMilliseconds -gt 0) {
        Start-Sleep -Milliseconds $HoldMilliseconds
    }

    $release = Release-ResourceLease -StateRoot $StateRoot -Owner $owner -LeaseId $first.lease.leaseId
    Write-WorkerEvent -Phase 'released' -Data @{
        leaseId = $first.lease.leaseId; releasedCount = $release.releasedCount
    }
    Write-WorkerEvent -Phase 'result' -Data @{
        success = $true; status = 'completed'; acquireStatus = $first.status
        waitedMilliseconds = $first.waitedMilliseconds; reclaimedStaleCount = $first.reclaimedStaleCount
    }
    exit 0
}
catch {
    try {
        Write-WorkerEvent -Phase 'result' -Data @{
            success = $false; status = 'worker-error'; detail = $_.Exception.Message
        }
    }
    catch {
        # The worker still exits non-zero if even its isolated event file cannot be written.
    }
    exit 10
}
