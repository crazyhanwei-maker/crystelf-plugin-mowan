# 魔丸官网静态站

这个目录是 `crystelf-plugin` 的静态官网，可以直接部署到任意静态站点服务。

## 文件结构

```text
guanwang/
  index.html
  features.html
  guide.html
  changelog.html
  site-data.js
  styles.css
  app.js
  assets/
```

## 本地预览

可以直接双击打开：

```text
guanwang/index.html
```

也可以在项目根目录启动一个静态服务：

```bash
npx serve guanwang
```

## 内容维护

- 官网主体结构在 `index.html`。
- 详细功能介绍在 `features.html`。
- 安装使用说明在 `guide.html`。
- 更新日志在 `changelog.html`。
- 公共页面数据在 `site-data.js`。
- 样式在 `styles.css`。
- 功能卡片、更新日志、FAQ、安装命令在 `app.js`。
- 图片素材位于 `assets/`。

## 安全说明

官网只包含公开介绍内容，不应放入：

- 控制台登录口令。
- 接口密钥。
- 私有接口地址。
- Bot 日志。
- 群聊记录。
- `data/crystelf/` 运行时数据。
- 用户画像、好感度、群总结原始记录。
