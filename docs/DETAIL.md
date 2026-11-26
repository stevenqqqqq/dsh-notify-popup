# 桌面通知弹窗

任务结束、需要你批准、需要你回答，这三种情况各弹一个 Windows 桌面通知。

## 触发点

| 事件 | 时机 | 弹窗标题 |
| --- | --- | --- |
| `agent/turn-stopping` | 一轮任务即将结束 | 任务已完成 |
| `approval/request` | 有工具调用等待批准 | 需要你的确认 |
| `user-questions/request` | agent 提问等待回答 | 需要你的回答 |

## 弹窗实现

主要走 Windows PowerShell 起的置顶 WPF 悬浮窗：右下角显示、淡入、约 9 秒自动消失，点击即刻关闭。这条路径已实测确认——即使 DSH 不在前台，弹窗依然可见。仅当 PowerShell 完全起不来时才退回 Electron 的 `Notification`（在 Windows 上未注册 AppUserModelID 时可能创建成功却不显示，因此不作为首选）。

## 子 agent 不弹窗

`agent/turn-stopping` 只对主 agent 弹窗。后台子 agent 的 `options.subagentDepth` 大于 0，会被识别并抑制，避免子任务结束时误报「任务已完成」。

## 审批/回答弹窗的兜底

审批与提问事件由宿主以带作用域的 waterfall 派发，普通全局监听器在本机不一定收到。插件额外注册了 Cordis 的 `internal/dispatch` 全局观察者（不受作用域过滤），在任何事件派发前旁路捕获 `approval/request` 与 `user-questions/request` 并弹窗。它与上面的普通钩子共用 1200ms 去重窗口，不会重复弹。三类弹窗均已在真实宿主中逐项实测通过。

## 可调参数

在插件配置里可以覆盖：

- `turnComplete` / `approval` / `question`：分别开关三类提醒，默认都开。
- `onlyRootAgent`：只提醒主 agent，忽略子 agent 的轮次结束，默认 `true`。
- `sound`：是否播放提示音，默认 `true`。
- `durationMs`：悬浮窗停留毫秒数，默认 `9000`。
- `dedupeMs`：相同内容的去重窗口，默认 `1200`。
