# 码字工作台 · Writer Workbench

码字工作台是一款面向小说作者和其他文字创作者的本地码字工具，支持在 Codex 或 DeepSeek Harness（DSH）里管理作品、编辑文稿、记录创作进度，并与 AI 协作写作。

它把码字与讨论放在同一个工作空间：作者选中需要讨论的段落，在工作台填写要求后直接发送到当前聊天，也可以在任意光标位置请求 AI 补写。生成的内容回到原位置的可编辑待采纳框，由作者决定采纳、批注重新生成或不采纳。

> AI 只是工具，真正的创作与好创意，始终来自作者的生活、想象与判断。愿这张小小的码字桌，能陪各位天之骄子把灵感写成故事。祝每一位笔者都能写出自己的代表作，早日成为白金大神。

## 功能

- **AI 协作写作**：围绕具体文稿与 AI 讨论构思、情节、人物、节奏和表达，辅助分析与修改，由作者决定如何采用建议。
- **AI 定点插入**：支持段首、段中、段尾和空行；返回内容与正文排版一致，框内可编辑，支持采纳、批注重新生成和不采纳。
- **带着原文讨论**：选区右键「添加到当前聊天」，在工作台弹窗填写要求后直接发送；批注也可批量直发，无需在聊天窗再次发送。
- **发送与换行**：要求输入框 Enter 发送，Shift+Enter 换行；中文输入法确认不误发。聊天只展示文稿与要求，定位上下文通过工具读取。
- **我的书架**：用封面展示作品、草稿与散篇，显示文稿数量和最近更新，点击封面继续写作。
- **作品管理**：书架上右键重命名作品、更换或移除封面；空作品可直接新建第一篇文稿。
- 作品文件树、Markdown 大纲、文稿/文件夹重命名、可调宽度侧栏。
- 自动保存、覆盖前备份、外部修改冲突保护。
- 回收站恢复与单条彻底删除；彻底删除前确认。
- 北京时间码字日历、新增/删除字数、码字与空闲时长。
- 右下角悬浮窗、作品封面、可选信息及龙娘/大肥鱼动图。
- 全屏写作保留标题、正文与悬浮窗；右上角按钮或 Esc 退出。
- 右上角悬浮窗开关和侧栏按钮，不受侧栏缩窄影响。

![我的书架示例](docs/images/shelf.png)

[写作界面](docs/images/workbench.png) · [全屏写作](docs/images/fullscreen.png)

截图使用程序生成的示例内容。本仓库不包含使用者的文稿、草稿、封面或码字记录；默认数据路径按当前使用目录配置。

## 构建

需要 Node.js 22+、npm，以及对应的本地客户端。

```sh
npm ci
npm run build
```

一次构建同时生成 `dist/`、Codex 的 `runtime/` 和 DSH 的 `dsh/lib/`、`dsh/assets/editor.html`，避免两边版本不一致。这些产物不提交到源码仓库。

## Codex 安装

1. 完成构建。
2. 注册仓库自带的本地插件源，在仓库目录执行：

   ```sh
   codex plugin marketplace add .
   codex plugin add writer-workbench@writer-tools-local
   ```

3. 重启客户端，再说“打开码字工作台”。也可从客户端的插件目录选择本地插件源安装。

源码启动配置使用 `${PLUGIN_ROOT}` 占位符。`npm run build` 会为本地 `runtime/` 自动生成实际 Node.js 和服务路径，不依赖客户端展开占位符。默认工作区为 `D:\AI-Workspace\apps\writer-workbench`。需要指定其他数据目录时，构建前设置 `WORKBENCH_WORKSPACE`，或构建后运行 `node scripts/configure-local.mjs <工作区绝对路径>`，再重新安装。后续构建会按环境变量或默认值重新生成运行配置。

安装格式参考 [OpenAI 本地 MCP 插件说明](https://developers.openai.com/plugins/deploy/desktop-only) 和 [本地插件源说明](https://developers.openai.com/plugins/build/plugins)。不同客户端版本对安装命令和占位符的支持可能不同。

## DeepSeek Harness 安装

两边共用源码，DSH 有独立的宿主桥和右侧栏入口。完成构建后：

```powershell
.\dsh\install.ps1 -Profile desktop
```

若 `dsh` 不在 PATH，通过 `-DshCmd` 指定命令路径；通过 `-Workspace` 指定数据目录。重启 DSH 后，使用聊天输入框旁的“码字”按钮或说“打开码字工作台”。详见 [DSH 安装说明](dsh/README.md)。

## 数据位置与隐私

Codex 与 DSH 默认工作区统一为 `D:\AI-Workspace\apps\writer-workbench`，数据根目录为 `D:\AI-Workspace\apps\writer-workbench\码字工作台\`，不随插件缓存或启动目录变化。该默认值位于 `src/workspace-config.mjs`；设置 `WORKBENCH_WORKSPACE` 可覆盖，DSH 的显式 `config.workspace` 和安装参数 `-Workspace` 优先。最终数据均写入 `<workspace>/码字工作台/`，不把「码字工作台」这一层重复追加到配置值中。其他机器使用前应配置可访问的绝对路径；已有 DSH profile 配置会保留，需核对其中的 `workspace`。两边指定相同目录即可共用数据，编辑同一文稿时建议只使用一个客户端。

每部作品使用自己的 `正文/`、`设定/`、`草稿/`。工作台不再预建空的顶层 `文稿/`；已有目录及其中的文件仍可正常读取，不会自动删除。

文稿、自动备份、回收站、封面、每日码字记录与待处理 AI 建议都保存在本机。AI 建议采纳前不写入正文、不计入字数；采纳时保存并保留覆盖前备份。批注仅在当前工作台页面内存中，关闭或刷新后清空；成功发送后移除对应记录，失败保留。加入聊天的内容将由所用客户端及其服务处理，请自行决定添加哪些文字。

所有运行数据目录、构建产物、日志和测试截图都在 `.gitignore` 中。提交前运行 `npm run privacy:check`，并检查实际暂存文件清单。隐私脚本是辅助检查，不能代替对待提交文件的审阅。

## 验证

```sh
npm test
npm run test:dsh
npx playwright install chromium
npm run test:focus
npm run test:shelf
npm run test:chat
npm run test:writing
```

封面在书架上右键管理，悬浮窗设置只控制封面与其他信息的展示。书架显示时暂时隐藏悬浮窗，返回写作后恢复其位置。

`npm run test:browser` 为完整浏览器回归；`node tests/paragraph-editor.browser.cjs` 检查段落编辑。浏览器测试使用合成文稿和模拟宿主，结果写入被忽略的 `test-results/`。可用 `PLAYWRIGHT_CHANNEL=msedge` 等环境变量选择已有浏览器。

## 目录

```text
src/               共享编辑器与本地数据逻辑
scripts/           构建、本机配置与发布文件检查
tests/             合成数据测试
skills/            Codex 写作工作台技能
.codex-plugin/     Codex 插件清单
.agents/plugins/   本地插件源清单
dsh/               DSH 宿主桥、客户端及技能
assets/            图标与内置萌宠动图
docs/              文档与合成示例截图
```

代码采用 MIT 许可证。开发版尚需在所使用的客户端版本中实际验证安装与界面行为。

