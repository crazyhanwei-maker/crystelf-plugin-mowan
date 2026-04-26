# Media Candidates

这一组优先看“当前 skill 框架是否能直接接”。当前框架更适合：

- `GET` / `POST JSON`
- URL 直调
- 直接返回 JSON

不太适合：

- `multipart/form-data`
- 直接返回图片二进制
- 需要上传本地文件

## 1. OCR.Space OCR API

- 优先级：`A`
- 文档：<https://ocr.space/ocrapi>
- 方法：`GET`
- 接口：`https://api.ocr.space/parse/imageurl?apikey={apikey}&url={image_url}`
- 鉴权：需要 `apikey`；官方测试 key 可用，正式建议自申请
- 核心参数：`apikey`、`url`
- 常用可选：`language`、`isOverlayRequired`、`detectOrientation`
- 成功响应核心字段：`ParsedResults[].ParsedText`、`ParsedResults[].TextOverlay`、`OCRExitCode`
- 适合原因：URL 直调、JSON 返回，最适合当前 skill 框架补 OCR 能力
- 风险 / 限制：免费额度有限；图片必须公网可访问
- 推荐命名：`ocr.extract_text`

## 2. goQR 读码 API

- 优先级：`A`
- 文档：<https://goqr.me/api/doc/read-qr-code/>
- 方法：`GET`
- 接口：`https://api.qrserver.com/v1/read-qr-code/?fileurl={image_url}&outputformat=json`
- 鉴权：无
- 核心参数：`fileurl`
- 成功响应核心字段：`symbol[0].data`、`symbol[0].error`
- 适合原因：二维码识别是当前插件明显缺口，而且这个接口返回体非常小
- 风险 / 限制：图片必须公网可访问；文件大小和格式有要求
- 推荐命名：`qrcode.read_qr`

## 3. Sightengine 图片审核

- 优先级：`B`
- 文档：<https://sightengine.com/docs/getstarted>
- 方法：`GET`
- 接口：`https://api.sightengine.com/1.0/check.json?url={image_url}&models=nudity-2.1,gore-2.0,weapon,qr-content,text-content&api_user={api_user}&api_secret={api_secret}`
- 鉴权：需要 `api_user` 和 `api_secret`
- 核心参数：`url`、`models`、`api_user`、`api_secret`
- 成功响应核心字段：`status`、`nudity.*`、`gore.*`、`weapon.*`
- 适合原因：图片审核和风控能力强，适合公网 bot 的防风险链路
- 风险 / 限制：需要账户密钥；海外服务延迟要评估
- 推荐命名：`image_guard.moderate_image`

## 4. Microlink Logo API

- 优先级：`B`
- 文档：<https://microlink.io/>
- 方法：`GET`
- 接口：`https://api.microlink.io?url={url}&filter=logo.url`
- 鉴权：匿名可用，高配额需要 key
- 核心参数：`url`
- 成功响应核心字段：`data.logo.url`
- 适合原因：和现有网页元数据能力互补，适合给链接卡片补站点 logo
- 风险 / 限制：和 `webparse.get_metadata` 有轻度交叉
- 推荐命名：`site_image.get_site_logo`

## 5. Gravatar Profiles API

- 优先级：`B`
- 文档：<https://docs.gravatar.com/rest-api/>
- 方法：`GET`
- 接口：`https://api.gravatar.com/v3/profiles/{profileIdentifier}`
- 鉴权：公开资料可无 token，完整字段可带 token
- 核心参数：路径参数 `profileIdentifier`
- 成功响应核心字段：`display_name`、`profile_url`、`avatar_url`、`description`、`verified_accounts`
- 适合原因：适合做用户资料卡、头像补全
- 风险 / 限制：适用面不如 GitHub / B 站广
- 推荐命名：`profile.get_gravatar_profile`

## 6. 暂不推荐直接接入的接口

### UAPI OCR

- 文档：<https://uapis.cn/docs/api-reference/post-image-ocr>
- 原因：请求体是 `multipart/form-data`，当前 skill 框架不适合直接发文件表单

### UAPI 图片敏感检测

- 文档：<https://uapis.cn/docs/api-reference/post-image-nsfw>
- 原因：同样偏 `multipart/form-data`，且文档侧认证方式更偏 key 场景

### UAPI 生成二维码

- 文档：<https://uapis.cn/docs/api-reference/get-image-qrcode>
- 原因：主要返回图片二进制，当前 skill 框架更适合 JSON

## 这一组建议先接入

1. `ocr.extract_text`
2. `qrcode.read_qr`
3. `image_guard.moderate_image`
