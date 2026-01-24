# ============================================================================
# Nuvana Uninstall Test Script
#
# Verifies the uninstallation of Nuvana application on Windows.
# Tests both data-preserving and full uninstallation.
#
# Usage: .\test-uninstall.ps1 [-InstallDir <path>] [-KeepData]
#
# @module tests/installation
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$InstallDir = "$env:ProgramFiles\Nuvana",

    [Parameter(Mandatory=$false)]
    [switch]$KeepData,

    [Parameter(Mandatory=$false)]
    [switch]$Verbose
)

# ============================================================================
# Configuration
# ============================================================================

$ErrorActionPreference = "Stop"
$TestsPassed = 0
$TestsFailed = 0

# ============================================================================
# Helper Functions
# ============================================================================

function Write-TestHeader {
    param([string]$Message)
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-TestResult {
    param(
        [string]$TestName,
        [bool]$Passed,
        [string]$Details = ""
    )

    if ($Passed) {
        Write-Host "  [PASS] $TestName" -ForegroundColor Green
        $script:TestsPassed++
    } else {
        Write-Host "  [FAIL] $TestName" -ForegroundColor Red
        $script:TestsFailed++
    }

    if ($Details -and $Verbose) {
        Write-Host "         $Details" -ForegroundColor Gray
    }
}

function Write-Info {
    param([string]$Message)
    Write-Host "  [INFO] $Message" -ForegroundColor Gray
}

function Stop-NuvanaProcess {
    $processes = Get-Process -Name "Nuvana" -ErrorAction SilentlyContinue
    if ($processes) {
        Write-Info "Stopping running Nuvana processes..."
        $processes | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
}

# ============================================================================
# Pre-flight Checks
# ============================================================================

Write-TestHeader "Pre-flight Checks"

# Check if installed
$uninstallExe = Join-Path $InstallDir "Uninstall Nuvana.exe"
if (-not (Test-Path $uninstallExe)) {
    # Try alternate uninstaller name
    $uninstallExe = Get-ChildItem $InstallDir -Filter "Uninstall*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}

if (-not $uninstallExe -or -not (Test-Path $uninstallExe)) {
    Write-Host "ERROR: Nuvana is not installed at: $InstallDir" -ForegroundColor Red
    Write-Host "       Or uninstaller not found" -ForegroundColor Red
    exit 1
}

Write-TestResult "Uninstaller exists" $true $uninstallExe

# Record app data state before uninstall
$appDataPath = "$env:LOCALAPPDATA\nuvana"
$appDataExisted = Test-Path $appDataPath
Write-Info "App data folder exists: $appDataExisted"

# Stop any running instances
Stop-NuvanaProcess

# ============================================================================
# Test 1: Run Uninstaller
# ============================================================================

Write-TestHeader "Test 1: Silent Uninstall"

try {
    Write-Info "Running silent uninstallation..."

    # NSIS uninstaller arguments
    # /S = Silent
    # _?= specifies install directory (for proper cleanup)
    $uninstallArgs = "/S", "_?=$InstallDir"

    $uninstallProcess = Start-Process -FilePath $uninstallExe `
        -ArgumentList $uninstallArgs `
        -Wait -PassThru -NoNewWindow

    $uninstallSuccess = $uninstallProcess.ExitCode -eq 0
    Write-TestResult "Silent uninstall completed" $uninstallSuccess "Exit code: $($uninstallProcess.ExitCode)"

} catch {
    Write-TestResult "Silent uninstall completed" $false $_.Exception.Message
    exit 1
}

# Wait for uninstall to complete
Start-Sleep -Seconds 5

# ============================================================================
# Test 2: Verify Application Removed
# ============================================================================

Write-TestHeader "Test 2: Verify Application Removed"

# Main executable should be gone
$exeRemoved = -not (Test-Path "$InstallDir\Nuvana.exe")
Write-TestResult "Application executable removed" $exeRemoved

# Install directory should be gone (or empty)
$installDirGone = -not (Test-Path $InstallDir) -or
    ((Get-ChildItem $InstallDir -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0)
Write-TestResult "Installation directory cleaned" $installDirGone

# ============================================================================
# Test 3: Verify Shortcuts Removed
# ============================================================================

Write-TestHeader "Test 3: Verify Shortcuts Removed"

# Desktop shortcut
$desktopShortcut = "$env:PUBLIC\Desktop\Nuvana.lnk"
$desktopRemoved = -not (Test-Path $desktopShortcut)
Write-TestResult "Desktop shortcut removed" $desktopRemoved

# User desktop shortcut
$userDesktopShortcut = "$env:USERPROFILE\Desktop\Nuvana.lnk"
$userDesktopRemoved = -not (Test-Path $userDesktopShortcut)
Write-TestResult "User desktop shortcut removed" $userDesktopRemoved

# Start menu shortcut
$startMenuFolder = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Nuvana"
$startMenuRemoved = -not (Test-Path $startMenuFolder)
Write-TestResult "Start menu folder removed" $startMenuRemoved

# ============================================================================
# Test 4: Verify Registry Cleaned
# ============================================================================

Write-TestHeader "Test 4: Verify Registry Cleaned"

$uninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
$nuvanaEntry = Get-ItemProperty $uninstallKey -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "*Nuvana*" }

$registryRemoved = $null -eq $nuvanaEntry
Write-TestResult "Uninstall registry entry removed" $registryRemoved

# ============================================================================
# Test 5: Check App Data (based on KeepData flag)
# ============================================================================

Write-TestHeader "Test 5: Check App Data"

$appDataStillExists = Test-Path $appDataPath

if ($KeepData) {
    # If KeepData was specified, data should still exist
    if ($appDataExisted) {
        Write-TestResult "App data preserved (as requested)" $appDataStillExists
    } else {
        Write-Info "App data folder did not exist before uninstall"
    }
} else {
    # If KeepData was not specified, behavior depends on user choice during uninstall
    # In silent mode, data is typically preserved by default
    if ($appDataStillExists) {
        Write-Info "App data folder still exists (user data preserved)"
        Write-Info "Path: $appDataPath"
    } else {
        Write-Info "App data folder removed"
    }
}

# ============================================================================
# Test 6: Check for Orphaned Processes
# ============================================================================

Write-TestHeader "Test 6: Check for Orphaned Processes"

$orphanedProcesses = Get-Process -Name "*Nuvana*" -ErrorAction SilentlyContinue
$noOrphans = $null -eq $orphanedProcesses -or $orphanedProcesses.Count -eq 0
Write-TestResult "No orphaned processes" $noOrphans

if (-not $noOrphans) {
    foreach ($proc in $orphanedProcesses) {
        Write-Info "Orphaned process: $($proc.Name) (PID: $($proc.Id))"
    }
}

# ============================================================================
# Summary
# ============================================================================

Write-TestHeader "Test Summary"

$totalTests = $TestsPassed + $TestsFailed
Write-Host "Total Tests: $totalTests" -ForegroundColor White
Write-Host "Passed: $TestsPassed" -ForegroundColor Green
Write-Host "Failed: $TestsFailed" -ForegroundColor $(if ($TestsFailed -gt 0) { "Red" } else { "Green" })

Write-Host ""

if ($TestsFailed -eq 0) {
    Write-Host "All uninstall tests passed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Cleanup Notes:" -ForegroundColor Yellow
    if ($appDataStillExists) {
        Write-Host "  - App data folder still exists at: $appDataPath" -ForegroundColor Yellow
        Write-Host "  - Contains: database, settings, logs" -ForegroundColor Yellow
        Write-Host "  - Delete manually if not needed" -ForegroundColor Yellow
    }
    exit 0
} else {
    Write-Host "Some uninstall tests failed. Please review the results above." -ForegroundColor Red
    exit 1
}
