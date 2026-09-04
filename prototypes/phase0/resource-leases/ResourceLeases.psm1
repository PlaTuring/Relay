Set-StrictMode -Version 2.0

$script:LeaseSchemaVersion = 1
$script:ResourceRanks = @{
    'artifact'    = 10
    'volume'      = 20
    'runtime'     = 30
    'gpu'         = 40
    'project-run' = 50
}

function Get-CurrentProcessStartTicks {
    $process = [System.Diagnostics.Process]::GetCurrentProcess()
    try {
        return $process.StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)
    }
    finally {
        $process.Dispose()
    }
}

function New-ResourceLeaseOwner {
    [CmdletBinding()]
    param()

    [pscustomobject]@{
        ownerToken                 = [Guid]::NewGuid().ToString('N')
        pid                        = [int]$PID
        processStartUtcTicks       = Get-CurrentProcessStartTicks
    }
}

function Assert-CurrentOwner {
    param([Parameter(Mandatory = $true)]$Owner)

    $required = @('ownerToken', 'pid', 'processStartUtcTicks')
    foreach ($name in $required) {
        if ($Owner.PSObject.Properties.Name -notcontains $name) {
            throw "Owner is missing '$name'."
        }
    }

    if ([string]$Owner.ownerToken -notmatch '^[0-9a-fA-F]{32}$') {
        throw 'Owner token must be a 32-character GUID token.'
    }
    if ([int]$Owner.pid -ne [int]$PID) {
        throw 'An owner can only be used by the process that created it.'
    }
    if ([string]$Owner.processStartUtcTicks -ne (Get-CurrentProcessStartTicks)) {
        throw 'Owner PID creation identity does not match the current process.'
    }
}

function Get-NormalizedResourceKey {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('artifact', 'volume', 'runtime', 'gpu', 'project-run')]
        [string]$ResourceType,

        [Parameter(Mandatory = $true)]
        [string]$ResourceKey
    )

    $trimmed = $ResourceKey.Trim()
    switch ($ResourceType) {
        'artifact' {
            if ($trimmed -notmatch '^[0-9a-fA-F]{64}$') {
                throw 'Artifact keys must be a full 64-character SHA-256 digest.'
            }
            return $trimmed.ToLowerInvariant()
        }
        'gpu' {
            if ($trimmed -notmatch '^[0-9a-fA-F]{8}:[0-9a-fA-F]{8}$') {
                throw 'GPU keys must be a normalized fake/real LUID such as 00000000:00000001.'
            }
            return $trimmed.ToUpperInvariant()
        }
        default {
            if ($trimmed -notmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') {
                throw "Resource key '$trimmed' is not a valid opaque identifier. Paths are not accepted."
            }
            return $trimmed.ToLowerInvariant()
        }
    }
}

function Assert-LeaseRequest {
    param(
        [string]$ResourceType,
        [string]$Mode,
        [long]$Bytes,
        [long]$CapacityBytes
    )

    $allowedMode = switch ($ResourceType) {
        'artifact'    { 'write' }
        'volume'      { 'reserve' }
        'runtime'     { @('read', 'write') }
        'gpu'         { 'exclusive' }
        'project-run' { 'exclusive' }
    }

    if ($allowedMode -notcontains $Mode) {
        throw "Mode '$Mode' is invalid for resource type '$ResourceType'."
    }

    if ($ResourceType -eq 'volume') {
        if ($Bytes -le 0) { throw 'A volume reservation must request more than zero bytes.' }
        if ($CapacityBytes -le 0) { throw 'A volume reservation must declare a positive capacity.' }
        if ($Bytes -gt $CapacityBytes) { throw 'Requested volume bytes exceed declared capacity.' }
    }
    elseif ($Bytes -ne 0 -or $CapacityBytes -ne 0) {
        throw 'Bytes and CapacityBytes are only valid for volume reservations.'
    }
}

function Get-StatePaths {
    param([Parameter(Mandatory = $true)][string]$StateRoot)

    $fullRoot = [System.IO.Path]::GetFullPath($StateRoot)
    if (-not [System.IO.Directory]::Exists($fullRoot)) {
        [void][System.IO.Directory]::CreateDirectory($fullRoot)
    }

    [pscustomobject]@{
        root   = $fullRoot
        ledger = [System.IO.Path]::Combine($fullRoot, 'resource-leases.json')
    }
}

