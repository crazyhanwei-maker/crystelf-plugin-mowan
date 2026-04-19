# crystelf-plugin

> 多功能群娱乐插件，包含群聊互动、RSS、点歌、AI 对话、本地控制台与网页调试沙箱等能力。

## 安装方法

- 使用 Github

  ```bash
  git clone --depth=1 https://github.com/Jerryplusy/crystelf-plugin ./plugins/crystelf-plugin
  ```

- 使用 Crystelf-Gitea 镜像（更新可能滞后）

  ```bash
  git clone --depth=1 https://git.crystelf.top/Jerry/crystelf-plugin ./plugins/crystelf-plugin
  ```

### 安装依赖

在 `Yunzai` 根目录下执行：

- npm

  ```bash
  npm install
  ```

- pnpm

  ```bash
  pnpm install
  ```

## 快速开始

1. 将插件放入 `./plugins/crystelf-plugin`。
2. 安装依赖后启动 Yunzai。
3. 使用锅巴或运行时配置文件填写基础配置。
4. 若启用 AI，请至少确认：
   - `ai.baseApi`
   - `ai.apiKey`
   - `ai.modelType`
5. 若启用联网搜索 / 网页读取 / TTS，请继续填写 `coreConfig.tools.*` 里的接口参数。

## 配置说明

### 配置文件分层

- `config/config.json`
  - 主开关配置
  - Web 控制台配置
  - 各功能启停
- `config/ai.json`
  - AI 对话、多模态、画像、人性化等配置
- `config/coreConfig.json`
  - AI 用量控制
  - 搜索工具
  - 网页转 Markdown
  - TTS 语音工具
- 其他配置
  - `auth.json`、`music.json`、`feeds.json`、`newcomer.json` 等分别管理对应功能

### 运行时配置说明

- 插件启动后会将默认配置同步到运行时数据目录。
- **实际生效的通常是运行时配置，不一定是插件目录下的默认配置文件。**
- README 只做说明，**推荐使用锅巴或控制台设置页管理配置**。

### 锅巴配置

本插件已适配锅巴，请优先通过锅巴进行配置。

**请不要直接长期手改插件目录下 `config` 文件夹中的默认文件。**

## 本地 Web 控制台

插件内置本地 Web 控制台，适合查看状态、排障与网页调试。

### 默认行为

- 默认启用本地控制台
- 默认地址：`http://127.0.0.1:27891/`
- 默认仅本机访问
- 可通过主配置修改：
  - `webConsole`
  - `webConsoleHost`
  - `webConsolePort`
  - `webConsoleRequireAuth`
  - `webConsoleToken`
  - `webConsoleReadOnly`

### 控制台能力

- 首页概览与健康检查
- 最近会话、用户画像、好感度、AI 用量日志
- 插件设置页
- 网页调试沙箱
- 网页读取调试
- AI 工具调用时间线
- 配置导出与恢复

### 安全建议

- 如果需要局域网访问，请务必设置 Token。
- 如果只是本地调试，建议保持 `127.0.0.1`。
- 对生产或多人共享环境，建议开启：
  - `webConsoleRequireAuth`
  - `webConsoleMaskSensitiveConfig`

## 网页调试沙箱

本地控制台内置网页调试页面，可用于在**不影响真实群聊数据**的情况下测试 AI 行为。

### 特点

- 不发送到真实群聊
- 不写入真实 chat.json
- 不写入真实画像 / 好感 / 学习数据
- 可单独调试系统提示词、上下文、网页阅读、工具调用

### 当前支持

- 普通文本对话
- 工具调用时间线
- 最终回答时间线节点
- 网页阅读测试
- 搜索 + 网页正文联动测试
- 表情包结果展示
- 语音结果展示
- 模型 / 温度 / max tokens 对比

### 网页阅读测试

已支持：

- 输入 URL 测试网页转 Markdown
- 直接预览返回正文
- 一键把网页正文注入当前对话输入框

