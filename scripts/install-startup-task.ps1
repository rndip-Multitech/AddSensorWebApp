param(
    [string]$TaskName = "MultitechSensorOnboarding",
    [string]$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$Host = "0.0.0.0",
    [int]$Port = 3000,
    [string]$ProxyAccessKey = "",
    [string]$AllowedGatewayHosts = "",
    [string]$AllowedGatewayCidrs = "",
    [string]$AllowedGatewaySuffixes = "",
    [bool]$AllowPrivateIpTargets = $true,
    [bool]$AllowHttpTargets = $false,
    [string]$DefaultGatewayTarget = ""
)

Set-Location $AppRoot
npm run build
if ($LASTEXITCODE -ne 0) {
    throw "Build failed. Startup task was not installed."
}

$runScript = Join-Path $AppRoot "scripts\run-local-server.ps1"
$arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$runScript`"",
    "-AppRoot", "`"$AppRoot`"",
    "-Host", "`"$Host`"",
    "-Port", $Port,
    "-ProxyAccessKey", "`"$ProxyAccessKey`"",
    "-AllowedGatewayHosts", "`"$AllowedGatewayHosts`"",
    "-AllowedGatewayCidrs", "`"$AllowedGatewayCidrs`"",
    "-AllowedGatewaySuffixes", "`"$AllowedGatewaySuffixes`"",
    "-AllowPrivateIpTargets:`$" + $AllowPrivateIpTargets.ToString().ToLower(),
    "-AllowHttpTargets:`$" + $AllowHttpTargets.ToString().ToLower(),
    "-DefaultGatewayTarget", "`"$DefaultGatewayTarget`""
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $AppRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Runs the Multitech Sensor Onboarding local proxy server at logon." `
    -Force | Out-Null

Write-Host "Installed startup task '$TaskName'."
Write-Host "The server will start at logon using host $Host and port $Port."
