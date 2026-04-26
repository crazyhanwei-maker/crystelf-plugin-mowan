# Daily Candidates

## 1. UAPI 世界时间

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-misc-worldtime>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/misc/worldtime`
- 鉴权：免 key
- 核心参数：`city`
- 成功响应核心字段：`datetime`、`offset_string`、`timezone`、`weekday`
- 适合原因：跨时区聊天、出海群、日常问答都很实用
- 风险 / 限制：参数实际是 IANA 时区名，不是真正的模糊城市搜索
- 推荐命名：`time.get_worldtime`

## 2. UAPI 程序员历史上的今天

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-history-programmer-today>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/history/programmer/today`
- 鉴权：免 key
- 核心参数：无
- 成功响应核心字段：`date`、`events[].year`、`events[].title`、`events[].description`、`events[].url`
- 适合原因：非常适合 bot 日常推送、群互动、定时任务
- 风险 / 限制：偏“程序员圈”主题，不适合通用新闻替代
- 推荐命名：`history.get_programmer_today`

## 3. UAPI 程序员历史事件

- 优先级：`B`
- 文档：<https://uapis.cn/docs/api-reference/get-history-programmer>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/history/programmer`
- 鉴权：免 key
- 核心参数：`month`、`day`
- 成功响应核心字段：`date`、`events`
- 适合原因：适合命令式查询某个日期
- 风险 / 限制：场景比“今天”弱
- 推荐命名：`history.get_programmer_on_date`

## 4. UAPI 一言

- 优先级：`B`
- 文档：<https://uapis.cn/docs/api-reference/get-saying>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/saying`
- 鉴权：免 key
- 核心参数：无
- 成功响应核心字段：`text`
- 适合原因：可做轻互动、空闲时发言、欢迎语池
- 风险 / 限制：娱乐性强，但不是高频刚需
- 推荐命名：`quote.get_saying`

## 5. UAPI 行政区域查询

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-misc-district>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/misc/district`
- 鉴权：免 key
- 核心参数：`keywords` / `adcode` / `lat` + `lng`
- 成功响应核心字段：`results[].name`、`level`、`country`、`province`、`city`、`district`、`adcode`、`center`
- 适合原因：地点解析、adcode 联动、坐标反查都很适合与天气、时间类能力配合
- 风险 / 限制：返回字段因中国 / 国际地区而异，接入时建议做 `pick`
- 推荐命名：`geo.search_district`

## 6. UAPI 每日新闻图

- 优先级：`C`
- 文档：<https://uapis.cn/docs/api-reference/get-daily-news-image>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/daily/news-image`
- 鉴权：免 key
- 核心参数：无
- 成功响应：`image/jpeg` 二进制
- 适合原因：适合早报图、信息看板
- 风险 / 限制：当前 skill 框架更适合 JSON，不适合直接接图片二进制
- 推荐结论：先不接，除非你要专门升级图片响应链路

## 这一组建议先接入

1. `time.get_worldtime`
2. `history.get_programmer_today`
3. `geo.search_district`
4. `quote.get_saying`
