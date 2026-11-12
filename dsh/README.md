# 递笔工作台 · DeepSeek Harness 适配层

这是原 Codex 插件 `writer-workbench` 的 DSH 适配层。**它不复制、不改写 Codex 版**：
`.codex-plugin/`、`.mcp.json`、`dist/server.mjs`、`skills/` 和原 `package.json` 都保持原样，
Codex 仍然按原来的方式加载。

适配层做三件事：

1. **复用原界面**：把 Codex 版打包好的 `dist/editor.html`（一个标准 MCP App）放进
   `assets/editor.html`，由 DSH 页面内嵌 iframe 加载，不重写编辑器。
2. **补一个 MCP Apps 宿主**：原界面通过 `postMessage` 发 `ui/initialize`、`tools/call`、
   `ui/message`；`src/bridge.mjs` 在 DSH 页面里扮演这个宿主，把工具调用转到同源 HTTP
   接口，把递笔要求和批注直接发送到当前 DSH 会话。
3. **接回原本地数据**：`src/runtime.mjs` 直接复用 Codex 版的 `src/workspace.mjs`，
   两边配置相同工作区后，都读写该工作区的 `码字工作台/`。

## 目录

```text
apps/writer-workbench/
├─ .codex-plugin/ .mcp.json dist/ src/ skills/ ...   # Codex 版，原样保留
└─ dsh/                                              # 本适配层（一个独立 DSH 插件包）
   ├─ package.json          # dsh.bundle.patch / dsh.client
   ├─ cordis.patch.yml      # 挂载行 + workspace 配置
   ├─ src/index.mjs         # 宿主半侧：路由 + open_workbench / workbench_status
   ├─ src/runtime.mjs       # 可单测的 HTTP API / 打开计数
   ├─ src/bridge.mjs        # MCP Apps 宿主桥（纯函数）
   ├─ src/client.mjs        # 浏览器半侧：输入框入口 + 右侧栏标签页 + iframe
   ├─ lib/                  # 构建产物
   ├─ assets/editor.html    # 从 ../dist/editor.html 同步
   └─ skills/writing-workbench/SKILL.md
```

## 安装

在仓库根目录安装依赖并构建，再运行 DSH 安装脚本：

```powershell
npm ci
npm run build
.\dsh\install.ps1 -SkipBuild
```

默认安装到 `desktop` profile。新配置的工作区默认是用户主目录下的 `WriterWorkspaces`，
数据保存在其下的 `码字工作台/`。`WORKBENCH_WORKSPACE` 可覆盖默认值，也可显式指定路径：

```powershell
.\dsh\install.ps1 -SkipBuild `
  -Profile desktop `
  -Workspace (Join-Path $env:USERPROFILE 'MyWriting')
```

升级时安装脚本保留已有 profile 的工作区。若需要在两端继续使用已有作品，请让 Codex 与 DSH 指向原工作区。
如果 `dsh` 命令不在 PATH 或默认安装位置，可向脚本传入 `-DshCmd`。

完成构建后，也可手动安装 bundle：

```powershell
dsh plugin --profile desktop add (Resolve-Path .\dsh).Path
```

`dsh plugin add` 会自动把 `dsh-writer-workbench` 追加到 profile 的
`dsh.profile.bundles`。如果没有，请手动在
`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 末尾加上
`"dsh-writer-workbench"`。

然后**完全退出并重启 DSH 桌面应用**（新插件包只在启动时组合，刷新页面不会加载新包）。

> 之后只改界面（`assets/editor.html`）时，重新 `npm run build` 后刷新页面，或关掉工作台标签再打开，
> 就会加载新界面；改了宿主代码（`src/index.mjs` / `src/runtime.mjs`）才需要再次完全重启。

技能会装到 `%USERPROFILE%\.dsh\skills\writing-workbench`，让模型更容易主动打开工作台；
不需要时删掉该目录即可。

## 使用

- 聊天输入框右侧有一个「✎ 递笔」按钮，点一下会在 **DSH 原生右侧栏**打开「递笔工作台」标签页，
  不会遮住对话。标签页自带「关闭 ×」，右侧栏也可以随时收起；还可以点标签条上的「全屏」。
- 工作台首页是「我的书架」：还没有作品时是一本空白的书，点击即可创建第一个作品；有作品后
  每本书是一个作品，下方显示文稿数与最近更新，书架末尾的虚线框也可以添加作品。点击封面会
  打开该作品「正文」里最近更新的文稿，并展开文稿侧栏；右键封面可以重命名作品、更改或移除封面。
  顶部「书架」按钮可随时回到书架；未另存的草稿和没有归入作品的散篇文稿也会以书的形式留在书架上。
- 在对话里说“打开递笔工作台”，模型会调用 `open_workbench`；页面最多 1.5 秒内自动在右侧栏打开/聚焦该标签页。
- 说“检查递笔工作台接入”，模型会调用 `workbench_status`。
- 工作台里选中正文或放置光标 → 右键「递笔」，在同一弹窗填写要求后暂存或直接发送到当前 DSH 会话；
  Enter 发送，Shift+Enter 换行。批注区「全部发送到聊天」也直接发送，无需到聊天窗二次确认。
- 在文件树里右键文稿或文件夹 →「重命名」（也可以按 F2），可直接改名；正文上方的「第一章」标题同样可改，回车生效。
  文件扩展名会自动保留，同名不会覆盖，重命名会同步文件树、当前文稿路径和作品封面。
  「设定」「正文」「草稿」是作品的结构名，改名会先弹出确认，因为工作台靠这些名字识别作品。
- 数据保存在 `<workspace>/码字工作台/`。两端配置相同工作区即可共用文稿和记录。

> 如果你之前看到的是“全屏盖住、退不出”的旧版本：那是 0.3.0-dsh.1 的客户端。
> 先按 `Ctrl+R` 刷新页面；若仍是旧界面，完全关闭并重开 DSH。0.3.0-dsh.2 起改为右侧栏标签页。

## 配置

`cordis.patch.yml` 里的 `workspace` 是作品目录：

```yaml
- insert:
    - id: writer-workbench
      name: 'dsh-writer-workbench'
      config: {}
