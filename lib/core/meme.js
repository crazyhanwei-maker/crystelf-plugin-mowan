import ConfigControl from '../config/configControl.js';
import fs from 'fs/promises';
import path from 'path';

const CACHE_SUBDIR = path.join('data', 'crystelf', 'cache');
const LOCAL_MEME_SUBDIR = path.join('data', 'chat', 'meme');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const KNOWN_EMOTIONS = new Set([
  'happy',
  'sad',
  'angry',
  'surprised',
  'surprise',
  'confused',
  'excited',
  'tired',
  'shy',
  'proud',
  'default',
  'funny',
  'cute',
  'love',
  'neutral',
  'bye',
  'sorry',
  'good',
  'goodmorning',
  'goodnight',
]);

const EMOTION_ALIASES = {
  surprise: 'surprised',
  shocked: 'surprised',
  confuse: 'confused',
  embarrassed: 'shy',
  embarassed: 'shy',
  smile: 'happy',
  grin: 'happy',
  laugh: 'funny',
  laughing: 'funny',
  joy: 'happy',
};

const EMOTION_RULES = [
  [/笑|开心|高兴|偷笑|憋笑|捂嘴|哈哈|可爱|萌/iu, ['happy', 'funny', 'cute', 'default']],
  [/哭|难过|伤心|委屈|泪|emo|沮丧/iu, ['sad', 'default']],
  [/怒|生气|火大|气死|炸毛|不爽/iu, ['angry', 'default']],
  [/惊|震惊|吓|愣|卧槽|讶/iu, ['surprised', 'confused', 'default']],
  [/疑惑|困惑|懵|问号|不懂/iu, ['confused', 'neutral', 'default']],
  [/害羞|脸红|羞/iu, ['shy', 'cute', 'default']],
  [/爱|喜欢|亲亲|心动|抱抱/iu, ['love', 'cute', 'default']],
  [/困|累|疲惫|晚安|睡/iu, ['tired', 'default']],
  [/得意|骄傲|自豪/iu, ['proud', 'default']],
  [/默认|普通|中性|平静/iu, ['default', 'neutral']],
];

