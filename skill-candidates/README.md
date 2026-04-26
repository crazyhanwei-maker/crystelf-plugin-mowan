# Skill Candidates

更新时间：2026-04-27

这份目录用于给 `crystelf-plugin` 挑选下一批适合接入 `config/skills.json` 的候选接口。

筛选标准：

- 适合当前 `HTTP skills` 框架
- 优先公开、免登录或低门槛
- 优先单次 HTTP 请求即可返回结构化 JSON
- 避免与当前已接入能力重复
- 对群聊 bot / 控制台 / AI 工具有实际价值

当前已接入，默认不再重复选：

- 天气
- 快递查询 / 快递公司识别
- 热榜
- 节假日 / 农历
- 网页元数据 / 网页图片提取
- 内置搜索 / 网页正文抓取 / TTS

优先级说明：

- `A`：很适合，且可直接按当前 skill 框架接入
- `B`：有用，但优先级略低或场景更窄
- `C`：有价值，但当前框架接入成本偏高，需要运行时升级

## 总表

| 分类 | 候选 | 优先级 | 说明 |
| --- | --- | --- | --- |
| 网络 | UAPI IP 信息查询 | A | 查 IP / 域名归属、ISP、ASN、经纬度 |
| 网络 | RDAP.org | A | 标准化域名 RDAP 查询，JSON 比传统 WHOIS 更适合 skill |
| 网络 | Google Public DNS JSON API | A | 做 DNS 解析最稳，字段天然适合 `pick` |
| 网络 | UAPI 手机归属地 | A | 查手机号归属省市和运营商 |
| 网络 | UAPI ICP 备案查询 | A | 查域名备案主体，适合站点背景核验 |
| 网络 | UAPI WHOIS 查询 | A | 查注册商、到期时间、域名状态 |
| 网络 | UAPI URL 状态检查 | A | 查 URL 是否可达，适合链路检测 |
| 社交 | UAPI GitHub 仓库信息 | A | 查 star / fork / release / 维护者 |
| 社交 | UAPI GitHub 用户信息 | A | 查开发者画像、组织、活跃数据 |
| 社交 | UAPI B 站视频信息 | A | 查标题、封面、UP 主、统计数据 |
| 社交 | UAPI B 站直播间信息 | A | 查是否开播、标题、人气、分区 |
| 社交 | UAPI B 站用户信息 | B | 查 UID 对应资料，适合补充 |
| 日常 | UAPI 世界时间 | A | 查任意时区当前时间 |
| 日常 | UAPI 程序员历史上的今天 | A | 很适合 bot 日常互动和定时推送 |
| 日常 | UAPI 程序员历史事件 | B | 指定月日查询，适合命令式使用 |
| 日常 | UAPI 一言 | B | 适合轻互动，但不是核心能力 |
| 日常 | UAPI 行政区域查询 | A | 地点解析、adcode 反查、坐标反查 |
| 日常 | UAPI 每日新闻图 | C | 返回图片二进制，当前 skill 框架不优 |
| 媒体 | OCR.Space OCR API | A | URL 直调、JSON 返回，适合图转文 |
| 媒体 | goQR 读码 API | A | 读二维码，公开可用，JSON 小而稳 |
| 媒体 | Sightengine 图片审核 | B | 审核很强，但需要账号和密钥 |
| 媒体 | Microlink Logo API | B | 抽站点 logo，适合链接卡片补图 |
| 媒体 | UAPI OCR / NSFW / 二维码生成 | C | 主要是 multipart 或图片响应，不适合现框架 |
| 游戏 | UAPI Steam 用户摘要 | A | 查 Steam 资料，支持多种标识 |
| 游戏 | UAPI MC 服务器状态 | A | 查在线状态、人数、版本、MOTD |
| 游戏 | UAPI MC 玩家信息 | A | 查 UUID、皮肤地址 |
| 游戏 | UAPI Epic 免费游戏 | A | 很适合做群推送与提醒 |
| 文本 | UAPI 敏感词快速检测 | A | 审核评论、输入前置检查 |
| 文本 | MyMemory Translation API | A | 免登录即可用，短句翻译门槛最低 |
| 文本 | Detect Language API | B | 适合翻译 / 审核前置做语言检测 |
| 文本 | TextGears Summarize | B | 适合把长文本压短，和正文抓取互补 |
| 文本 | UAPI 翻译 | B | 有用，但和现有 AI 有功能重叠 |
| 文本 | UAPI 文本分析 | B | 轻量统计有用，但不是高频核心 |

## 文件列表

- [01-network.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/01-network.md)
- [02-social.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/02-social.md)
- [03-daily.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/03-daily.md)
- [04-media.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/04-media.md)
- [05-games.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/05-games.md)
- [06-text.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/06-text.md)
- [07-public-apis.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/07-public-apis.md)

## 2026-04-27 新增公开接口实测

已在 bot 所在 VPS 上用 `curl` 实测一批免 key 公开接口，结论记录在 [07-public-apis.md](D:/群机器人插件/crystelf-plugin-main/skill-candidates/07-public-apis.md)。

最值得下一批接入：

1. Open-Meteo Air Quality / Geocoding / Elevation：空气质量、城市坐标、海拔
2. OSV + NVD：开源包与 CVE 漏洞查询
3. npm Registry + PyPI JSON + Stack Exchange + Hacker News：开发者查询
4. PubChem：化合物与药品基础信息
5. Open Food Facts：条形码食品信息
6. Dictionary API + Datamuse：英文词典、近义词、联想词
7. Jikan + CheapShark：动漫与游戏折扣
8. GBIF + NASA EONET / Images + Launch Library：物种、自然事件、航天图片与发射

## 最推荐先做

如果只先挑一小批，我建议这 10 个先选：

1. UAPI `network/ipinfo`
2. RDAP.org `domain/{domain}`
3. Google DNS JSON API `resolve`
4. UAPI `network/icp`
5. UAPI `github/repo`
6. UAPI `github/user`
7. UAPI `social/bilibili/videoinfo`
8. UAPI `misc/worldtime`
9. UAPI `misc/district`
10. UAPI `game/epic-free`
11. UAPI `text/profanitycheck`
12. MyMemory Translation API

如果你还想补图像能力，再加：

13. OCR.Space OCR API
14. goQR `read-qr-code`
