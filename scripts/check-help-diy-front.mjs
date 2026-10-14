import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const requests = [];
const timers = [];
const document = { addEventListener() {}, getElementById() { return { textContent: '' }; } };
const context = vm.createContext({
  window: { CrystelfRequest: { fetchJson() {}, postJson(url, payload) {
    return new Promise((resolve, reject) => requests.push({ url, payload, resolve, reject }));
  } } },
  document,
  console,
  setTimeout(fn) { timers.push(fn); return timers.length; },
  clearTimeout() {},
});
vm.runInContext(fs.readFileSync(new URL('../lib/webConsole/public/help-diy.js', import.meta.url), 'utf8'), context);
const run = source => vm.runInContext(source, context);
run('const actualRender = render; const actualGetDraft = getDraft;');
const value = source => JSON.parse(JSON.stringify(run(source)));
const oldPayload = { enabled: true, home: {mode:'miao',text:'帮助\n分组\n- #测试',image:''}, categories:{} };
context.fixture = oldPayload;

const style = value('normalizeMiaoStyleFront({themeImage:"/uploads/help-diy/theme.png",bodyImage:"/uploads/help-diy/body.png",colCount:3,fontScale:1.15})');
assert.equal(style.themeImage, '/uploads/help-diy/theme.png');
assert.equal(style.bodyImage, '/uploads/help-diy/body.png');
assert.equal(style.colCount, 3);
assert.equal(style.fontScale, 1.15);
assert.equal(value('normalizeMiaoStyleFront({colCount:999,fontScale:Infinity,bodyImage:"/uploads/help-diy/../private.png"})').bodyImage, '');
const original = value('sanitizeComparablePayload(fixture)');
const changed = value('sanitizeComparablePayload({...fixture,miaoStyle:{titleColor:"#abcdef"}})');
assert.notDeepEqual(original, changed, 'style-only edits must be dirty');
const roundtrip = { title: '帮助', groups: [{ group: '分组', items: [{icon:null,title:'#点歌 歌名',desc:''}] }] };
context.roundtrip = roundtrip;
assert.deepEqual(value('parseMiaoTextToStruct(serializeMiaoText(roundtrip).trim())'), roundtrip, 'command arguments with empty descriptions must survive serialization');
const parsed = value('parseMiaoTextToStruct("帮助\\n分组\\n- [artd:nav-系统设置] #设置  配置\\n- [icon:2] #播放  音乐")');
context.parsed = parsed;
assert.equal(value('parseMiaoTextToStruct(serializeMiaoText(parsed))').groups[0].items[0].icon, 'artd:nav-系统设置');

run('renderPreview = () => {}; previewBlock = () => ({mode:"miao"});');
run('helpDiyState.miaoStyle = normalizeMiaoStyleFront({}); scheduleMiaoLivePreview("home","first")');
await timers.shift()();
assert.equal(requests.length, 1);
run('scheduleMiaoLivePreview("ai","second")');
await timers.shift()();
assert.equal(requests.length, 1, 'preview requests must serialize while rendering');
requests[0].resolve({dataUrl:'data:image/png;base64,OLD'});
await new Promise(resolve => setImmediate(resolve));
assert.equal(run('helpDiyState.miaoLive.dataUrl'), '', 'superseded render must not show stale image');
assert.equal(requests.length, 2);
requests[1].resolve({dataUrl:'data:image/png;base64,NEW'});
await new Promise(resolve => setImmediate(resolve));
assert.equal(run('helpDiyState.miaoLive.dataUrl'), 'data:image/png;base64,NEW');
run('scheduleMiaoLivePreview("ai", "failure")');
await timers.shift()();
requests[2].reject(new Error('test-render-failure'));
await new Promise(resolve => setImmediate(resolve));
run('scheduleMiaoLivePreview("ai", "failure")');
assert.equal(timers.length, 0, 'failed unchanged preview must not retry infinitely');
run('scheduleMiaoLivePreview("ai", "failure", true)');
await timers.shift()();
assert.equal(requests.length, 4, 'explicit retry must work');
requests[3].resolve({dataUrl:'data:image/png;base64,RETRY'});
await new Promise(resolve => setImmediate(resolve));

run('syncUndoButtons = () => {}; helpDiyState.lastSavedPayload = fixture; getDraft = () => fixture; render = payload => { fixture = payload; };');
run('recordDraft(); fixture = {...fixture, miaoStyle:{colCount:3}}; recordDraft(); restoreDraftHistory(-1)');
assert.equal(run('fixture.miaoStyle'), undefined, 'undo restores complete draft');
run('restoreDraftHistory(1)');
assert.equal(run('fixture.miaoStyle.colCount'), 3, 'redo restores style change');
run('restoreDraftHistory(-1); fixture = {...fixture, miaoStyle:{colCount:2}}; recordDraft()');
assert.equal(run('helpDiyState.undo.index'), run('helpDiyState.undo.entries.length - 1'), 'new edit discards redo branch');

