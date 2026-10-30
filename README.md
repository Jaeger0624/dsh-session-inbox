# dsh-session-inbox

[![CI](https://github.com/Jaeger0624/dsh-session-inbox/actions/workflows/ci.yml/badge.svg)](https://github.com/Jaeger0624/dsh-session-inbox/actions/workflows/ci.yml)

DeepSeek Harness Web GUI 的「会话收件箱」：一屏看完**正在运行**、**等你回复**、**跑完还没打开**的会话，下面是**按时间倒序的最近完成记录**。点一下直达对话。

## 界面

侧边栏底部多一个图标（有需要处理的东西时右上角亮一个小圆点），点开是主区整页：

**会话区**（按紧急度排序）

| 状态 | 判定依据 | 标记 |
| --- | --- | --- |
| 待审批 / 计划待审 / 待回答 | `pendingInteraction` | 橙点（呼吸） |
| 进行中 | `running` | 转圈 |
| 已完成未打开 | `completionUnread` | 绿点 |

排序：待回复 → 进行中 → 已完成未打开，组内按最近更新时间倒序。

**最近完成区**（时间线，默认 5 条）

按会话最后一次 `turn/end` 的时间倒序，显示标题、工作区、相对时间和结束原因（已完成 / 出错 / 已中止 / 已中断 / 达上限 / 被阻塞 / 已分叉）。右上角下拉切 **5 / 10 / 20 / 50**，选择存浏览器 localStorage，刷新不丢。

旁边的「分列」开关打开后，这一区拆成三列：

| 列 | 包含的结束原因 |
| --- | --- |
| 已完成 | `completed` |
| 已停止 | `aborted` / `interrupted` / `blocked` / `forked`（以及未知原因） |
| 错误 | `error` / `max-tokens` |

分列时「5 / 10 / 20 / 50」是**每列**的条数。开关状态同样存 localStorage。

**侧边栏计数**

「会话收件箱」那一行的右端是一排「色点 + 数字」，每一项对应一种状态，颜色即状态：

| 项 | 颜色 | 判定 |
| --- | --- | --- |
| 完成未查看 | 绿 | `completionUnread` |
| 待回答 | 橙 | `pendingInteraction`（审批 / 计划待审 / 提问） |
| 正在进行 | 蓝 | `running` |

三个计数是一个**互斥划分**，一个会话只落在其中一格，优先级按上表从上到下（等你处理的东西最优先）。侧边栏折叠成窄栏（行宽不足）时不显示数字。结束原因是错误的会话不单列一项，它的结果在「最近完成」区里用红色标出。

> 宿主把这一行画成 `[16px 图标][标题]`，行尾不属于插件槽位。数字是用行按钮的实测坐标贴在行尾的穿透浮层：不改宿主 DOM、不挡点击，侧边栏宽度变化或窗口缩放时会重新测量。
> 底部「设置」旁的那条统计仍然保留在代码里，默认关闭（`lib/client.js` 的 `FOOTER_STRIP` 常量），需要时可以打开。

已经出现在「会话区」的会话不会在「最近完成区」重复出现。

点任意一行 → 选中该会话并切回对话视图。打开即已读：「已完成未打开」由运行时在会话成为主视图或重新开始运行时自动清除，不需要手动标记。

## 安装

```sh
dsh plugin --profile <your-profile> add github:Jaeger0624/dsh-session-inbox
```

安装后重启 dsh web（宿主 profile 的 `patchReload` 多为 `startup`），再刷新页面。

本地开发用 `link:`：

```sh
dsh plugin --profile <your-profile> add link:<repo path>
```

## 数据从哪来

全部是运行时已经算好的事实，插件只读，不推断、不写会话日志、不注册任何面向模型的工具：

| 来源 | 内容 |
| --- | --- |
| `ctx.get('sessions').list` | `SessionListState`：标题、工作区、更新时间、`projectionValues` |
| `ctx.get('uiSession').sessionStatus` | `Map<SessionId, { running, pendingInteraction, completionUnread }>` |
| `projectionValues.sessionInbox` | 本插件的宿主投影：把每个会话的 `turn/end` 折成 `{ turn, time, reason }` |

`completionUnread` 的语义是「在你不在它的主视图时跑完」，正好等于"跑完但还没看"。

## 边界

- 不替换宿主侧边栏的会话列表（那是 `single` 槽，替换会把官方浏览区整个顶掉），只增加一个独立入口
- 不显示空白会话（新建未发言）与子代理会话
- 侧边栏与主区两侧都有错误边界：内部逻辑出错时降级为纯图标 / 提示页，不会把宿主那一行吞掉
- 「最近完成」读的是宿主投影缓存，多开标签页时各标签页的列表会各自更新，不做跨标签同步

## 开发

零依赖、无构建步骤，两个入口都是手写 ESM：

```sh
node --check index.js
node --check lib/client.js
node test/smoke.mjs     # 用桩 React 跑真实 bundle，验证过滤/排序/限额/跳转
```

`test/smoke.mjs` 不安装任何依赖；CI（GitHub Actions）跑同样的检查。

## English

Session inbox panel for the DeepSeek Harness web GUI. One list of the conversations that are running, finished but not yet opened, or waiting on your reply (approval, plan review, question), plus a time-ordered feed of recently finished turns (default 5, switchable to 10/20/50). Clicking a row selects the conversation and returns to the chat view; "finished unopened" clears itself as soon as the conversation becomes the main view. Pure UI plus one session projection — no session events are written and no tools are registered.

## License

MIT
