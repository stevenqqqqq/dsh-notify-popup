# DSH 桌面通知弹窗插件

> 任务完成时、需要你审批时、需要你回答时，在 Windows 桌面右下角弹出提醒卡片。切到其他应用也能看见。

一个 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）宿主插件。插件市场里没有同类插件，所以自己写了一个。

## 功能

| 场景 | 触发事件 | 弹窗标题 |
| --- | --- | --- |
| 一轮任务结束 | `agent/turn-stopping` | 任务已完成 |
| 工具调用等待批准 | `approval/request` | 需要你的确认 |
| agent 提问等待回答 | `user-questions/request` | 需要你的回答 |

弹窗是 PowerShell 启动的置顶 WPF 悬浮窗：桌面右下角、淡入、约 9 秒自动消失、点击即刻关闭。即使 DSH 不在前台也可见。

- **后台子 agent 不打扰**：用 `options.subagentDepth` 识别子 agent，只给主 agent 的任务结束弹窗。
- **审批弹窗兜底**：DSH 的审批/提问是带作用域的 waterfall 事件，普通全局监听器收不到；插件额外监听 Cordis 的 `internal/dispatch` 全局事件旁路捕获，两类事件都实测可用。
- **不重复弹**：普通钩子与兜底观察者共用 1200ms 去重窗口。

## 安装

需要 Windows + DeepSeek Harness（Cordis 插件体系）。

1. 克隆到任意本地目录，例如 `C:\Users\steven\dsh-notify-popup`：
   ```powershell
   git clone https://github.com/stevenqqqqq/dsh-notify-popup.git
   ```
2. 在 DSH 会话里让 agent 安装这个本地 bundle（把路径换成你自己的）：

   > 帮我安装插件：`C:\Users\steven\dsh-notify-popup`

   它内部会调用 `plugin_manager` 的 `install_bundle`，把这个目录 link 进当前 profile 并启用，全程约 1–2 分钟。
3. 重载 DSH 即可生效。

包名保持 `@local/dsh-notify-popup` 是本地 bundle 的命名约定，不影响使用。

## 配置

在插件配置里可以覆盖以下参数：

| 参数 | 含义 | 默认值 |
| --- | --- | --- |
| `turnComplete` | 任务完成提醒开关 | `true` |
| `approval` | 审批提醒开关 | `true` |
| `question` | 提问提醒开关 | `true` |
| `onlyRootAgent` | 忽略子 agent 的轮次结束 | `true` |
| `sound` | 提示音 | `true` |
| `durationMs` | 悬浮窗停留毫秒数 | `9000` |
| `dedupeMs` | 相同内容去重窗口（毫秒） | `1200` |
| `diagnostics` | 诊断日志开关 | `true` |
| `logPath` | 诊断日志路径 | `%TEMP%\dsh-notify-popup.log` |

## 实现要点 / 踩过的坑

- PowerShell 启动参数**绝不能加 `detached: true`**：Windows 上 libuv 会加 `DETACHED_PROCESS`，无控制台的 PowerShell 脚本会静默不执行，退出码却是 0。
- WPF 的 `ShowDialog()` **必须 `-Sta`**，否则 MTA 线程抛 `The calling thread must be STA`。
- 弹窗文字用环境变量传给 PowerShell，避免中文在非 ASCII 命令行里乱码。
- Electron `Notification` 只作为最后兜底：Windows 上未注册 AppUserModelID 时可能创建了却不显示。

## 文件

```
index.js          宿主半边：事件钩子 + 兜底观察者 + 调度弹窗
notify.ps1        Windows PowerShell WPF 弹窗
cordis.patch.yml  bundle 注册
package.json      包清单
locale/           中英文插件市场文案
docs/DETAIL.md    详细使用说明
icon.svg          图标
```

## License

MIT — 随便用，欢迎反馈问题。
