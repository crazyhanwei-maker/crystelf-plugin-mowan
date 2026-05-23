globalThis.logger = {
  info: (...args) => console.log('[info]', ...args),
  warn: (...args) => console.log('[warn]', ...args),
  error: (...args) => console.log('[error]', ...args),
  mark: (...args) => console.log('[mark]', ...args),
};

const ConfigControl = (await import('../lib/config/configControl.js')).default;
const { startWebConsole } = await import('../lib/webConsole/server.js');

await ConfigControl.init();
const info = await startWebConsole();
console.log(JSON.stringify({
  ok: true,
  info,
  tokenGenerated: info?.authTokenGenerated === true,
}, null, 2));

setInterval(() => {}, 1 << 30);