```

省略 `workspace` 时，宿主依次采用 `WORKBENCH_WORKSPACE` 环境变量和用户主目录下的 `WriterWorkspaces`，
不依赖启动时的当前目录。需要自定义时，在 `config` 下设置 `workspace` 的绝对路径，然后重启 DSH。也可以不改插件包，在
`~/.dsh/profiles/desktop/cordis.patch.yml` 里追加一条同 id 的覆盖行（profile 层优先）：

```yaml
- id: writer-workbench
  name: dsh-writer-workbench
  config:
    workspace: 'C:\Writing\MyBooks'
```

## 验证

```powershell
cd dsh
npm test          # 18 个测试：workspace 往返、回收站、路径穿越、MCP Apps 桥、宿主工具、客户端注册
```

另外两个真实浏览器冒烟脚本（需要 `~/.dsh/electron/electron.exe`）：

```powershell
# 1) 只测 editor.html + MCP Apps 桥，不启动 DSH
$env:ELECTRON_RUN_AS_NODE=$null
& "$env:USERPROFILE\.dsh\electron\electron.exe" tests\e2e\main.cjs

# 2) 测真实 DSH Web UI：需要先启动一个带本插件的 profile
#    dsh --profile wwtest --port 0 --no-open
& "$env:USERPROFILE\.dsh\electron\electron.exe" tests\e2e\dsh-ui.cjs "http://127.0.0.1:<port>/?token=..."
```

第 2 个脚本已验证：输入框右侧入口出现、工作台在右侧栏标签页打开、iframe 连上宿主、
现有作品/章节渲染、原生「关闭」按钮可用、`open_workbench` 计数重新打开。选区流程现改为工作台对话弹窗；新版脚本验证弹窗与取消，直接发送由模拟宿主测试覆盖，不自动向真实聊天发送测试消息。

## 与 Codex 共存

- 适配层只新增 `dsh/` 目录，不改 Codex 的任何入口或产物。
- 两边读写同一个 `码字工作台/`；不要同时打开两边的同一个文稿编辑（保存冲突保护会拒绝覆盖，
  但最稳妥是同一时间只用一个客户端）。
- 适配层的构建会从 `../dist/editor.html` 复制一份；Codex 版重新构建后，重跑
  `npm run build` 即可同步界面。

## 已知限制

- 工作台在 DSH 右侧栏标签页里，宽度由右侧栏决定；可拖动分隔条或点标签条上的「全屏」放大。
  工作台宽度以「文稿侧栏 + 正文宽度」为上限并居中，右侧栏再宽也不会把侧栏和正文之间的空白撑大；
  正文宽度可在「设置 → 排版」里调整，侧栏也可以设到文本右边（「设置 → 布局」）。窄宽度下工作台会自动把文件侧栏移到正文下方。
- 码字统计固定在文稿侧栏里，不会浮出来遮挡正文；进入全屏写作时按原来的悬浮窗单独显示，
  可拖动并在本次打开期间记住位置，退出全屏后自动归位。
- 直接发送需要活动会话提供原生发送接口；缺少接口时明确报错并保留内容。已有的聊天草稿及附件不会连带发送。
- 批注与每轮结果持久保存在本地；刷新、重启后仍可恢复。统一使用「递笔」入口，讨论、补写和改写按要求处理。
- 文件夹也能重命名，但「设定」「正文」「草稿」是结构名：改名后工作台可能不再把该目录识别为作品，需要时改回来即可。
- 工作台需要页面在线才能打开；`open_workbench` 在没有页面连接时只登记请求。
- DSH 的右侧栏会话识别依赖 `sidebarRight.mounted`；如果某个部署没有这个服务，且同时存在
  多个会话，选区写入会提示“没有活动的会话”。

## 卸载

```powershell
dsh plugin --profile desktop remove dsh-writer-workbench
```

再从 `dsh.profile.bundles` 删除对应项（`pnpm remove` 通常会自动处理），重启 DSH。
`码字工作台/` 数据目录不会被删除。
