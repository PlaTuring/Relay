[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$prototypeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workerPath = Join-Path $prototypeRoot 'FakeWorker.ps1'
$modulePath = Join-Path $prototypeRoot 'ResourceLeases.psm1'
$testStateParent = [System.IO.Path]::GetFullPath((Join-Path $prototypeRoot '.test-state'))
$runRoot = [System.IO.Path]::Combine($testStateParent, [Guid]::NewGuid().ToString('N'))
$trackedProcesses = New-Object System.Collections.ArrayList
$script:Failures = @()
$script:Passed = 0

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "$Message Expected '$Expected', got '$Actual'."
    }
}

function New-Scenario {
    param([Parameter(Mandatory = $true)][string]$Name)

    $root = Join-Path $runRoot $Name
    $state = Join-Path $root 'state'
    $events = Join-Path $root 'events'
    [void][System.IO.Directory]::CreateDirectory($state)
    [void][System.IO.Directory]::CreateDirectory($events)
    [pscustomobject]@{ root = $root; state = $state; events = $events }
}

function Quote-ProcessArgument {
    param([Parameter(Mandatory = $true)]$Value)
    $text = [string]$Value
    return '"' + $text.Replace('"', '\"') + '"'
}

function Start-FakeWorker {
    param(
        [Parameter(Mandatory = $true)]$Scenario,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Arguments
    )

    $powerShellExe = (Get-Command powershell.exe -ErrorAction Stop).Source
    $commandArguments = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', (Quote-ProcessArgument $workerPath),
        '-StateRoot', (Quote-ProcessArgument $Scenario.state),
        '-EventDirectory', (Quote-ProcessArgument $Scenario.events),
        '-Name', (Quote-ProcessArgument $Name)
    )
    foreach ($key in $Arguments.Keys) {
        if ($null -eq $Arguments[$key]) { continue }
        $commandArguments += "-$key"
        $commandArguments += Quote-ProcessArgument $Arguments[$key]
    }

    $process = Start-Process `
        -FilePath $powerShellExe `
        -ArgumentList $commandArguments `
        -WindowStyle Hidden `
        -PassThru
    [void]$trackedProcesses.Add($process)
    return $process
}

function Get-EventPath {
    param($Scenario, [string]$Name, [string]$Phase)
    Join-Path $Scenario.events "$Name.$Phase.json"
}

function Wait-WorkerEvent {
    param(
        [Parameter(Mandatory = $true)]$Scenario,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Phase,
        [int]$TimeoutMilliseconds = 5000
    )

    $path = Get-EventPath $Scenario $Name $Phase
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        if ([System.IO.File]::Exists($path)) {
            $json = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
            return $json | ConvertFrom-Json
        }
        Start-Sleep -Milliseconds 20
    }
    throw "Timed out waiting for worker event '$Name/$Phase'."
}

function Test-EventExists {
    param($Scenario, [string]$Name, [string]$Phase)
    [System.IO.File]::Exists((Get-EventPath $Scenario $Name $Phase))
}

function Wait-WorkerExit {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [int]$ExpectedExitCode = 0,
        [int]$TimeoutMilliseconds = 10000
    )

    if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
        throw "Worker PID $($Process.Id) did not exit within $TimeoutMilliseconds ms."
    }
    $Process.Refresh()
    Assert-Equal $ExpectedExitCode $Process.ExitCode "Worker PID $($Process.Id) exit code mismatch."
}

function Invoke-LeaseTest {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Body
    )

    try {
        & $Body
        $script:Passed++
        Write-Host "PASS $Name"
    }
    catch {
        $script:Failures += "$Name :: $($_.Exception.Message)"
        Write-Host "FAIL $Name :: $($_.Exception.Message)"
    }
}

[void][System.IO.Directory]::CreateDirectory($runRoot)
Import-Module -Name $modulePath -Force -DisableNameChecking -ErrorAction Stop

