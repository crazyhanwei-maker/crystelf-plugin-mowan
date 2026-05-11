# crystelf-plugin 使用说明

`crystelf-plugin` 是面向 Yunzai / TRSS-Yunzai 的群聊增强插件，集 AI 对话、图像生成、HTTP Skills、群管理、图片监控、帮助 DIY、RSS、点歌、早报、欢迎验证和本地控制台于一体。

这份文档按当前功能重新整理。日常使用优先通过“魔丸控制台”配置，少量高级配置再手改 JSON。

## 功能概览

| 模块 | 能力 |
| --- | --- |
| AI 对话 | 多轮对话、上下文、记忆、用户画像、好感度、工具调用、图片理解、语音回复、表情包回复 |
| AI 生图 | 支持 `gpt-image-2`、OpenAI 风格 `/v1/images/generations`、对话式生图、即梦接口 |
| HTTP Skills | 天气、快递、热榜、日历、网页解析、汇率、论文、地震、国家信息、节假日、宏观指标等 |
| 群管理 | 加群申请、自动审核、入群欢迎、AI 欢迎、内容风控、群日志、实时事件、群总结、群头衔申请 |
| 图片监控 | 独立视觉模型审核、违规记录/告警/撤回、表情包识别入库、本地预览图、清理非表情包图片 |
| 帮助系统 | `#灵晶帮助` 分类帮助、控制台 Help DIY、图片帮助模式、默认帮助图 |
| 娱乐内容 | 60 秒早报、早晚安、RSS 订阅、点歌、表情回应、戳一戳 |
| 控制台 | 登录鉴权、配置管理、API 测试、日志查看、用量中心、会话调试、文件浏览、依赖检查 |

## 安装

在 Yunzai 根目录执行：

```bash
git clone --depth=1 https://gitee.com/nuesurwan/crystelf-plugin.git ./plugins/crystelf-plugin
```

安装依赖：

```bash
pnpm install
```

或：

```bash
npm install
```

启动 Bot 后，插件会自动加载。

## 更新

如果插件目录本身是 Git 仓库，可以在插件目录执行：

```bash
git pull
```

也可以由主人在群里发送：

```text
#更新灵晶
```

更新后建议重启 Bot，尤其是控制台页面、API 路由、群管理运行时有变更时。

## 首次配置

1. 启动 Bot，确认控制台启动日志。
2. 打开本机控制台：`http://127.0.0.1:27891/`
3. 首次使用先设置控制台登录口令。
4. 进入“API 设置”，填写 AI 接口、图像生成接口、TTS 或图片监控接口。
5. 进入“插件设置”，按需开启功能。
6. 进入“群管理”，选择要启用的群。群管理相关功能默认都是关闭的。

AI 主接口的 `baseApi` 推荐填写 OpenAI 兼容基地址，例如：

```text
https://example.com/v1
```

不要填写到 `/chat/completions`。

## 功能开关默认状态

默认配置来自 `config/config.json`：

| 功能 | 默认状态 | 说明 |
| --- | --- | --- |
| `webConsole` | 开启 | 本地控制台 |
| `ai` | 开启 | AI 对话主功能 |
| `help` | 开启 | `#灵晶帮助` |
| `60s` | 开启 | 60 秒早报 |
| `rss` | 开启 | RSS 订阅 |
| `music` | 开启 | 点歌 |
| `poke` | 开启 | 戳一戳互动 |
| `zwa` | 开启 | 早晚安 |
| `faceReply` | 开启 | 表情回应 |
| `welcome` | 关闭 | 入群欢迎 |
| `auth` | 关闭 | 入群验证 |
| `imageMonitor` | 关闭 | 图片监控 |
| `groupManagement` | 关闭 | 群管理面板和运行时 |
| `groupTitle` | 关闭 | 群头衔申请 |
| `autoUpdate` | 关闭 | 自动更新 |

群管理、安全审核、图片监控、头衔发放都不会默认接管群聊，需要手动开启。

## 魔丸控制台

默认入口：

```text
http://127.0.0.1:27891/
```

常用页面：

