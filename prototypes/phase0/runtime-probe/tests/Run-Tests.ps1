[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw "ASSERTION FAILED: $Message"
    }
}

function Get-FixtureSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $items = Get-ChildItem -LiteralPath $Root -Recurse -Force -File | Sort-Object FullName
    return @($items | ForEach-Object {
            [pscustomobject][ordered]@{
                relativePath = $_.FullName.Substring($Root.Length).TrimStart('\')
                length       = $_.Length
                lastWriteUtc = $_.LastWriteTimeUtc.ToString('o')
                sha256       = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        })
}

$testRoot = Split-Path -Parent $PSScriptRoot
$probePath = Join-Path $testRoot 'Invoke-RuntimeTopologyProbe.ps1'
$fixtureRoot = Join-Path $testRoot 'fixtures'

Assert-True -Condition (Test-Path -LiteralPath $probePath -PathType Leaf) -Message 'Probe script is missing.'
Assert-True -Condition (Test-Path -LiteralPath $fixtureRoot -PathType Container) -Message 'Fixture directory is missing.'

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($probePath, [ref]$tokens, [ref]$parseErrors)
Assert-True -Condition ($parseErrors.Count -eq 0) -Message 'Probe script has PowerShell parse errors.'

$forbiddenCommands = @(
    'Add-Type',
    'Clear-Content',
    'Copy-Item',
    'Export-Clixml',
    'Export-Csv',
    'Import-Module',
    'Invoke-Command',
    'Invoke-Expression',
    'Invoke-RestMethod',
    'Invoke-WebRequest',
    'Move-Item',
    'New-Item',
    'New-ItemProperty',
    'Out-File',
    'Remove-Item',
    'Remove-ItemProperty',
    'Rename-Item',
    'Set-Acl',
    'Set-Content',
    'Set-Item',
    'Set-ItemProperty',
    'Start-Job',
    'Start-Process',
    'Tee-Object',
    'cmd',
    'comfy',
    'curl',
    'git',
    'pip',
    'pip3',
    'powershell',
    'pwsh',
    'python',
    'python3',
    'wget'
)
$commandAsts = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
$commandNames = @($commandAsts | ForEach-Object { $_.GetCommandName() } | Where-Object { $_ })
foreach ($forbidden in $forbiddenCommands) {
    Assert-True -Condition ($commandNames -notcontains $forbidden) -Message "Probe contains forbidden command: $forbidden"
}

$before = Get-FixtureSnapshot -Root $fixtureRoot
$jsonText = & $probePath -Mode Fixture -FixtureRoot $fixtureRoot
$result = $jsonText | ConvertFrom-Json
$after = Get-FixtureSnapshot -Root $fixtureRoot

Assert-True -Condition ($result.schemaVersion -eq 'runtime-probe-spike/0.1') -Message 'Unexpected probe schema version.'
Assert-True -Condition ($result.taskId -eq 'P0-ARC-001') -Message 'Unexpected task ID.'
Assert-True -Condition ($result.safety.readOnly -eq $true) -Message 'Probe did not declare read-only behavior.'
Assert-True -Condition ($result.safety.executesExternalProcess -eq $false) -Message 'Probe declared external process execution.'
Assert-True -Condition ($result.safety.importsExternalPython -eq $false) -Message 'Probe declared external Python import.'
Assert-True -Condition ($result.safety.revealsAbsolutePaths -eq $false) -Message 'Probe declared path disclosure.'

Assert-True -Condition ($result.summary.desktopExecutableCandidates -eq 1) -Message 'Desktop fixture was not found exactly once.'
Assert-True -Condition ($result.summary.desktopStateOnlyCandidates -eq 1) -Message 'Desktop state-only fixture was not separated.'
Assert-True -Condition ($result.summary.portableCandidates -eq 1) -Message 'Portable fixture was not classified.'
Assert-True -Condition ($result.summary.coreCandidates -eq 1) -Message 'Core fixture was not classified.'
Assert-True -Condition ($result.summary.partialLayouts -eq 1) -Message 'Unknown partial layout did not fail closed.'

$unknown = @($result.candidates | Where-Object { $_.candidateId -eq 'fixture-unknown' })
Assert-True -Condition ($unknown.Count -eq 1) -Message 'Unknown fixture result is missing.'
Assert-True -Condition ($unknown[0].topology -eq 'unknown_partial_layout') -Message 'Unknown fixture was incorrectly approved.'

$beforeJson = $before | ConvertTo-Json -Depth 4 -Compress
$afterJson = $after | ConvertTo-Json -Depth 4 -Compress
Assert-True -Condition ($beforeJson -ceq $afterJson) -Message 'Probe modified fixture contents or timestamps.'

$serialized = $result | ConvertTo-Json -Depth 8 -Compress
Assert-True -Condition ($serialized -notmatch '[A-Za-z]:\\') -Message 'Probe output disclosed an absolute drive path.'
if (-not [string]::IsNullOrWhiteSpace($env:USERNAME)) {
    Assert-True -Condition ($serialized -notmatch [regex]::Escape($env:USERNAME)) -Message 'Probe output disclosed the local username.'
}

Write-Output 'PASS: PowerShell AST contains no forbidden mutating/network/process commands.'
Write-Output 'PASS: Desktop executable evidence is distinct from Desktop state-only evidence.'
Write-Output 'PASS: Portable and Core fixtures are classified; incomplete layout fails closed.'
Write-Output 'PASS: Fixture bytes and timestamps are unchanged after the probe.'
Write-Output 'PASS: JSON output contains no absolute drive path or local username.'