run('helpDiyState.miaoEditors = {home:{sourceText:fixture.home.text,struct:{title:"",groups:[{group:"",items:[{title:"",desc:"unfinished",icon:null}]}]}}}; recordDraft()');
assert.equal(value('helpDiyState.undo.entries[helpDiyState.undo.index].__editorDrafts.home').groups[0].items[0].desc, 'unfinished', 'history retains incomplete structured fields');
run('helpDiyState.miaoEditors.home.struct.groups[0].items[0].title = "filled"; recordDraft(); render = (payload, options) => { fixture = payload; restoredOptions = options; }; restoreDraftHistory(-1)');
assert.equal(run('restoredOptions.editorDrafts.home.groups[0].items[0].title'), '', 'undo restores empty command fields');
assert.equal(run('restoredOptions.editorDrafts.home.groups[0].items[0].desc'), 'unfinished');
run('const acceptA = beginHelpImageUpdate("home"); const acceptB = beginHelpImageUpdate("home");');
assert.equal(run('acceptA()'), false, 'newer image work supersedes older requests');
assert.equal(run('acceptB()'), true);
run('fixture = {...fixture,miaoStyle:{colCount:4}}');
assert.equal(run('acceptB()'), false, 'image results must not override newer drafts');
run('renderDirtyStatus = () => {}; render = () => { throw new Error("no-change import must not replace draft"); }');
const importing = run('importTemplate({text:async()=>"{}"})');
await new Promise(resolve => setImmediate(resolve));
requests.at(-1).resolve({changedCount:0});
await importing;
assert.equal(run('fixture.miaoStyle.colCount'), 4, 'no-change import retains draft');

run('refreshHistory = async () => {}; renderDirtyStatus = () => {}; helpDiyState.lastSavedPayload = fixture;');
assert.equal(run('hasUnsavedChanges()'), true, 'incomplete editor rows remain dirty even when the text payload is unchanged');
const incompleteRequestCount = requests.length;
await run('save()');
await run('exportTemplate()');
assert.equal(requests.length, incompleteRequestCount, 'save and export refuse incomplete help cards');
run('fixture = {...fixture,home:{...fixture.home,mode:"text"},categories:normalizeHelpDiyPayload(fixture).categories};');
const submittedPayload = value('getDraft()');
const saving = run('save()');
assert.equal(requests.at(-1).url, '/api/help-diy/save');
run('fixture = {...fixture,miaoStyle:{colCount:5}}');
requests.at(-1).resolve({data:submittedPayload});
await saving;
assert.equal(run('fixture.miaoStyle.colCount'), 5, 'save response retains edits made while waiting');
assert.equal(run('helpDiyState.lastSavedPayload.miaoStyle.colCount'), 4, 'save baseline reflects submitted content');
assert.equal(run('helpDiyState.saving'), false);

run('render = (payload, options) => { fixture = payload; restoredOptions = options; }; helpDiyState.miaoEditors = {home:{sourceText:fixture.home.text,struct:{title:"",groups:[{group:"",items:[{title:"",desc:"unfinished",icon:null}]}]}}};');
const unchangedSave = run('save()');
requests.at(-1).resolve({data:value('getDraft()')});
await unchangedSave;
assert.equal(run('restoredOptions.editorDrafts.home.groups[0].items[0].desc'), 'unfinished', 'saving completed commands keeps unfinished editor rows');

run('webConsoleConfirm = async () => true;');
const importCount = requests.length;
const busyImport = run('importTemplate({text:async()=>JSON.stringify({miaoStyle:{colCount:2}})})');
await new Promise(resolve => setImmediate(resolve));
assert.equal(run('helpDiyState.saving'), true);
await run('save()');
await run('importTemplate({text:async()=>"{}"})');
assert.equal(requests.length, importCount + 1, 'save and a second import cannot overlap an import');
requests.at(-1).resolve({changedCount:1,changes:['style']});
await new Promise(resolve => setImmediate(resolve));
assert.equal(requests.at(-1).url, '/api/help-diy/save');
run('fixture = {...fixture,miaoStyle:{colCount:5}}; render = () => { throw new Error("import response must preserve newer edits"); };');
requests.at(-1).resolve({data:{...oldPayload,miaoStyle:{colCount:2}}});
await busyImport;
assert.equal(run('fixture.miaoStyle.colCount'), 5);
assert.equal(run('helpDiyState.saving'), false);

run('webConsoleConfirm = async () => { fixture = {...fixture,miaoStyle:{colCount:3}}; return true; };');
const confirmingImport = run('importTemplate({text:async()=>"{}"})');
await new Promise(resolve => setImmediate(resolve));
const confirmCount = requests.length;
requests.at(-1).resolve({changedCount:1,changes:['style']});
await confirmingImport;
assert.equal(requests.length, confirmCount, 'editing during confirmation cancels the import before writing');
assert.equal(run('helpDiyState.saving'), false);
const badImport = run('importTemplate({text:async()=>"not-json"})');
await assert.rejects(badImport, /不是有效/);
assert.equal(run('helpDiyState.saving'), false, 'failed import releases the write lock');

