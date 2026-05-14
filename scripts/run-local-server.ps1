param(
    [string]$AppRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$Host = "127.0.0.1",
    [int]$Port = 3000,
    [string]$ProxyAccessKey = "",
    [string]$AllowedGatewayHosts = "",
    [string]$AllowedGatewayCidrs = "",
    [string]$AllowedGatewaySuffixes = "",
    [bool]$AllowPrivateIpTargets = $true,
    [bool]$AllowHttpTargets = $false,
    [string]$DefaultGatewayTarget = ""
)

$distPath = Join-Path $AppRoot "dist\index.html"
if (-not (Test-Path $distPath)) {
    throw "Build output not found. Run 'npm run build' before starting the local server."
}

$nodeCommand = Get-Command node -ErrorAction Stop

$env:HOST = $Host
$env:PORT = [string]$Port
$env:PROXY_ACCESS_KEY = $ProxyAccessKey
$env:ALLOWED_GATEWAY_HOSTS = $AllowedGatewayHosts
$env:ALLOWED_GATEWAY_CIDRS = $AllowedGatewayCidrs
$env:ALLOWED_GATEWAY_SUFFIXES = $AllowedGatewaySuffixes
$env:ALLOW_PRIVATE_IP_TARGETS = if ($AllowPrivateIpTargets) { "true" } else { "false" }
$env:ALLOW_HTTP_TARGETS = if ($AllowHttpTargets) { "true" } else { "false" }
$env:DEFAULT_GATEWAY_TARGET = $DefaultGatewayTarget

Set-Location $AppRoot
& $nodeCommand.Source (Join-Path $AppRoot "server.mjs")