function joinUrl(base, pathname) {
  const normalizedBase = String(base || '').replace(/\/+$/, '');
  const normalizedPath = String(pathname || '').replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

function resolveMemeApiBase(memeConfig, coreConfig) {
  const legacyCoreUrl = coreConfig?.coreUrl;
  return String(memeConfig.apiBase || legacyCoreUrl || 'http://165.99.42.28:5555').replace(/\/+$/, '');
}

function dedupe(items = []) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeImageUrl(apiBase, imageUrl) {
  const value = String(imageUrl || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${apiBase}${value.startsWith('/') ? value : `/${value}`}`;
}

function normalizeLocalDirInput(dirPath = '') {
  return String(dirPath || '').trim().replace(/[\\/]+$/, '');
}

function resolveLocalBaseDir(memeConfig = {}) {
  const configured = normalizeLocalDirInput(memeConfig?.localBaseDir);
  const rawPath = configured || LOCAL_MEME_SUBDIR;

  if (path.isAbsolute(rawPath)) {
    return path.normalize(rawPath);
  }

  return path.resolve(process.cwd(), rawPath);
}

async function findCaseInsensitiveDirectory(parentDir, targetName) {
  const normalizedTarget = String(targetName || '').trim().toLowerCase();
  if (!normalizedTarget) return '';

  try {
    const entries = await fs.readdir(parentDir, { withFileTypes: true });
    const match = entries.find(
      entry => entry.isDirectory() && entry.name.toLowerCase() === normalizedTarget
    );
    return match ? path.join(parentDir, match.name) : '';
  } catch {
    return '';
  }
}

async function pickRandomImageFile(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map(entry => entry.name);

    if (files.length === 0) {
      return '';
    }

    const selectedFile = files[Math.floor(Math.random() * files.length)];
    return path.join(dirPath, selectedFile);
  } catch {
    return '';
  }
}

async function listImageFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

const Meme = {
  resolveLocalBaseDir(memeConfig = {}) {
    return resolveLocalBaseDir(memeConfig);
  },

  async getLocalMemeRuntimeConfig(memeConfigOverride = null) {
    const aiConfig = memeConfigOverride ? null : await ConfigControl.get('ai');
    const sourceConfig = memeConfigOverride || aiConfig?.memeConfig || {};
    return {
      enabled: sourceConfig.localEnabled !== false,
      preferLocal: sourceConfig.preferLocal === true,
      configuredBaseDir: normalizeLocalDirInput(sourceConfig.localBaseDir),
      resolvedBaseDir: resolveLocalBaseDir(sourceConfig),
    };
  },

  /**
   * 获取随机表情url
   * @param character 角色
   * @param status 状态
   * @returns {Promise<string>}
   */
  async getMeme(character, status, memeConfigOverride = null) {
    const aiConfig = memeConfigOverride ? null : await ConfigControl.get('ai');
    const memeConfig = memeConfigOverride || aiConfig?.memeConfig || {};
    const coreConfig = await ConfigControl.get('coreConfig');
    const apiBase = resolveMemeApiBase(memeConfig, coreConfig);
    const query = new URLSearchParams();

    if (character) {
      query.set('character', character);
    }

    if (status) {
      query.set('emotion', status);
    }

    query.set('count', '1');

    return `${joinUrl(apiBase, 'api/random.php')}?${query.toString()}`;
  },

  async getMemePayload(character, status, count = 1, memeConfigOverride = null) {
    const aiConfig = memeConfigOverride ? null : await ConfigControl.get('ai');
    const memeConfig = memeConfigOverride || aiConfig?.memeConfig || {};
    const coreConfig = await ConfigControl.get('coreConfig');
    const apiBase = resolveMemeApiBase(memeConfig, coreConfig);
    const query = new URLSearchParams();

    if (character) {
      query.set('character', character);
    }

    if (status) {
      query.set('emotion', status);
    }

    query.set('count', String(count));

    try {
      const response = await fetch(`${joinUrl(apiBase, 'api/random.php')}?${query.toString()}`);
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok) {
        return {
          success: false,
          status: response.status,
          error: `HTTP ${response.status}`,
        };
      }

      if (contentType.includes('application/json')) {
        return await response.json();
      }

      return {
        success: response.ok,
        imageUrl: `${joinUrl(apiBase, 'api/random.php')}?${query.toString()}`,
      };
    } catch (error) {
      logger.error(`[meme] 从表情包服务（或旧核心兼容服务兜底）获取表情包失败: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  },

  getEmotionCandidates(status = '') {
    const raw = String(status || '').trim();
    const normalized = raw.toLowerCase();
    const candidates = [];

    if (raw) candidates.push(raw);
    if (normalized && normalized !== raw) candidates.push(normalized);

    if (KNOWN_EMOTIONS.has(normalized)) {
      candidates.push(normalized === 'surprise' ? 'surprised' : normalized);
    }

    if (EMOTION_ALIASES[normalized]) {
      candidates.push(EMOTION_ALIASES[normalized]);
    }

    for (const [pattern, mapped] of EMOTION_RULES) {
      if (pattern.test(raw)) {
        candidates.push(...mapped);
      }
    }

    candidates.push('default');
    return dedupe(candidates);
  },

  async getPayloadImageUrl(character, status, count = 1, memeConfigOverride = null) {
    const aiConfig = memeConfigOverride ? null : await ConfigControl.get('ai');
    const memeConfig = memeConfigOverride || aiConfig?.memeConfig || {};
    const coreConfig = await ConfigControl.get('coreConfig');
    const apiBase = resolveMemeApiBase(memeConfig, coreConfig);
    const payload = await this.getMemePayload(character, status, count, memeConfigOverride);

    if (!payload?.success) {
      return '';
    }

    if (payload.imageUrl) {
      return normalizeImageUrl(apiBase, payload.imageUrl);
    }

    if (Array.isArray(payload.data) && payload.data.length > 0) {
      const firstImage = payload.data[0];
      return normalizeImageUrl(apiBase, firstImage?.image_url || firstImage?.url || firstImage?.src || '');
    }

    return '';
  },

  async getResolvedMemeUrl(character, status, fallbackStatuses = [], memeConfigOverride = null) {
    const localConfig = await this.getLocalMemeRuntimeConfig(memeConfigOverride);
    const candidates = dedupe([
      ...this.getEmotionCandidates(status),
      ...fallbackStatuses.flatMap(item => this.getEmotionCandidates(item)),
    ]);

    const tryLocal = async () => {
      if (!localConfig.enabled) {
        return null;
      }

      const localMeme = await this.getLocalResolvedMemePath(character, status, fallbackStatuses, memeConfigOverride);
      if (!localMeme.imagePath) {
        return null;
      }

      return {
        imageUrl: localMeme.imagePath,
        imagePath: localMeme.imagePath,
        emotion: localMeme.emotion || candidates[0] || 'default',
        character: localMeme.character || character,
        source: localMeme.source || 'local',
      };
    };

    const tryRemote = async () => {
      for (const candidate of candidates) {
        const imageUrl = await this.getPayloadImageUrl(character, candidate, 1, memeConfigOverride);
        if (imageUrl) {
          return {
            imageUrl,
            imagePath: imageUrl,
            emotion: candidate,
            character,
            source: 'remote',
          };
        }
      }

      return null;
    };

    if (localConfig.preferLocal) {
      const localFirst = await tryLocal();
      if (localFirst) {
        return localFirst;
      }
    }

    const remoteMeme = await tryRemote();
    if (remoteMeme) {
      return remoteMeme;
    }

    const localFallback = await tryLocal();
    if (localFallback) {
      return localFallback;
    }

    return {
      imageUrl: '',
      imagePath: '',
      emotion: candidates[0] || 'default',
      character,
      source: 'unavailable',
    };
  },

  async getLocalResolvedMemePath(character, status, fallbackStatuses = [], memeConfigOverride = null) {
    const localConfig = await this.getLocalMemeRuntimeConfig(memeConfigOverride);
    if (!localConfig.enabled) {
      return {
        imagePath: '',
        emotion: '',
        character: '',
        source: '',
      };
    }

    const baseDir = localConfig.resolvedBaseDir;
    const characterDir = await findCaseInsensitiveDirectory(baseDir, character);

    if (!characterDir) {
      return {
        imagePath: '',
        emotion: '',
        character: '',
        source: '',
      };
    }

    const candidates = dedupe([
      ...this.getEmotionCandidates(status),
      ...fallbackStatuses.flatMap(item => this.getEmotionCandidates(item)),
    ]);

    for (const candidate of candidates) {
      const emotionDir = await findCaseInsensitiveDirectory(characterDir, candidate);
      if (!emotionDir) {
        continue;
      }

      const imagePath = await pickRandomImageFile(emotionDir);
      if (imagePath) {
        return {
          imagePath,
          emotion: candidate,
          character: path.basename(characterDir),
          source: 'local-emotion',
        };
      }
    }

    const flatImagePath = await pickRandomImageFile(characterDir);
    if (flatImagePath) {
      return {
        imagePath: flatImagePath,
        emotion: candidates[0] || 'default',
        character: path.basename(characterDir),
        source: 'local-flat',
      };
    }

    return {
      imagePath: '',
      emotion: '',
      character: path.basename(characterDir),
      source: '',
    };
  },

  async scanLocalMemeDirectory(memeConfigOverride = null) {
    const localConfig = await this.getLocalMemeRuntimeConfig(memeConfigOverride);
    const baseDir = localConfig.resolvedBaseDir;
    const result = {
      success: true,
      enabled: localConfig.enabled,
      preferLocal: localConfig.preferLocal,
      configuredBaseDir: localConfig.configuredBaseDir,
      resolvedBaseDir: baseDir,
      exists: false,
      supportedLayouts: [
        '<baseDir>/<character>/<emotion>/<image>',
        '<baseDir>/<character>/<image>',
      ],
      summary: {
        characterCount: 0,
        totalImages: 0,
        nestedCharacterCount: 0,
        flatCharacterCount: 0,
        mixedCharacterCount: 0,
        emptyCharacterCount: 0,
      },
      characters: [],
    };

    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      result.exists = true;

      const characterEntries = entries
        .filter(entry => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

      for (const entry of characterEntries) {
        const characterDir = path.join(baseDir, entry.name);
        const dirEntries = await fs.readdir(characterDir, { withFileTypes: true });
        const flatFiles = dirEntries
          .filter(item => item.isFile() && IMAGE_EXTENSIONS.has(path.extname(item.name).toLowerCase()))
          .map(item => item.name);

        const emotions = [];
        for (const child of dirEntries.filter(item => item.isDirectory())) {
          const emotionDir = path.join(characterDir, child.name);
          const emotionFiles = await listImageFiles(emotionDir);
          if (emotionFiles.length > 0) {
            emotions.push({
              name: child.name,
              count: emotionFiles.length,
              sampleFiles: emotionFiles.slice(0, 3),
            });
          }
        }

        const structure = emotions.length > 0 && flatFiles.length > 0
          ? 'mixed'
          : emotions.length > 0
            ? 'nested'
            : flatFiles.length > 0
              ? 'flat'
              : 'empty';

        if (structure === 'nested') result.summary.nestedCharacterCount += 1;
        if (structure === 'flat') result.summary.flatCharacterCount += 1;
        if (structure === 'mixed') result.summary.mixedCharacterCount += 1;
        if (structure === 'empty') result.summary.emptyCharacterCount += 1;

        const imageCount = flatFiles.length + emotions.reduce((sum, item) => sum + item.count, 0);
        result.summary.totalImages += imageCount;
        result.characters.push({
          name: entry.name,
          structure,
          imageCount,
          flatFileCount: flatFiles.length,
          sampleFlatFiles: flatFiles.slice(0, 3),
          emotions,
        });
      }

      result.summary.characterCount = result.characters.length;
      return result;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return result;
      }

      logger.error(`[meme] 扫描本地表情包目录失败: ${error.message}`);
      return {
        ...result,
        success: false,
        error: error.message,
      };
    }
  },

  async getCharacters() {
    const aiConfig = await ConfigControl.get('ai');
    const memeConfig = aiConfig?.memeConfig || {};
    const coreConfig = await ConfigControl.get('coreConfig');
    const apiBase = resolveMemeApiBase(memeConfig, coreConfig);

    try {
      const response = await fetch(joinUrl(apiBase, 'api/characters.php'));
      const data = await response.json();
      if (data?.success && Array.isArray(data.data)) {
        try {
          const cacheDir = path.join(process.cwd(), CACHE_SUBDIR);
          await fs.mkdir(cacheDir, { recursive: true });
          await fs.writeFile(
            path.join(cacheDir, 'meme-characters.json'),
            JSON.stringify(data.data, null, 2),
            'utf8'
          );

          const pluginCacheDir = path.join(process.cwd(), 'crystelf-plugin-main', CACHE_SUBDIR);
          await fs.mkdir(pluginCacheDir, { recursive: true });
          await fs.writeFile(
            path.join(pluginCacheDir, 'meme-characters.json'),
            JSON.stringify(data.data, null, 2),
            'utf8'
          );
        } catch (writeError) {
          logger.error(`[meme] 缓存角色列表失败: ${writeError.message}`);
        }
        return data.data;
      }
    } catch (error) {
      logger.error(`[meme] 从表情包服务（或旧核心兼容服务兜底）获取角色列表失败: ${error.message}`);
    }

    return [];
  },
};

export default Meme;
