# ============================================================================
# Nuvana Installation Test Script
#
# Verifies the installation of Nuvana application on Windows.
# Tests silent installation, file verification, and application launch.
#
# Usage: .\test-install.ps1 -InstallerPath <path> [-InstallDir <path>]
#
# @module tests/installation
# ============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$InstallerPath,

    [Parameter(Mandatory=$false)]
    [string]$InstallDir = "$env:ProgramFiles\Nuvana",

    [Parameter(Mandatory=$false)]
    [switch]$Verbose
)

# ============================================================================
# Configuration
# ============================================================================

$ErrorActionPreference = "Stop"
$TestsPassed = 0
$TestsFailed = 0

# Required files after installation
$RequiredFiles = @(
    "Nuvana.exe",
    "resources\app.asar"
)

# Optional files (warnings if missing)
$OptionalFiles = @(
    "resources\migrations"
)

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

function Write-Warning {
    param([string]$Message)
    Write-Host "  [WARN] $Message" -ForegroundColor Yellow
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

# Verify installer exists
if (-not (Test-Path $InstallerPath)) {
    Write-Host "ERROR: Installer not found at: $InstallerPath" -ForegroundColor Red
    exit 1
}

Write-TestResult "Installer exists" $true $InstallerPath

# Get installer size
$installerSize = (Get-Item $InstallerPath).Length / 1MB
Write-Info "Installer size: $([math]::Round($installerSize, 2)) MB"

# Check if already installed
if (Test-Path "$InstallDir\Nuvana.exe") {
    Write-Warning "Nuvana already installed at $InstallDir"
    Write-Warning "This test will reinstall/upgrade"
}

# Stop any running instances
Stop-NuvanaProcess

# ============================================================================
# Test 1: Silent Installation
# ============================================================================

Write-TestHeader "Test 1: Silent Installation"

try {
    Write-Info "Running silent installation..."
    Write-Info "Install directory: $InstallDir"

    $installProcess = Start-Process -FilePath $InstallerPath `
        -ArgumentList "/S", "/D=$InstallDir" `
        -Wait -PassThru -NoNewWindow

    $installSuccess = $installProcess.ExitCode -eq 0
    Write-TestResult "Silent installation completed" $installSuccess "Exit code: $($installProcess.ExitCode)"

    if (-not $installSuccess) {
        Write-Host "Installation failed with exit code: $($installProcess.ExitCode)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-TestResult "Silent installation completed" $false $_.Exception.Message
    exit 1
}

# Wait for installation to complete
Start-Sleep -Seconds 3

# ============================================================================
# Test 2: Verify Required Files
# ============================================================================

Write-TestHeader "Test 2: Verify Required Files"

foreach ($file in $RequiredFiles) {
    $fullPath = Join-Path $InstallDir $file
    $exists = Test-Path $fullPath
    Write-TestResult "File exists: $file" $exists
}

# Check optional files
foreach ($file in $OptionalFiles) {
    $fullPath = Join-Path $InstallDir $file
    if (-not (Test-Path $fullPath)) {
        Write-Warning "Optional file missing: $file"
    }
}

# ============================================================================
# Test 3: Application Launch
# ============================================================================

Write-TestHeader "Test 3: Application Launch"

$exePath = Join-Path $InstallDir "Nuvana.exe"

try {
    Write-Info "Starting application..."
    $process = Start-Process -FilePath $exePath -PassThru

    # Wait for application to initialize
    Start-Sleep -Seconds 10

    # Check if process is still running
    $stillRunning = $null -ne (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)
    Write-TestResult "Application started successfully" $stillRunning "PID: $($process.Id)"

    if ($stillRunning) {
        # Stop the application
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
} catch {
    Write-TestResult "Application started successfully" $false $_.Exception.Message
}

# ============================================================================
# Test 4: Verify Shortcuts
# ============================================================================

Write-TestHeader "Test 4: Verify Shortcuts"

# Desktop shortcut
$desktopShortcut = "$env:PUBLIC\Desktop\Nuvana.lnk"
$desktopExists = Test-Path $desktopShortcut
Write-TestResult "Desktop shortcut created" $desktopExists

# Start menu shortcut
$startMenuShortcut = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Nuvana\Nuvana.lnk"
$startMenuExists = Test-Path $startMenuShortcut
Write-TestResult "Start menu shortcut created" $startMenuExists

# Alternative start menu location (all users)
if (-not $startMenuExists) {
    $altStartMenu = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Nuvana\Nuvana.lnk"
    if (Test-Path $altStartMenu) {
        Write-Info "Start menu shortcut found in alternate location"
    }
}

# ============================================================================
# Test 5: App Data Folder
# ============================================================================

Write-TestHeader "Test 5: App Data Folder"

$appDataPath = "$env:LOCALAPPDATA\nuvana"

# Note: App data folder may be created on first run
if (Test-Path $appDataPath) {
    Write-TestResult "App data folder exists" $true $appDataPath
} else {
    Write-Warning "App data folder not created yet (may be created on first run)"
}

# ============================================================================
# Test 6: Registry Entries (Uninstall info)
# ============================================================================

Write-TestHeader "Test 6: Registry Entries"

$uninstallKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
$nuvanaEntry = Get-ItemProperty $uninstallKey -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like "*Nuvana*" }

$registryExists = $null -ne $nuvanaEntry
Write-TestResult "Uninstall registry entry exists" $registryExists

if ($registryExists -and $Verbose) {
    Write-Info "Display Name: $($nuvanaEntry.DisplayName)"
    Write-Info "Version: $($nuvanaEntry.DisplayVersion)"
    Write-Info "Publisher: $($nuvanaEntry.Publisher)"
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
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some tests failed. Please review the results above." -ForegroundColor Red
    exit 1
}
