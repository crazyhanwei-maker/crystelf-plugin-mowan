# 插件健康检查待办

检查时间：2026-04-21

说明：
- 本文件仅汇总问题，不代表已修改。
- 你可以按条处理，处理完后自行删掉对应条目或改成已完成。
- 严重级别分为：`严重`、`高`、`中`、`低`。

## 严重

1. `严重` [lib/webConsole/server.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/server.js):124, 141, 1877, 5622, 6147
原因：`bootstrap` 判定信任 `X-Forwarded-For` 首值；反向代理场景下可被伪造为回环地址，导致未登录也可走初始化白名单并提交 `/api/plugin-settings/save` 写入 `webConsoleToken`。

## 高

2. `高` [lib/webConsole/server.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/server.js):1375, [lib/webConsole/public/help-diy.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/help-diy.js):206
原因：帮助历史备注 `historyNote` 原样存储，前端用 `innerHTML` 直接渲染，存在 Stored XSS 风险。

3. `高` [apps/auth.js](D:/群机器人插件/crystelf-plugin-main/apps/auth.js):216
原因：验证超时后踢人使用的是 `e.user_id/e.group_id`，而不是 `auth(e, group_id, user_id)` 传入的目标用户；管理员执行“#重新验证@某人”时可能误踢自己。

4. `高` [apps/music.js](D:/群机器人插件/crystelf-plugin-main/apps/music.js):136, 137
原因：数字选歌流程先 `clearGroupSearch` 再 `handleSelection`，会先把搜索结果清空，导致按序号选歌失败。

5. `高` [lib/yunzai/utils.js](D:/群机器人插件/crystelf-plugin-main/lib/yunzai/utils.js):44
原因：`e.bot.version?.app_name` 未对 `e.bot` 做可选链保护；当事件对象不带 `bot` 时会直接 `TypeError`。

6. `高` [lib/yunzai/message.js](D:/群机器人插件/crystelf-plugin-main/lib/yunzai/message.js):3, 22
原因：直接引用未声明的全局 `Bot`；在无该全局变量环境下会 `ReferenceError`。

7. `高` [lib/ai/toolRegistry.js](D:/群机器人插件/crystelf-plugin-main/lib/ai/toolRegistry.js):240
原因：`fetch_web_markdown` 对 Markdown 结果调用 `sanitizeText`，会压缩空白并移除反引号，导致返回内容失真。

8. `高` [lib/humanize/actionPlanner.js](D:/群机器人插件/crystelf-plugin-main/lib/humanize/actionPlanner.js):124, 136, 148, 169
原因：解析失败/异常时默认返回 `reply`，与模块“默认等待”策略相反，容易放大误触发与刷屏。

## 中

9. `中` [lib/webConsole/server.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/server.js):1597, 5886
原因：`/api/image-proxy` 可代理任意 `http/https` URL，存在 SSRF 风险。

10. `中` [lib/webConsole/server.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/server.js):5575, 1095
原因：静态资源统一按 UTF-8 文本读取，上传托管的图片文件可能返回损坏内容。

11. `中` [lib/webConsole/public/image-monitor-detail.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/image-monitor-detail.js):65, 85, 104, [lib/webConsole/public/log-detail.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/log-detail.js):57
原因：多个 `innerHTML` 模板直接插入日志字段，存在 HTML 注入与恶意链接注入风险。

12. `中` [lib/humanize/memoryRetrieval.js](D:/群机器人插件/crystelf-plugin-main/lib/humanize/memoryRetrieval.js):158
原因：对 `tool_call.arguments` 直接 `JSON.parse`，模型参数不是严格 JSON 时会中断整轮记忆检索。

13. `中` [lib/ai/chatDatabase.js](D:/群机器人插件/crystelf-plugin-main/lib/ai/chatDatabase.js):217
原因：`getMessagesByUser` 用严格相等比较 `message.userId === userId`，字符串/数字混用时查不到历史。

14. `中` [lib/core/meme.js](D:/群机器人插件/crystelf-plugin-main/lib/core/meme.js):520
原因：写缓存时硬编码 `crystelf-plugin-main` 目录名，仓库重命名或部署目录变化后会写到错误位置。

15. `中` [lib/core/meme.js](D:/群机器人插件/crystelf-plugin-main/lib/core/meme.js):65
原因：表情 API 未配置时兜底仍是 `http://127.0.0.1:5555`，与当前公开默认值 `http://165.99.42.28:5555` 不一致。

16. `中` [lib/ai/aiCaller.js](D:/群机器人插件/crystelf-plugin-main/lib/ai/aiCaller.js):624
原因：`getSystemPrompt` 无条件访问 `e.group.getChatHistory`，私聊上下文下会抛错并导致 system prompt 上下文退化。

17. `中` [apps/music.js](D:/群机器人插件/crystelf-plugin-main/apps/music.js):158, [config/music.json](D:/群机器人插件/crystelf-plugin-main/config/music.json):6
原因：音质配置是字符串，但代码使用数字严格比较，低音质语音分支无法按预期命中。