function Get-CoordinatorMutexName {
    param([Parameter(Mandatory = $true)][string]$StateRoot)

    $canonical = [System.IO.Path]::GetFullPath($StateRoot).TrimEnd('\').ToLowerInvariant()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($canonical)
        $digest = $sha.ComputeHash($bytes)
        $hex = ([System.BitConverter]::ToString($digest)).Replace('-', '').Substring(0, 32)
        return "Local\MiniMaxH3.ResourceLeases.$hex"
    }
    finally {
        $sha.Dispose()
    }
}

function New-CoordinatorMutex {
    param([Parameter(Mandatory = $true)][string]$StateRoot)

    $name = Get-CoordinatorMutexName -StateRoot $StateRoot
    return New-Object -TypeName System.Threading.Mutex -ArgumentList @($false, $name)
}

function Enter-CoordinatorMutex {
    param(
        [Parameter(Mandatory = $true)][System.Threading.Mutex]$Mutex,
        [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
    )

    try {
        return $Mutex.WaitOne($TimeoutMilliseconds)
    }
    catch [System.Threading.AbandonedMutexException] {
        # WaitOne grants ownership before raising this exception. The JSON ledger,
        # not abandoned mutex state, remains the source of truth.
        return $true
    }
}

function New-EmptyLedger {
    [pscustomobject]@{
        schemaVersion = $script:LeaseSchemaVersion
        revision      = [long]0
        leases        = @()
    }
}

function Assert-LedgerShape {
    param([Parameter(Mandatory = $true)]$Ledger)

    foreach ($name in @('schemaVersion', 'revision', 'leases')) {
        if ($Ledger.PSObject.Properties.Name -notcontains $name) {
            throw "Lease ledger is malformed: missing '$name'."
        }
    }
    if ([int]$Ledger.schemaVersion -ne $script:LeaseSchemaVersion) {
        throw "Unsupported lease ledger schema version '$($Ledger.schemaVersion)'."
    }

    $requiredLeaseFields = @(
        'leaseId', 'resourceType', 'resourceKey', 'mode', 'bytes', 'capacityBytes',
        'ownerToken', 'ownerPid', 'ownerProcessStartUtcTicks', 'acquiredAtUtc'
    )
    foreach ($lease in @($Ledger.leases)) {
        foreach ($name in $requiredLeaseFields) {
            if ($lease.PSObject.Properties.Name -notcontains $name) {
                throw "Lease ledger is malformed: a lease is missing '$name'."
            }
        }
        if ([string]$lease.leaseId -notmatch '^[0-9a-fA-F]{32}$') {
            throw 'Lease ledger is malformed: invalid leaseId.'
        }
        if ([string]$lease.ownerToken -notmatch '^[0-9a-fA-F]{32}$') {
            throw 'Lease ledger is malformed: invalid ownerToken.'
        }
        if ([int]$lease.ownerPid -le 0 -or [string]$lease.ownerProcessStartUtcTicks -notmatch '^\d+$') {
            throw 'Lease ledger is malformed: invalid owner process identity.'
        }

        $type = [string]$lease.resourceType
        if ($script:ResourceRanks.Keys -notcontains $type) {
            throw "Lease ledger is malformed: unknown resource type '$type'."
        }
        $normalized = Get-NormalizedResourceKey -ResourceType $type -ResourceKey ([string]$lease.resourceKey)
        if ($normalized -cne [string]$lease.resourceKey) {
            throw 'Lease ledger is malformed: resource key is not canonical.'
        }
        Assert-LeaseRequest -ResourceType $type -Mode ([string]$lease.mode) -Bytes ([long]$lease.bytes) -CapacityBytes ([long]$lease.capacityBytes)
    }
}

function Read-LeaseLedger {
    param([Parameter(Mandatory = $true)][string]$LedgerPath)

    if (-not [System.IO.File]::Exists($LedgerPath)) {
        return New-EmptyLedger
    }

    try {
        $json = [System.IO.File]::ReadAllText($LedgerPath, [System.Text.Encoding]::UTF8)
        $ledger = $json | ConvertFrom-Json
        Assert-LedgerShape -Ledger $ledger
        $ledger.leases = @($ledger.leases)
        return $ledger
    }
    catch {
        throw "Lease ledger cannot be read safely; refusing to continue: $($_.Exception.Message)"
    }
}

function Write-LeaseLedgerAtomic {
    param(
        [Parameter(Mandatory = $true)]$Ledger,
        [Parameter(Mandatory = $true)][string]$LedgerPath
    )

    $Ledger.revision = [long]$Ledger.revision + 1
    $Ledger.leases = @($Ledger.leases)
    $json = $Ledger | ConvertTo-Json -Depth 8
    $directory = [System.IO.Path]::GetDirectoryName($LedgerPath)
    $temporary = [System.IO.Path]::Combine(
        $directory,
        ".resource-leases.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
    )
    $backup = [System.IO.Path]::Combine(
        $directory,
        ".resource-leases.$PID.$([Guid]::NewGuid().ToString('N')).bak"
    )

    try {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($temporary, $json, $utf8NoBom)
        if ([System.IO.File]::Exists($LedgerPath)) {
            # Windows PowerShell 5.1 binds a null backup argument as an empty
            # path on some .NET Framework builds. A same-directory backup keeps
            # File.Replace atomic; cleanup is attempted after the swap.
            [System.IO.File]::Replace($temporary, $LedgerPath, $backup)
            try {
                [System.IO.File]::Delete($backup)
            }
            catch {
                # The target commit already succeeded. Backup cleanup must not
                # turn a committed lease mutation into an ambiguous failure.
            }
        }
        else {
            [System.IO.File]::Move($temporary, $LedgerPath)
        }
    }
    catch {
        if ([System.IO.File]::Exists($temporary)) {
            [System.IO.File]::Delete($temporary)
        }
        if ([System.IO.File]::Exists($backup)) {
            [System.IO.File]::Delete($backup)
        }
        throw
    }
}

function Test-OwnerIdentityEqual {
    param($Lease, $Owner)

    return (
        [string]$Lease.ownerToken -ceq [string]$Owner.ownerToken -and
        [int]$Lease.ownerPid -eq [int]$Owner.pid -and
        [string]$Lease.ownerProcessStartUtcTicks -ceq [string]$Owner.processStartUtcTicks
    )
}

function Get-RecordedOwnerState {
    param(
        [int]$OwnerPid,
        [string]$OwnerProcessStartUtcTicks
    )

    $process = $null
    try {
        $process = [System.Diagnostics.Process]::GetProcessById($OwnerPid)
    }
    catch [System.ArgumentException] {
        return 'definitely-stale'
    }
    catch {
        return 'unknown'
    }

    try {
        $actualTicks = $process.StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)
        if ($actualTicks -ceq $OwnerProcessStartUtcTicks) {
            return 'live'
        }
        return 'definitely-stale'
    }
    catch {
        # Access denied or another inspection failure is not evidence of death.
        return 'unknown'
    }
    finally {
        if ($null -ne $process) { $process.Dispose() }
    }
}