| 页面 | 路径 | 用途 |
| --- | --- | --- |
| 首页 | `/index.html` | 总览、状态、最近运行情况 |
| 插件设置 | `/plugin-settings.html` | 功能开关、AI 行为、Skills、表情、TTS 等 |
| API 设置 | `/api-settings.html` | AI 主接口、图像生成、图片监控接口、连通性测试 |
| 群管理 | `/group-management.html` | 群开关、申请列表、欢迎、风控、总结、头衔、日志 |
| 图片监控 | `/image-monitor-center.html` | 审核日志、表情包入库、清理、导出、本地图预览 |
| 用量中心 | `/usage-center.html` | Token 用量、图片监控审核用量、工具调用记录 |
| 会话中心 | `/session-center.html` | AI 会话状态和调试入口 |
| QQ 通信模拟器 | `/qq-simulator.html` | 安全模拟群消息、连续对话、截图、语音、加群申请、入群、戳一戳事件 |
| 用户画像 | `/profile-center.html` | 用户画像记录 |
| 好感中心 | `/affinity-center.html` | 好感度和历史 |
| 沙盒聊天 | `/sandbox-chat.html` | 不进群测试 AI、工具、表情、语音 |
| 文件浏览 | `/file-browser.html` | 查看和编辑允许范围内的项目文件 |
| 依赖检查 | `/dependency-check.html` | 检查依赖、环境和关键文件 |
| 帮助 DIY | `/help-diy.html` | 自定义帮助文本或帮助图片 |

### 控制台安全

- 控制台始终要求登录。
- 默认监听 `127.0.0.1`，只允许本机访问。
- 登录口令保存在 `config/config.json` 的 `webConsoleToken`。
- 公网暴露前必须设置强口令。
- 如果必须监听 `0.0.0.0`，建议同时开启 `webConsoleReadOnly`。
- 敏感配置默认会脱敏，相关开关是 `webConsoleMaskSensitiveConfig`。
- 日志查看由 `webConsoleExposeLogs` 控制。

## 命令速查

### 帮助

| 命令 | 说明 |
| --- | --- |
| `#灵晶帮助` | 查看默认帮助 |
| `#灵晶帮助 AI` | 查看 AI 相关命令 |
| `#灵晶帮助 管理` | 查看验证、欢迎、总结、头衔相关命令 |
| `#灵晶帮助 娱乐` | 查看早报、点歌、RSS、互动相关命令 |
| `#灵晶帮助 调试` | 查看控制台、状态和排查命令 |

### 主人功能开关

这些命令只给主人使用：

| 命令 | 说明 |
| --- | --- |
| `#查看功能开关` | 查看所有功能开关 |
| `#查看已关闭功能` | 只列出关闭项 |
| `#开启AI` / `#关闭AI` | 开关 AI |
| `#开启群管理` / `#关闭群管理` | 开关群管理 |
| `#开启验证` / `#关闭验证` | 开关入群验证 |
| `#开启欢迎` / `#关闭欢迎` | 开关欢迎 |
| `#开启图片监控` / `#关闭图片监控` | 开关图片监控 |
| `#开启群头衔` / `#关闭群头衔` | 开关头衔申请 |
| `#开启音乐` / `#关闭音乐` | 开关点歌 |
| `#开启订阅` / `#关闭订阅` | 开关 RSS |
| `#开启表情回复` / `#关闭表情回复` | 开关表情回应 |
| `#开启60s` / `#关闭60s` | 开关早报 |
| `#开启早晚安` / `#关闭早晚安` | 开关早晚安 |
| `#开启自动更新` / `#关闭自动更新` | 开关自动更新 |
| `#开启全部功能` / `#关闭全部功能` | 批量开关 |
| `#开启全部AI相关功能` | 开启 AI、帮助、图片监控、表情回复 |
| `#开启全部群管相关功能` | 开启验证、欢迎、群管理、群头衔 |
| `#只开启AI` | 只保留 AI |
| `#只保留群管功能` | 只保留群管相关功能 |
| `#备份功能开关` | 备份当前开关 |
| `#恢复功能开关` | 恢复备份 |
| `#导出功能开关` | 导出当前开关 |
| `#重置功能开关` | 恢复默认开关 |

### AI 对话

