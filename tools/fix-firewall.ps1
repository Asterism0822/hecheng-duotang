# 需要管理员权限运行：放行「合成多糖」本机服务器的入站连接
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'duotang-firewall.log'
"start $(Get-Date -Format o)" | Set-Content -Path $log -Encoding UTF8

try {
  $rules = Get-NetFirewallRule -DisplayName 'Node.js JavaScript Runtime' -ErrorAction SilentlyContinue
  if ($rules) {
    $count = @($rules).Count
    $rules | Remove-NetFirewallRule
    Add-Content $log "removed $count block rule(s) for node.exe"
  } else {
    Add-Content $log 'no node block rules found'
  }

  $name = 'Duotang Local Game (TCP 3000)'
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $name `
    -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any `
    -Description 'Allow the local Hecheng Duotang game server' | Out-Null
  Add-Content $log 'allow rule added'

  Get-NetFirewallRule -DisplayName $name | ForEach-Object {
    Add-Content $log ("rule: {0} | action={1} profile={2} enabled={3}" -f $_.DisplayName, $_.Action, $_.Profile, $_.Enabled)
  }
  Add-Content $log 'done'
} catch {
  Add-Content $log ("error: " + $_.Exception.Message)
}
