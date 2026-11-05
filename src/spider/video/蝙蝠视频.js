// 蝙蝠视频 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 upload-6.py（tvbox python 源，https://257915.xyz/）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
// 註：站點全站雙層混淆（外層整頁 base64 反轉、內層 document.write(d('base64')) 分片、
// 標題中摻 display:none 干擾字符），_page() 負責還原。
// 註：原 localProxy 為通用抓取代理，模板六接口無對應項，未移植。
import req from '../../util/req.js';

let SITE = 'https://257915.xyz';
const HEADERS = {
'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S9080) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
Referer: 'https://257915.xyz/',
'Accept-Language': 'zh-CN,zh;q=0.9',
Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const toStr = (v) => (v == null? '': String(v));

function htmlUnescape(s) {
const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
return toStr(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, ent) => {
if (ent[0] === '#') {
const code = ent[1] === 'x' || ent[1] === 'X'? parseInt(ent.slice(2), 16): parseInt(ent.slice(1), 10);
if (!Number.isNaN(code)) {
try {
return String.fromCodePoint(code);
} catch {
return m;
}
}
return m;
}
return Object.prototype.hasOwnProperty.call(named, ent)? named[ent]: m;
});
}

function cleanText(s) {
return htmlUnescape(toStr(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function absUrl(u) {
if (!u) return u;
u = u.trim();
if (u.startsWith('//')) return 'https:' + u;
if (/^https?:\/\//i.test(u)) return u;
if (u.startsWith('/')) {
const m = /^(https?:\/\/[^/]+)/.exec(SITE);
return (m? m[1]: SITE) + u;
}
return SITE.replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
}

async function fetchText(url, referer) {
const headers = {...HEADERS, Referer: referer || SITE + '/'};
try {
const resp = await req.get(url, { headers, timeout: 12000, validateStatus: () => true});
if ((resp.status?? 0) >= 400) return '';
const data = resp.data;
return typeof data === 'string'? data: toStr(data);
} catch {
return '';
}
}

// ===================== 頁面還原（對應 Python _page） =====================
// 外層整頁 base64 反轉 → 內層 document.write(d('base64')) 分片 → 去 display:none 干擾 span
function restorePage(html) {
if (!html) return '';
let page = html;
const m = /\w+\('([A-Za-z0-9+/=]{1000,})/.exec(html);
if (m) {
try {
const raw = Buffer.from(m[1].split('').reverse().join(''), 'base64').toString('utf8');
const i = raw.indexOf('<!DOCTYPE');
page = i >= 0? raw.slice(i): raw;
} catch {
page = html;
}
}
page = page.replace(/document\.write\(d\('([^']+)'\)\);/g, (mm, b64) => {
try {
return Buffer.from(b64, 'base64').toString('utf8');
} catch {
return '';
}
});
page = page.replace(/<span[^>]*?display\s*:\s*none[^>]*?>[\s\S]*?<\/span>/g, '');
return page;
}

// ===================== 分類（對應 Python _cats） =====================
function buildCats() {
const groups = [
['线路1', [['64360061', '中文字幕'], ['64370061', '网红主播'], ['64380061', '成人动漫'], ['64390061', '欧美情色'], ['64400061', '国模私拍'], ['64430061', '韩国伦理'], ['64170061', '国产情色'], ['64180061', '日本无码']]],
['线路2', [['64170041', '日韩无码'], ['64190041', '欧美精品'], ['64200041', '国产精品'], ['64340041', '中文字幕'], ['64360041', '动漫精品'], ['64390041', '日韩精品'], ['64430041', '自拍偷拍'], ['64580041', '大秀视频']]],
['线路3', [['64360111', '精品推荐'], ['64380111', '国产色情'], ['64390111', '主播直播'], ['64630111', '91探花'], ['64750111', '传媒出品'], ['64500111', '自拍偷拍'], ['64530111', '日本精品'], ['64460111', '欧美精品']]],
['线路4', [['64170031', '国产自拍'], ['64180031', '欧美极品'], ['64190031', '日韩无码'], ['64360031', '中文字幕'], ['64370031', '动漫精品'], ['64380031', '极骚萝莉'], ['64410031', '三级自慰'], ['64420031', '强奸乱伦']]],
['磁力1', [['64169922', '国产专区'], ['64179922', '日本有码'], ['64189922', '日本无码'], ['64199922', '欧美色情'], ['64209922', '传媒作品'], ['64219922', '探花直播'], ['64229922', '网黄女神'], ['64239922', '绿帽淫妻']]],
];
const cats = [];
for (const [gname, items] of groups) {
for (const [tid, name] of items) cats.push({ type_id: tid, type_name: `${gname}·${name}`});
}
return cats;
}

// ===================== 列表解析（對應 Python _items） =====================
function parseItems(html) {
const vods = [];
if (!html) return vods;
for (const m of html.matchAll(/<dl>([\s\S]*?)<\/dl>/g)) {
const dl = m[1];
const a = /<a[^>]+href="((?:\/video\.php|\/torrent\.php)\?id=\d+)"/.exec(dl);
if (!a) continue;
const path = a[1];
const im = /<img[^>]+src="([^"]+)"/.exec(dl);
const pic = im? absUrl(im[1]): '';
const t = /<h3>([\s\S]*?)<\/h3>/.exec(dl);
const name = t? cleanText(t[1]): '';
if (!name) continue;
vods.push({ vod_id: path + '|' + pic, vod_name: name, vod_pic: pic, vod_remarks: ''});
}
return vods;
}

// ===================== 六大介面 =====================

// /init：支持 extend.host 覆寫站點
async function init(inReq) {
try {
const ext = inReq?.body;
let cfg = {};
if (ext && typeof ext === 'object') cfg = ext;
else if (typeof ext === 'string' && ext.trim()) cfg = JSON.parse(ext);
if (cfg && typeof cfg === 'object' && cfg.host) {
SITE = String(cfg.host).trim().replace(/\/+$/, '');
HEADERS.Referer = SITE + '/';
}
} catch {
// 忽略，保留默認站點
}
return {};
}

// /home：分類 + 首頁推薦前 18
async function home() {
let recs = [];
try {
const html = restorePage(await fetchText(SITE + '/'));
recs = parseItems(html).slice(0, 18);
} catch (e) {
console.error('[bianfu] home recs error:', e.message);
}
return { class: buildCats(), list: recs, filters: {}};
}

// /category：/list.php?id={tid}&page={pg}
async function category(inReq) {
const tid = toStr(inReq.body?.id).trim();
let pg = inReq.body?.page || 1;
if (pg == 0) pg = 1;
pg = parseInt(pg, 10) || 1;
try {
const html = restorePage(await fetchText(`${SITE}/list.php?id=${tid}&page=${pg}`));
if (!html) return { list: [], page: pg, pagecount: 9999, limit: 20, total: 999999};
return { list: parseItems(html), page: pg, pagecount: 9999, limit: 20, total: 999999};
} catch (e) {
console.error('[bianfu] category error:', e.message);
return { list: [], page: pg, pagecount: pg, limit: 20, total: 0};
}
}

// /detail：video.php 取 playFilteredHLS 直鏈；torrent.php 取磁力鏈
async function detail(inReq) {
const rawId = inReq.body?.id;
const raw = Array.isArray(rawId)? String(rawId[0] || ''): toStr(rawId);
const sepIdx = raw.indexOf('|');
const path = sepIdx >= 0? raw.slice(0, sepIdx): raw;
const pic = sepIdx >= 0? raw.slice(sepIdx + 1): '';
const vod = { vod_id: path, vod_name: '', vod_pic: pic, vod_content: '', vod_play_from: '', vod_play_url: ''};
try {
const html = restorePage(await fetchText(absUrl(path)));
if (!html) return { list: [vod]};

const hm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
if (hm) vod.vod_name = cleanText(hm[1]);

if (path.includes('/torrent.php')) {
const mm = /magnet:\?[^\s"'<>]+/.exec(html);
const info = [];
for (const im of html.matchAll(/：<\/script>([^<]*)/g)) {
const v = im[2].replace(/\\n/g, '').trim();
if (v) info.push(`${im[1]}:${v}`);
}
if (info.length) vod.vod_content = info.join(' ');
if (mm) {
vod.vod_play_from = '磁力链接';
vod.vod_play_url = '磁力$' + mm[0];
}
} else {
const m2 = /playFilteredHLS\('video',\s*'([^']+)'/.exec(html);
if (m2) {
vod.vod_play_from = '在线播放';
vod.vod_play_url = '正片$' + m2[1].trim();
}
}
return { list: [vod]};
} catch (e) {
console.error('[bianfu] detail error:', e.message);
return { list: [vod]};
}
}

// /search：type=1/2 兩輪，去重
async function search(inReq) {
const key = toStr(inReq.body?.wd?? inReq.body?.key);
const vods = [];
const seen = new Set();
try {
for (const stype of ['1', '2']) {
const url = `${SITE}/search.php?content=${encodeURIComponent(key)}&type=${stype}`;
const html = restorePage(await fetchText(url));
if (!html) continue;
for (const v of parseItems(html)) {
if (!seen.has(v.vod_id)) {
seen.add(v.vod_id);
vods.push(v);
}
}
}
} catch (e) {
console.error('[bianfu] search error:', e.message);
}
return { list: vods};
}

// /play：去 $ 前綴後直接播（詳情已給出直鏈/magnet）
async function play(inReq) {
let url = toStr(inReq.body?.id).trim();
if (url.includes('$')) url = url.split('$').slice(-1)[0].trim();
if (!url) return { parse: 0, url: '', header: {...HEADERS}};
return { parse: 0, url, header: {...HEADERS}};
}

export default {
meta: { key: 'bianfu', name: '蝙蝠视频', type: 3},
api: async (fastify) => {
fastify.post('/init', init);
fastify.post('/home', home);
fastify.post('/category', category);
fastify.post('/detail', detail);
fastify.post('/play', play);
fastify.post('/search', search);
},
};