function Remove-DefinitelyStaleLeases {
    param([Parameter(Mandatory = $true)]$Ledger)

    $cache = @{}
    $retained = @()
    $removed = 0
    foreach ($lease in @($Ledger.leases)) {
        $identity = "$($lease.ownerPid):$($lease.ownerProcessStartUtcTicks)"
        if (-not $cache.ContainsKey($identity)) {
            $cache[$identity] = Get-RecordedOwnerState `
                -OwnerPid ([int]$lease.ownerPid) `
                -OwnerProcessStartUtcTicks ([string]$lease.ownerProcessStartUtcTicks)
        }
        if ($cache[$identity] -eq 'definitely-stale') {
            $removed++
        }
        else {
            $retained += $lease
        }
    }
    $Ledger.leases = @($retained)

    [pscustomobject]@{
        count = $removed
    }
}

function Get-LeaseOrderViolation {
    param(
        [Parameter(Mandatory = $true)]$Ledger,
        [Parameter(Mandatory = $true)]$Owner,
        [Parameter(Mandatory = $true)][string]$ResourceType,
        [Parameter(Mandatory = $true)][string]$ResourceKey
    )

    $candidateRank = [int]$script:ResourceRanks[$ResourceType]
    foreach ($lease in @($Ledger.leases)) {
        if (-not (Test-OwnerIdentityEqual -Lease $lease -Owner $Owner)) { continue }

        $heldRank = [int]$script:ResourceRanks[[string]$lease.resourceType]
        if ($candidateRank -lt $heldRank) {
            return "Requested '$ResourceType/$ResourceKey' after higher-ranked '$($lease.resourceType)/$($lease.resourceKey)'."
        }
        if ($candidateRank -eq $heldRank -and
            [string]::CompareOrdinal($ResourceKey, [string]$lease.resourceKey) -lt 0) {
            return "Same-type resources must be acquired in canonical key order."
        }
    }
    return $null
}

