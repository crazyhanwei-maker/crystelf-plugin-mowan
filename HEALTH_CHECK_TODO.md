# 插件健康检查待办

检查时间：2026-04-26

说明：
- 本文件仅汇总当前复核后仍成立的问题，不代表已修改。
- 本次复核已移除上一版中已经修复或不再成立的旧条目。
- 严重级别分为：`严重`、`高`、`中`、`低`。

## 当前检查结果

- `通过` `npm run check:encoding`，检查 205 个文本文件。
- `通过` JS/MJS 语法检查，检查 93 个文件。
- `通过` 非 `node_modules` JSON 配置解析。
- `通过` `npm ls --depth=0`。
- `失败` `npx eslint .`，当前 442 个错误，大量来自 Yunzai 运行时全局变量未在 ESLint 配置声明。
- `失败` `npm audit --omit=dev`，当前 9 个漏洞：`7 high`、`2 moderate`。
- `通过` SSH 远端覆盖部署测试：安装插件生产依赖后，PM2 在线，控制台 `/api/auth/status` 返回 200，最新日志显示 crystelf 初始化完成并成功加载 11 个插件。

## 严重

当前未发现会让整个插件入口必然崩溃的严重项。

## 高

1. `高` [apps/rssPush.js](D:/群机器人插件/crystelf-plugin-main/apps/rssPush.js):7, [package.json](D:/群机器人插件/crystelf-plugin-main/package.json):20
原因：`rssPush` 直接导入 `node-schedule`，但 `package.json.dependencies` 未声明该依赖；干净环境或宿主未安装时，RSS 推送应用会导入失败。

2. `高` [apps/ai.js](D:/群机器人插件/crystelf-plugin-main/apps/ai.js):427
原因：`isMasterUser()` 读取未声明的 `cfg.masterQQ`；触发 AI 的“功能开关”主人命令时会 `ReferenceError`。

3. `高` [package.json](D:/群机器人插件/crystelf-plugin-main/package.json):21, [package-lock.json](D:/群机器人插件/crystelf-plugin-main/package-lock.json):396, [package-lock.json](D:/群机器人插件/crystelf-plugin-main/package-lock.json):2209
原因：`npm audit --omit=dev` 报 9 个生产依赖漏洞，其中高危主要来自 `puppeteer` 链、`proxy-agent/basic-ftp` 链；中危来自 `axios/follow-redirects` 链。当前 audit 显示无自动修复方案，需要跟踪上游版本或评估替代依赖与风险缓解。

## 中

4. `中` [package-lock.json](D:/群机器人插件/crystelf-plugin-main/package-lock.json):3, [package-lock.json](D:/群机器人插件/crystelf-plugin-main/package-lock.json):9, [package.json](D:/群机器人插件/crystelf-plugin-main/package.json):3
原因：`package.json` 版本是 `1.6.4`，但 `package-lock.json` 根版本仍是 `1.6.3`；发布或复现安装时容易产生版本混乱。

5. `中` [pnpm-lock.yaml](D:/群机器人插件/crystelf-plugin-main/pnpm-lock.yaml):10, [pnpm-lock.yaml](D:/群机器人插件/crystelf-plugin-main/pnpm-lock.yaml):11, [pnpm-lock.yaml](D:/群机器人插件/crystelf-plugin-main/pnpm-lock.yaml):17
原因：`pnpm-lock.yaml` 与当前 `package.json` 明显不一致，仍记录较旧的依赖组合，例如 `axios ^1.8.4`、`openai ^4.89.0`；如果保留 pnpm 锁文件，应重新生成。

6. `中` [eslint.config.js](D:/群机器人插件/crystelf-plugin-main/eslint.config.js):7, [eslint.config.js](D:/群机器人插件/crystelf-plugin-main/eslint.config.js):9
原因：ESLint 只声明了 browser/node 全局变量，未声明 Yunzai 运行时全局 `plugin`、`logger`、`Bot`、`redis`、`segment` 等，导致 lint 结果混入大量误报，无法作为质量门禁使用。

