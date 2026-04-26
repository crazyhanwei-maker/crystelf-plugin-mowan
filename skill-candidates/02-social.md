# Social Candidates

## 1. UAPI GitHub 仓库信息

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-github-repo>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/github/repo`
- 鉴权：免 key
- 核心参数：`repo=owner/repo`
- 成功响应核心字段：`full_name`、`description`、`homepage`、`language`、`topics`、`stargazers`、`forks`、`open_issues`、`latest_release`
- 适合原因：非常适合插件更新、仓库分析、项目推荐、版本检查
- 风险 / 限制：协作者和维护者字段可能受权限限制或为空
- 推荐命名：`github.get_repo`

## 2. UAPI GitHub 用户信息

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-github-user>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/github/user`
- 鉴权：免 key
- 核心参数：`user`
- 常用可选：`activity=true`、`pinned=true`、`repos=true`
- 成功响应核心字段：`login`、`name`、`bio`、`company`、`location`、`avatar_url`、`organizations`
- 适合原因：适合查开发者资料、组织信息、开源活跃度
- 风险 / 限制：开启活动数据后返回体会变大，接入时建议使用 `pick`
- 推荐命名：`github.get_user`

## 3. UAPI B 站视频信息

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-social-bilibili-videoinfo>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/social/bilibili/videoinfo`
- 鉴权：免 key
- 核心参数：`aid` 或 `bvid`
- 成功响应核心字段：`title`、`pic`、`owner`、`stat`、`desc`、`pubdate`、`tname`
- 适合原因：B 站链接解析、群聊查视频、UP 主数据补全都很适合
- 风险 / 限制：返回体较大，接入时应对 `rights`、`pages`、`desc_v2` 做裁剪
- 推荐命名：`bilibili.get_video_info`

## 4. UAPI B 站直播间信息

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-social-bilibili-liveroom>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/social/bilibili/liveroom`
- 鉴权：免 key
- 核心参数：`mid` 或 `room_id`
- 成功响应核心字段：`room_id`、`live_status`、`title`、`online`、`area_name`、`user_cover`
- 适合原因：适合 bot 回答“主播开播没”“直播间标题是什么”
- 风险 / 限制：在线人气不是精确在线人数
- 推荐命名：`bilibili.get_liveroom`

## 5. UAPI B 站用户信息

- 优先级：`B`
- 文档：<https://uapis.cn/docs/api-reference/get-social-bilibili-userinfo>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/social/bilibili/userinfo`
- 鉴权：免 key
- 核心参数：`uid`
- 成功响应核心字段：`name`、`face`、`sign`、`level`、`follower`、`archive_count`
- 适合原因：适合根据 UID 补充资料卡
- 风险 / 限制：比视频 / 直播场景窄一些
- 推荐命名：`bilibili.get_user_info`

## 备选

- UAPI B 站投稿：<https://uapis.cn/docs/api-reference/get-social-bilibili-archives>
- UAPI B 站评论：<https://uapis.cn/docs/api-reference/get-social-bilibili-replies>

## 这一组建议先接入

1. `github.get_repo`
2. `github.get_user`
3. `bilibili.get_video_info`
4. `bilibili.get_liveroom`
