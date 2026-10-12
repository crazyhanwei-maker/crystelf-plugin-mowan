/* Classic browser helper. Icon SVGs and paging remain the caller's responsibility. */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'crystelf-help-recent-icons';
  const RECENT_LIMIT = 24;
  const CARTOON_COUNT = 40;
  const categories = [
    { id: 'all', label: '全部' },
    { id: 'recent', label: '最近使用' },
    { id: 'navigation', label: '导航' },
    { id: 'ai', label: 'AI 智能' },
    { id: 'media', label: '媒体娱乐' },
    { id: 'manage', label: '管理安全' },
    { id: 'tools', label: '工具' },
    { id: 'social', label: '社交' },
    { id: 'nature', label: '自然天气' },
    { id: 'commerce', label: '商业生活' },
  ];

  // Match whole hyphen-delimited words, preferring compounds to their components.
  // In particular, car/cart/card and logo-apple/apple must not share translations.
  const words = {
    navigation: {
      home: '首页 主页 房屋 家', menu: '菜单 导航', nav: '导航',
      search: '搜索 查找 检索 放大镜', compass: '指南针 方向 导航',
      navigate: '导航 定位 方向', location: '位置 定位 地点 地图',
      locate: '定位 位置 瞄准', map: '地图 路线 导航', pin: '图钉 标记 位置',
      'trail-sign': '路标 指路 导航', flag: '旗帜 标记 目标',
      arrow: '箭头 方向', caret: '三角箭头 方向', chevron: '折角箭头 方向',
      back: '返回 后退 向左 左', forward: '前进 向右 右',
      up: '向上 上 上移', down: '向下 下 下移', left: '向左 左 左侧', right: '向右 右 右侧',
      'arrow-redo': '重做 恢复 右箭头', 'arrow-undo': '撤销 撤回 左箭头',
      'chevron-collapse': '收起 折叠', 'chevron-expand': '展开 扩展',
      'return-down-back': '返回 换行 左下箭头 向左 向下',
      'return-down-forward': '返回 换行 右下箭头 向右 向下',
      'return-up-back': '返回 左上箭头 向左 向上',
      'return-up-forward': '返回 右上箭头 向右 向上',
      'swap-horizontal': '水平交换 左右 切换', 'swap-vertical': '垂直交换 上下 切换',
      move: '移动 拖动 方向 上下左右', expand: '展开 放大 全屏',
      contract: '收缩 缩小 退出全屏', resize: '调整大小 缩放',
      enter: '进入 回车', exit: '退出 离开', open: '打开 外链 新窗口',
      airplane: '飞机 航空 出行', bicycle: '自行车 单车 骑行',
      boat: '船 游艇 出行', bus: '公交 巴士 出行', car: '汽车 车辆 出行',
      'car-sport': '跑车 汽车 车辆 出行', subway: '地铁 交通', train: '火车 列车 交通',
      walk: '步行 行走 出行', footsteps: '脚印 足迹 步行',
    },
    ai: {
      ai: '人工智能 智能 AI', bot: '机器人 智能助手 AI 人工智能',
      robot: '机器人 智能助手 AI 人工智能', brain: '大脑 思考 智能 AI',
      'hardware-chip': '芯片 硬件 处理器 机器人 智能 AI',
      bulb: '灯泡 灵感 创意 智能', sparkles: '闪光 魔法 智能 AI',
      rocket: '火箭 启动 创新', 'color-wand': '魔法棒 智能 生成 特效',
      infinite: '无限 循环', 'logo-ionitron': '机器人 智能助手 Ionitron',
    },
    media: {
      image: '图片 图像 照片 picture photo', images: '图片 图像 相册 照片',
      camera: '相机 摄影 拍照 照片', 'camera-reverse': '切换相机 翻转镜头 拍照',
      albums: '相册 专辑 图片', aperture: '光圈 摄影 镜头',
      film: '电影 胶片 视频', videocam: '摄像机 视频 录像', tv: '电视 视频',
      mic: '麦克风 话筒 语音 录音', headset: '耳机 耳麦 音乐 语音',
      musical: '音乐 音符 歌曲 点歌 music', 'musical-note': '音乐 音符 歌曲 点歌 music',
      'musical-notes': '音乐 音符 歌曲 点歌 music', music: '音乐 歌曲 点歌',
      volume: '音量 声音 喇叭', 'volume-mute': '静音 无声 音量',
      'volume-off': '关闭声音 静音 音量', recording: '录音 语音 音频',
      radio: '广播 电台 音频', disc: '光盘 唱片 音乐',
      play: '播放 视频 音乐', pause: '暂停 播放', stop: '停止 播放',
      'play-back': '快退 倒放 上一首 播放', 'play-forward': '快进 播放',
      'play-skip-back': '上一首 上一个 上一曲 播放',
      'play-skip-forward': '下一首 下一个 下一曲 播放',
      repeat: '重复 单曲循环 播放', shuffle: '随机播放 洗牌 音乐',
      'game-controller': '游戏 手柄 娱乐', dice: '骰子 随机 游戏',
      'american-football': '橄榄球 运动 体育', baseball: '棒球 运动 体育',
      basketball: '篮球 运动 体育', 'bowling-ball': '保龄球 运动 体育',
      football: '足球 运动 体育', golf: '高尔夫 运动 体育', tennisball: '网球 运动 体育',
      barbell: '杠铃 健身 运动', fitness: '健身 运动 健康',
      medal: '奖牌 荣誉 成就', trophy: '奖杯 荣誉 冠军', podium: '领奖台 排名 榜单',
      easel: '画架 绘画 美术', brush: '画笔 绘画 刷子',
      'color-fill': '填色 油漆 颜色', 'color-filter': '滤镜 颜色 图片',
      'color-palette': '调色板 颜色 绘画', contrast: '对比度 明暗 图像',
      'invert-mode': '反色 颜色 明暗', crop: '裁剪 图片 剪裁',
      'logo-youtube': '油管 视频 YouTube', 'logo-tiktok': '抖音 短视频 TikTok',
      'logo-twitch': '直播 游戏 Twitch', 'logo-vimeo': '视频 Vimeo',
      'logo-soundcloud': '音乐 音频 SoundCloud', 'logo-playstation': '游戏 主机 索尼 PlayStation',
      'logo-xbox': '游戏 主机 微软 Xbox', 'logo-steam': '游戏 平台 Steam',
      'logo-google-playstore': '应用商店 安卓 游戏 Google Play',
    },
    manage: {
      'nav-系统设置': '系统设置 设置 配置 管理', 'nav-更新日志': '更新日志 更新 日志 版本 历史',
      设置: '设置 配置 管理', 管理: '管理 管理员 控制', 安全: '安全 保护 验证',
      settings: '设置 配置 齿轮 管理', setting: '设置 配置 齿轮 管理',
      cog: '齿轮 设置 配置 管理', options: '选项 设置 配置 管理',
      shield: '盾牌 安全 保护 防护 管理', 'shield-checkmark': '盾牌 安全 验证 认证 通过',
      lock: '锁 安全 权限 加密', 'lock-closed': '锁定 上锁 安全 加密',
      'lock-open': '解锁 开锁 安全 权限', key: '钥匙 密钥 安全 权限',
      'finger-print': '指纹 安全 验证 认证', 'id-card': '身份 证件 用户 验证',
      'log-in': '登录 登入 进入 账户', 'log-out': '退出登录 登出 账户',
      eye: '查看 显示 可见', 'eye-off': '隐藏 不可见 隐私',
      ban: '禁止 封禁 禁用 管理', warning: '警告 告警 注意 安全',
      alert: '提醒 警报 告警 感叹号', fail: '失败 错误 异常',
      check: '确认 勾选 成功 验证', checkmark: '确认 勾选 成功 完成 验证',
      checkbox: '复选框 勾选 选择', close: '关闭 取消 叉号',
      add: '添加 新增 加号 创建', remove: '移除 减少 减号 删除',
      trash: '删除 垃圾桶 清理 移除', 'trash-bin': '删除 垃圾桶 清理 回收站',
      archive: '归档 存档 收纳', folder: '文件夹 目录 文件 管理',
      document: '文档 文件 资料', documents: '文档 文件 资料',
      'document-lock': '文档 文件 加密 安全', clipboard: '剪贴板 清单 管理 复制',
      copy: '复制 拷贝 副本', duplicate: '复制 副本 克隆',
      save: '保存 存储 磁盘', layers: '图层 层级 分层 管理',
      analytics: '分析 统计 数据 图表 管理', chart: '图表 统计 数据 管理',
      'bar-chart': '柱状图 图表 统计 数据', 'pie-chart': '饼图 图表 统计 数据',
      'stats-chart': '统计图 图表 数据', 'trending-up': '上涨 趋势 增长 图表',
      'trending-down': '下降 趋势 下跌 图表',
      server: '服务器 服务 运维 管理', toggle: '开关 启用 禁用 设置',
      refresh: '刷新 更新 重试', reload: '重新加载 刷新 重试',
      sync: '同步 刷新 更新', version: '版本 更新 升级 刷新',
      'cloud-done': '云端 云同步 完成 成功', 'cloud-offline': '云端 离线 断开',
      'cloud-download': '云端 下载 云下载', 'cloud-upload': '云端 上传 云上传',
      'file-tray': '文件 收纳 托盘 收件箱',
    },
    tools: {
      build: '工具 扳手 构建 维修 修复', construct: '工具 维修 扳手 锤子 修复',
      tool: '工具 调试 修复', tools: '工具 调试 修复', wrench: '扳手 工具 维修 修复',
      hammer: '锤子 工具 维修', bug: '漏洞 错误 调试 排查 虫子',
      code: '代码 编程 开发', terminal: '终端 命令 调试 控制台',
      git: '代码 版本 仓库 开发', 'git-branch': '分支 代码 版本',
      'git-commit': '提交 代码 版本', 'git-merge': '合并 分支 代码',
      'git-pull-request': '合并请求 拉取请求 代码',
      desktop: '电脑 桌面 显示器 控制台', laptop: '笔记本 电脑',
      browsers: '浏览器 网页 窗口 多窗口',
      phone: '手机 电话 设备', tablet: '平板 设备', watch: '手表 设备 时间',
      cellular: '信号 移动网络 通信', bluetooth: '蓝牙 无线 连接',
      wifi: '无线 网络 联网', power: '电源 开机 关机', battery: '电池 电量',
      'battery-charging': '电池 充电 电量', 'battery-dead': '电池 没电 电量',
      'battery-full': '电池 满电 电量', 'battery-half': '电池 半电 电量',
      calculator: '计算器 计算 数学', calendar: '日历 日期 日程', today: '今天 日历 日期',
      time: '时间 时钟 历史', timer: '计时器 倒计时 时间', stopwatch: '秒表 计时',
      alarm: '闹钟 提醒 时间', hourglass: '沙漏 等待 时间',
      book: '书籍 阅读 知识', library: '图书馆 知识库 书籍',
      journal: '日记 记录 笔记', reader: '阅读 读者 书籍', school: '学校 学习 教育',
      language: '语言 翻译 中英文', text: '文字 文本 字体',
      newspaper: '新闻 报纸 早报 资讯', information: '信息 说明 提示',
      help: '帮助 疑问 问号', 'help-buoy': '帮助 救生圈 支持',
      print: '打印 打印机', attach: '附件 回形针', cut: '剪切 剪刀',
      create: '编辑 创建 写作 修改', pencil: '铅笔 编辑 修改 写作',
      backspace: '退格 删除 清除', download: '下载 保存', upload: '上传 发送',
      link: '链接 连接 网址', unlink: '取消链接 断开连接',
      filter: '筛选 过滤', funnel: '漏斗 筛选 过滤',
      grid: '网格 布局 宫格', apps: '应用 程序 网格', list: '列表 清单',
      reorder: '排序 拖动 调整顺序', 'extension-puzzle': '插件 扩展 拼图',
      keypad: '键盘 输入 数字', barcode: '条形码 扫码', 'qr-code': '二维码 扫码',
      scan: '扫描 扫码', binoculars: '望远镜 查找 观察', telescope: '望远镜 天文 观察',
      magnet: '磁铁 吸附', speedometer: '速度 仪表盘 性能',
      beaker: '烧杯 实验 测试', flask: '烧瓶 实验 测试',
      flashlight: '手电筒 照明', glasses: '眼镜 阅读', eyedrop: '滴管 取色',
      cube: '立方体 方块', shapes: '形状 图形', square: '方形 正方形',
      ellipse: '椭圆 图形', triangle: '三角形 图形', prism: '棱柱 图形',
      ellipsis: '更多 省略号', logo: '品牌 标志 商标',
      'logo-android': '安卓 系统 Android', 'logo-apple': '苹果 系统 Apple',
      'logo-apple-appstore': '苹果 应用商店 AppStore', 'logo-apple-ar': '苹果 增强现实 AR',
      'logo-chrome': '谷歌 浏览器 Chrome', 'logo-edge': '微软 浏览器 Edge',
      'logo-firefox': '火狐 浏览器 Firefox', 'logo-google': '谷歌 搜索 Google',
      'logo-microsoft': '微软 系统 Microsoft', 'logo-windows': '微软 视窗 系统 Windows',
      'logo-tux': '企鹅 系统 Linux', 'logo-github': '代码 仓库 GitHub',
      'logo-gitlab': '代码 仓库 GitLab', 'logo-docker': '容器 开发 Docker',
      'logo-python': '编程 开发 Python', 'logo-javascript': '编程 开发 JavaScript',
      'logo-nodejs': '编程 服务端 Nodejs', 'logo-npm': '包管理 开发 npm',
      'logo-react': '前端 开发 React', 'logo-vue': '前端 开发 Vue',
      'logo-figma': '设计 协作 Figma', 'logo-wordpress': '博客 网站 WordPress',
      'logo-rss': '订阅 新闻 RSS', 'logo-no-smoking': '禁止吸烟 禁烟',
    },
    social: {
      person: '用户 个人 人物 账户 头像', people: '用户 群组 群聊 成员 团队 管理',
      user: '用户 个人 账户 头像', users: '用户 群组 成员 团队',
      'person-add': '添加用户 入群 邀请 成员', 'person-remove': '移除用户 退群 踢人 成员 管理',
      chatbox: '聊天 消息 对话 会话 气泡', chatbubble: '聊天 消息 对话 会话 气泡',
      chatbubbles: '群聊 聊天 消息 对话 会话 气泡', chat: '聊天 消息 对话 会话',
      mail: '邮件 邮箱 消息 信封', 'mail-unread': '未读邮件 邮箱 消息',
      call: '电话 通话 联系', send: '发送 消息 纸飞机', 'paper-plane': '纸飞机 发送 消息',
      notifications: '通知 提醒 消息 铃铛', notification: '通知 提醒 消息 铃铛',
      bell: '铃铛 通知 提醒', megaphone: '公告 广播 喇叭 通知',
      at: '艾特 提及 邮箱', share: '分享 转发 共享', 'share-social': '社交 分享 转发',
      heart: '爱心 喜欢 收藏 关注 心形', star: '星星 星标 收藏 喜欢',
      bookmark: '书签 收藏 标记', bookmarks: '书签 收藏 标记',
      happy: '开心 快乐 笑脸 表情', sad: '难过 悲伤 哭脸 表情',
      'thumbs-up': '点赞 赞 同意 支持', 'thumbs-down': '点踩 反对 不喜欢',
      'heart-dislike': '不喜欢 取消收藏 心形', 'heart-dislike-circle': '不喜欢 取消收藏 心形',
      'hand-left': '左手 举手 手掌', 'hand-right': '右手 举手 手掌',
      accessibility: '无障碍 辅助 人物', body: '身体 人体 人物',
      man: '男人 男性 人物', woman: '女人 女性 人物',
      male: '男性 男', female: '女性 女', 'male-female': '性别 男女',
      transgender: '跨性别 性别', push: '推送 手势', balloon: '气球 庆祝',
      ribbon: '丝带 勋章 荣誉',
      'logo-wechat': '微信 聊天 社交', 'logo-whatsapp': '聊天 社交 WhatsApp',
      'logo-discord': '群聊 社区 Discord', 'logo-facebook': '脸书 社交 Facebook',
      'logo-twitter': '推特 社交 Twitter', 'logo-x': '推特 社交 Twitter X',
      'logo-instagram': '照片 社交 Instagram', 'logo-linkedin': '领英 职场 社交',
      'logo-skype': '通话 聊天 Skype', 'logo-slack': '团队 聊天 Slack',
      'logo-reddit': '社区 论坛 Reddit', 'logo-threads': '社区 社交 Threads',
      'logo-mastodon': '长毛象 社区 社交 Mastodon', 'logo-snapchat': '聊天 社交 Snapchat',
      'logo-pinterest': '图片 收藏 社交 Pinterest', 'logo-tumblr': '博客 社交 Tumblr',
    },
    nature: {
      sunny: '晴天 太阳 阳光 天气', sun: '太阳 晴天 阳光 天气',
      'partly-sunny': '晴间多云 多云 太阳 天气', moon: '月亮 夜晚 月牙 天气',
      cloud: '云 云朵 天气', cloudy: '多云 阴天 天气', 'cloudy-night': '夜间多云 月亮 天气',
      rainy: '下雨 雨天 天气', snow: '雪 下雪 雪花 天气',
      thunderstorm: '雷雨 雷电 暴雨 天气', umbrella: '雨伞 下雨 天气',
      thermometer: '温度 温度计 天气', water: '水 水滴 雨水',
      earth: '地球 世界 全球', globe: '地球 全球 世界 网络 联网',
      planet: '星球 行星 宇宙', leaf: '叶子 植物 绿色 自然',
      flower: '花 花朵 植物', rose: '玫瑰 花朵 植物', paw: '爪印 宠物 动物',
      fish: '鱼 动物 海洋', flame: '火 火焰 热门', bonfire: '篝火 火焰',
      flash: '闪电 快速 闪光', zap: '闪电 快速 能量', nuclear: '核能 辐射',
      ear: '耳朵 听觉', skull: '骷髅 头骨 危险',
      health: '健康 心跳 状态 监测', pulse: '脉搏 心跳 健康',
      medical: '医疗 健康 十字', medkit: '急救箱 医疗 健康',
      bandage: '绷带 医疗 伤口', nutrition: '营养 健康 食物',
    },
    commerce: {
      cart: '购物车 购物 商城', bag: '购物袋 包 购物', basket: '购物篮 篮子 购物',
      card: '银行卡 信用卡 支付 卡片', cash: '现金 钱 金钱 支付',
      wallet: '钱包 钱 金钱 支付', receipt: '收据 小票 账单',
      pricetag: '价格 标签 商品', pricetags: '价格 标签 商品',
      storefront: '店铺 商店 商城 门店', business: '商业 公司 办公 大楼',
      briefcase: '公文包 工作 办公 商务', gift: '礼物 礼品 赠送',
      diamond: '钻石 宝石 贵重', ticket: '票 门票 票券',
      shirt: '衣服 衬衫 服装', bed: '床 睡觉 酒店', scale: '秤 重量 称重',
      cafe: '咖啡 咖啡馆 饮品', beer: '啤酒 饮品', wine: '葡萄酒 红酒 饮品',
      pint: '酒杯 饮品', restaurant: '餐厅 餐饮 吃饭', 'fast-food': '快餐 汉堡 餐饮',
      pizza: '披萨 比萨 食物', egg: '鸡蛋 食物', 'ice-cream': '冰淇淋 甜品',
      'logo-alipay': '支付宝 支付', 'logo-paypal': '贝宝 支付 PayPal',
      'logo-venmo': '支付 Venmo', 'logo-amazon': '亚马逊 购物 商城 Amazon',
      'logo-bitcoin': '比特币 数字货币', 'logo-euro': '欧元 货币',
      'logo-usd': '美元 美金 货币', 'logo-yen': '日元 人民币 货币',
    },
  };
  const modifiers = {
    outline: '线框 轮廓 描边', sharp: '尖角 锐利', circle: '圆形 圆圈',
    horizontal: '水平 横向', vertical: '垂直 竖向', half: '一半 半',
    off: '关闭 禁用', on: '开启 启用', full: '完整 满',
    text: '文字 文本', number: '数字', clear: '清除',
    done: '完成 成功', charging: '充电', high: '高 大', low: '低 小', medium: '中',
  };
  const lexicon = new Map();
  Object.keys(words).forEach(category => {
    Object.keys(words[category]).forEach(word => {
      lexicon.set(word, { category, aliases: words[category][word] });
    });
  });
  const categoryIds = new Set(categories.map(category => category.id));
  let memoryRecent = [];
  let storageUnavailable = false;

  function lower(value) {
    return String(value == null ? '' : value).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  function tokens(value) {
    return lower(value).match(/[a-z0-9\u3400-\u9fff]+/g) || [];
  }

  function describe(item) {
    let category = '';
    const search = new Set();
    [item.slug, item.name].forEach(value => {
      const parts = tokens(value);
      if (!parts.length) return;
      search.add(lower(value));
      search.add(parts.join('-'));
      search.add(parts.join(' '));
      for (let index = 0; index < parts.length;) {
        let entry = null;
        let length = parts.length - index;
        for (; length > 0; length--) {
          entry = lexicon.get(parts.slice(index, index + length).join('-'));
          if (entry) break;
        }
        if (entry) {
          if (!category) category = entry.category;
          search.add(lower(entry.aliases));
          index += length;
        } else {
          if (modifiers[parts[index]]) search.add(modifiers[parts[index]]);
          index++;
        }
      }
    });
    return { category: category || 'tools', searchText: Array.from(search).join(' ') };
  }

  function enrich(items) {
    if (!Array.isArray(items)) return [];
    return items.map(item => ({ ...item, ...describe(item || {}) }));
  }

  // IDs are syntactically validated without needing to fetch the icon catalogue.
  // Chinese slugs are used by the built-in ART PRO icons.
  function validId(icon) {
    if (typeof icon === 'number') {
      return Number.isInteger(icon) && icon >= 1 && icon <= CARTOON_COUNT ? icon : null;
    }
    if (typeof icon !== 'string') return null;
    const id = icon.trim().toLowerCase();
    return /^artd:[a-z0-9\u3400-\u9fff]+(?:-[a-z0-9\u3400-\u9fff]+)*$/.test(id) ? id : null;
  }

  function cleanRecent(value) {
    if (!Array.isArray(value)) return [];
    const ids = [];
    const seen = new Set();
    for (const entry of value) {
      const id = validId(entry);
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length === RECENT_LIMIT) break;
    }
    return ids;
  }

  function recent() {
    if (!storageUnavailable) {
      let stored;
      try {
        stored = global.localStorage.getItem(STORAGE_KEY);
      } catch {
        storageUnavailable = true;
        return memoryRecent.slice();
      }
      try {
        memoryRecent = cleanRecent(stored ? JSON.parse(stored) : []);
      } catch {
        memoryRecent = [];
      }
    }
    return memoryRecent.slice();
  }

  function remember(icon) {
    const id = validId(icon);
    const previous = recent();
    if (id === null) return previous;
    memoryRecent = [id, ...previous.filter(entry => entry !== id)].slice(0, RECENT_LIMIT);
    if (!storageUnavailable) {
      try {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryRecent));
      } catch {
        // Disabled storage or quota errors must not break the picker. Keep this
        // page's choices in memory instead of re-reading an older stored list.
        storageUnavailable = true;
      }
    }
    return memoryRecent.slice();
  }

  function itemId(item) {
    if (typeof item.slug === 'string' && item.slug) {
      return validId(item.slug.startsWith('artd:') ? item.slug : `artd:${item.slug}`);
    }
    // Also accept the caller's cartoon descriptors; the actual name is retained.
    for (const value of [item.icon, item.id, item.value]) {
      const id = validId(value);
      if (id !== null) return id;
    }
    return null;
  }

  function matches(searchText, query) {
    const haystack = lower(searchText);
    // English uses whole words; Chinese accepts substrings within meaningful
    // aliases, so both “设置” and “系统设置” work. Multiple terms use AND.
    return query.every(term => {
      if (/^[a-z0-9]+$/.test(term)) {
        return new RegExp(`(^|[^a-z0-9])${term}($|[^a-z0-9])`).test(haystack);
      }
      return haystack.includes(term);
    });
  }

  function filter(items, query = '', category = 'all') {
    if (!Array.isArray(items)) return [];
    const selectedCategory = categoryIds.has(category) ? category : 'all';
    const terms = tokens(String(query == null ? '' : query).trim().replace(/^artd:/i, ''));
    const ranks = selectedCategory === 'recent'
      ? new Map(recent().map((id, index) => [id, index]))
      : null;
    const result = items.filter(item => {
      if (!item || typeof item !== 'object') return false;
      if (ranks && !ranks.has(itemId(item))) return false;
      const metadata = typeof item.searchText === 'string' && categoryIds.has(item.category)
        ? item
        : describe(item);
      return (selectedCategory === 'all' || selectedCategory === 'recent' || metadata.category === selectedCategory)
        && matches(metadata.searchText, terms);
    });
    if (ranks) result.sort((a, b) => ranks.get(itemId(a)) - ranks.get(itemId(b)));
    // No display limit: the caller pages the complete set of matching icons.
    return result;
  }

  global.HelpDiyIcons = { categories, enrich, filter, remember, recent };
})(window);