| 命令或触发 | 说明 |
| --- | --- |
| `机器人昵称 + 内容` | 触发 AI 对话，例如 `花花 你好` |
| `@机器人 内容` | 触发 AI 对话 |
| `#重置对话` / `#重置会话` | 清空当前会话 |
| `#查看好感度` | 查看自己的好感度 |
| `#重置好感度` | 重置好感度 |
| `#好感排行` | 查看好感排行 |
| `#查看用户画像` | 查看用户画像 |
| `#查看会话状态` | 查看当前会话调试状态 |
| `#查看知识命中` | 查看最近知识命中 |
| `#查看工具调用` | 查看最近工具调用 |
| `#语音 内容` | 直接生成语音 |
| `#tts 内容` | 直接生成语音 |
| `#配音 内容` | 直接生成语音 |

AI 支持在回答中使用表情包标记：

```text
[meme:芙宁娜:default]
[meme:芙宁娜:happy]
[meme:芙宁娜:sad]
```

支持的情绪一般使用 `happy`、`sad`、`angry`、`confused`、`shy`、`surprised`、`default`。

### AI 图像生成

生图使用自然语言触发，不接管 `#绘图`、`#画图` 命令，避免和其他绘图插件冲突。

可用示例：

```text
花花生成一张美丽的花海图片
帮我画一张赛博朋克风格的猫娘头像
把这张图改成二次元风格
来一张透明背景的可爱表情包
```

不建议用：

```text
#绘图 一张花海图片
#画图 一张头像
```

这两个命令会被本插件主动避让。

图像生成配置在 `config/ai.json` 的 `imageConfig`，也可以在控制台“API 设置”里改。

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否启用图像生成 |
| `imageMode` | `openai`、`chat`、`jimeng` |
| `model` | 图像模型，例如 `gpt-image-2` |
| `baseApi` | OpenAI 风格接口基地址，可填到 `/v1` |
| `jimengApiUrl` | 即梦模式接口地址 |
| `apiKey` | 图像接口密钥 |
| `timeout` | 超时时间，单位毫秒，慢接口可设 `120000` 或 `360000` |
| `quality` | `gpt-image-2` 推荐 `low`、`medium`、`high` |
| `size` | 例如 `1024x1024` |
| `responseFormat` | `gpt-image-2` 推荐 `b64_json` |
| `background` | `auto`、`opaque`、`transparent`，留空表示不传 |
| `fallbackReply` | 生成失败提示 |
| `fallbackTimeoutReply` | 超时提示 |

`openai` 模式会调用 `/v1/images/generations`。如果 `baseApi` 填了 `https://example.com/v1`，插件会自动处理最终路径。

### 入群验证与欢迎

| 命令 | 说明 |
| --- | --- |
| `#开启验证` / `#关闭验证` | 开关入群验证 |
| `#切换验证模式` | 切换验证模式 |
| `#设置验证提示模式开启` / `#设置验证提示模式关闭` | 开关提示模式 |
| `#设置验证困难模式开启` / `#设置验证困难模式关闭` | 开关困难模式 |
| `#设置验证次数3` | 设置验证次数 |
| `#设置撤回开启` / `#设置撤回关闭` | 开关验证消息撤回 |
| `#绕过验证 @某人` | 让指定成员跳过验证 |
| `#重新验证 @某人` | 对指定成员重新验证 |
| `#设置欢迎文案 欢迎词` | 设置本群普通欢迎文案 |
| `#设置欢迎图片` | 配合图片设置欢迎图 |
| `#查看欢迎` | 查看本群欢迎配置 |
| `#清除欢迎` | 清除本群欢迎配置 |

入群欢迎已经整合到控制台“群管理”分组里。推荐新配置都在群管理面板完成。

### 群管理

群管理主要通过控制台使用：

```text
http://127.0.0.1:27891/group-management.html
```

群内快捷命令：

| 命令 | 说明 |
| --- | --- |
| `#灵晶开启群管理` | 开启插件群管理总开关，并启用本群入群风险评分和群消息风控 |
| `#灵晶关闭群管理` | 关闭本群入群风险评分和群消息风控，不影响其他群 |

支持能力：

