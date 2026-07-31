# Bot 日志查看页面设计方案

日期：2026-08-01
状态：已确认，进入实现

## 目标

在网页控制台「诊断与调试」导航组下新增 **Bot 日志** 页面，直接读取 bot 运行日志文件，支持手动/自动刷新查看最新内容，并具备向前翻页、级别筛选与关键字搜索能力。

## 需求确认结果

1. **日志来源**：自动扫描全部候选日志目录（bot 根 `logs`/`log`/`data/logs`、插件 `logs`/`log`/`temp`/`data/crystelf/debug`），复用现有诊断功能（`logDiagnosisConsole`）的扫描策略
2. **刷新方式**：手动「刷新」按钮 + 可选「自动刷新」（3 秒轮询拉取尾部）
3. **查看形式**：尾部 2000 行 + 「加载更早」向前翻页；单次读取上限 3MB，超出提示仅显示尾部
4. **搜索筛选**：关键字搜索（匹配行高亮）+ 级别筛选（全部/ERROR/WARN/INFO/DEBUG/其他）

## 架构

```
前端                                         后端
bot-logs.html ── GET /api/bot-logs/files ──→ botLogsConsole.buildFileList
bot-logs.js   ── GET /api/bot-logs/read  ──→ botLogsConsole.readLogWindow
console-shell.js 导航项「Bot 日志」              └─ 依赖 logFileDiscovery（共享扫描/读取）
                                               logRoutes.js 挂载 API
```

## 组件

### 1. `lib/webConsole/logFileDiscovery.js`（新建，共享模块）

从 `logDiagnosisConsole.js` 提取通用日志发现逻辑，供诊断与日志查看共用：

- `getCandidateDirectories()` — 候选日志目录扫描（bot 根 + 插件根）
- `listCandidateLogFiles(source)` — 列出候选目录下的日志文件（按名称优先级 + 修改时间排序，最多 12 个）
- `getDisplayPath(filePath)` — 生成「Bot/插件/运行目录」相对展示路径
- `readLogTailText(filePath, maxLength)` — 按字节读尾部文本（从 logDiagnosisConsole 提取，逻辑不变）
- `readLogFileWindow(filePath, options)` — 按行窗口读取：
  - `mode=tail`：返回文件末尾 `limit` 行（默认 2000）
  - `mode=window`：返回 `[startLine, startLine + limit)` 范围内的行（用于向前翻页）
  - 单次最多读取尾部 3MB，超出标记 `truncated`
  - 返回 `{ lines, windowStart, windowEnd, windowLines, fileSize, mtime, truncated, lineCount }`

模块直接 `import Path from '../../constants/path.js'` 使用单例路径，不依赖 options 注入。

### 2. `lib/webConsole/logDiagnosisConsole.js`（修改）

删除内部定义的 `getCandidateDirectories` / `listCandidateLogFiles` / `getDisplayPath` / `readLogTailText`，改为从 `logFileDiscovery.js` 导入。行为零变化，仅去重。

### 3. `lib/webConsole/botLogsConsole.js`（新建）

`createBotLogsConsole(options)`，依赖 `{ fs, path, logger, createHttpError }`，返回：

- `buildFileList()` — 调用 `listCandidateLogFiles('all')`，返回 `{ success, files, scannedAt }`；file 条目含 `filePath / displayPath / name / size / mtime`
- `readLogWindow(params)` — 读取日志窗口：
  - **白名单校验**：`file` 参数必须是 `listCandidateLogFiles('all')` 结果的规范化路径之一，否则抛 400「日志文件不在候选列表内」，防止任意文件读取
  - 转发 `mode / startLine / limit` 给 `readLogFileWindow`

### 4. 路由接入（修改）

- `webConsoleHandlerContext.js`：options 解构新增 `botLogsConsole = {}`，context 注入 `buildBotLogFileList`、`readBotLogWindow`
- `dataLogConsoleSuite.js`：创建 `botLogsConsole` 并导出
- `server.js`：解构 `botLogsConsole` 并传入 handler context
- `logRoutes.js`：`handle` 中新增两个分支（均先 `requireLogsExposed` 校验，read 接口对错误返回 `{ success:false, error, code }`）：
  - `GET /api/bot-logs/files`
  - `GET /api/bot-logs/read?file=&mode=&startLine=&limit=`

### 5. 前端（新建 + 修改）

- `public/bot-logs.html`（新建）：`auth-guarded-page` 页面，加载 `/auth.js`、`/theme.js`、`console-modern.css`、`bot-logs.js`；顶部工具栏（文件下拉 + 刷新按钮 + 自动刷新开关 + 级别筛选 + 搜索框 + 加载更早按钮），中部日志内容区（行号 + 文本，ERROR/WARN 着色），底部状态栏（文件大小、显示范围、最后刷新时间）
- `public/bot-logs.js`（新建）：页面逻辑
  - 加载文件列表填充下拉框，默认选中修改时间最新文件
  - 读取尾部渲染（`mode=tail&limit=2000`），记录当前 `windowStart`
  - 「加载更早」→ `mode=window&startLine=windowStart-limit`
  - 刷新 → 重新拉取 tail（自动刷新开启时每 3 秒一次，页面隐藏时暂停）
  - 级别筛选与关键字搜索在前端内存行中过滤/高亮，不做后端请求
  - 状态栏与错误提示（文件被删除 → 自动重载文件列表）
- `public/console-shell.js`（修改）：「诊断与调试」组新增 `{ href: '/bot-logs.html', label: 'Bot 日志', icon: '▤' }`

## 数据流

1. 页面加载 → `GET /api/bot-logs/files` → 填充下拉框，选中最新文件 → `GET /api/bot-logs/read?mode=tail` → 渲染尾部
2. 用户点「加载更早」→ `GET /api/bot-logs/read?mode=window&startLine=N` → 在顶部追加更早的行
3. 用户点「刷新」/ 自动刷新触发 → `GET /api/bot-logs/read?mode=tail` → 替换为最新尾部
4. 级别/关键字筛选 → 前端对已加载行做过滤，纯本地

## 错误处理

| 场景 | 行为 |
|---|---|
| 文件被删除/轮转 | 读取返回空/失败 → 页面提示并自动重载文件列表 |
| 文件 > 3MB | `truncated: true` → 提示「文件过大，仅显示尾部 3MB」 |
| `webConsoleExposeLogs=false` | 接口 403 → 页面提示「日志暴露已关闭，请在插件设置中开启」 |
| file 参数不在白名单 | 400「日志文件不在候选列表内」 |
| 自动刷新时页面不可见 | 暂停轮询（`document.hidden`），可见后立即刷新一次 |

## 测试

1. 单元：`test/` 下现有模式（若框架可用）对 `readLogFileWindow` 用临时文件验证 tail/window/截断
2. 手工：`temp/dev-webconsole.mjs` 启动控制台，验证：
   - 文件列表加载与默认选中最新文件
   - 尾部渲染、加载更早、刷新、自动刷新
   - 级别筛选与关键字搜索
   - 大文件截断提示、删除文件后的重载行为
