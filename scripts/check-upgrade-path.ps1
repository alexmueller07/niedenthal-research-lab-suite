# Does an upgrade over an existing install actually work?
#
# This exists because it did not, from v1.1.0 to v1.3.0, and nothing caught it.
# Every check we had passed: the installer built, it was the right size, a clean
# install worked, and `/S` worked — which is the route the lab's own deployment
# notes use, so the one path nobody exercised was the one a person takes when
# they double-click the file. It failed with "Unable to uninstall!".
#
# The mechanism is in src-tauri/installer-hooks.nsh. The short version: Tauri's
# installer runs the OLD uninstaller in place (`uninstall.exe /P _?=$INSTDIR`)
# so it can wait on it, and our preinstall/preuninstall hook used to kill
# anything running from the install folder — which, run in place, includes the
# uninstaller. It shot itself, deleted nothing, exited -1.
#
# So this script checks the two things a release has to get right:
#
#   1. a clean silent install lands the app;
#   2. the uninstaller, invoked THE WAY AN UPGRADE INVOKES IT, actually
#      uninstalls — exit code 0 and no binary left behind. Tauri treats a
#      surviving $INSTDIR\<app>.exe as failure whatever the exit code, so both
#      halves matter.
#
#   .\scripts\check-upgrade-path.ps1 -Installer "path\to\...-setup.exe"
#
# It installs and uninstalls on the machine it runs on. Do not run it on a
# machine that is mid-session.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [string]$InstallDir = "$env:LOCALAPPDATA\Niedenthal Lab Suite",
    [string]$MainBinary = "lab-suite.exe"
)

$ErrorActionPreference = "Stop"
$failures = @()

function Step($msg) { Write-Host "==> $msg" }
function Fail($msg) { $script:failures += $msg; Write-Host "    FAIL: $msg" -ForegroundColor Red }
function Pass($msg) { Write-Host "    ok: $msg" -ForegroundColor Green }

if (-not (Test-Path $Installer)) { throw "installer not found: $Installer" }

Step "Clearing any existing install"
if (Test-Path "$InstallDir\uninstall.exe") {
    Start-Process -FilePath "$InstallDir\uninstall.exe" -ArgumentList "/S" -Wait
    Start-Sleep -Seconds 5
}
Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Niedenthal Lab Suite' `
    -Recurse -Force -ErrorAction SilentlyContinue

Step "Clean silent install"
$p = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($p.ExitCode -ne 0) { Fail "installer exited $($p.ExitCode)" } else { Pass "installer exited 0" }
if (-not (Test-Path "$InstallDir\$MainBinary")) { Fail "$MainBinary was not installed" }
else { Pass "$MainBinary installed" }

Step "Uninstall the way an upgrade does it (in place, _?=)"
if (Test-Path "$InstallDir\uninstall.exe") {
    $u = Start-Process -FilePath "$InstallDir\uninstall.exe" `
        -ArgumentList "/P", "_?=$InstallDir" -PassThru -Wait
    Start-Sleep -Seconds 3
    if ($u.ExitCode -ne 0) {
        Fail "in-place uninstaller exited $($u.ExitCode) (was -1 when the hook killed it)"
    } else {
        Pass "in-place uninstaller exited 0"
    }
    # The check Tauri itself makes before deciding an upgrade cannot proceed.
    if (Test-Path "$InstallDir\$MainBinary") {
        Fail "$MainBinary survived the uninstall - Tauri would show 'Unable to uninstall!'"
    } else {
        Pass "$MainBinary removed"
    }
} else {
    Fail "no uninstall.exe to test"
}

Step "Silent upgrade over an existing install"
Start-Process -FilePath $Installer -ArgumentList "/S" -Wait
$p2 = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
if ($p2.ExitCode -ne 0) { Fail "silent upgrade exited $($p2.ExitCode)" } else { Pass "silent upgrade exited 0" }
if (-not (Test-Path "$InstallDir\$MainBinary")) { Fail "$MainBinary missing after upgrade" }
else { Pass "$MainBinary present after upgrade" }

Write-Host ""
if ($failures.Count -eq 0) {
    Write-Host "All upgrade-path checks passed." -ForegroundColor Green
    exit 0
}
Write-Host "$($failures.Count) check(s) failed:" -ForegroundColor Red
$failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
exit 1
