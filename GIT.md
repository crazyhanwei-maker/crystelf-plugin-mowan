# Git / Gitee 安装与更新

这份文档给插件使用者看，主要说明如何通过 Git 或 Gitee 安装、更新、切换地址和处理常见拉取问题。

## 1. 推荐安装方式

进入 Yunzai 根目录，然后执行：

```bash
git clone --depth=1 https://gitee.com/nuesurwan/crystelf-plugin.git ./plugins/crystelf-plugin
```

安装依赖：

```bash
pnpm install
```

如果你的 Bot 环境使用 npm：

```bash
npm install
```

完成后重启 Bot。

## 2. 更新插件

进入插件目录：

```bash
cd ./plugins/crystelf-plugin
```

拉取最新版本：

```bash
git pull
```

也可以在群里由主人发送：

```text
#更新灵晶
```

更新后建议重启 Bot，尤其是更新了控制台、群管理、图片监控、QQ 模拟器、AI 生图或插件管理功能时。

## 3. 查看当前版本

在插件目录执行：

```bash
git log -1 --oneline
```

查看插件版本：

```bash
node -p "require('./package.json').version"
```

当前文档对应版本：

```text
2.0.1
```

## 4. 如果已经手动下载过压缩包

如果你是直接下载 ZIP 放进 `plugins/crystelf-plugin` 的，目录里可能没有 `.git`，这时 `git pull` 不能更新。

推荐处理方式：

1. 备份自己的配置文件。
2. 删除旧的 `plugins/crystelf-plugin` 目录。
3. 用上面的 `git clone` 方式重新安装。
4. 把配置恢复回去。
5. 重启 Bot。

常见需要备份的配置：

```text
config/config.json
config/ai.json
config/imageMonitor.json
config/groupTitle.json
config/skills.json
config/skills/
```

运行时数据通常在：

```text
data/crystelf/
```

如果你不确定要不要保留，先整个目录备份。

## 5. 拉取失败怎么办

### 网络连接失败

可以稍后重试：

```bash
git pull
```

如果服务器访问 Gitee 不稳定，可以在本地更新后再同步到服务器。

### 提示不是 Git 仓库

通常是目录不是通过 `git clone` 安装的，或当前不在插件目录。

检查当前目录：

```bash
pwd
```

确认目录里是否存在 `.git`：

```bash
ls -a
```

Windows PowerShell 可用：

```powershell
Get-ChildItem -Force
```

### 提示有本地修改无法合并

这说明你本地改过插件文件。普通用户建议：

1. 先备份整个插件目录。
2. 如果只改过配置，优先备份 `config/` 和 `data/crystelf/`。
3. 重新 clone 一份干净插件。
4. 再恢复配置。

不要随便执行会清空改动的命令，避免把自己的配置或数据弄丢。

## 6. Bot 端更新步骤

推荐顺序：

1. 停止 Bot。
2. 进入 `plugins/crystelf-plugin`。
3. 执行 `git pull`。
4. 如果依赖有变化，在 Yunzai 根目录执行 `pnpm install` 或 `npm install`。
5. 启动 Bot。
6. 打开控制台确认页面正常。
7. 在测试群发送 `#灵晶状态` 和 `#灵晶帮助`。

## 7. 控制台和安全提醒

控制台默认地址：

```text
http://127.0.0.1:27891/
```

首次使用请查看启动日志中的控制台登录口令；也可以在配置中改成自己的强口令。

注意：

- 不建议把可写控制台直接暴露到公网。
- `启动控制台.cmd` 不会写死口令，也不会自动开放防火墙。
- 如果需要局域网访问，请自己确认监听地址、登录口令和防火墙规则。
- 插件管理里的“安装插件”默认只克隆仓库，不会默认执行依赖安装脚本。
- 如果手动选择安装依赖，会使用 `npm install --ignore-scripts`。

## 8. 常用命令

```bash
git clone --depth=1 https://gitee.com/nuesurwan/crystelf-plugin.git ./plugins/crystelf-plugin
git pull
git log -1 --oneline
```

群内命令：

```text
#更新灵晶
#灵晶状态
#灵晶帮助
```