## AI 能力

### 对话能力

- 自定义人设
- 自动调整回复长度与自动分段
- 决定是否引用与是否 @
- 支持获取引用消息
- 支持群聊上下文消息
- 自定义上下文长度
- 记忆存储与检索
- 自定义会话管理
- 多模态图片理解
- Markdown 渲染
- 代码高亮渲染
- 图片生成

### 已支持的内置工具

当前代码中已经支持以下 AI 工具：

- `search_web`
  - 联网搜索最新网页、公告、文档
- `fetch_web_markdown`
  - 读取指定网页正文并转换为 Markdown
- `speak_text`
  - 调用 TTS 工具生成语音

### 搜索与网页读取

当前 AI 已可联动执行：

1. 先搜索网页
2. 再读取网页正文
3. 最后结合网页内容回答

对应配置位于：

- `coreConfig.tools.search.apiUrl`
- `coreConfig.tools.search.markdownApiUrl`
- `coreConfig.tools.search.markdownStatusUrl`

### 语音工具

当前代码中已接入内置 TTS 工具。

启用前需要配置：

- `coreConfig.tools.tts.enabled`
- `coreConfig.tools.tts.apiUrl`
- `coreConfig.tools.tts.modelsUrl`
- `coreConfig.tools.tts.defaultModel`

可调项包括：

- 默认语言
- 默认情感
- 输出音频类型
- 自动语音最大长度
- 允许自动语音的场景
- 是否要求显式语音意图关键词

### 自动语音场景代码

`coreConfig.tools.tts.allowedAutoScenes` 使用逗号分隔场景代码，例如：

```text
reply,poked
```

当前代码中可用的场景代码包括：

- `reply`
  - 正常回复 / 被提问 / 被 @ 时的场景
- `comment`
  - 对上一条回复继续补充评论时的场景
- `idle`
  - 群里沉默一段时间后，机器人主动插话的场景
- `review`
  - 你回复之后，别人继续追问或补充时的场景
- `poked`
  - 被戳一戳时的场景

默认值为：

```text
reply,poked
```

这表示默认只允许在：

- 正常回复
- 被戳一戳

这两个场景中自动发送语音。

例如：

```text
reply,poked,comment
```

表示除了默认场景外，也允许在 `comment` 场景中自动发送语音。

### 自动语音额外限制

即使场景命中，也还会继续受这些条件限制：

- `allowAiTrigger = true`
- 文本长度不能超过 `maxAutoVoiceTextLength`
- 如果 `requireVoiceKeywords = true`，则用户消息中还需要出现显式语音意图关键词，例如：
  - `语音`
  - `念出来`
  - `读出来`
  - `说出来`
  - `发语音`
  - `配音`
  - `朗读`

网页调试页也能直接显示语音结果。

### 表情包能力

表情能力分为两类：

- **表情回复**
  - 监听群聊中的 emoji 并进行贴图/表情反馈
- **AI 主动发表情包**
  - AI 在合适语境下根据角色与情绪选择表情包

网页调试页目前也能直接显示 AI 产出的表情包结果。

## 可用功能  
> 某些功能可能会与其他插件发生冲突,在config中调整对应功能关闭即可
<details>
<summary>60s</summary>

- 命令: `60s` 或 `早报`  
![60s.png](resources/readme/60s.png)
</details>
<details>
<summary>更好的<small><del>手性碳</del></small>数字验证</summary>

> bot需要为群管理及以上,操作者需为主人或群管理员
- `#开启验证` 在本群开启验证,默认验证模式为数字验证(100以内加减法)
- `#关闭验证` 在本群关闭验证
- `#切换验证模式` 在数字验证模式和手性碳验证模式之间切换
- `#重新验证@某人` 让这个人重新验证一次  
- `#绕过验证@某人` 你不用再验证了  
- `#设置验证(提示|困难)模式(开启|关闭)` 提示模式开启时,会在图上用`*`标记手性碳位置;困难模式开启时,新人需要回答出全部手性碳位置而不是默认的只需要回答出一个位置
- `#设置验证次数+次数` 最大验证次数
- `#设置撤回(开启|关闭)` 是否撤回错误答案  
![tan.png](resources/readme/tan.png)
</details>
<details>
<summary>自定义加群欢迎</summary>

