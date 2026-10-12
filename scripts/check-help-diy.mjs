// Isolated backend checks: node --experimental-vm-modules scripts/check-help-diy.mjs [--render]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crystelf-help-diy-'));
const originalCwd = process.cwd();
const uploadDir = path.join(scratch, 'lib', 'webConsole', 'public', 'uploads', 'help-diy');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const themeUrl = '/uploads/help-diy/theme.png';
const bodyUrl = '/uploads/help-diy/body.png';
const text = 'Test help\nCommands\n- [artd:nav-系统设置] #one  First\n- #two  Second\n- #three  Third\n- #four  Fourth\n- #five  Fifth\n- #six  Sixth';
const roundtripItems = [
  { title: '#点歌 歌名', desc: '' },
  { title: '中文 帮助', desc: '说明 内容' },
  { title: '#rss添加 订阅地址', desc: '' },
];
//Frontend contract: emit the delimiter for empty descriptions; a final divider survives payload.trim().
const serializeRoundtrip = items => ['Undo roundtrip', 'Commands', ...items.map(item => `- [artd:nav-系统设置] ${item.title}  ${item.desc}`), '━━━━━━━━━━━━'].join('\n').trim();
const roundtripText = serializeRoundtrip(roundtripItems);
const captures = [];
const results = [];
let renderCallback = async options => {
  captures.push(options);
  fs.writeFileSync(options.outputPath, png);
};
let realRenderer;