function Get-ExistingOwnerLeaseDecision {
    param(
        [Parameter(Mandatory = $true)]$Ledger,
        [Parameter(Mandatory = $true)]$Owner,
        [string]$ResourceType,
        [string]$ResourceKey,
        [string]$Mode,
        [long]$Bytes,
        [long]$CapacityBytes
    )

    foreach ($lease in @($Ledger.leases)) {
        if (-not (Test-OwnerIdentityEqual -Lease $lease -Owner $Owner)) { continue }
        if ([string]$lease.resourceType -cne $ResourceType -or [string]$lease.resourceKey -cne $ResourceKey) { continue }

        if (
            [string]$lease.mode -ceq $Mode -and
            [long]$lease.bytes -eq $Bytes -and
            [long]$lease.capacityBytes -eq $CapacityBytes
        ) {
            return [pscustomobject]@{ status = 'idempotent'; lease = $lease; detail = 'The owner already holds this lease.' }
        }

        $detail = if ($ResourceType -eq 'runtime') {
            'Runtime lease upgrades/downgrades are not supported; release and reacquire in canonical order.'
        }
        else {
            'The owner already holds the resource with different lease parameters.'
        }
        return [pscustomobject]@{ status = 'request-mismatch'; lease = $null; detail = $detail }
    }
    return $null
}

function Get-ConflictDecision {
    param(
        [Parameter(Mandatory = $true)]$Ledger,
        [Parameter(Mandatory = $true)]$Owner,
        [string]$ResourceType,
        [string]$ResourceKey,
        [string]$Mode,
        [long]$Bytes,
        [long]$CapacityBytes
    )

    $sameResource = @($Ledger.leases | Where-Object {
        [string]$_.resourceType -ceq $ResourceType -and
        [string]$_.resourceKey -ceq $ResourceKey -and
        -not (Test-OwnerIdentityEqual -Lease $_ -Owner $Owner)
    })

    switch ($ResourceType) {
        'volume' {
            foreach ($lease in $sameResource) {
                if ([long]$lease.capacityBytes -ne $CapacityBytes) {
                    return [pscustomobject]@{
                        blocked = $true; terminal = $true; status = 'capacity-mismatch'
                        detail = 'Active reservations disagree about the volume capacity snapshot.'
                    }
                }
            }
            $reserved = [long]0
            foreach ($lease in $sameResource) { $reserved += [long]$lease.bytes }
            if (($reserved + $Bytes) -gt $CapacityBytes) {
                return [pscustomobject]@{
                    blocked = $true; terminal = $false; status = 'capacity-busy'
                    detail = "Cooperative reservations would exceed capacity ($reserved + $Bytes > $CapacityBytes)."
                }
            }
        }
        'runtime' {
            if ($Mode -eq 'read') {
                if (@($sameResource | Where-Object { [string]$_.mode -eq 'write' }).Count -gt 0) {
                    return [pscustomobject]@{ blocked = $true; terminal = $false; status = 'runtime-write-busy'; detail = 'A runtime writer is active.' }
                }
            }
            elseif ($sameResource.Count -gt 0) {
                return [pscustomobject]@{ blocked = $true; terminal = $false; status = 'runtime-busy'; detail = 'Runtime readers or a writer are active.' }
            }
        }
        default {
            if ($sameResource.Count -gt 0) {
                return [pscustomobject]@{ blocked = $true; terminal = $false; status = 'resource-busy'; detail = 'An exclusive lease is active.' }
            }
        }
    }

    return [pscustomobject]@{ blocked = $false; terminal = $false; status = 'available'; detail = 'Resource is available.' }
}

function ConvertTo-PublicLease {
    param([Parameter(Mandatory = $true)]$Lease)

    [pscustomobject]@{
        leaseId        = [string]$Lease.leaseId
        resourceType   = [string]$Lease.resourceType
        resourceKey    = [string]$Lease.resourceKey
        mode           = [string]$Lease.mode
        bytes          = [long]$Lease.bytes
        capacityBytes  = [long]$Lease.capacityBytes
        ownerPid       = [int]$Lease.ownerPid
        acquiredAtUtc  = [string]$Lease.acquiredAtUtc
    }
}

function New-AcquireResult {
    param(
        [bool]$Success,
        [string]$Status,
        $Lease,
        [long]$WaitedMilliseconds,
        [int]$ReclaimedStaleCount,
        [string]$Detail
    )

    [pscustomobject]@{
        success                 = $Success
        status                  = $Status
        lease                   = if ($null -eq $Lease) { $null } else { ConvertTo-PublicLease -Lease $Lease }
        waitedMilliseconds      = $WaitedMilliseconds
        reclaimedStaleCount     = $ReclaimedStaleCount
        detail                  = $Detail
    }
}