const draftNodes = new Map();
document.getElementById = id => {
  if (!draftNodes.has(id)) draftNodes.set(id, {value:'',checked:false,dataset:{},textContent:''});
  return draftNodes.get(id);
};
document.querySelectorAll = () => [];
run('renderPreview = () => {}; renderGlobalStyle = () => {}; ensureArtdIcons = async () => []; render = actualRender; getDraft = actualGetDraft; helpDiyState.undo = {entries:[],index:-1,timer:null,restoring:false};');
context.rawDraft = {enabled:false,home:{mode:'text',text:'帮助\n',image:''},categories:Object.fromEntries(['ai','manage','fun','debug'].map(slot=>[slot,{mode:'text',text:'',image:''}]))};
run('render(rawDraft, {preserveDraft:true});');
assert.equal(run('getDraft().home.text'), '帮助\n');
run('document.getElementById("help-diy-home").value = "帮助\\n新内容"; recordDraft(); restoreDraftHistory(-1);');
assert.equal(run('getDraft().home.text'), '帮助\n', 'undo keeps original whitespace');
run('restoreDraftHistory(1)');
assert.equal(run('getDraft().home.text'), '帮助\n新内容', 'redo survives whitespace-preserving restoration');

context.Image = class {
  set src(value) {
    this.naturalWidth = 4000;
    this.naturalHeight = 3000;
    setImmediate(() => this.onload());
  }
};
document.createElement = tag => {
  assert.equal(tag, 'canvas');
  return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: (type, quality) => { context.__canvasArgs = [type, quality]; return 'data:image/jpeg;base64,' + 'A'.repeat(400); } };
};
run('readFileAsDataUrl = async file => `data:image/png;base64,RAW-${file.name}`');
const smallPrepared = await run('compressHelpImageFile({size: 1000, type: "image/png", name: "small.png"})');
assert.equal(smallPrepared.dataUrl, 'data:image/png;base64,RAW-small.png', 'small images upload unchanged');
assert.equal(smallPrepared.note, '');
const bigPrepared = await run('compressHelpImageFile({size: 6 * 1024 * 1024, type: "image/png", name: "big.png"})');
assert.equal(bigPrepared.dataUrl.startsWith('data:image/jpeg;base64,'), true, 'oversized images must be recompressed');
assert.deepEqual(context.__canvasArgs, ['image/jpeg', 0.85]);
assert.match(bigPrepared.note, /2400×1800/);
const gifPrepared = await run('compressHelpImageFile({size: 6 * 1024 * 1024, type: "image/gif", name: "anim.gif"})');
assert.equal(gifPrepared.dataUrl, 'data:image/png;base64,RAW-anim.gif', 'animated gif must skip recompression');
document.createElement = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,' + 'A'.repeat(8 * 1024 * 1024) });
await assert.rejects(run('compressHelpImageFile({size: 6 * 1024 * 1024, type: "image/png", name: "huge.png"})'), /仍超过 5MB/, 'uncompressible images keep the size guard');

const viewButtons = ['edit', 'preview'].map(helpView => ({
  dataset: { helpView },
  classList: { toggle(name, state) { this[name] = state; } },
  setAttribute(name, state) { this[name] = state; },
  addEventListener(name, handler) { this[name] = handler; },
}));
document.body = { dataset: { helpView: 'edit' } };
let scrolledPanel = '';
const panels = new Map(['help-diy-home-panel', 'help-diy-preview-pane'].map(id => [id, {
  style: {}, scrollIntoView() { scrolledPanel = id; },
}]));
document.getElementById = id => panels.get(id);
document.querySelector = selector => {
  assert.equal(selector, '.help-workbench-bar');
  return { offsetHeight: 220 };
};
context.window.matchMedia = () => ({ matches: true });
context.window.getComputedStyle = () => ({ top: '104px' });
run('helpDiyState.activePreview = "home"');
document.querySelectorAll = selector => {
  if (selector === 'button[data-help-view]') return viewButtons;
  assert.equal(selector, '[data-help-preview]');
  return [];
};
run('bindPreviewTabs()');
assert.equal(viewButtons[0]['aria-pressed'], 'true');
viewButtons[1].click();
assert.equal(document.body.dataset.helpView, 'preview');
assert.equal(viewButtons[1]['aria-pressed'], 'true');
assert.equal(scrolledPanel, 'help-diy-preview-pane', 'mobile view changes reveal the new pane below the sticky toolbar');
assert.equal(panels.get('help-diy-preview-pane').style.scrollMarginTop, '336px');
viewButtons[0].click();
assert.equal(document.body.dataset.helpView, 'edit');
assert.equal(viewButtons[0]['aria-pressed'], 'true');

const html = fs.readFileSync(new URL('../lib/webConsole/public/help-diy.html', import.meta.url), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'workbench IDs must be unique');
for (const id of ['help-diy-global-style','help-diy-undo-btn','help-diy-redo-btn','help-diy-preview-dialog','help-diy-preview-stage']) assert(ids.includes(id), `missing ${id}`);
for (const slot of ['home','ai','manage','fun','debug']) {
  for (const suffix of ['', '-mode', '-image', '-upload', '-miao-editor']) assert(ids.includes(`help-diy-${slot}${suffix}`));
}
console.log('Help DIY frontend checks passed: image/style preservation, Unicode icons, preview races/retry, workbench contracts.');
