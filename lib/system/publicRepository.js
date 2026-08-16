export const PUBLIC_REPOSITORY_URL = 'https://gitee.com/nuesurwan/crystelf-plugin.git';
export const PUBLIC_REPOSITORY_URL_FALLBACK = 'https://github.com/crazyhanwei-maker/crystelf-plugin-mowan.git';
export const PUBLIC_REPOSITORY_URLS = Object.freeze([
  PUBLIC_REPOSITORY_URL,
  PUBLIC_REPOSITORY_URL_FALLBACK,
].filter(Boolean));
export const PUBLIC_REPOSITORY_GIT_CONFIG_ARGS = Object.freeze([
  ...(process.platform === 'win32' ? ['-c', 'http.sslBackend=openssl'] : []),
  '-c',
  'credential.helper=',
]);
export const PUBLIC_REPOSITORY_BRANCH = 'main';
export const PUBLIC_REPOSITORY_REF = `crystelf-public/${PUBLIC_REPOSITORY_BRANCH}`;
export const PUBLIC_REPOSITORY_FETCH_REFSPEC = `refs/heads/${PUBLIC_REPOSITORY_BRANCH}:refs/remotes/${PUBLIC_REPOSITORY_REF}`;