| 功能 | 说明 |
| --- | --- |
| 默认设置 | 未单独配置的群会继承默认群管理设置 |
| 群选择 | 选择哪些群启用群管理 |
| 批量开启 | 按群批量开启功能 |
| 加群申请列表 | 查看待处理申请，手动同意或拒绝 |
| 自动通过 | 可按 QQ 等级、账号年龄、关键词、白名单、黑名单、风险规则等条件处理 |
| 入群欢迎 | 普通欢迎、欢迎图片、AI 欢迎 |
| AI 欢迎兜底 | AI 接口失败时自动回退普通欢迎 |
| 内容风控 | 反广告、刷屏、新成员保护、关键词、警告、黑白名单 |
| 群管理日志 | 记录风控、申请、欢迎、总结、头衔等事件 |
| 实时事件 | 控制台实时显示新触发事件，不用反复刷新日志 |
| 群总结 | 每天每群自动总结，也可手动获取 |
| 群头衔申请 | 成员申请头衔，管理员或 AI 审核 |
| 配置备份 | 群配置保存和回滚 |

注意：

- `config.groupManagement` 默认关闭。
- 单群也需要在群管理面板里开启。
- 如果某个群没有单独设置，会使用默认设置。
- 自动通过加群申请依赖适配器能提供申请事件和用户资料字段。
- 自动撤回、设置头衔、读取成员资料等能力取决于当前 Bot 适配器权限。

### 群聊总结

| 命令 | 说明 |
| --- | --- |
| `#群总结` | 获取本群最近总结 |

每日总结配置在 `config/ai.json` 的 `dailyGroupSummary`，控制台群管理里也可以设置目标群、时间、保留数量、最少消息数、提示词等。

### 群头衔申请

| 命令 | 说明 |
| --- | --- |
| `#申请头衔 你的头衔` | 提交头衔申请 |
| `#头衔申请列表` | 查看待审核申请 |
| `#同意头衔 编号` | 同意申请 |
| `#拒绝头衔 编号 理由` | 拒绝申请 |
| `#取消头衔申请` | 取消自己的申请 |

头衔配置在 `config/groupTitle.json`。

重要限制：

- QQ 群头衔需要机器人是群主才可以发放。
- `approvalRoles` 控制可审核身份，主人始终可审核。
- AI 自动审核在 `aiReview.enabled` 开启后生效。
- AI 判断合法时可自动同意并发放，非法时可自动拒绝或保留人工审核。

### 图片监控

图片监控配置在 `config/imageMonitor.json`，控制台入口是：

```text
http://127.0.0.1:27891/image-monitor-center.html
```

支持能力：

| 功能 | 说明 |
| --- | --- |
| 独立视觉模型 | 图片审核可以使用独立 `apiBase`、`apiKey`、`model` |
| 本地审核预览 | `saveReviewImages` 开启后保存本地图片，避免 QQ 图床链接过期 |
| 表情包入库 | 识别为表情包后保存到本地 |
| 稳定目录 | 表情包按 `角色/情绪` 保存，例如 `芙宁娜/happy` |
| 只保存指定角色 | `saveMemeCharacters` 只保存指定角色 |
| 只保存指定关键词 | `saveMemeKeywords` 只保存命中关键词的表情包 |
| 清理非表情包 | 控制台可清理图片监控中的非表情包图片 |
| 清理未命中过滤器 | 控制台可清理不符合角色/关键词过滤的表情包 |
| 风险处理 | `record` 仅记录、`alert` 告警、`recall` 自动撤回 |
| 群白黑名单 | `allowedGroups` 和 `blockedGroups` 控制启用范围 |

本地数据位置：

```text
data/crystelf/image-monitor/reviews/
data/crystelf/image-monitor/memes/
data/crystelf/image-monitor/review-log.jsonl
data/crystelf/image-monitor/meme-index.jsonl
```

识别提示词要求模型只输出 JSON，关键字段是：

```json
{
  "isMeme": true,
  "memeCharacter": "芙宁娜",
  "memeEmotion": "happy",
  "memeTags": ["开心", "笑"],
  "riskLevel": "none",
  "riskCategories": [],
  "summary": "芙宁娜开心表情包"
}
```

