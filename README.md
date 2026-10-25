# dsh-session-activity

DeepSeek Harness Web GUI 的「会话动态」面板：一屏看完**正在运行**、**等你回复**、**跑完还没打开**的会话，以及**按时间倒序的最近完成记录**，点一下直达对话。

## 它能做什么

侧边栏多一个「会话动态」图标（有需要处理的东西时右上角亮一个小圆点），点开是主区整页：

**需要处理**（单列表，按紧急度排序）

| 状态 | 判定依据 | 标记 |
| --- | --- | --- |
| 待审批 / 计划待审 / 待回答 | `status.pendingInteraction` | 橙点（呼吸） |
| 进行中 | `status.running` | 转圈 |
| 已完成 | `status.completionUnread` | 绿点 |

排序：待回复 → 进行中 → 已完成，组内按最近更新时间倒序。

**最近完成**（时间线，默认 5 个）

按会话最后一次 `turn/end` 的时间倒序，显示标题、工作区、相对时间与结束原因（已完成 / 出错 / 已中止 / 已中断 / 达上限 / 被阻塞 / 已分叉）。右上角下拉可切 **5 / 10 / 20 / 50**，选择存在浏览器 localStorage（`dsh-session-activity:recent-limit`），刷新不丢。

已经出现在「需要处理」里的会话不会在「最近完成」里重复出现。

- 点任意一行 → 选中该会话并切回对话视图（`uiWorkspace.openSession`）
- 「已完成」不需要手动标已读：会话成为主视图、或重新开始运行，运行时自己会清掉
- 两个区都空时是「没有需要处理的会话」

## 数据来源

全部来自运行时事实，插件只读，不推断、不写会话日志、不注册工具：

- `ctx.get('sessions').list` → `SessionListState`：标题、工作区、更新时间、`projectionValues`
- `ctx.get('uiSession').sessionStatus` → `Map<SessionId, { running, pendingInteraction, completionUnread }>`
- `projectionValues.sessionActivity` → 本插件的 host 投影：把每个会话的 `turn/end` 折成 `{ turn, time, reason }`，所以完成记录刷新后仍在

`completionUnread` 的语义是「在你不在它的主视图时跑完」，正好等于"跑完但还没看"。

## 安装

```bash
dsh plugin --profile web15 add link:E:\deepseek-harness-learn\plugins\dsh-session-activity
```

随后重启 dsh web（该 profile 是 `patchReload: startup`），再刷新页面。

## 技术说明

纯客户端 UI + 一个零依赖的 host 投影，手写单文件 bundle，无构建步骤：

- 挂载：`sidebar.panellist`（侧边栏图标，`order: 40`）+ `main`（主区页面，key = `session-activity`），都走 `ctx.slots.inject`，槽位没声明就不出现，不影响启动
- 两侧都有错误边界：内部逻辑炸了只降级成纯图标 / 提示页，不会把侧边栏那一行吞掉
- 订阅：`useSyncExternalStore` 直接订两个运行时 observable，无轮询；只有一个 30s 的时钟用于刷新"几分钟前"
- 样式：只用宿主 `--dsw-alias-*` token，明暗主题自动跟随；`prefers-reduced-motion` 下关闭入场动画、放慢转圈
- 排除：空白会话（新建未发言）与子代理会话

### 自检

- `lib/client.js` 与 `index.js` 都是手写、无依赖，`node --check` 即可验证语法
- host 半面带一个诊断上报路由 `/dsh-session-activity/report`（`DIAGNOSTICS` 常量可关）：浏览器会把 `load / apply / render / crash` 写到 `~/.dsh/dsh-web.log`，用来在看不到控制台时定位槽位崩溃
- 离线冒烟测试（不进仓库）：用桩 React 渲染两个槽位组件，覆盖过滤、排序、最近完成区、限额下拉、点击跳转

## License

MIT