> 操作者需为主人或群管理员
- `#设置欢迎文案+欢迎词` 在某个群替换默认欢迎文案为欢迎词
- `#设置欢迎图片+图片` 或 `#设置欢迎图片` + 引用图片 在某个群的欢迎词后面加一张图片/表情包
- `#查看欢迎` 查看当前群欢迎词
- `#清除欢迎` 清除当前群欢迎词  
![welcome.png](resources/readme/welcome.png)

</details>
<details>
<summary>表情回复</summary>

- 开启后bot会监听所有群聊中用户消息中存在的emoji并贴上表情
- `#回应+emoji` 查看当前emoji对应类型及id

</details>
<details>
<summary>戳一戳功能</summary>

- 开启本功能后戳一戳bot会调用晶灵核心的戳一戳词库进行回复
</details>
<details>
<summary>rss订阅及推送</summary>

- `#rss添加+订阅地址` 添加rss订阅源到该群聊,bot会定时检查该源是否更新并推送
- `#rss移除+id` 在本群移除某个订阅
- `#rss拉取+订阅地址` 测试拉取某个rss源

</details>
<details>
<summary>早晚安</summary>

- 在群里正常的发送早晚安时,插件会调用晶灵智能的早晚安api获取文案进行回复
- `早安`
- `晚安`

</details>
<details>
<summary>点歌功能</summary>