try {
    Invoke-LeaseTest 'artifact digest permits only one writer' {
        $scenario = New-Scenario 'artifact'
        $digest = ('a' * 64) -join ''
        $first = Start-FakeWorker $scenario 'artifact1' ([ordered]@{
            ResourceType = 'artifact'; ResourceKey = $digest; Mode = 'write'
            HoldMilliseconds = 900; TimeoutMilliseconds = 3000
        })
        [void](Wait-WorkerEvent $scenario 'artifact1' 'acquired')
        $second = Start-FakeWorker $scenario 'artifact2' ([ordered]@{
            ResourceType = 'artifact'; ResourceKey = $digest; Mode = 'write'
            HoldMilliseconds = 0; TimeoutMilliseconds = 3000
        })
        Start-Sleep -Milliseconds 250
        Assert-True (-not (Test-EventExists $scenario 'artifact2' 'acquired')) 'Second artifact writer acquired while the first writer was holding.'
        Assert-True (-not $first.HasExited) 'First artifact writer exited before the overlap assertion.'
        Wait-WorkerExit $first
        Wait-WorkerExit $second
        $result = Wait-WorkerEvent $scenario 'artifact2' 'result'
        Assert-Equal 'completed' $result.status 'Second artifact writer did not complete after release.'
        Assert-True ([int]$result.waitedMilliseconds -ge 200) 'Second artifact writer did not demonstrate serialized waiting.'
    }

    Invoke-LeaseTest 'same fake GPU LUID is serialized' {
        $scenario = New-Scenario 'gpu'
        $first = Start-FakeWorker $scenario 'gpu1' ([ordered]@{
            ResourceType = 'gpu'; ResourceKey = '00000000:00000001'; Mode = 'exclusive'
            HoldMilliseconds = 850; TimeoutMilliseconds = 3000
        })
        [void](Wait-WorkerEvent $scenario 'gpu1' 'acquired')
        $second = Start-FakeWorker $scenario 'gpu2' ([ordered]@{
            ResourceType = 'gpu'; ResourceKey = '00000000:00000001'; Mode = 'exclusive'
            TimeoutMilliseconds = 3000
        })
        Start-Sleep -Milliseconds 250
        Assert-True (-not (Test-EventExists $scenario 'gpu2' 'acquired')) 'Second fake GPU user acquired while the first was holding.'
        Assert-True (-not $first.HasExited) 'First fake GPU worker exited before the overlap assertion.'
        Wait-WorkerExit $first
        Wait-WorkerExit $second
        Assert-Equal 'completed' (Wait-WorkerEvent $scenario 'gpu2' 'result').status 'Second fake GPU worker did not complete.'
    }

    Invoke-LeaseTest 'runtime readers coexist and exclude writer' {
        $scenario = New-Scenario 'runtime'
        $reader1 = Start-FakeWorker $scenario 'reader1' ([ordered]@{
            ResourceType = 'runtime'; ResourceKey = 'generation-001'; Mode = 'read'
            HoldMilliseconds = 1000; TimeoutMilliseconds = 3000
        })
        $reader2 = Start-FakeWorker $scenario 'reader2' ([ordered]@{
            ResourceType = 'runtime'; ResourceKey = 'generation-001'; Mode = 'read'
            HoldMilliseconds = 1000; TimeoutMilliseconds = 3000
        })
        [void](Wait-WorkerEvent $scenario 'reader1' 'acquired')
        [void](Wait-WorkerEvent $scenario 'reader2' 'acquired')
        $writer = Start-FakeWorker $scenario 'writer' ([ordered]@{
            ResourceType = 'runtime'; ResourceKey = 'generation-001'; Mode = 'write'
            TimeoutMilliseconds = 4000
        })
        Start-Sleep -Milliseconds 250
        Assert-True (-not (Test-EventExists $scenario 'writer' 'acquired')) 'Runtime writer overlapped active readers.'
        Assert-True (-not $reader1.HasExited -and -not $reader2.HasExited) 'A reader exited before writer exclusion was checked.'
        Wait-WorkerExit $reader1
        Wait-WorkerExit $reader2
        Wait-WorkerExit $writer
        Assert-Equal 'completed' (Wait-WorkerEvent $scenario 'writer' 'result').status 'Runtime writer did not complete after readers released.'
    }

    Invoke-LeaseTest 'project-run is mutually exclusive' {
        $scenario = New-Scenario 'project'
        $first = Start-FakeWorker $scenario 'project1' ([ordered]@{
            ResourceType = 'project-run'; ResourceKey = 'project-demo'; Mode = 'exclusive'
            HoldMilliseconds = 850; TimeoutMilliseconds = 3000
        })
        [void](Wait-WorkerEvent $scenario 'project1' 'acquired')
        $second = Start-FakeWorker $scenario 'project2' ([ordered]@{
            ResourceType = 'project-run'; ResourceKey = 'project-demo'; Mode = 'exclusive'
            TimeoutMilliseconds = 3000
        })
        Start-Sleep -Milliseconds 250
        Assert-True (-not (Test-EventExists $scenario 'project2' 'acquired')) 'Two workers held the same project-run lease.'
        Wait-WorkerExit $first
        Wait-WorkerExit $second
        Assert-Equal 'completed' (Wait-WorkerEvent $scenario 'project2' 'result').status 'Second project worker did not complete.'
    }

    Invoke-LeaseTest 'volume byte reservations are bounded and timeout never steals' {
        $scenario = New-Scenario 'volume'
        $reserve70 = Start-FakeWorker $scenario 'reserve70' ([ordered]@{
            ResourceType = 'volume'; ResourceKey = 'volume-d'; Mode = 'reserve'
            Bytes = 70; CapacityBytes = 100; HoldMilliseconds = 2500; TimeoutMilliseconds = 3000
        })
        [void](Wait-WorkerEvent $scenario 'reserve70' 'acquired')
        $reserve30 = Start-FakeWorker $scenario 'reserve30' ([ordered]@{
            ResourceType = 'volume'; ResourceKey = 'volume-d'; Mode = 'reserve'
            Bytes = 30; CapacityBytes = 100; HoldMilliseconds = 2400; TimeoutMilliseconds = 3000
        })
        [void](Wait-WorkerEvent $scenario 'reserve30' 'acquired')
        $reserve40Timeout = Start-FakeWorker $scenario 'reserve40timeout' ([ordered]@{
            ResourceType = 'volume'; ResourceKey = 'volume-d'; Mode = 'reserve'
            Bytes = 40; CapacityBytes = 100; TimeoutMilliseconds = 250
        })
        $timeoutResult = Wait-WorkerEvent $scenario 'reserve40timeout' 'result' 3000
        Wait-WorkerExit $reserve40Timeout 3
        Assert-Equal 'timeout' $timeoutResult.status 'Over-capacity reservation did not time out.'
        Assert-True (-not $reserve70.HasExited -and -not $reserve30.HasExited) 'A live volume owner was displaced by timeout.'
        $snapshot = Get-ResourceLeaseSnapshot -StateRoot $scenario.state
        $volumeLeases = @($snapshot.leases | Where-Object { $_.resourceType -eq 'volume' })
        Assert-Equal 2 $volumeLeases.Count 'Timeout altered the live volume reservations.'
        Assert-Equal 100 (($volumeLeases | Measure-Object -Property bytes -Sum).Sum) 'Live volume byte total changed unexpectedly.'
        Assert-True (@($volumeLeases.ownerPid) -notcontains $reserve40Timeout.Id) 'Timed-out worker appeared in the active ledger.'
        Wait-WorkerExit $reserve70
        Wait-WorkerExit $reserve30
        $reserve40 = Start-FakeWorker $scenario 'reserve40after' ([ordered]@{
            ResourceType = 'volume'; ResourceKey = 'volume-d'; Mode = 'reserve'
            Bytes = 40; CapacityBytes = 100; TimeoutMilliseconds = 2000
        })
        Wait-WorkerExit $reserve40
        Assert-Equal 'completed' (Wait-WorkerEvent $scenario 'reserve40after' 'result').status 'Reservation did not succeed after capacity was released.'
    }

    Invoke-LeaseTest 'owner token and PID creation identity are both enforced' {
        $scenario = New-Scenario 'owner-identity'
        $owner = New-ResourceLeaseOwner
        $first = Acquire-ResourceLease `
            -StateRoot $scenario.state -Owner $owner `
            -ResourceType 'project-run' -ResourceKey 'identity-project' -Mode 'exclusive' `
            -TimeoutMilliseconds 0
        Assert-True $first.success 'Primary owner could not acquire identity test lease.'

        $differentTokenOwner = New-ResourceLeaseOwner
        $contender = Acquire-ResourceLease `
            -StateRoot $scenario.state -Owner $differentTokenOwner `
            -ResourceType 'project-run' -ResourceKey 'identity-project' -Mode 'exclusive' `
            -TimeoutMilliseconds 0
        Assert-Equal 'timeout' $contender.status 'A different owner token was treated as the existing owner.'

        $wrongCreationIdentity = [pscustomobject]@{
            ownerToken = $owner.ownerToken
            pid = $owner.pid
            processStartUtcTicks = ([long]$owner.processStartUtcTicks + 1).ToString()
        }
        $rejected = $false
        try {
            [void](Acquire-ResourceLease `
                -StateRoot $scenario.state -Owner $wrongCreationIdentity `
                -ResourceType 'project-run' -ResourceKey 'other-project' -Mode 'exclusive' `
                -TimeoutMilliseconds 0)
        }
        catch {
            $rejected = ($_.Exception.Message -match 'creation identity')
        }
        Assert-True $rejected 'A forged PID creation identity was not rejected.'
        [void](Release-ResourceLease -StateRoot $scenario.state -Owner $owner -LeaseId $first.lease.leaseId)
    }

    Invoke-LeaseTest 'public acquire result and snapshot redact private owner identity' {
        $scenario = New-Scenario 'public-redaction'
        $owner = New-ResourceLeaseOwner
        $acquire = Acquire-ResourceLease `
            -StateRoot $scenario.state -Owner $owner `
            -ResourceType 'runtime' -ResourceKey 'redaction-generation' -Mode 'read' `
            -TimeoutMilliseconds 0
        Assert-True $acquire.success 'Could not acquire the redaction test lease.'

        try {
            $snapshot = Get-ResourceLeaseSnapshot -StateRoot $scenario.state
            Assert-Equal 1 @($snapshot.leases).Count 'Redaction snapshot did not contain the expected public lease.'
            $forbiddenFields = @('ownerToken', 'ownerProcessStartUtcTicks', 'processStartUtcTicks')

            foreach ($field in $forbiddenFields) {
                Assert-True `
                    (@($acquire.PSObject.Properties.Name) -notcontains $field) `
                    "Acquire result root exposed private field '$field'."
                Assert-True `
                    (@($acquire.lease.PSObject.Properties.Name) -notcontains $field) `
                    "Acquire result lease exposed private field '$field'."
                Assert-True `
                    (@($snapshot.PSObject.Properties.Name) -notcontains $field) `
                    "Snapshot root exposed private field '$field'."
                foreach ($lease in @($snapshot.leases)) {
                    Assert-True `
                        (@($lease.PSObject.Properties.Name) -notcontains $field) `
                        "Snapshot lease exposed private field '$field'."
                }
            }

            $acquireJson = $acquire | ConvertTo-Json -Depth 8
            $snapshotJson = $snapshot | ConvertTo-Json -Depth 8
            foreach ($field in $forbiddenFields) {
                $propertyPattern = '"' + [Regex]::Escape($field) + '"\s*:'
                Assert-True `
                    ($acquireJson -notmatch $propertyPattern) `
                    "Serialized Acquire result exposed private property '$field'."
                Assert-True `
                    ($snapshotJson -notmatch $propertyPattern) `
                    "Serialized snapshot exposed private property '$field'."
            }
        }
        finally {
            [void](Release-ResourceLease -StateRoot $scenario.state -Owner $owner -LeaseId $acquire.lease.leaseId)
        }
    }

    Invoke-LeaseTest 'crashed owner is reclaimed only after process death proof' {
        $scenario = New-Scenario 'crash'
        $crashed = Start-FakeWorker $scenario 'crashed' ([ordered]@{
            ResourceType = 'project-run'; ResourceKey = 'crash-project'; Mode = 'exclusive'
            HoldMilliseconds = 10000; TimeoutMilliseconds = 3000
        })
        $acquired = Wait-WorkerEvent $scenario 'crashed' 'acquired'
        Assert-Equal $crashed.Id ([int]$acquired.pid) 'Crash target PID did not match the tracked fake worker.'
        Stop-Process -Id $crashed.Id -Force -ErrorAction Stop
        [void]$crashed.WaitForExit(3000)
        $successor = Start-FakeWorker $scenario 'successor' ([ordered]@{
            ResourceType = 'project-run'; ResourceKey = 'crash-project'; Mode = 'exclusive'
            TimeoutMilliseconds = 3000
        })
        Wait-WorkerExit $successor
        $result = Wait-WorkerEvent $scenario 'successor' 'result'
        Assert-Equal 'completed' $result.status 'Successor did not acquire after confirmed process death.'
        Assert-True ([int]$result.reclaimedStaleCount -ge 1) 'Successor did not report reclaiming the definitely stale lease.'
    }

    Invoke-LeaseTest 'reverse acquisition order is rejected immediately' {
        $scenario = New-Scenario 'order'
        $worker = Start-FakeWorker $scenario 'reverse' ([ordered]@{
            Action = 'reverse-order'
            ResourceType = 'gpu'; ResourceKey = '00000000:00000002'; Mode = 'exclusive'
            SecondResourceType = 'runtime'; SecondResourceKey = 'generation-002'; SecondMode = 'read'
            TimeoutMilliseconds = 3000
        })
        Wait-WorkerExit $worker
        $second = Wait-WorkerEvent $scenario 'reverse' 'second'
        $result = Wait-WorkerEvent $scenario 'reverse' 'result'
        Assert-Equal 'order-violation' $second.status 'Reverse-order request was not rejected.'
        Assert-True ([int]$second.waitedMilliseconds -lt 500) 'Order violation waited as if it were resource contention.'
        Assert-Equal 'expected-order-violation' $result.status 'Reverse-order worker did not observe the expected result.'
    }
}
finally {
    foreach ($process in @($trackedProcesses)) {
        try {
            if (-not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
                [void]$process.WaitForExit(3000)
            }
        }
        catch {
            Write-Warning "Could not stop tracked fake worker PID $($process.Id): $($_.Exception.Message)"
        }
        finally {
            $process.Dispose()
        }
    }

    $resolvedParent = [System.IO.Path]::GetFullPath($testStateParent).TrimEnd('\') + '\'
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    if (-not $resolvedRunRoot.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing cleanup outside prototype test-state: $resolvedRunRoot"
    }
    if ([System.IO.Directory]::Exists($resolvedRunRoot)) {
        Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
    }
}

Write-Host "RESULT passed=$script:Passed failed=$($script:Failures.Count)"
if ($script:Failures.Count -gt 0) {
    foreach ($failure in $script:Failures) { Write-Host "  $failure" }
    exit 1
}
exit 0
