[CmdletBinding()]
param(
    [switch]$SkipPublicLint,
    [switch]$Diagnostic
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$prototypeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ownedPrefix = $prototypeRoot.TrimEnd('\') + '\'
$localArtifacts = [System.IO.Path]::GetFullPath((Join-Path $prototypeRoot 'artifacts\local'))
$generationRoot = [System.IO.Path]::GetFullPath((Join-Path $localArtifacts 'generation'))
$compilerTemp = [System.IO.Path]::GetFullPath((Join-Path $localArtifacts 'compiler-temp'))
$workRoot = [System.IO.Path]::GetFullPath((Join-Path $prototypeRoot 'work'))
$evidenceRoot = [System.IO.Path]::GetFullPath((Join-Path $prototypeRoot 'evidence'))
$evidencePath = [System.IO.Path]::GetFullPath((Join-Path $evidenceRoot 'LAST_RUN.json'))

function Assert-OwnedTarget {
    param([Parameter(Mandatory = $true)][string]$Target)

    $resolved = [System.IO.Path]::GetFullPath($Target)
    if (-not $resolved.StartsWith($ownedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Target is outside the owned prototype root.'
    }
}

function Reset-OwnedDirectory {
    param([Parameter(Mandatory = $true)][string]$Target)

    Assert-OwnedTarget -Target $Target
    if (Test-Path -LiteralPath $Target) {
        Remove-Item -LiteralPath $Target -Recurse -Force
    }
    [void](New-Item -ItemType Directory -Path $Target -Force)
}

function Invoke-CSharpCompile {
    param(
        [Parameter(Mandatory = $true)][string[]]$Sources,
        [Parameter(Mandatory = $true)][string]$OutputAssembly,
        [Parameter(Mandatory = $true)][bool]$GenerateExecutable,
        [string[]]$AdditionalReferences = @()
    )

    $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
    try {
        $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
        $parameters.GenerateExecutable = $GenerateExecutable
        $parameters.GenerateInMemory = $false
        $parameters.IncludeDebugInformation = $false
        $parameters.OutputAssembly = $OutputAssembly
        $parameters.CompilerOptions = '/optimize+ /platform:x64'
        [void]$parameters.ReferencedAssemblies.Add('System.dll')
        [void]$parameters.ReferencedAssemblies.Add('System.Core.dll')
        foreach ($reference in $AdditionalReferences) {
            [void]$parameters.ReferencedAssemblies.Add($reference)
        }
        $result = $provider.CompileAssemblyFromFile($parameters, $Sources)
        $errors = @($result.Errors | Where-Object { -not $_.IsWarning })
        if ($errors.Count -gt 0) {
            $summary = $errors | ForEach-Object {
                '{0}:{1}:{2}' -f $_.ErrorNumber, ([System.IO.Path]::GetFileName($_.FileName)), $_.Line
            }
            throw ('CSharp compile failed: ' + ($summary -join ','))
        }
    }
    finally {
        $provider.Dispose()
    }
}

try {
    Reset-OwnedDirectory -Target $localArtifacts
    Reset-OwnedDirectory -Target $workRoot
    [void](New-Item -ItemType Directory -Path $generationRoot -Force)
    [void](New-Item -ItemType Directory -Path $compilerTemp -Force)
    [void](New-Item -ItemType Directory -Path $evidenceRoot -Force)

    $commonSources = Get-ChildItem -LiteralPath (Join-Path $prototypeRoot 'src\Common') -Filter '*.cs' -File |
        Sort-Object -Property Name |
        ForEach-Object { $_.FullName }
    $childSource = [System.IO.Path]::GetFullPath((Join-Path $prototypeRoot 'src\FakeChild\Program.cs'))
    $harnessSource = [System.IO.Path]::GetFullPath((Join-Path $prototypeRoot 'src\Harness\Program.cs'))
    $commonAssembly = [System.IO.Path]::GetFullPath((Join-Path $generationRoot 'ManagedProcessOwnership.Common.dll'))
    $childAssembly = [System.IO.Path]::GetFullPath((Join-Path $generationRoot 'ManagedProcessOwnership.FakeChild.exe'))
    $harnessAssembly = [System.IO.Path]::GetFullPath((Join-Path $generationRoot 'ManagedProcessOwnership.Harness.exe'))

    $priorTemp = $env:TEMP
    $priorTmp = $env:TMP
    try {
        $env:TEMP = $compilerTemp
        $env:TMP = $compilerTemp
        Invoke-CSharpCompile -Sources $commonSources -OutputAssembly $commonAssembly -GenerateExecutable $false
        Invoke-CSharpCompile -Sources @($childSource) -OutputAssembly $childAssembly -GenerateExecutable $true -AdditionalReferences @($commonAssembly)
        Invoke-CSharpCompile -Sources @($harnessSource) -OutputAssembly $harnessAssembly -GenerateExecutable $true -AdditionalReferences @($commonAssembly)
    }
    finally {
        $env:TEMP = $priorTemp
        $env:TMP = $priorTmp
    }

    & $harnessAssembly `
        --mode tests `
        --harness $harnessAssembly `
        --child $childAssembly `
        --generation-root $generationRoot `
        --work $workRoot `
        --evidence $evidencePath
    if ($LASTEXITCODE -ne 0) {
        throw 'Harness acceptance failed.'
    }

    if (-not $SkipPublicLint) {
        $lintScript = [System.IO.Path]::GetFullPath((Join-Path $prototypeRoot 'scripts\lint-public-evidence.mjs'))
        & node $lintScript
        if ($LASTEXITCODE -ne 0) {
            throw 'Public evidence lint failed.'
        }
    }
}
catch {
    if ($Diagnostic) {
        $safeMessage = [string]$_.Exception.Message
        $safeMessage = $safeMessage.Replace($prototypeRoot, '<prototype>')
        $safeMessage = [regex]::Replace($safeMessage, '[A-Za-z]:[\\/]Users[\\/][^\\/\s]+', '<private-root>')
        Write-Output ('DIAGNOSTIC ' + $safeMessage)
    }
    Write-Output 'RESULT build-or-test-failed'
    exit 1
}

exit 0