async function loadModule(relativePath, dependencies, globals = {}) {
  const context = vm.createContext({ console, process, Buffer, ...globals });
  const filename = path.join(projectDir, relativePath);
  const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), {
    context,
    identifier: filename,
    initializeImportMeta: meta => { meta.url = pathToFileURL(filename).href; },
  });
  await module.link(specifier => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency: ${specifier}`);
    const exports = dependencies[specifier];
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return module.namespace;
}

const plain = value => JSON.parse(JSON.stringify(value));
function check(label, callback) {
  callback();
  results.push(label);
}

try {
  // CWD-bound output and renderer cleanup stay in fresh scratch space; no live config is read.
  process.chdir(scratch);
  fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'theme.png'), png);
  fs.writeFileSync(path.join(uploadDir, 'body.png'), png);
  const icons = await import('../lib/help/artdIcons.js');
  const renderer = await loadModule('lib/help/miaoHelpRenderer.js', {
    fs: { default: fs }, path: { default: path }, url: { fileURLToPath },
    './artdIcons.js': { renderArtdIcon: icons.renderArtdIcon, getArtdIcon: icons.getArtdIcon },
    '../system/puppeteerRenderer.js': { renderHtmlToImage: options => renderCallback(options) },
    '../system/version.js': { default: { ver: 'test-version' } },
  });
  const defaults = plain(renderer.MIAO_STYLE_DEFAULTS);
  check('numeric defaults, every supported value, and invalid input fallback', () => {
    assert.deepEqual(plain(renderer.normalizeMiaoStyle()), defaults);
    for (const colCount of [2, 3, 4, 5]) {
      assert.equal(renderer.normalizeMiaoStyle({ colCount: String(colCount) }).colCount, colCount);
    }
    for (const fontScale of [0.85, 1, 1.15, 1.3]) {
      assert.equal(renderer.normalizeMiaoStyle({ fontScale: String(fontScale) }).fontScale, fontScale);
    }
    for (const invalid of [null, '', false, true, [], {}, -1, 0, 2.5, 99, Infinity, 'NaN']) {
      assert.equal(renderer.normalizeMiaoStyle({ colCount: invalid, fontScale: invalid }).colCount, 5);
      assert.equal(renderer.normalizeMiaoStyle({ colCount: invalid, fontScale: invalid }).fontScale, 1);
    }
    const style = renderer.normalizeMiaoStyle({ titleColor: '#12345', descColor: '#abc', titleAlign: 'CENTER', preset: 'blue' });
    assert.equal(style.titleColor, defaults.titleColor);
    assert.equal(style.descColor, '#abc');
    assert.equal(style.titleAlign, 'center');
    assert.equal(Object.hasOwn(style, 'preset'), false);
  });
  check('Unicode icon registry validation and unknown icon fallback', () => {
    const parsed = renderer.parseHelpText(text);
    assert.equal(parsed.groups[0].items[0].icon, 'artd:nav-系统设置');
    const unknown = renderer.parseHelpText('Test\nCommands\n- [artd:<script>] #x');
    assert.equal(typeof unknown.groups[0].items[0].icon, 'number');
  });
  check('explicit empty descriptions survive serialization, payload trim, and repeated undo roundtrips', () => {
    let serialized = roundtripText;
    for (let cycle = 0; cycle < 3; cycle++) {
      const items = renderer.parseHelpText(serialized).groups[0].items;
      assert.deepEqual(plain(items.map(({ title, desc }) => ({ title, desc }))), roundtripItems);
      assert.ok(items.every(item => item.icon === 'artd:nav-系统设置'));
      serialized = serializeRoundtrip(items);
    }
    const items = renderer.parseHelpText('Test\nCommands\n  - #点歌 歌名\t\t\n• 普通 标题  \n* #点歌 歌名\n- #点歌 歌名  查询歌曲\n━━━━━━━━━━━━').groups[0].items;
    assert.deepEqual(plain(items.map(({ title, desc }) => ({ title, desc }))), [
      { title: '#点歌 歌名', desc: '' },
      { title: '普通 标题', desc: '' },
      { title: '#点歌', desc: '歌名' },
      { title: '#点歌 歌名', desc: '查询歌曲' },
    ]);
  });
  check('uploaded image resolution rejects traversal, absolute paths, encodings, and directories', () => {
    assert.equal(renderer.resolveHelpDiyImageSource(themeUrl, uploadDir), fs.realpathSync(path.join(uploadDir, 'theme.png')));
    fs.mkdirSync(path.join(uploadDir, 'directory.png'));
    for (const url of [
      '/uploads/help-diy/../body.png', '/uploads/help-diy/sub/../../body.png',
      '/uploads/help-diy/%2e%2e/body.png', '/uploads/help-diy/%252e%252e/body.png',
      '/uploads/help-diy/..\\body.png', '/uploads/help-diy//body.png',
      '/uploads/help-diy/body.png:stream', '/uploads/help-diy/body.png?x=1',
      '/uploads/help-diy/body.png#fragment', '/uploads/help-diy/missing.png',
      '/uploads/help-diy/directory.png', '/uploads/help-diy/body.svg',
      path.join(uploadDir, 'body.png'), `data:image/png;base64,${png.toString('base64')}`,
    ]) assert.equal(renderer.resolveHelpDiyImageSource(url, uploadDir), '', url);
  });
  const outside = path.join(scratch, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'image.png'), png);
  fs.symlinkSync(outside, path.join(uploadDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  check('realpath guard rejects a symlink/junction escaping upload root', () => {
    assert.equal(renderer.resolveHelpDiyImageSource('/uploads/help-diy/linked/image.png', uploadDir), '');
  });

  let stored;
  const memoryFiles = new Map();
  const consoleModule = await loadModule('lib/webConsole/helpDiyConsole.js', {
    fs: { default: fs }, path: { default: path },
    '../help/miaoHelpRenderer.js': { renderMiaoHelpCard: renderer.renderMiaoHelpCard, normalizeMiaoStyle: renderer.normalizeMiaoStyle },
  });
  const diy = consoleModule.createHelpDiyConsole({
    uploadDir, historyFile: 'memory:history', helpDiyFile: 'memory:current', legacyHelpDiyFile: 'memory:legacy',
    getStoredConfig: () => stored,
    setStoredConfig: async value => { stored = plain(value); },
    safeReadJson: (filename, fallback) => memoryFiles.get(filename) ?? fallback,
    safeWriteJson: (filename, value) => memoryFiles.set(filename, plain(value)),
  });
  let payload = plain(await diy.buildPayload());
  assert.deepEqual(payload.miaoStyle, defaults);
  payload.enabled = true;
  payload.home.mode = 'miao';
  payload.home.text = text;
  payload.miaoStyle = { ...defaults, themeImage: themeUrl, bodyImage: bodyUrl, colCount: 3, fontScale: 1.15, titleColor: '#abcdef' };
  await diy.savePayload(payload);
  const preview = plain(await diy.buildImportPreviewPayload({ miaoStyle: { colCount: '2', fontScale: '1.3', preset: 'blue' } }));
  assert.equal(preview.changedCount, 1);
  assert.match(preview.changes[0], /样式/);
  assert.deepEqual(preview.next.home, payload.home);
  assert.deepEqual(preview.next.categories, payload.categories);
  assert.equal(preview.next.enabled, true);
  assert.equal(preview.next.miaoStyle.themeImage, themeUrl);
  assert.equal(Object.hasOwn(preview.next.miaoStyle, 'preset'), false);
  const saved = plain(await diy.savePayload({ miaoStyle: { colCount: '2', fontScale: '1.3', preset: 'blue' } }));
  const { updatedAt, ...comparableSaved } = saved;
  const { updatedAt: previousUpdatedAt, ...previousPayload } = payload;
  assert.deepEqual(comparableSaved, { ...previousPayload, ...preview.next });
  const legacyTemplate = plain(payload);
  delete legacyTemplate.miaoStyle;
  const oldPreview = plain(await diy.buildImportPreviewPayload(legacyTemplate));
  assert.deepEqual(oldPreview.next.miaoStyle, saved.miaoStyle);
  const oldSaved = plain(await diy.savePayload(legacyTemplate));
  assert.deepEqual(oldSaved.miaoStyle, saved.miaoStyle);
  assert.equal(diy.buildHistoryPayload()[0].payload.miaoStyle.bodyImage, bodyUrl);
  assert.ok(fs.existsSync(path.join(uploadDir, 'theme.png')));
  assert.ok(fs.existsSync(path.join(uploadDir, 'body.png')));
  results.push('default payload, save/import parity, style-only import, legacy template preservation, and history URLs');

  // Separate in-memory config exercises patch semantics without changing the render fixtures.
  let patchStored = plain(oldSaved);
  patchStored.home.image = themeUrl;
  let patchWriteHook = async () => {};
  const patchFiles = new Map();
  const patchDiy = consoleModule.createHelpDiyConsole({
    uploadDir, historyFile: 'memory:patch-history', helpDiyFile: 'memory:patch-current', legacyHelpDiyFile: 'memory:patch-legacy',
    getStoredConfig: () => patchStored,
    setStoredConfig: async value => { await patchWriteHook(value); patchStored = plain(value); },
    safeReadJson: (filename, fallback) => patchFiles.get(filename) ?? fallback,
    safeWriteJson: (filename, value) => patchFiles.set(filename, plain(value)),
  });
  const assertPersistedPatch = async savedPatch => {
    assert.deepEqual(plain(await patchDiy.buildPayload()), plain(savedPatch), 'export payload must match the completed save');
    assert.deepEqual(plain(patchDiy.buildHistoryPayload()[0].payload), plain(savedPatch), 'latest history must match the completed save');
  };
  const textPatch = { home: { text: 'Replacement help\nCommands\n- #replacement' } };
  const patchPreview = plain(await patchDiy.buildImportPreviewPayload(textPatch));
  assert.equal(patchPreview.changedCount, 1);
  assert.equal(patchPreview.next.home.mode, 'miao');
  assert.equal(patchPreview.next.home.image, themeUrl);
  let patchSaved = plain(await patchDiy.savePayload(textPatch));
  assert.deepEqual(patchSaved.home, patchPreview.next.home, 'partial import preview and save must agree');
  assert.deepEqual(patchSaved.categories, oldSaved.categories);
  await assertPersistedPatch(patchSaved);
  const categoryBefore = plain(patchSaved.categories.ai);
  patchSaved = plain(await patchDiy.savePayload({ categories: { ai: { text: 'Replaced AI text' } } }));
  assert.deepEqual(patchSaved.categories.ai, { ...categoryBefore, text: 'Replaced AI text' });
  await assertPersistedPatch(patchSaved);
  patchSaved = plain(await patchDiy.savePayload({ home: { text: '' }, categories: { ai: { text: '' } } }));
  assert.deepEqual(patchSaved.home, { mode: 'image', text: '', image: themeUrl }, 'explicit empty text must clear and retain the available image fallback');
  assert.deepEqual(
    patchSaved.categories.ai,
    { ...categoryBefore, mode: categoryBefore.image ? 'image' : 'text', text: '' },
    'empty miao category must fall back to its available image like the home block',
  );
  await assertPersistedPatch(patchSaved);
  patchSaved = plain(await patchDiy.savePayload({ home: { mode: 'miao', image: '' } }));
  assert.deepEqual(patchSaved.home, { mode: 'text', text: '', image: '' }, 'empty miao block must still use the existing mode fallback');
  await assertPersistedPatch(patchSaved);
  patchSaved = plain(await patchDiy.savePayload({ categories: { ai: { mode: 'invalid-mode' } } }));
  assert.deepEqual(patchSaved.categories.ai, { mode: 'text', text: '', image: categoryBefore.image }, 'invalid mode must normalize while omitted image survives');
  await assertPersistedPatch(patchSaved);
  patchSaved = plain(await patchDiy.savePayload({ home: { mode: 'image', text: 'Retained text', image: bodyUrl } }));
  patchSaved = plain(await patchDiy.savePayload({ home: { image: '' } }));
  assert.deepEqual(patchSaved.home, { mode: 'image', text: 'Retained text', image: '' }, 'image-only patch must retain omitted mode and text');
  await assertPersistedPatch(patchSaved);
  patchSaved = plain(await patchDiy.savePayload({ home: '' }));
  assert.deepEqual(patchSaved.home, { mode: 'text', text: '', image: '' }, 'empty legacy string block must clear instead of restoring old text');
  await assertPersistedPatch(patchSaved);
  results.push('explicit empty text, nested partial block preservation, legal mode fallback, and save/export/history parity');

  // Hold the first write before persistence so an unqueued second save would merge stale config.
  let releaseFirstWrite;
  const firstWriteGate = new Promise(resolve => { releaseFirstWrite = resolve; });
  let signalFirstWrite;
  const firstWriteStarted = new Promise(resolve => { signalFirstWrite = resolve; });
  const concurrentWrites = [];
  patchWriteHook = async value => {
    concurrentWrites.push(plain(value));
    if (concurrentWrites.length === 1) {
      signalFirstWrite();
      await firstWriteGate;
    }
  };
  const concurrentA = patchDiy.savePayload({ home: { text: 'Concurrent home text' }, historyNote: 'first concurrent patch' });
  const concurrentB = patchDiy.savePayload({ categories: { ai: { text: 'Concurrent AI text' } }, miaoStyle: { colCount: 4 }, historyNote: 'second concurrent patch' });
  await firstWriteStarted;
  await new Promise(resolve => setImmediate(resolve));
  const writesWhileBlocked = concurrentWrites.length;
  releaseFirstWrite();
  const [savedA, savedB] = await Promise.all([concurrentA, concurrentB]);
  assert.equal(writesWhileBlocked, 1, 'second save must wait before reading or writing current config');
  assert.equal(savedB.home.text, 'Concurrent home text', 'second partial save must preserve the first committed patch');
  assert.equal(savedB.categories.ai.text, 'Concurrent AI text');
  assert.equal(savedB.miaoStyle.colCount, 4);
  assert.deepEqual(plain(concurrentWrites[0]), plain(savedA));
  assert.deepEqual(plain(concurrentWrites[1]), plain(savedB));
  await assertPersistedPatch(savedB);
  const concurrentHistory = plain(patchDiy.buildHistoryPayload());
  assert.deepEqual(concurrentHistory.slice(0, 2).map(item => item.payload), [plain(savedB), plain(savedA)]);
  assert.deepEqual(concurrentHistory.slice(0, 2).map(item => item.note), ['second concurrent patch', 'first concurrent patch']);
  const historyCountBeforeFailure = concurrentHistory.length;
  let failNextWrite = true;
  patchWriteHook = async () => {
    if (failNextWrite) { failNextWrite = false; throw new Error('isolated-write-failure'); }
  };
  const failedSave = patchDiy.savePayload({ home: { text: 'Must not commit' } });
  const recoveredSave = patchDiy.savePayload({ categories: { fun: { text: 'Queue recovered' } } });
  await assert.rejects(failedSave, /isolated-write-failure/);
  const recovered = plain(await recoveredSave);
  assert.equal(recovered.home.text, 'Concurrent home text');
  assert.equal(recovered.categories.fun.text, 'Queue recovered');
  assert.equal(patchDiy.buildHistoryPayload().length, historyCountBeforeFailure + 1, 'failed saves must not add DIY history');
  await assertPersistedPatch(recovered);
  results.push('serialized concurrent partial saves, committed history ordering, final export parity, and recovery after rejected write');

  await diy.previewMiaoImage('home', text, { colCount: 99, fontScale: 9, themeImage: themeUrl });
  assert.match(captures.at(-1).html, /width:1355px/);
  assert.match(captures.at(-1).html, /font-size:36px/);
  assert.ok(captures.at(-1).html.includes(`data:image/png;base64,${png.toString('base64')}`));
  await diy.generateMiaoImage('home', text, { colCount: '4', fontScale: '0.85', bodyImage: bodyUrl });
  assert.match(captures.at(-1).html, /width:1090px/);
  assert.match(captures.at(-1).html, /font-size:30\.6px/);
  await diy.previewMiaoImage('home', text);
  assert.match(captures.at(-1).html, /font-size:46\.8px/);
  results.push('preview/generate normalize supplied styles and use stored fallback');

  const configFiles = new Map();
  let cached;
  const botFs = Object.create(fs);
  botFs.existsSync = filename => configFiles.has(filename) || fs.existsSync(filename);
  botFs.readFileSync = (filename, ...args) => configFiles.has(filename) ? JSON.stringify(configFiles.get(filename)) : fs.readFileSync(filename, ...args);
  const botModule = await loadModule('apps/help.js', {
    '../lib/config/configControl.js': { default: { get: key => key === 'help-diy' ? cached : key === 'config' ? {} : { config: { help: true } } } },
    '../lib/help/miaoHelpRenderer.js': { renderMiaoHelpCard: renderer.renderMiaoHelpCard, normalizeMiaoStyle: renderer.normalizeMiaoStyle, resolveHelpDiyImageSource: renderer.resolveHelpDiyImageSource },
    fs: { default: botFs }, path: { default: path },
    '../constants/path.js': { default: { config: path.join(scratch, 'config-fixture'), lib: path.join(scratch, 'lib') } },
  }, { plugin: class {}, segment: { image: filename => ({ image: filename }) }, logger: { warn() {} } });
  const bot = new botModule.default();
  const currentConfigPath = path.join(scratch, 'config-fixture', 'help-diy.json');
  const legacyConfigPath = path.join(scratch, 'data', 'crystelf', 'help-diy.json');
  for (const source of ['cached', 'current', 'legacy']) {
    cached = undefined;
    configFiles.clear();
    if (source === 'cached') cached = saved;
    else configFiles.set(source === 'current' ? currentConfigPath : legacyConfigPath, saved);
    await bot.showHelp({ msg: '#灵晶帮助', reply: async () => true });
    assert.match(captures.at(-1).html, /font-size:46\.8px/);
    assert.match(captures.at(-1).html, /width:800px/);
    assert.ok(captures.at(-1).html.includes(`data:image/png;base64,${png.toString('base64')}`));
  }
  results.push('bot carries cached/current/legacy style and resolves uploaded backgrounds');

  const uploadedTheme = diy.saveImage(`data:image/png;base64,${png.toString('base64')}`, 'miao-theme');
  const uploadedBody = diy.saveImage(`data:image/png;base64,${png.toString('base64')}`, 'miao-body');
  const uploadedStyle = { themeImage: uploadedTheme, bodyImage: uploadedBody, colCount: 3, fontScale: 1.15, titleColor: '#123456' };
  await diy.savePayload({ miaoStyle: uploadedStyle });
  const exported = JSON.parse(JSON.stringify(await diy.buildPayload()));
  assert.equal(exported.miaoStyle.themeImage, uploadedTheme);
  assert.equal(exported.miaoStyle.bodyImage, uploadedBody);
  await diy.savePayload({ miaoStyle: defaults });
  const uploadImport = plain(await diy.buildImportPreviewPayload({ miaoStyle: exported.miaoStyle }));
  assert.equal(uploadImport.changedCount, 1);
  await diy.savePayload({ miaoStyle: exported.miaoStyle });
  assert.equal(diy.buildHistoryPayload()[0].payload.miaoStyle.themeImage, uploadedTheme);
  assert.ok(renderer.resolveHelpDiyImageSource(uploadedTheme, uploadDir));
  assert.ok(renderer.resolveHelpDiyImageSource(uploadedBody, uploadDir));
  results.push('console saveImage upload URLs survive style save, JSON export/import, and history');

  if (process.argv.includes('--render')) {
    realRenderer = await import('../lib/system/puppeteerRenderer.js');
    const observations = [];
    renderCallback = options => realRenderer.renderHtmlToImage({
      ...options,
      afterContent: async page => {
        observations.push(await page.evaluate(async () => {
          const selectors = ['.head-box .title', '.head-box .label', '.help-group', '.help-title', '.help-desc', '.help-footer'];
          const background = selector => getComputedStyle(document.querySelector(selector)).backgroundImage.slice(5, -2);
          const imageLoads = await Promise.all(['body', '.container'].map(selector => new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve(image.naturalWidth > 0);
            image.onerror = () => resolve(false);
            image.src = background(selector);
          })));
          return {
            columns: document.querySelector('.tr').children.length,
            rows: document.querySelectorAll('.tr').length,
            items: Array.from(document.querySelectorAll('.help-title'), title => ({ title: title.textContent, desc: title.nextElementSibling.textContent })),
            width: document.querySelector('.container').getBoundingClientRect().width,
            fonts: selectors.map(selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)),
            lines: selectors.map(selector => parseFloat(getComputedStyle(document.querySelector(selector)).lineHeight)),
            footer: document.querySelector('.help-footer').textContent,
            titleColor: getComputedStyle(document.querySelector('.head-box .title')).color,
            backgrounds: ['body', '.container'].map(background),
            imageLoads,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          };
        }));
      },
    });
    for (const [colCount, fontScale] of [[2, 1.3], [5, 0.85]]) {
      const outputPath = path.join(scratch, `real-${colCount}.png`);
      await renderer.renderMiaoHelpCard(text, { outputPath, uploadDir, style: { colCount, fontScale, themeImage: themeUrl, bodyImage: bodyUrl } });
      const observation = observations.at(-1);
      assert.equal(observation.columns, colCount);
      assert.equal(observation.rows, Math.ceil(6 / colCount));
      assert.equal(observation.width, Math.max(800, colCount * 265 + 30));
      observation.fonts.forEach((size, index) => assert.ok(Math.abs(size - [36, 18, 18, 16, 13, 16][index] * fontScale) < 0.02));
      observation.lines.forEach((size, index) => assert.ok(Math.abs(size - [50, 24, 24, 24, 18, 24][index] * fontScale) < 0.02));
      assert.equal(observation.footer, '魔丸 vtest-version');
      assert.deepEqual(observation.imageLoads, [true, true]);
      assert.equal(observation.overflow, false);
      const output = fs.readFileSync(outputPath);
      assert.equal(output.subarray(1, 4).toString(), 'PNG');
      assert.ok(output.length > 1024);
    }
    await renderer.renderMiaoHelpCard(text, { outputPath: path.join(scratch, 'precedence.png'), uploadDir, colCount: 4, style: { colCount: 2 } });
    assert.equal(observations.at(-1).columns, 4);
    results.push('real Chromium: columns, row padding, all scaled fonts/line heights, backgrounds, footer, PNG output, explicit option precedence');
    const actualPreview = await diy.previewMiaoImage('home', text);
    const uploadedObservation = observations.at(-1);
    assert.equal(uploadedObservation.columns, 3);
    assert.ok(Math.abs(uploadedObservation.fonts[0] - 41.4) < 0.02);
    assert.equal(uploadedObservation.titleColor, 'rgb(18, 52, 86)');
    assert.deepEqual(uploadedObservation.backgrounds, Array(2).fill(`data:image/png;base64,${png.toString('base64')}`));
    assert.deepEqual(uploadedObservation.imageLoads, [true, true]);
    assert.ok(Buffer.from(actualPreview.dataUrl.split(',')[1], 'base64').length > 1024);
    results.push('real console preview uses uploaded/saved/exported/imported images, three columns, 1.15 font scale, and resolved preset color');
    await renderer.renderMiaoHelpCard(roundtripText, { outputPath: path.join(scratch, 'roundtrip.png'), uploadDir });
    assert.deepEqual(observations.at(-1).items, roundtripItems);
    results.push('real renderer preserves multiword command titles and empty descriptions after roundtrip serialization');
  } else {
    await renderer.renderMiaoHelpCard(text, { outputPath: path.join(scratch, 'precedence.png'), uploadDir, colCount: 4, style: { colCount: 2 } });
    assert.match(captures.at(-1).html, /width:1090px/);
    results.push('explicit colCount option overrides style');
  }
  console.log(JSON.stringify({ ok: true, realRender: Boolean(realRenderer), results, scratch }, null, 2));
} finally {
  await realRenderer?.closeSharedPuppeteerBrowser();
  process.chdir(originalCwd);
  // Keep scratch fixtures/results; never clean user assets or runtime files.
}