7. `中` [apps/ai.js](D:/群机器人插件/crystelf-plugin-main/apps/ai.js):21, [apps/poke.js](D:/群机器人插件/crystelf-plugin-main/apps/poke.js):1, [apps/poke.js](D:/群机器人插件/crystelf-plugin-main/apps/poke.js):13, [apps/zwa.js](D:/群机器人插件/crystelf-plugin-main/apps/zwa.js):1, [apps/update-plugin.js](D:/群机器人插件/crystelf-plugin-main/apps/update-plugin.js):1
原因：部分应用直接依赖 Yunzai 宿主路径或宿主依赖，例如 `../../../lib/config/config.js`、`../../../lib/plugins/plugin.js`、`oicq`；这是 Yunzai 插件常见写法，但当前 README/依赖声明没有把这些运行前置讲清楚，独立检查或非标准目录部署时会导入失败。

8. `中` [lib/music/audioProcessor.js](D:/群机器人插件/crystelf-plugin-main/lib/music/audioProcessor.js):222, [lib/music/audioProcessor.js](D:/群机器人插件/crystelf-plugin-main/lib/music/audioProcessor.js):226, [config/music.json](D:/群机器人插件/crystelf-plugin-main/config/music.json):6
原因：`config/music.json` 中 `quality` 是字符串 `"3"`，但音频处理里使用 `quality === 1` 严格比较；当配置为 `"1"` 时，低音质转语音分支不会命中。

9. `中` [guoba/configSchema.js](D:/群机器人插件/crystelf-plugin-main/guoba/configSchema.js):8, [guoba/configSchema.js](D:/群机器人插件/crystelf-plugin-main/guoba/configSchema.js):32
原因：锅巴配置 schema 仍硬编码 `crystelf-plugin-main` 目录名读取缓存；插件目录重命名或按 README 克隆为 `crystelf-plugin` 后，候选路径可能失效。

10. `中` [lib/webConsole/public/app.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/app.js):1213, [lib/webConsole/public/app.js](D:/群机器人插件/crystelf-plugin-main/lib/webConsole/public/app.js):1214
原因：前端直接重赋值函数声明 `summarizeFallbackConfig`、`renderConfig`，触发 ESLint `no-func-assign`；建议改为显式函数名切换或直接保留增强版实现。

11. `中` [package.json](D:/群机器人插件/crystelf-plugin-main/package.json):20, [README.md](D:/群机器人插件/crystelf-plugin-main/README.md):1
原因：远端只覆盖插件源码且不带 `node_modules` 时，宿主环境不一定已有插件声明的运行依赖；本次 SSH 测试首次启动报 `crystelf-plugin 缺少依赖 axios`，执行 `npm --prefix /root/mu/Yunzai/plugins/crystelf-plugin install --omit=dev --ignore-scripts --no-audit --no-fund` 后恢复。建议在部署说明或脚本中明确覆盖后安装生产依赖。

## 低

12. `低` [config/skills.json](D:/群机器人插件/crystelf-plugin-main/config/skills.json):1, [config/skills](D:/群机器人插件/crystelf-plugin-main/config/skills):1, [lib/ai/httpSkillRegistry.js](D:/群机器人插件/crystelf-plugin-main/lib/ai/httpSkillRegistry.js):1
原因：HTTP skills 相关文件当前是新增未跟踪文件；如果该功能要进入正式版本，需要确认全部加入版本管理，否则发布包会缺少 skill 定义或注册器。

13. `低` [skill-candidates](D:/群机器人插件/crystelf-plugin-main/skill-candidates):1, [skillre.md](D:/群机器人插件/crystelf-plugin-main/skillre.md):1
原因：候选 skill 文档当前也是新增未跟踪文件；如果只是调研资料，建议移到 docs 或确认是否随插件发布。
