import path from 'path';
import Path from '../../constants/path.js';

export const WEB_CONSOLE_DIR = path.join(Path.lib, 'webConsole');
export const PUBLIC_DIR = path.join(WEB_CONSOLE_DIR, 'public');
export const CHAT_DB_FILE = path.join(process.cwd(), 'data', 'chat', 'chat.json');
export const AFFINITY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'affinity', 'affinity.json');
export const USAGE_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'ai-usage.log');
export const IMAGE_USAGE_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'image-usage.log');
export const SEARCH_DEBUG_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'search-web.log');
export const API_QUALITY_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'api-quality.log');
export const AFFINITY_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'affinity.log');
export const WEB_CONSOLE_AUDIT_LOG_FILE = path.join(process.cwd(), 'data', 'crystelf', 'debug', 'web-console-audit.jsonl');
export const WEB_CONSOLE_AUDIT_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MONITOR_DIR = path.join(process.cwd(), 'data', 'crystelf', 'image-monitor');
export const IMAGE_MONITOR_REVIEW_LOG = path.join(process.cwd(), 'data', 'crystelf', 'image-monitor', 'review-log.jsonl');
export const IMAGE_MONITOR_MEME_INDEX = path.join(process.cwd(), 'data', 'crystelf', 'image-monitor', 'meme-index.jsonl');
export const IMAGE_MONITOR_MEME_DIR = path.join(process.cwd(), 'data', 'crystelf', 'image-monitor', 'memes');
export const HELP_DIY_FILE = path.join(Path.config, 'help-diy.json');
export const LEGACY_HELP_DIY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'help-diy.json');
export const HELP_DIY_UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads', 'help-diy');
export const HELP_DIY_HISTORY_FILE = path.join(process.cwd(), 'data', 'crystelf', 'help-diy-history.json');
export const DEFAULT_HELP_DIY_IMAGE = '/uploads/help-diy/default-help-navigation.png';
export const DEFAULT_CONSOLE_BACKGROUND_SOURCE_URL = 'https://www.loliapi.com/acg/pc/';
export const CONSOLE_BACKGROUND_CACHE_DIR = path.join(process.cwd(), 'temp', 'web-console-background');
export const CONSOLE_BACKGROUND_CACHE_FILE = path.join(CONSOLE_BACKGROUND_CACHE_DIR, 'current-image.bin');
export const CONSOLE_BACKGROUND_CACHE_META_FILE = path.join(CONSOLE_BACKGROUND_CACHE_DIR, 'current-image.json');
export const PACKAGE_JSON_FILE = Path.pkg;
export const PACKAGE_LOCK_FILE = path.join(Path.root, 'package-lock.json');
export const FILE_BROWSER_ROOT_DIR = process.cwd();
export const FILE_BROWSER_BLOCKED_NAMES = new Set(['.git', 'node_modules', 'temp']);
export const FILE_BROWSER_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const FILE_BROWSER_MAX_DIRECTORY_ENTRIES = 500;
export const FILE_BROWSER_SEARCH_MAX_RESULTS = 120;
export const FILE_BROWSER_SEARCH_MAX_PREVIEW_LENGTH = 180;
export const REMOTE_IMAGE_PROXY_TIMEOUT_MS = 10000;
export const REMOTE_IMAGE_PROXY_MAX_BYTES = 15 * 1024 * 1024;
export const REMOTE_IMAGE_PROXY_MAX_REDIRECTS = 3;
export const WEB_CONSOLE_REQUEST_BODY_MAX_BYTES = 8 * 1024 * 1024;
export const SANDBOX_CHAT_MAX_IMAGES = 6;
export const SANDBOX_CHAT_IMAGE_DATA_MAX_BYTES = 2 * 1024 * 1024;
export const QQ_SIMULATOR_VOICE_DATA_MAX_BYTES = 3 * 1024 * 1024;
export const QQ_SIMULATOR_ADAPTER_FORMATS = new Set(['onebot', 'icqq', 'go-cqhttp', 'napcat']);
export const QQ_SIMULATOR_GROUP_HISTORY_LIMIT = 30;
export const QQ_SIMULATOR_GROUP_HISTORY_TEXT_LIMIT = 600;
export const HELP_DIY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WEB_CONSOLE_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const WEB_CONSOLE_LOGIN_WINDOW_MS = 10 * 60 * 1000;
export const WEB_CONSOLE_LOGIN_MAX_FAILURES = 5;
export const WEB_CONSOLE_LOGIN_BLOCK_MS = 15 * 60 * 1000;
export const GROUP_MANAGEMENT_RUNTIME_TIMEOUT_MS = 3500;
export const GROUP_MANAGEMENT_MEMBER_LIMIT = 500;
export const GROUP_WELCOME_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const GROUP_WELCOME_IMAGE_CONTENT_TYPES = {
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
export const FILE_BROWSER_TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.html', '.css', '.yml', '.yaml', '.toml',
  '.ini', '.conf', '.sh', '.ps1', '.py', '.ts', '.tsx', '.jsx', '.vue', '.sql', '.log',
  '.env', '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc',
]);
