$scriptPath = $PSScriptRoot
$env:Path = "$scriptPath\node;" + $env:Path
Set-Location -Path $scriptPath
Write-Host "Launching Smart Messenger full-stack application concurrently..."
& "$scriptPath\node\node.exe" run_dev.js