18. `中` [apps/60s.js](D:/群机器人插件/crystelf-plugin-main/apps/60s.js):12
原因：正则 `^(#|/)?60s|(#|/)?早报$` 缺少分组，`60s` 分支没有 `$` 约束，会误匹配如 `60sabc`。

19. `中` [guoba/configSchema.js](D:/群机器人插件/crystelf-plugin-main/guoba/configSchema.js):2659, [config/music.json](D:/群机器人插件/crystelf-plugin-main/config/music.json):2, [guoba/configHandler.js](D:/群机器人插件/crystelf-plugin-main/guoba/configHandler.js):431
原因：`music.urls` 在 Guoba 中定义成对象数组，但默认配置是字符串数组；面板保存后有结构漂移风险。

20. `中` [apps/welcome-set.js](D:/群机器人插件/crystelf-plugin-main/apps/welcome-set.js):71, 73
原因：欢迎图扩展名逻辑只区分 `gif`，其余全部按 `jpg` 保存；上传 `png/webp` 时会出现内容格式与后缀不一致。

21. `中` [lib/system/updater.js](D:/群机器人插件/crystelf-plugin-main/lib/system/updater.js):75, 86, 91, 123
原因：更新逻辑硬编码远端名为 `origin`，且用 `local !== remote` 判定“有更新”，会把本地 ahead/分叉误判为可更新。

22. `中` [lib/yunzai/group.js](D:/群机器人插件/crystelf-plugin-main/lib/yunzai/group.js):42, 54
原因：直接调用 `e.bot.sendApi`，缺少能力检测与回退，适配器差异下容易抛错。

23. `中` [README.md](D:/群机器人插件/crystelf-plugin-main/README.md):288, 291, [config/coreConfig.json](D:/群机器人插件/crystelf-plugin-main/config/coreConfig.json):77
原因：README 写默认自动语音触发场景为 `reply,poked`，实际默认值是 `reply,poked,comment`。

24. `中` [README.md](D:/群机器人插件/crystelf-plugin-main/README.md):59, 65, [package.json](D:/群机器人插件/crystelf-plugin-main/package.json):10
原因：README 仓库来源描述与 `package.json.repository.url` 不一致。

## 低

25. `低` [apps/poke.js](D:/群机器人插件/crystelf-plugin-main/apps/poke.js):429
原因：该行包含控制字符 `U+0008`，属于真实脏字符，会影响正则可读性和匹配稳定性。

26. `低` [lib/webConsole/public/image-monitor-detail.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/image-monitor-detail.js):130, [lib/webConsole/public/log-detail.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/log-detail.js):155
原因：复制按钮事件绑定使用 `{ once: true }`，点一次后监听器就被移除。

27. `低` [lib/webConsole/public/login.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/login.js):28, [lib/webConsole/server.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/server.js):5559
原因：前端在“未配置口令”时固定展示“前往初始化页面”，但后端仅在 `bootstrapMode` 才允许未登录访问初始化页，非本机场景提示与实际行为不一致。

28. `低` [lib/webConsole/server.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/server.js):166, [lib/webConsole/public/app.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/app.js):134, [lib/webConsole/public/image-monitor-center.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/image-monitor-center.js):99
原因：后端 CSP 禁止内联脚本，但前端用内联 `onerror` 做图片失败回退，实际不会执行。

29. `低` [index.js](D:/群机器人插件/crystelf-plugin-main/index.js):83, [apps/update-plugin.js](D:/群机器人插件/crystelf-plugin-main/apps/update-plugin.js):13, [config/config.json](D:/群机器人插件/crystelf-plugin-main/config/config.json):6
原因：存在 `apps/update-plugin.js` 入口，但没有统一配置开关项，配置管理不一致。

30. `低` [apps/help.js](D:/群机器人插件/crystelf-plugin-main/apps/help.js):172, [config/config.json](D:/群机器人插件/crystelf-plugin-main/config/config.json):26
原因：帮助文案把控制台地址写死为 `127.0.0.1:27891`，与可配置项 `webConsoleHost/webConsolePort` 不一致。

31. `低` [config/ai.json](D:/群机器人插件/crystelf-plugin-main/config/ai.json):268
原因：注释字段文本错误，`豪秒` 应为 `毫秒`。

32. `低` [temp/file-browser-conflict-test.txt](D:/群机器人插件/crystelf-plugin-main/temp/file-browser-conflict-test.txt):1, [temp/start-web-console-validate.mjs](D:/群机器人插件/crystelf-plugin-main/temp/start-web-console-validate.mjs):1, [temp/validate-console-bg.mjs](D:/群机器人插件/crystelf-plugin-main/temp/validate-console-bg.mjs):1
原因：存在 UTF-8 BOM；虽在忽略目录中，但仓内编码风格不统一。
