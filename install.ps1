#Requires -Version 5.1
<#
.SYNOPSIS
  安装递笔工作台到 Codex、DeepSeek Harness 或两者。

.DESCRIPTION
  需要 Node.js 22 或更新版本，以及所选宿主。源码安装另需 npm 和 npm registry
  访问权限。使用 Windows 预构建包时添加 -SkipBuild。
  Codex 需支持 plugin marketplace add 和 plugin add 的 CLI。DeepSeek Harness
  需先启动一次对应 profile。请将解压后的目录保留在固定位置。

.PARAMETER HostApp
  Codex、DeepSeek 或 Both。默认为 Codex。

.PARAMETER Workspace
  写作工作区目录。优先使用此参数，其次为 WORKBENCH_WORKSPACE，默认是用户目录下的 WriterWorkspaces。

.PARAMETER CodexCmd
  codex 不在 PATH 时，指定 codex.exe 或 codex.cmd 路径。

.PARAMETER DshCmd
  dsh 不在 PATH 或默认安装位置时，指定 dsh.cmd 路径。

.PARAMETER Profile
  DeepSeek Harness profile。默认为 desktop。

.PARAMETER SkipBuild
  使用包内预构建文件，只生成本机运行配置。

.EXAMPLE
  .\install.ps1 -HostApp Codex -SkipBuild

.EXAMPLE
  .\install.ps1 -HostApp Both -SkipBuild -Workspace 'D:\Writing'
#>
[CmdletBinding()]
param(
    [ValidateSet('Codex', 'DeepSeek', 'Both')]
    [string]$HostApp = 'Codex',
    [string]$Workspace,
    [string]$CodexCmd,
    [string]$DshCmd,
    [ValidateNotNullOrEmpty()]
    [string]$Profile = 'desktop',
    [switch]$SkipBuild,
    [switch]$SkipSkill
)

$ErrorActionPreference = 'Stop'
$installCodex = $HostApp -in @('Codex', 'Both')
$installDsh = $HostApp -in @('DeepSeek', 'Both')

function Resolve-Application {
    param([string]$Name, [string]$ExplicitPath, [string]$MissingMessage)

    if ($ExplicitPath) {
        if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
            throw "找不到 $Name 命令：$ExplicitPath"
        }
        return (Resolve-Path -LiteralPath $ExplicitPath).ProviderPath
    }
    $command = Get-Command -Name $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw $MissingMessage }
    return $command.Source
}

function Invoke-CheckedCommand {
    param([string]$Command, [string[]]$CommandArgs)

    & $Command @CommandArgs
    if ($LASTEXITCODE -ne 0) {
        $commandName = [System.IO.Path]::GetFileName($Command)
        throw "$commandName $($CommandArgs -join ' ') 执行失败，退出码 $LASTEXITCODE。"
    }
}

function Assert-PackageFile {
    param([string]$RelativePath)

    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $RelativePath) -PathType Leaf)) {
        throw "安装包缺少 $RelativePath。请重新解压完整安装包；源码目录安装时请省略 -SkipBuild。"
    }
}

function Stage-CodexRuntime {
    $runtime = Join-Path $PSScriptRoot 'runtime'
    foreach ($directory in @('dist', 'assets', '.codex-plugin', 'skills')) {
        New-Item -ItemType Directory -Path (Join-Path $runtime $directory) -Force | Out-Null
    }
    foreach ($file in @('dist/server.mjs', 'dist/editor.html', 'assets/icon.svg', '.codex-plugin/plugin.json')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $runtime $file) -Force
    }
    Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'skills') -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $runtime 'skills') -Recurse -Force
    }
}

if ([string]::IsNullOrWhiteSpace($Workspace)) { $Workspace = $env:WORKBENCH_WORKSPACE }
if ([string]::IsNullOrWhiteSpace($Workspace)) { $Workspace = Join-Path $env:USERPROFILE 'WriterWorkspaces' }
$Workspace = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Workspace)
if (Test-Path -LiteralPath $Workspace -PathType Leaf) {
    throw "工作区路径指向文件，请指定目录：$Workspace"
}

$node = Resolve-Application -Name 'node' -MissingMessage '请安装 Node.js 22 或更新版本，并将 node 加入 PATH。'
$nodeMajor = & $node -p 'process.versions.node.split(String.fromCharCode(46))[0]'
if ($LASTEXITCODE -ne 0 -or $nodeMajor -notmatch '^\d+$' -or [int]$nodeMajor -lt 22) {
    throw '需要 Node.js 22 或更新版本。'
}
if (-not $SkipBuild) {
    $npm = Resolve-Application -Name 'npm' -MissingMessage '源码安装需要 npm。请安装带 npm 的 Node.js。'
    Assert-PackageFile 'package-lock.json'
    Assert-PackageFile 'scripts/build-all.mjs'
}
if ($installCodex) {
    $codex = Resolve-Application -Name 'codex' -ExplicitPath $CodexCmd -MissingMessage '找不到 Codex CLI。请将 codex 加入 PATH，或用 -CodexCmd 指定路径。'
    Assert-PackageFile '.agents/plugins/marketplace.json'
    Assert-PackageFile 'scripts/configure-local.mjs'
    if ($SkipBuild) {
        foreach ($file in @('dist/server.mjs', 'dist/editor.html', 'assets/icon.svg', '.codex-plugin/plugin.json')) {
            Assert-PackageFile $file
        }
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'skills') -PathType Container)) {
            throw '安装包缺少 skills 目录，请重新解压完整安装包。'
        }
    }
}
if ($installDsh) {
    Assert-PackageFile 'dsh/install.ps1'
    if ($DshCmd) {
        $DshCmd = Resolve-Application -Name 'dsh' -ExplicitPath $DshCmd
    }
    if ($SkipBuild) {
        foreach ($file in @('dsh/lib/index.js', 'dsh/lib/client.js', 'dsh/assets/editor.html', 'dsh/assets/icon.svg')) {
            Assert-PackageFile $file
        }
    }
}

$originalWorkspace = $env:WORKBENCH_WORKSPACE
Push-Location -LiteralPath $PSScriptRoot
try {
    $env:WORKBENCH_WORKSPACE = $Workspace
    if (-not $SkipBuild) {
        Write-Host '安装依赖并构建递笔工作台…'
        Invoke-CheckedCommand -Command $npm -CommandArgs @('ci')
        Invoke-CheckedCommand -Command $npm -CommandArgs @('run', 'build')
    }
    if ($installCodex) {
        Write-Host '安装 Codex 插件…'
        if ($SkipBuild) {
            Stage-CodexRuntime
            Invoke-CheckedCommand -Command $node -CommandArgs @('scripts/configure-local.mjs', $Workspace)
        }
        Invoke-CheckedCommand -Command $codex -CommandArgs @('plugin', 'marketplace', 'add', '.')
        Invoke-CheckedCommand -Command $codex -CommandArgs @('plugin', 'add', 'writer-workbench@writer-tools-local')
    }
    if ($installDsh) {
        Write-Host '安装 DeepSeek Harness 插件…'
        $dshParams = @{ Profile = $Profile; Workspace = $Workspace; SkipBuild = $true; SkipSkill = $SkipSkill }
        if ($DshCmd) { $dshParams.DshCmd = $DshCmd }
        & (Join-Path $PSScriptRoot 'dsh/install.ps1') @dshParams
    }
} finally {
    $env:WORKBENCH_WORKSPACE = $originalWorkspace
    Pop-Location
}

Write-Host '安装完成。请保留此安装目录，重启所选宿主后说「打开递笔工作台」。'
