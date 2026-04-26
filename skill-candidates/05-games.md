# Games Candidates

## 1. UAPI Steam 用户摘要

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-game-steam-summary>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/game/steam/summary`
- 鉴权：可不传 `key`；如你自己有 Steam key 可作为可选项
- 核心参数：`steamid` / `id` / `id3`
- 成功响应核心字段：`personaname`、`avatarfull`、`personastate`、`profileurl`、`steamid`
- 适合原因：支持多种 Steam 标识输入，群聊里很好用
- 风险 / 限制：文档里允许传自定义 key，默认接入时建议不暴露该参数
- 推荐命名：`steam.get_user_summary`

## 2. UAPI MC 服务器状态

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-game-minecraft-serverstatus>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/game/minecraft/serverstatus`
- 鉴权：免 key
- 核心参数：`server`
- 成功响应核心字段：`online`、`players`、`max_players`、`version`、`motd_clean`
- 适合原因：非常适合群聊命令和游戏群 bot
- 风险 / 限制：玩家列表可能为空或不完整
- 推荐命名：`minecraft.get_server_status`

## 3. UAPI MC 玩家信息

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-game-minecraft-userinfo>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/game/minecraft/userinfo`
- 鉴权：免 key
- 核心参数：`username`
- 成功响应核心字段：`username`、`uuid`、`skin_url`
- 适合原因：适合根据玩家名查 UUID 和皮肤
- 风险 / 限制：仅正版用户名场景更稳
- 推荐命名：`minecraft.get_user_info`

## 4. UAPI Epic 免费游戏

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-game-epic-free>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/game/epic-free`
- 鉴权：免 key
- 核心参数：无
- 成功响应核心字段：`data[].title`、`cover`、`original_price`、`free_end`、`link`
- 适合原因：非常适合做群提醒、游戏推荐、定时任务
- 风险 / 限制：返回列表可能较长，接入时建议 `pick`
- 推荐命名：`epic.list_free_games`

## 这一组建议先接入

1. `epic.list_free_games`
2. `minecraft.get_server_status`
3. `steam.get_user_summary`
4. `minecraft.get_user_info`
