# DeepSeek Harness 适配层

复用根目录的界面和数据逻辑，在 DSH 右侧栏打开工作台。选区与批注加入当前聊天草稿，不自动发送。

## 安装

在仓库根目录先运行 `npm ci`、`npm run build`，再运行：

```powershell
.\dsh\install.ps1 -Profile desktop
```

脚本使用 PATH 上的 `dsh` 命令；可通过 `-DshCmd` 指定。默认工作区为本插件项目目录（`dsh/` 的上一级），数据写入 `<插件项目目录>/码字工作台/`。`WORKBENCH_WORKSPACE` 环境变量可覆盖默认值，`-Workspace` 参数或宿主 `config.workspace` 可显式指定目录。默认路径不依赖启动时的当前目录。不会自动导入已有小说目录。

脚本将本包链接到指定 profile，在 `dsh.profile.bundles` 中登记，并安装配套技能。若 profile 已有工作台配置，保留原配置，需自行核对 workspace。安装后完全退出并重启 DSH。

也可手动执行 `dsh plugin --profile desktop add ./dsh`，并确保 profile 的 `dsh.profile.bundles` 含 `dsh-writer-workbench`。通过 profile 的 `cordis.patch.yml` 配置 workspace：

```yaml
- id: writer-workbench
  name: dsh-writer-workbench
  config:
    workspace: '/path/to/writing-data'
```

Codex 默认使用用户目录的 `.writer-workbench/`。如需共用 DSH 数据，在构建后运行 `node scripts/configure-local.mjs /path/to/writer-workbench`，或将两边的 `WORKBENCH_WORKSPACE` 配置成相同目录。编辑同一文稿时建议只使用一个客户端。

## 维护与测试

在根目录运行 `npm run build` 同时更新两边产物；`npm run test:dsh` 检查宿主桥与存储逻辑。不要只更新其中一边的 editor.html。

`tests/e2e/main.cjs` 使用 Electron 和独立临时目录测试完整宿主桥。将该脚本交给可用的 Electron 可执行文件运行。真实客户端的打开、全屏、退出与聊天草稿入口，请在独立测试 profile 中手动验收。不要将带凭据的测试 URL 写入文件或提交日志。

DSH 原生全屏时编辑区会进入全屏写作；也可点文稿右上角“全屏”。保留退出按钮和 Esc 退出，悬浮窗保持原位置。

工作台默认从“我的书架”进入；点击封面继续写作，右键管理作品名和封面。草稿与散篇也有单独入口。
