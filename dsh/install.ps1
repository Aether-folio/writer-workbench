#Requires -Version 5.1
[CmdletBinding()]
param([string]$Profile='desktop',[string]$Workspace,[string]$DshCmd,[switch]$SkipSkill)
$ErrorActionPreference='Stop'
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'lib/index.js'))) { throw '请先在仓库根目录运行 npm ci 和 npm run build。' }
if (-not $Workspace) { $Workspace = if($env:WORKBENCH_WORKSPACE){$env:WORKBENCH_WORKSPACE}else{Join-Path $env:USERPROFILE '.writer-workbench'} }
$dataRoot=[System.IO.Path]::GetFullPath($Workspace)
if (-not $DshCmd) { $found=Get-Command dsh -ErrorAction SilentlyContinue;if(-not $found){throw '找不到 dsh，请通过 -DshCmd 指定命令路径。'};$DshCmd=$found.Source }
& $DshCmd plugin --profile $Profile add $PSScriptRoot
if($LASTEXITCODE -ne 0){throw 'DSH 安装失败。'}
$profileDir=Join-Path $env:USERPROFILE ('.dsh/profiles/'+$Profile)
$manifest=Join-Path $profileDir 'package.json'
if(-not(Test-Path -LiteralPath $manifest)){throw '未找到 profile 清单。请先启动一次该 profile。'}
$config=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
if(-not $config.PSObject.Properties['dsh']){$config|Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{})}
if(-not $config.dsh.PSObject.Properties['profile']){$config.dsh|Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{})}
if(-not $config.dsh.profile.PSObject.Properties['bundles']){$config.dsh.profile|Add-Member -NotePropertyName bundles -NotePropertyValue @()}
$bundle=@($config.dsh.profile.bundles)
if($bundle -notcontains 'dsh-writer-workbench'){$config.dsh.profile.bundles=@($bundle+'dsh-writer-workbench');[IO.File]::WriteAllText($manifest,($config|ConvertTo-Json -Depth 32),[Text.UTF8Encoding]::new($false))}
$patch=Join-Path $profileDir 'cordis.patch.yml'
$existing=if(Test-Path -LiteralPath $patch){[IO.File]::ReadAllText($patch)}else{''}
if($existing -match '(?m)^\s*-\s*id:\s*writer-workbench\s*$'){Write-Host '已有工作台配置，保留原配置；请核对 workspace。'}
else{
 $escaped=$dataRoot.Replace("'","''")
 $block="`n- id: writer-workbench`n  name: dsh-writer-workbench`n  config:`n    workspace: '$escaped'`n"
 [IO.File]::WriteAllText($patch,$existing+$block,[Text.UTF8Encoding]::new($false))
}
if(-not $SkipSkill){
 $source=Join-Path $PSScriptRoot 'skills/writing-workbench'
 $target=Join-Path $env:USERPROFILE '.dsh/skills/writing-workbench'
 New-Item -ItemType Directory -Path $target -Force | Out-Null
 Get-ChildItem -LiteralPath $source -File | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $target -Force}
}
Write-Host '已安装。请完全退出并重启 DSH。数据根目录：' $dataRoot
