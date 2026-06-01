# Applies LAN/camera permissions and Android TLS trust config after Capacitor platforms exist.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$androidXmlSource = Join-Path $root "native-config\android\network_security_config.xml"
$androidXmlTargetDir = Join-Path $root "android\app\src\main\res\xml"
$androidXmlTarget = Join-Path $androidXmlTargetDir "network_security_config.xml"
$androidManifest = Join-Path $root "android\app\src\main\AndroidManifest.xml"

if (Test-Path $androidXmlSource) {
  if (-not (Test-Path $androidXmlTargetDir)) {
    New-Item -ItemType Directory -Path $androidXmlTargetDir -Force | Out-Null
  }

  Copy-Item -Path $androidXmlSource -Destination $androidXmlTarget -Force
  Write-Host "Copied Android network security config."

  if (Test-Path $androidManifest) {
    $manifest = Get-Content $androidManifest -Raw
    if ($manifest -notmatch "networkSecurityConfig") {
      $manifest = $manifest -replace
        '(<application[^>]*)(>)',
        '$1 android:networkSecurityConfig="@xml/network_security_config"$2'
      Set-Content -Path $androidManifest -Value $manifest -NoNewline
      Write-Host "Updated AndroidManifest.xml with networkSecurityConfig."
    }
  }
}

$iosPlist = Join-Path $root "ios\App\App\Info.plist"
if (Test-Path $iosPlist) {
  $plist = Get-Content $iosPlist -Raw
  $changed = $false

  if ($plist -notmatch "NSCameraUsageDescription") {
    $plist = $plist -replace
      "(<dict>)",
      @"
`$1
	<key>NSCameraUsageDescription</key>
	<string>Scan sensor QR codes for onboarding.</string>
"@
    $changed = $true
  }

  if ($plist -notmatch "NSLocalNetworkUsageDescription") {
    $plist = $plist -replace
      "(<dict>)",
      @"
`$1
	<key>NSLocalNetworkUsageDescription</key>
	<string>Connect to the MultiTech gateway on your network to add sensors.</string>
"@
    $changed = $true
  }

  if ($plist -notmatch "NSAllowsLocalNetworking") {
    $plist = $plist -replace
      "(<dict>)",
      @"
`$1
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
"@
    $changed = $true
  }

  if ($changed) {
    Set-Content -Path $iosPlist -Value $plist -NoNewline
    Write-Host "Updated iOS Info.plist permissions and local networking."
  }
}

Write-Host "Native config apply finished."