`memeCharacter` 必须是稳定角色名，不能把场景、动作、长句当文件夹名。`memeEmotion` 只能使用 `happy`、`sad`、`angry`、`confused`、`shy`、`surprised`、`default`。

### 娱乐和内容

| 命令 | 说明 |
| --- | --- |
| `60s` / `#60s` / `/60s` / `早报` | 获取 60 秒早报 |
| `早安` / `晚安` | 早晚安互动 |
| `#点歌 歌名` | 搜歌 |
| `#听 歌名` | 直接播放 |
| `#听 1` | 播放搜索结果第 1 首 |
| `1` 到 `20` | 在点歌列表中选择序号 |
| `#rss添加 订阅地址` | 添加 RSS |
| `#rss列表` | 查看 RSS |
| `#rss移除0` | 移除索引为 0 的订阅 |
| `#rss拉取 订阅地址` | 立即拉取指定订阅 |
| `#回应 内容` | 查看表情 reaction ID 并回应 |

RSS 会自动识别部分 `.atom` 或 `/feed` 链接。

## HTTP Skills

Skills 是给 AI 自动调用的 HTTP 工具。配置位置：

```text
config/skills.json
config/skills/*.json
data/crystelf/skills.json
data/crystelf/skills/*.json
```

推荐通过控制台“插件设置”的 Skills 面板管理：

- 启用或关闭全局 Skills。
- 启用或关闭单个 Skill。
- 搜索、筛选、展开技能卡片。
- 查看工具参数和示例。
- 使用预设批量开启。
- 用 JSON 编辑器校验、格式化、保存、恢复默认。

默认启用的常用 Skills：

| Skill | 用途 |
| --- | --- |
| `weather` | 天气查询 |
| `tracking` | 快递查询、快递公司识别 |
| `hotboard` | 主流平台热榜 |
| `calendar` | 日历、节假日、农历 |
| `webparse` | 网页解析、链接预览、网页图片提取 |
| `exchange` | 汇率查询和换算 |
| `paper` | OpenAlex 论文检索 |
| `earthquake` | USGS 地震速报 |
| `country` | 国家、首都、货币、语言、人口、时区 |
| `holiday-global` | 全球公共节假日 |
| `finance` | World Bank 宏观指标 |

默认关闭但可按需开启的 Skills 包括 `wiki`、`books`、`air-quality`、`security`、`developer`、`dictionary`、`chemistry`、`food`、`anime`、`games-deals`、`space`、`bio`、`translate`、`external-api`、`youtube`、`network`、`social`、`game`、`misc-extra`、`text`。

### 怎么调用 Skill

用户不需要输入特殊命令，直接自然语言提问即可，例如：

```text
花花查一下北京今天的天气
花花帮我看看这个快递单号到哪了
花花今天有什么热榜
花花查一下美元兑人民币汇率
花花搜一下这篇论文
```

如果想确认是否调用了 Skill，可以发送：

```text
#查看工具调用
```

如果没有调用，检查：

- `config/skills.json` 的 `enabled` 和 `autoLoad`。
- 对应 Skill 是否开启。
- AI 主接口是否支持工具调用。
- 控制台“会话调试”和“用量中心”里的工具调用记录。

## 帮助 DIY

控制台入口：

```text
http://127.0.0.1:27891/help-diy.html
```

支持：

- 自定义 `#灵晶帮助` 默认内容。
- 自定义 `#灵晶帮助 AI`、`管理`、`娱乐`、`调试` 分类内容。
- 文本模式和图片模式。
- 上传或选择帮助图片。
- 生成预览。
- 导入、导出、恢复默认。

当前默认帮助图位于：

```text
lib/webConsole/public/uploads/help-diy/default-help-navigation.png
```

开启图片模式后，`#灵晶帮助` 会优先发送配置的帮助图片。

## 主要配置文件

| 文件 | 说明 |
| --- | --- |
| `config/config.json` | 主开关、控制台、安全项、分页和日志项 |
| `config/ai.json` | AI、人设、会话、图像生成、群总结、表情策略 |
| `config/coreConfig.json` | 搜索、网页抓取、TTS、工具链、用量控制 |
| `config/imageMonitor.json` | 图片监控、视觉模型、表情包保存策略 |
| `config/groupTitle.json` | 群头衔申请和 AI 审核 |
| `config/skills.json` | Skills 总开关和定义列表 |
| `config/skills/*.json` | 拆分后的 Skill 定义 |