- 使用[hifi公共音源库](https://github.com/sachinsenal0x64/hifi)提供服务,
- 由于音源位于海外,大陆连接下载音乐时可能遇到缓慢问题,考虑优化网络环境
- 由于海外音源,搜歌时考虑使用繁体中文,英文等进行搜索以处理搜索不到的情况
- 默认下载flac/CD无损级音乐,可在配置文件调整为mp3音质或直接通过语音发送
- ~~可以听周杰伦~~
- `#点歌晴天`
- `#听1`
- `#听夜曲`

> 直接#听+歌曲名可能播放错误的歌曲

</details>
<details>
<summary>晶灵智能✨</summary>

> 与机器人进行普通的对话吧!

单次对话消耗tokens>2000,请合理安排使用  
支持功能:  
- [X] 自定义人设  
- [X] 自动调整回复长度及自动分段发送  
- [X] 发送聊天消息时决定是否引用及是否@  
- [X] 根据语境发送表情包 (需要晶灵核心)  
- [X] 戳一戳别人  
- [X] 代码高亮渲染  
- [X] Markdown渲染  
- [X] 自定义上下文长度  
- [X] 记忆存储及搜索  
- [X] 自定义会话管理  
- [X] 支持获取引用消息,使用seq标记  
- [X] 支持群聊上下文消息  
- [X] 支持调用内置工具  
- [X] 获取引用消息  
- [X] 适配多模态模型,查看图片等  
- [X] 支持联网搜索  
- [X] 支持网页正文读取  
- [X] 支持内置语音工具  
- [X] 支持生成图片  
- [ ] 支持渲染数学公式  
- [ ] 违禁词检测  
- [ ] 使用toon代替json与模型交互  


**填写完配置文件后开箱即用!**  
支持@调用及昵称开头语句调用  
![meme.jpg](resources/readme/meme.jpg)
![md.jpg](resources/readme/md.jpg)
![code.jpg](resources/readme/code.jpg)
</details>

## 帮助与文档现状

- 当前项目里有 `apps/help.js` 文件，但帮助指令模块尚未真正补完。
- 现阶段请优先以 README、锅巴设置页和本地 Web 控制台为准。
- 后续如需补聊天内帮助命令，可再单独实现。

## 关于晶灵核心  
晶灵核心是一个开源的api服务,使用nestjs框架编写,本插件部分功能依赖于晶灵核心,如戳一戳,早晚安,晶灵智能等.  
其中,全部功能都可以使用官方提供的api进行操作,如果部分地区被墙或速度过慢,可以参考教程自行部署晶灵核心.  
晶灵核心及文案等数据均开源,但表情数据及图片为闭源不公开,如自行部署需要考虑表情问题(如自行收集表情包存于相关目录下).  
自行搭建请前往[晶灵核心仓库](https://github.com/crystelf/crystelf-core)

## 关于兼容性
| 框架/适配器          | 是否适配   |
|-----------------|--------|
| TRSS-Yunzai     | 完全适配   |
| Miao-Yunzai     | 可能出现问题 |
| Onebot-Napcat   | 完全适配   |
| Onebot-Lgr      | 完全适配   |
| Onebot-LLTwoBot | 部分适配   |
| ICQQ            | 可能出现问题 |

## 常见问题

### 1. 控制台打不开

- 检查是否启用了 `webConsole`
- 检查端口是否被占用
- 检查 `webConsoleHost` 是否仍为 `127.0.0.1`
- 如果开启了鉴权，请检查 Token 是否正确

### 2. 网页读取失败

请检查：

- `coreConfig.tools.search.markdownApiUrl`
- `coreConfig.tools.search.markdownStatusUrl`
- 搜索 / 网页转 Markdown 服务是否可访问

### 3. 语音工具不生效

请检查：

- `coreConfig.tools.tts.enabled`
- `coreConfig.tools.tts.apiUrl`
- `coreConfig.tools.tts.modelsUrl`
- `coreConfig.tools.tts.defaultModel`

### 4. AI 不触发联网搜索或网页读取

请检查：

- 搜索工具是否启用
- 搜索 API Key 是否已填写
- 模型是否支持工具调用
- 沙箱页是否能单独跑通搜索和网页读取

## 联系我们  
如果遇到任何问题,欢迎提出issue或加入我们的QQ群进行交流.    
闲聊群: [884788970](https://qun.qq.com/universal-share/share?ac=1&authKey=H6t8wQF4wz2okV93sQMB3X2ase0BdgAZQoKYQwf4iYIXY76TIynhInTYeRux1pGy&busi_data=eyJncm91cENvZGUiOiI4ODQ3ODg5NzAiLCJ0b2tlbiI6ImZVWGlqOHdIaUUwKzZtWmI2cU9wL1E5c2tBYzN5dDFqTzUyU29mazcwMmJmbkFXT1VobVhhbkRjbWhoMHR0WjciLCJ1aW4iOiIzNDc5NDQ1NzAzIn0%3D&data=yAdFXNuwB1TL2thCUrfZIhkO2Ud7PRHiwAGWH_Bd2Ev0L9rBfvpV7vfGb1xMqJsO8rvU_6ob-PI6JYt2EV8PtA&svctype=4&tempid=h5_group_info)  
开发者咕咕群: [1023625838](https://qun.qq.com/universal-share/share?ac=1&authKey=CqKLFZD7YY51MiiN6h2gzTOCUHt8Nh6UhPj%2Bl9nMsugTnAU3A%2FWGh5ezqClno1HI&busi_data=eyJncm91cENvZGUiOiIxMDIzNjI1ODM4IiwidG9rZW4iOiIxZUMzdExTWTV6WTBnQngvNHVGT3dNZlVFWVJ6aVJEUS9sOEpZZnozaHUvRjYrVkxZa2kyMFFmMXVYQXBEdm1lIiwidWluIjoiMzQ3OTQ0NTcwMyJ9&data=FgsEtwv4kJmNCu_tw55iWkw5Sw7m4YTXf8RP4kHodaTfYJ8OfQraUe2dXw5OAWS4SqqzOfZmCjVravKMt9aJWg&svctype=4&tempid=h5_group_info)    
