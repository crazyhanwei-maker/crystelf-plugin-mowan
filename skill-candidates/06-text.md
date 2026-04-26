# Text Candidates

## 1. UAPI 敏感词快速检测

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/post-sensitive-word-quick-check>
- 方法：`POST`
- 接口：`https://uapis.cn/api/v1/text/profanitycheck`
- 鉴权：免 key
- 核心参数：JSON body 中的 `text`
- 成功响应核心字段：`status`、`masked_text`、`forbidden_words`
- 适合原因：非常适合公网 bot 的文本审核、评论前置检查
- 风险 / 限制：主要针对中文敏感词，不是通用 AI 审核替代品
- 推荐命名：`moderation.quick_profanity_check`

## 2. MyMemory Translation API

- 优先级：`A`
- 文档：<https://mymemory.translated.net/doc/spec.php>
- 方法：`GET`
- 接口：`https://api.mymemory.translated.net/get`
- 鉴权：可匿名；可选 `key`
- 核心参数：`q`、`langpair`
- 成功响应核心字段：`responseData.translatedText`、`responseData.match`、`matches[]`
- 适合原因：翻译门槛极低，匿名即可跑，非常适合先做基础翻译能力
- 风险 / 限制：匿名额度不高；质量更适合短句，不适合长文精翻
- 推荐命名：`translate.translate_text`

## 3. Detect Language API

- 优先级：`B`
- 文档：<https://detectlanguage.com/documentation/v2>
- 方法：`POST`
- 接口：`https://ws.detectlanguage.com/0.2/detect`
- 鉴权：需要 Bearer API key
- 核心参数：`q`
- 成功响应核心字段：`data.detections[].language`、`isReliable`、`confidence`
- 适合原因：可以作为翻译、审核、摘要之前的前置路由器
- 风险 / 限制：需要注册；免费额度较小
- 推荐命名：`langdetect.detect_language`

## 4. TextGears Summarize

- 优先级：`B`
- 文档：<https://textgears.com/api>
- 方法：`GET`
- 接口：`https://api.textgears.com/summarize`
- 鉴权：需要 API key
- 核心参数：`text`
- 常用可选：`language`、`max_sentences`
- 成功响应核心字段：`status`、`response.keywords[]`、`response.summary[]`
- 适合原因：非常适合和现有 `fetch_web_markdown` 串联，把长正文压成群聊可读摘要
- 风险 / 限制：免费额度不高；单次文本长度有限制
- 推荐命名：`summary.summarize_text`

## 5. UAPI 文本分析

- 优先级：`B`
- 文档：<https://uapis.cn/docs/api-reference/post-text-analyze>
- 方法：`POST`
- 接口：`https://uapis.cn/api/v1/text/analyze`
- 鉴权：免 key
- 核心参数：JSON body 中的 `text`
- 成功响应核心字段：`characters`、`words`、`sentences`、`paragraphs`、`lines`
- 适合原因：可做轻量文本统计、控制台工具、发言分析
- 风险 / 限制：价值偏工具型，不是高频群聊核心功能
- 推荐命名：`text.analyze_stats`

## 6. UAPI 翻译

- 优先级：`B`
- 文档：<https://uapis.cn/docs/api-reference/post-translate-text>
- 方法：`POST`
- 接口：`https://uapis.cn/api/v1/translate/text`
- 鉴权：免 key
- 核心参数：查询参数 `to_lang`；JSON body `text`
- 成功响应核心字段：`source_lang`、`translated_text`
- 适合原因：对“纯翻译”场景很稳，不必总让大模型翻
- 风险 / 限制：和现有 AI 能力重叠，优先级低于审核和网络类工具
- 推荐命名：`translate.translate_text`

## 备选

- UAPI 敏感词分析：<https://uapis.cn/docs/api-reference/post-sensitive-word-analyze>
- UAPI AI 智能翻译：<https://uapis.cn/docs/api-reference/post-ai-translate>

## 这一组建议先接入

1. `moderation.quick_profanity_check`
2. `translate.translate_text`
3. `langdetect.detect_language`
4. `summary.summarize_text`