function Acquire-ResourceLease {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$StateRoot,
        [Parameter(Mandatory = $true)]$Owner,
        [Parameter(Mandatory = $true)]
        [ValidateSet('artifact', 'volume', 'runtime', 'gpu', 'project-run')]
        [string]$ResourceType,
        [Parameter(Mandatory = $true)][string]$ResourceKey,
        [Parameter(Mandatory = $true)]
        [ValidateSet('write', 'reserve', 'read', 'exclusive')]
        [string]$Mode,
        [long]$Bytes = 0,
        [long]$CapacityBytes = 0,
        [ValidateRange(0, 2147483647)][int]$TimeoutMilliseconds = 30000,
        [ValidateRange(5, 60000)][int]$PollMilliseconds = 50
    )

    Assert-CurrentOwner -Owner $Owner
    $normalizedKey = Get-NormalizedResourceKey -ResourceType $ResourceType -ResourceKey $ResourceKey
    Assert-LeaseRequest -ResourceType $ResourceType -Mode $Mode -Bytes $Bytes -CapacityBytes $CapacityBytes
    $paths = Get-StatePaths -StateRoot $StateRoot
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $totalReclaimed = 0
    $lastDetail = 'The resource did not become available.'
    $firstAttempt = $true

    while ($firstAttempt -or $stopwatch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $firstAttempt = $false
        $remaining = [Math]::Max(0, $TimeoutMilliseconds - [int]$stopwatch.ElapsedMilliseconds)
        $mutexWait = [Math]::Min(500, $remaining)
        $mutex = New-CoordinatorMutex -StateRoot $paths.root
        $entered = $false
        try {
            $entered = Enter-CoordinatorMutex -Mutex $mutex -TimeoutMilliseconds $mutexWait
            if (-not $entered) {
                $lastDetail = 'The lease coordinator is busy.'
                continue
            }

            $ledger = Read-LeaseLedger -LedgerPath $paths.ledger
            $reclaim = Remove-DefinitelyStaleLeases -Ledger $ledger
            $totalReclaimed += [int]$reclaim.count
            $ledgerDirty = ([int]$reclaim.count -gt 0)

            $existing = Get-ExistingOwnerLeaseDecision `
                -Ledger $ledger -Owner $Owner -ResourceType $ResourceType -ResourceKey $normalizedKey `
                -Mode $Mode -Bytes $Bytes -CapacityBytes $CapacityBytes
            if ($null -ne $existing) {
                if ($ledgerDirty) { Write-LeaseLedgerAtomic -Ledger $ledger -LedgerPath $paths.ledger }
                if ($existing.status -eq 'idempotent') {
                    return New-AcquireResult $true 'acquired' $existing.lease $stopwatch.ElapsedMilliseconds $totalReclaimed $existing.detail
                }
                return New-AcquireResult $false $existing.status $null $stopwatch.ElapsedMilliseconds $totalReclaimed $existing.detail
            }

            $orderViolation = Get-LeaseOrderViolation `
                -Ledger $ledger -Owner $Owner -ResourceType $ResourceType -ResourceKey $normalizedKey
            if ($null -ne $orderViolation) {
                if ($ledgerDirty) { Write-LeaseLedgerAtomic -Ledger $ledger -LedgerPath $paths.ledger }
                return New-AcquireResult $false 'order-violation' $null $stopwatch.ElapsedMilliseconds $totalReclaimed $orderViolation
            }

            $decision = Get-ConflictDecision `
                -Ledger $ledger -Owner $Owner -ResourceType $ResourceType -ResourceKey $normalizedKey `
                -Mode $Mode -Bytes $Bytes -CapacityBytes $CapacityBytes
            if ($decision.terminal) {
                if ($ledgerDirty) { Write-LeaseLedgerAtomic -Ledger $ledger -LedgerPath $paths.ledger }
                return New-AcquireResult $false $decision.status $null $stopwatch.ElapsedMilliseconds $totalReclaimed $decision.detail
            }

            if (-not $decision.blocked) {
                $lease = [pscustomobject]@{
                    leaseId                    = [Guid]::NewGuid().ToString('N')
                    resourceType                = $ResourceType
                    resourceKey                 = $normalizedKey
                    mode                        = $Mode
                    bytes                       = [long]$Bytes
                    capacityBytes               = [long]$CapacityBytes
                    ownerToken                  = [string]$Owner.ownerToken
                    ownerPid                    = [int]$Owner.pid
                    ownerProcessStartUtcTicks   = [string]$Owner.processStartUtcTicks
                    acquiredAtUtc               = [DateTime]::UtcNow.ToString('o')
                }
                $ledger.leases = @($ledger.leases) + @($lease)
                Write-LeaseLedgerAtomic -Ledger $ledger -LedgerPath $paths.ledger
                return New-AcquireResult $true 'acquired' $lease $stopwatch.ElapsedMilliseconds $totalReclaimed 'Lease acquired.'
            }

            $lastDetail = [string]$decision.detail
            if ($ledgerDirty) { Write-LeaseLedgerAtomic -Ledger $ledger -LedgerPath $paths.ledger }
        }
        finally {
            if ($entered) { $mutex.ReleaseMutex() }
            $mutex.Dispose()
        }

        if ($stopwatch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
            $sleep = [Math]::Min($PollMilliseconds, [Math]::Max(1, $TimeoutMilliseconds - [int]$stopwatch.ElapsedMilliseconds))
            Start-Sleep -Milliseconds $sleep
        }
    }

    return New-AcquireResult $false 'timeout' $null $stopwatch.ElapsedMilliseconds $totalReclaimed $lastDetail
}

function Release-ResourceLease {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$StateRoot,
        [Parameter(Mandatory = $true)]$Owner,
        [string]$LeaseId
    )

    Assert-CurrentOwner -Owner $Owner
    if ($PSBoundParameters.ContainsKey('LeaseId') -and $LeaseId -notmatch '^[0-9a-fA-F]{32}$') {
        throw 'LeaseId must be a 32-character GUID token.'
    }

    $paths = Get-StatePaths -StateRoot $StateRoot
    $mutex = New-CoordinatorMutex -StateRoot $paths.root
    $entered = $false
    try {
        $entered = Enter-CoordinatorMutex -Mutex $mutex -TimeoutMilliseconds 30000
        if (-not $entered) { throw 'Timed out entering the lease coordinator.' }
        $ledger = Read-LeaseLedger -LedgerPath $paths.ledger
        $reclaim = Remove-DefinitelyStaleLeases -Ledger $ledger
        $retained = @()
        $released = 0
        $foundRequestedId = $false

        foreach ($lease in @($ledger.leases)) {
            $idMatches = (-not $PSBoundParameters.ContainsKey('LeaseId')) -or ([string]$lease.leaseId -ceq $LeaseId)
            if ($PSBoundParameters.ContainsKey('LeaseId') -and [string]$lease.leaseId -ceq $LeaseId) {
                $foundRequestedId = $true
            }
            if ($idMatches -and (Test-OwnerIdentityEqual -Lease $lease -Owner $Owner)) {
                $released++
            }
            else {
                $retained += $lease
            }
        }

        if ($PSBoundParameters.ContainsKey('LeaseId') -and $foundRequestedId -and $released -eq 0) {
            throw 'The requested lease is owned by another process identity.'
        }

        if ($released -gt 0 -or [int]$reclaim.count -gt 0) {
            $ledger.leases = @($retained)
            Write-LeaseLedgerAtomic -Ledger $ledger -LedgerPath $paths.ledger
        }

        [pscustomobject]@{
            success             = $true
            status              = if ($released -gt 0) { 'released' } else { 'not-found' }
            releasedCount       = $released
            reclaimedStaleCount = [int]$reclaim.count
        }
    }
    finally {
        if ($entered) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Get-ResourceLeaseSnapshot {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$StateRoot)

    $paths = Get-StatePaths -StateRoot $StateRoot
    $mutex = New-CoordinatorMutex -StateRoot $paths.root
    $entered = $false
    try {
        $entered = Enter-CoordinatorMutex -Mutex $mutex -TimeoutMilliseconds 30000
        if (-not $entered) { throw 'Timed out entering the lease coordinator.' }
        $ledger = Read-LeaseLedger -LedgerPath $paths.ledger
        [pscustomobject]@{
            schemaVersion = [int]$ledger.schemaVersion
            revision      = [long]$ledger.revision
            leases        = @($ledger.leases | ForEach-Object { ConvertTo-PublicLease -Lease $_ })
        }
    }
    finally {
        if ($entered) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

Export-ModuleMember -Function @(
    'New-ResourceLeaseOwner',
    'Acquire-ResourceLease',
    'Release-ResourceLease',
    'Get-ResourceLeaseSnapshot'
)