运行时配置和数据通常写入：

```text
data/crystelf/
```

长期维护建议优先使用控制台或锅巴配置，减少直接改默认 JSON。

## 数据和日志位置

| 路径 | 说明 |
| --- | --- |
| `data/crystelf/image-monitor/` | 图片监控审核图、表情包、索引、日志 |
| `data/crystelf/skills*` | Skills 运行时覆盖 |
| `data/crystelf/cache/` | TTS 模型缓存等 |
| `data/crystelf/` | 会话、画像、好感、用量、群管理等运行时数据 |

实际路径以 Bot 当前工作目录为准。

## 排错

### 控制台打不开

检查：

- Bot 是否已经启动。
- `config.webConsole` 是否为 `true`。
- 监听地址和端口是否是 `127.0.0.1:27891`。
- 如果端口冲突，检查 `webConsolePortAutoIncrement`。
- 控制台页面更新后建议重启 Bot。

### 登录口令不知道

查看或设置：

```text
config/config.json -> webConsoleToken
```

首次本机访问时也可以按登录页提示初始化。

### `/api/group-management` 返回 404

通常是 Bot 进程还在跑旧代码。重启 Bot 后再打开：

```text
http://127.0.0.1:27891/group-management.html
```

### AI 生图失败或超时

检查：

- `ai.imageConfig.enabled` 是否开启。
- `imageMode` 是否正确。
- `model` 是否是接口支持的图像模型。
- `baseApi` 是否是基地址，不要填具体 endpoint。
- `apiKey` 是否正确。
- 慢接口把 `timeout` 调到 `120000` 或 `360000`。
- `gpt-image-2` 推荐 `responseFormat=b64_json`。
- 控制台“API 设置”里先跑图像接口测试。

### `#绘图` 没有被本插件处理

这是正常行为。本插件故意不抢 `#绘图` 和 `#画图`，这两个命令留给其他绘图插件。

### 图片监控生成了很多奇怪文件夹

检查视觉模型输出的 `memeCharacter` 和 `memeEmotion`：

- `memeCharacter` 应该是角色名，例如 `芙宁娜`。
- `memeEmotion` 应该是固定枚举，例如 `happy`。
- 不要让模型把场景、动作、长句写进 `memeCharacter`。
- 可以用 `saveMemeCharacters` 和 `saveMemeKeywords` 限制入库。
- 可以在图片监控中心清理非表情包和不符合过滤器的入库图片。

### 群管理没有自动通过申请

检查：

- `config.groupManagement` 是否开启。
- 对应群是否在群管理面板启用。
- 自动通过规则是否开启。
- Bot 是否收到加群申请事件。
- QQ 等级、账号年龄等条件是否由当前适配器提供。
- 黑名单、风险规则是否拦截了申请。

### 群头衔发放失败

检查：

- `config.groupTitle` 是否开启。
- `config/groupTitle.json` 的 `enabled` 是否开启。
- 机器人是否是该群群主。
- 头衔长度是否超过限制。
- 是否命中禁用关键词。

## 本地检查

项目内置编码检查：

```bash
npm run check:encoding
```

控制台也提供“依赖检查”页面，可用于确认关键依赖、配置和运行环境。

## 兼容说明

- 插件面向 Yunzai / TRSS-Yunzai。
- 群消息、发送图片、撤回、设置群头衔、emoji reaction 等能力会受当前适配器限制。
- 代码中已尽量通过适配层处理不同 Bot 环境，但具体行为以当前 Bot 端完整环境为准。
- 外部接口能力以你配置的 API 服务为准，慢接口建议提高超时时间。

## 维护建议

- 控制台只在本机访问，公网暴露必须强口令和只读。
- 群管理、图片监控、自动撤回、自动通过加群申请建议逐群开启，先观察日志。
- 改 Skills 后用 `#查看工具调用` 和沙盒聊天确认是否真的调用。
- 改帮助图后用 `#灵晶帮助` 实测发送效果。
- 推送到 Bot 端后重启 Bot，再测试控制台和群内命令。
