#Requires -Version 5.1
<#
.SYNOPSIS
  把递笔工作台（DSH 适配层）安装到一个 DSH profile，并可选安装技能。

.DESCRIPTION
  1. 构建 lib/ 与 assets/editor.html；
  2. 用 DSH CLI 以 link: 方式安装本目录；
  3. 确认 dsh.profile.bundles 已选中本插件；
  4. 可选：把 writing-workbench 技能复制到 ~/.dsh/skills；
  5. 打印重启提示。

  本脚本不修改 Codex 版文件，也不会删除「码字工作台」数据目录。

.PARAMETER Profile
  DSH profile 名，桌面应用默认 desktop。

.PARAMETER Workspace
  作品目录。省略时读取 WORKBENCH_WORKSPACE，未设置时使用用户主目录下的 WriterWorkspaces。
  数据根为 <作品目录>\码字工作台\。安装会为新 profile 配置此路径，已有覆盖继续生效。

.PARAMETER DshCmd
  dsh 命令路径；省略时自动查找 PATH，再查找 DeepSeek Harness 默认安装位置。

.PARAMETER SkipBuild
  跳过构建，直接安装现有 lib/。

.PARAMETER SkipSkill
  不安装 writing-workbench 技能。

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Profile desktop -Workspace (Join-Path $env:USERPROFILE 'MyWriting')
#>
[CmdletBinding()]
param(
  [string]$Profile = 'desktop',
  [string]$Workspace,
  [string]$DshCmd,
  [switch]$SkipBuild,
  [switch]$SkipSkill
)

$ErrorActionPreference = 'Stop'
$packageRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Workspace)) {
  $Workspace = $env:WORKBENCH_WORKSPACE
}
if ([string]::IsNullOrWhiteSpace($Workspace)) {
  $Workspace = Join-Path $env:USERPROFILE 'WriterWorkspaces'
}
$Workspace = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Workspace.Trim())

function Find-DshCmd {
  if ($DshCmd) {
    if (-not (Test-Path -LiteralPath $DshCmd)) { throw "找不到 DshCmd：$DshCmd" }
    return (Resolve-Path -LiteralPath $DshCmd).Path
  }
  $command = Get-Command dsh -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if ($env:LOCALAPPDATA) {
    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw '找不到 dsh 命令。请用 -DshCmd 指定 dsh.cmd 的完整路径。'
}

function Update-ProfileManifest {
  param([string]$ProfileDir, [string]$PackageName)
  $manifestPath = Join-Path $ProfileDir 'package.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "profile 清单不存在：$manifestPath（请先运行一次 dsh --profile $Profile）"
  }
  $script = @'
const fs = require('fs');
const [file, name] = process.argv.slice(1);
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
json.dependencies ??= {};
json.dsh ??= {};
json.dsh.profile ??= {};
json.dsh.profile.bundles ??= [];
let changed = false;
if (json.dependencies[name] === undefined) { changed = true; }
if (!json.dsh.profile.bundles.includes(name)) {
  json.dsh.profile.bundles.push(name);
  changed = true;
}
if (changed) {
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
  console.log('updated');
} else {
  console.log('unchanged');
}
'@
  $result = & node -e $script $manifestPath $PackageName
  Write-Host "  profile 清单：$result"
}

function Add-WorkspaceOverride {
  param([string]$ProfileDir, [string]$WorkspacePath)
  $patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
  $existing = if (Test-Path -LiteralPath $patchPath) { Get-Content -LiteralPath $patchPath -Raw } else { '' }
  if ($existing -match '(?m)^\s*-\s*id:\s*writer-workbench\s*$') {
    Write-Host '  profile 覆盖行已存在，保留原配置（如需改 workspace 请手动编辑）。'
    return $false
  }
  $escaped = $WorkspacePath.Replace("'", "''")
  $block = @"

# 递笔工作台：profile 层覆盖 bundle 默认的 workspace（安装脚本写入）
- id: writer-workbench
  name: dsh-writer-workbench
  config:
    workspace: '$escaped'
"@
  Add-Content -LiteralPath $patchPath -Value $block -Encoding UTF8
  Write-Host "  已写入 workspace 覆盖：$WorkspacePath"
  return $true
}

Write-Host '递笔工作台 · DSH 适配层安装'
Write-Host "  插件目录：$packageRoot"
Write-Host "  新配置拟用作品目录：$Workspace"
Write-Host "  profile：$Profile"

if (-not $SkipBuild) {
  Write-Host '[1/5] 构建宿主与浏览器 bundle…'
  Push-Location $packageRoot
  try {
    & node scripts/build.mjs
    if ($LASTEXITCODE -ne 0) { throw '构建失败' }
  } finally {
    Pop-Location
  }
} else {
  Write-Host '[1/5] 跳过构建'
  if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'lib\index.js'))) {
    throw 'lib/index.js 不存在，不能使用 -SkipBuild'
  }
}

$resolvedDsh = Find-DshCmd
Write-Host "[2/5] 安装到 profile（$resolvedDsh）…"
& $resolvedDsh plugin --profile $Profile add $packageRoot
if ($LASTEXITCODE -ne 0) { throw 'dsh plugin add 失败' }

$profileDir = Join-Path (Join-Path $env:USERPROFILE '.dsh\profiles') $Profile
if (-not (Test-Path -LiteralPath $profileDir)) {
  throw "找不到 profile 目录：$profileDir"
}

Write-Host '[3/5] 确认 bundle 选择…'
Update-ProfileManifest -ProfileDir $profileDir -PackageName 'dsh-writer-workbench'

Write-Host '[4/5] 写入 profile 层 workspace…'
$workspaceConfigured = Add-WorkspaceOverride -ProfileDir $profileDir -WorkspacePath $Workspace

if (-not $SkipSkill) {
  Write-Host '[5/5] 安装技能…'
  $skillSource = Join-Path $packageRoot 'skills\writing-workbench'
  $skillTarget = Join-Path (Join-Path $env:USERPROFILE '.dsh\skills') 'writing-workbench'
  if (Test-Path -LiteralPath $skillSource) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $skillTarget) | Out-Null
    Copy-Item -LiteralPath $skillSource -Destination (Split-Path -Parent $skillTarget) -Recurse -Force
    Write-Host "  技能已安装：$skillTarget"
  } else {
    Write-Host '  技能目录不存在，跳过。'
  }
} else {
  Write-Host '[5/5] 跳过技能'
}

Write-Host ''
Write-Host '完成。请完全退出并重新启动 DSH 桌面应用，然后：'
Write-Host '  - 点页面右侧的「✎ 递笔工作台」；'
Write-Host '  - 或在对话里说“打开递笔工作台”（open_workbench）；'
Write-Host '  - 说“检查递笔工作台接入”验证（workbench_status）。'
if ($workspaceConfigured) {
  Write-Host '数据目录：' (Join-Path $Workspace '码字工作台')
} else {
  Write-Host '沿用原 profile 的数据目录，可通过 workbench_status 查看。'
}
