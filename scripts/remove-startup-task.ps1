param(
    [string]$TaskName = "MultitechSensorOnboarding"
)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Removed startup task '$TaskName'."
