// 蝴蝶影视·MissAV —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 MissAV.py（tvbox python 源，missav.ws / 備用 thisav.my）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
// 註：原 _build_opener 的本地代理端口探測（127.0.0.1:7890 等）為 TVBox 環境特有，
// catBridge 下走宿主 HTTP 客戶端直連，未移植。
// 註：原 localProxy 僅返回 [404, "Disabled"]，無實質功能，未移植。
import req from '../../util/req.js';

const PRIMARY_HOST = 'https://missav.ws';
const FALLBACK_HOST = 'https://www.thisav.my';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

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
return htmlUnescape(toStr(s)).replace(/<[^>]+>/g, '').trim();
}

const CATEGORY_ROUTES = {
chinese_subtitle: '/dm278/cn/chinese-subtitle',
new: '/dm539/cn/new',
release: '/dm635/cn/release',
uncensored_leak: '/dm817/cn/uncensored-leak',
today_hot: '/dm301/cn/today-hot',
weekly_hot: '/dm170/cn/weekly-hot',
monthly_hot: '/dm273/cn/monthly-hot',
actresses: '/cn/actresses',
actresses_ranking: '/cn/actresses/ranking',
genres: '/cn/genres',
makers: '/cn/makers',
vr: '/cn/genres/VR',
fc2: '/dm597/cn/fc2',
heyzo: '/dm2208642/cn/heyzo',
tokyohot: '/dm42/cn/tokyohot',
'1pondo': '/dm5199603/cn/1pondo',
caribbeancom: '/dm7704788/cn/caribbeancom',
caribbeancompr: '/dm91887/cn/caribbeancompr',
'10musume': '/dm7208981/cn/10musume',
pacopacomama: '/dm3600557/cn/pacopacomama',
gachinco: '/dm150/cn/gachinco',
siro: '/dm36/cn/siro',
luxu: '/dm34/cn/luxu',
gana: '/dm34/cn/gana',
scute: '/dm38/cn/scute',
maan: '/dm1004/cn/maan',
ara: '/dm34/cn/ara',
naughty4610: '/dm33/cn/naughty4610',
naughty0930: '/dm37/cn/naughty0930',
madou: '/dm63/cn/madou',
twav: '/dm31/cn/twav',
furuke: '/dm15/cn/furuke',
marriedslash: '/dm37/cn/marriedslash',
xxxav: '/dm42/cn/xxxav',
};

const CLASSES = [
['中文字幕', 'chinese_subtitle'], ['最近更新', 'new'], ['新作上市', 'release'],
['无码流出', 'uncensored_leak'], ['女优一览', 'actresses'], ['女优排行', 'actresses_ranking'],
['全部类型', 'genres'], ['全部发行商', 'makers'], ['VR 专区', 'vr'],
['今日热门', 'today_hot'], ['本周热门', 'weekly_hot'], ['本月热门', 'monthly_hot'],
['FC2', 'fc2'], ['HEYZO', 'heyzo'], ['东京热', 'tokyohot'], ['一本道', '1pondo'],
['加勒比', 'caribbeancom'], ['加勒比PR', 'caribbeancompr'], ['天然素人', '10musume'],
['熟女俱乐部', 'pacopacomama'], ['Gachinco', 'gachinco'], ['SIRO', 'siro'],
['LUXU', 'luxu'], ['GANA', 'gana'], ['S-CUTE', 'scute'], ['PRESTIGE', 'maan'],
['ARA', 'ara'], ['顽皮4610', 'naughty4610'], ['顽皮0930', 'naughty0930'],
['麻豆传媒', 'madou'], ['TWAV', 'twav'], ['Furuke', 'furuke'],
['人妻斩', 'marriedslash'], ['XXX-AV', 'xxxav'],
];

const COLOR_PALETTE = [
['1e3a8a', '60a5fa'], ['14532d', '4ade80'], ['701a75', 'f472b6'],
['7c2d12', 'fb923c'], ['1f2937', '38bdf8'], ['312e81', '818cf8'],
['831843', 'fb7185'], ['064e3b', '34d399'], ['3b0764', 'c084fc'],
];

const BANNED_SLUGS = new Set([
'chinese-subtitle', 'new', 'release', 'uncensored-leak', 'today-hot',
'weekly-hot', 'monthly-hot', 'genres', 'actresses', 'makers', 'series', 'tags',
'vip', 'saved', 'playlists', 'history', 'login', 'register', 'siro', 'luxu', 'gana',
]);

// ===================== 請求（含主備站點回退，對應 Python _fetch） =====================
async function rawFetch(targetUrl, hostCtx) {
const curHost = hostCtx || PRIMARY_HOST;
const headers = {
'User-Agent': UA,
Referer: curHost + '/',
Origin: curHost,
Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
'Accept-Encoding': 'gzip, deflate',
Connection: 'keep-alive',
};
try {
const resp = await req.get(targetUrl, { headers, timeout: 8000, validateStatus: () => true});
const data = resp.data;
return { code: resp.status?? -1, text: typeof data === 'string'? data: toStr(data)};
} catch {
return { code: -1, text: ''};
}
}

async function fetchWithFallback(targetUrl) {
let realUrl = targetUrl;
if (realUrl.startsWith('//')) realUrl = 'https:' + realUrl;
else if (realUrl.startsWith('/')) realUrl = PRIMARY_HOST + realUrl;

const res = await rawFetch(realUrl, PRIMARY_HOST);
const bad = [403, 451, 503, -1].includes(res.code)
|| res.text.includes('Just a moment')
|| res.text.length < 2000;
if (bad) {
const altUrl = realUrl.replace(PRIMARY_HOST, FALLBACK_HOST);
const resAlt = await rawFetch(altUrl, FALLBACK_HOST);
if (resAlt.code === 200 && resAlt.text.length > 2000) return resAlt;
}
return res;
}

// ===================== 封面清洗（對應 Python _clean_pic_url） =====================
function cleanPicUrl(rawPic, fallbackId) {
let p = toStr(rawPic).trim();
if (p.startsWith('//')) p = 'https:' + p;
else if (p.startsWith('/')) {
try {
p = new URL(p, PRIMARY_HOST).href;
} catch {
// 保留原值
}
}
if (!p && fallbackId) p = `https://fourhoi.com/${fallbackId}/cover-t.jpg`;
if (!p) return 'https://dummyimage.com/640x360/1e293b/ffffff.png&text=NO_COVER';
// 移除 @Referer= 等 iOS 無法識別的語法糖後綴
if (p.includes('@Referer=')) p = p.split('@Referer=')[0];
return p;
}

// ===================== 卡片解析（對應 Python _parse_cards） =====================
function parseCards(html, mode) {
if (!html) return [];
let body = html;
if (body.includes('</nav>')) body = body.split('</nav>')[1];
else if (body.includes('</header>')) body = body.split('</header>')[1];

const vodList = [];
const seenIds = new Set();

// ---- 女優 / 女優排行 ----
if (mode === 'actress' || mode === 'actress_ranking') {
const isRanking = mode === 'actress_ranking';
let chunks = [...body.matchAll(/(<div[^>]*>\s*<a[^>]+href=["'][^"']*\/actresses\/[^"']+["'][^>]*>[\s\S]*?<\/div>\s*<\/div>)/g)].map((m) => m[1]);
if (!chunks.length) {
chunks = [...body.matchAll(/(<a[^>]+href=["'][^"']*\/actresses\/[^"']+["'][^>]*>[\s\S]*?<\/a>\s*<div[\s\S]*?<\/div>)/g)].map((m) => m[1]);
}
for (const block of chunks) {
const hrefM = /href=["']([^"']*\/actresses\/[^"']+)["']/.exec(block);
if (!hrefM) continue;
const href = hrefM[1].trim();
if (href.includes('actresses/ranking')) continue;
if (seenIds.has(href)) continue;
seenIds.add(href);

const picM = /(?:data-src|data-original|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i.exec(block);
const rawPic = picM? picM[1].trim(): '';
const cleanPic = cleanPicUrl(rawPic);

const altM = /alt=["']([^"']+)["']/.exec(block);
let title = altM? altM[1].trim(): '';
if (!title) {
for (const tc of block.match(/>([^<]+)</g) || []) {
const t = tc.slice(1, -1).trim();
if (t && !['影片', '条', '條', '部', '出道', '年', '第', '名', 'Ranking'].some((k) => t.includes(k))) {
if (t.length >= 2 &&!/^\d+$/.test(t)) {
title = t;
break;
}
}
}
}
if (!title) title = '女优';
title = htmlUnescape(title);

let subDesc = '';
let remarksText;
if (isRanking) {
const rankM = /(第\s*\d+\s*名)/.exec(block);
subDesc = rankM? rankM[1].replace(/ /g, ''): '';
remarksText = subDesc? `蝴蝶影视 · ${subDesc}`: '蝴蝶影视';
} else {
const countM = /(\d+)\s*(?:条影片|條影片|部影片|部)/.exec(block);
const debutM = /(\d{4})\s*(?:出道|年出道)/.exec(block);
const metaArr = [];
if (countM) metaArr.push(`${countM[1]}部`);
if (debutM) metaArr.push(`${debutM[1]}出道`);
subDesc = metaArr.join(' · ');
remarksText = subDesc? `蝴蝶影视 · ${subDesc}`: '蝴蝶影视';
}
const displayName = subDesc? `${title}\n${subDesc}`: title;
vodList.push({
vod_id: 'folder@' + (/^https?:\/\//i.test(href)? href: new URL(href, PRIMARY_HOST).href),
vod_name: displayName,
vod_pic: cleanPic,
vod_remarks: remarksText,
vod_tag: 'folder',
style: { type: 'oval', ratio: 1.0},
});
}
return vodList;
}

// ---- 類型 / 發行商 ----
if (mode === 'genres' || mode === 'makers') {
const targetKey = mode;
const cellRe = new RegExp('(<div>\\s*<a[^>]+href=["\\\'][^"\\\']*/' + targetKey + '/[^"\\\']+["\\\'][^>]*>[\\s\\S]*?</div>)', 'g');
const cells = [...body.matchAll(cellRe)].map((m) => m[1]);
let idx = 0;
for (const cell of cells) {
const hrefRe = new RegExp('href=["\\\']([^"\\\']*/' + targetKey + '/[^"\\\']+)["\\\']');
const hrefM = hrefRe.exec(cell);
if (!hrefM) continue;
const cleanHref = hrefM[1].trim();
if (seenIds.has(cleanHref) || cleanHref.endsWith('/' + targetKey) || cleanHref.endsWith('/' + targetKey + '/')) continue;
seenIds.add(cleanHref);

let titleM = /<a[^>]+class=["'][^"']*text-nord13[^"']*["'][^>]*>([\s\S]*?)<\/a>/.exec(cell);
if (!titleM) {
const linkRe = new RegExp('<a[^>]+href=["\\\'][^"\\\']*/' + targetKey + '/[^"\\\']+["\\\'][^>]*>([\\s\\S]*?)</a>');
titleM = linkRe.exec(cell);
}
const rawTitle = titleM? titleM[1].trim(): '';
const title = cleanText(rawTitle);
if (!title) continue;

const countM = /(\d+)\s*(?:条影片|條影片|部影片|部)/.exec(cell);
const remarks = countM? `蝴蝶影视 · ${countM[1]}部`: '蝴蝶影视';

const firstChar = title[0].trim().toUpperCase();
const [bgColor, fgColor] = COLOR_PALETTE[idx % COLOR_PALETTE.length];
idx++;
const cardPic = `https://dummyimage.com/640x360/${bgColor}/${fgColor}.png&text=${encodeURIComponent(firstChar)}`;

vodList.push({
vod_id: 'folder@' + (/^https?:\/\//i.test(cleanHref)? cleanHref: new URL(cleanHref, PRIMARY_HOST).href),
vod_name: title,
vod_pic: cardPic,
vod_remarks: remarks,
vod_tag: 'folder',
style: { type: 'rect', ratio: 1.78},
});
}
return vodList;
}

// ---- 視頻卡片 ----
let cardChunks = [];
if (body.includes('class="relative group')) cardChunks = body.split('class="relative group').slice(1);
else if (body.includes('class="thumbnail')) cardChunks = body.split('class="thumbnail').slice(1);
else cardChunks = [...body.matchAll(/(<a[^>]+href=["'][^"']*(?:missav\.[^"']+|\/[^"']+)["'][^>]*>[\s\S]*?<\/a>)/g)].map((m) => m[1]);

for (const ch of cardChunks) {
const hrefM = /href=["']([^"']*\/(?:cn|dm\d+\/cn)\/([A-Za-z0-9_-]+))["']/.exec(ch);
if (!hrefM) continue;
const fullHref = hrefM[1];
const dvdId = hrefM[2];
const dvdLow = dvdId.toLowerCase();
if (BANNED_SLUGS.has(dvdLow) || seenIds.has(dvdLow) || dvdId.length < 3) continue;
seenIds.add(dvdLow);

let title = '';
const nameDivM = /<div[^>]*class=["'][^"']*(?:title|my-2|font-semibold)[^"']*["'][^>]*>([\s\S]*?)<\/div>/.exec(ch);
if (nameDivM) {
const candTitle = nameDivM[1].replace(/<[^>]+>/g, '').trim();
if (candTitle && candTitle.toLowerCase()!== dvdLow && candTitle.length >= dvdId.length) title = candTitle;
}
if (!title) {
const altM = /alt=["']([^"']+)["']/.exec(ch);
if (altM) {
const candAlt = altM[1].trim();
if (candAlt && candAlt.toLowerCase()!== dvdLow && candAlt.length >= dvdId.length) title = candAlt;
}
}
if (!title) {
for (const tc of ch.match(/>([^<]{4,120})</g) || []) {
const tStr = tc.slice(1, -1).trim();
if (tStr && tStr.toLowerCase()!== dvdLow && tStr.length > dvdId.length) {
if (!['item.', 'HD', 'FHD', '4K', ':', '条影片'].some((k) => tStr.includes(k))) {
title = tStr;
break;
}
}
}
}
if (!title) title = dvdId.toUpperCase();
title = htmlUnescape(title);

const picM = /(?:data-src|data-original|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i.exec(ch);
let rawPic = '';
if (picM &&!picM[1].includes('item.dvd_id')) rawPic = picM[1].trim();
const cleanPic = cleanPicUrl(rawPic, dvdId);

const durM = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(ch);
const dur = durM? `蝴蝶影视 · ${durM[1]}`: '蝴蝶影视';

vodList.push({
vod_id: `${dvdId}@@${fullHref}`,
vod_name: title,
vod_pic: cleanPic,
vod_remarks: dur,
style: { type: 'rect', ratio: 1.78},
});
}
return vodList;
}

// ===================== surrit UUID 提取（對應 Python _extract_surrit_uuid） =====================
function extractSurritUuid(html) {
if (!html) return '';
let m = /hls\.loadSource\(["']https?:\/\/[^/]+\/([a-f0-9-]{36})\/playlist\.m3u8["']\)/.exec(html);
if (m) return m[1];

const urlsBlock = /urls:\s*\[\s*["']([^"']+)["']/.exec(html);
if (urlsBlock) {
const targetLink = urlsBlock[1];
if (!targetLink.includes('sample') &&!targetLink.includes('preview')) {
const um = /([a-f0-9-]{36})/.exec(targetLink);
if (um) return um[1];
}
}

for (const sc of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
const script = sc[1];
if ((script.includes('surrit.com') || script.includes('sixyik.com')) &&!script.includes('sample')) {
for (const um of script.matchAll(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/g)) {
const u = um[1];
const uPos = script.indexOf(u);
const surround = script.slice(Math.max(0, uPos - 40), Math.min(script.length, uPos + 60));
if (!['user_uuid', 'sample', 'preview', 'thumbnail', 'recombee'].some((bad) => surround.includes(bad))) {
return u;
}
}
}
}

for (const cm of html.matchAll(/https?:\/\/(?:surrit\.com|sixyik\.com)\/([a-f0-9-]{36})\/(?:playlist\.m3u8)?/g)) {
const c = cm[1];
const cPos = html.indexOf(c);
if (!html.slice(Math.max(0, cPos - 30), Math.min(html.length, cPos + 60)).includes('sample')) return c;
}
return '';
}

// ===================== 篩選器 =====================
function buildFilters() {
const filterSort = {
key: 'sort', name: '排序', init: 'default',
value: [
{ n: '默认排序', v: 'default'}, { n: '发行日期', v: 'released_at'},
{ n: '最近更新', v: 'published_at'}, { n: '收藏最多', v: 'saved'},
{ n: '今日浏览', v: 'today_views'}, { n: '本周浏览', v: 'weekly_views'},
{ n: '本月浏览', v: 'monthly_views'}, { n: '总浏览数', v: 'views'},
],
};
const filterType = {
key: 'filters', name: '过滤', init: 'all',
value: [
{ n: '所有', v: 'all'}, { n: '单人作品', v: 'individual'},
{ n: '多人作品', v: 'multiple'}, { n: '中文字幕', v: 'chinese-subtitle'},
],
};
const heightRanges = [
'131-135', '136-140', '141-145', '146-150', '151-155', '156-160',
'161-165', '166-170', '171-175', '176-180', '181-185', '186-190',
];
const filterActressHeight = {
key: 'height', name: '身高', init: 'all',
value: [{ n: '选择身高', v: 'all'},...heightRanges.map((r) => ({ n: `${r}cm`, v: r}))],
};
const cups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'];
const filterActressCup = {
key: 'cup', name: '罩杯', init: 'all',
value: [{ n: '选择罩杯', v: 'all'},...cups.map((c) => ({ n: `${c} 罩杯`, v: c}))],
};
const filterActressAge = {
key: 'age', name: '年龄', init: 'all',
value: [
{ n: '选择年龄', v: 'all'}, { n: '< 20', v: '<20'}, { n: '20 - 30', v: '20-30'},
{ n: '30 - 40', v: '30-40'}, { n: '40 - 50', v: '40-50'},
{ n: '50 - 60', v: '50-60'}, { n: '> 60', v: '>60'},
],
};
const years = [];
for (let y = 2026; y >= 2008; y--) years.push(String(y));
const filterActressDebut = {
key: 'debut', name: '出道年份', init: 'all',
value: [{ n: '选择出道年份', v: 'all'},...years.map((y) => ({ n: `${y} 以前`, v: y}))],
};
const filterActressSort = {
key: 'sort', name: '排序', init: 'default',
value: [{ n: '默认排序', v: 'default'}, { n: '影片最多', v: 'videos'}],
};

const filtersDict = {};
for (const [, cid] of CLASSES) {
if (cid === 'actresses') {
filtersDict[cid] = [filterActressSort, filterActressHeight, filterActressCup, filterActressAge, filterActressDebut];
} else if (!['actresses_ranking', 'genres', 'makers'].includes(cid)) {
filtersDict[cid] = [filterSort, filterType];
}
}
return filtersDict;
}

function firstVal(extend, key) {
const v = extend? extend[key]: undefined;
return Array.isArray(v)? v[0]: v;
}

// ===================== 六大介面 =====================

// /init：解析 extend（dict/JSON 字符串）
async function init(inReq) {
try {
const ext = inReq?.body;
if (ext && typeof ext === 'object') return { options: ext};
if (typeof ext === 'string' && ext.trim()) return { options: JSON.parse(ext)};
} catch {
// 忽略
}
return {};
}

// /home：34 分類 + 篩選器；推薦取 /dm247/cn 前 16
async function home() {
let list = [];
try {
const res = await fetchWithFallback(PRIMARY_HOST + '/dm247/cn');
list = parseCards(res.text, 'video').slice(0, 16);
} catch (e) {
console.error('[missav] home list error:', e.message);
}
return {
class: CLASSES.map(([name, id]) => ({ type_name: name, type_id: id})),
filters: buildFilters(),
list,
};
}

// /category
async function category(inReq) {
const slug = toStr(inReq.body?.id).trim();
let pg = inReq.body?.page || 1;
if (pg == 0) pg = 1;
const page = /^\d+$/.test(String(pg))? parseInt(pg, 10): 1;
const extend = inReq.body?.filters && typeof inReq.body.filters === 'object'? inReq.body.filters: {};

let targetUrl;
let parseMode;
if (slug.startsWith('folder@')) {
targetUrl = slug.replace('folder@', '');
parseMode = 'video';
} else {
const routePath = CATEGORY_ROUTES[slug] || CATEGORY_ROUTES.chinese_subtitle;
targetUrl = PRIMARY_HOST + routePath;
if (slug === 'actresses') parseMode = 'actress';
else if (slug === 'actresses_ranking') parseMode = 'actress_ranking';
else if (slug === 'genres' || slug === 'makers') parseMode = slug;
else parseMode = 'video';
}

const queryParts = [];
if (page > 1) queryParts.push(`page=${page}`);
if (parseMode === 'actress') {
for (const k of ['height', 'cup', 'age', 'debut']) {
const val = firstVal(extend, k);
if (val && val!== 'all') queryParts.push(`${k}=${encodeURIComponent(val)}`);
}
const sortVal = firstVal(extend, 'sort');
if (sortVal && sortVal!== 'default') queryParts.push(`sort=${sortVal}`);
} else if (parseMode === 'video') {
const activeSort = firstVal(extend, 'sort') || 'default';
if (activeSort && activeSort!== 'default') queryParts.push(`sort=${activeSort}`);
const activeFilters = firstVal(extend, 'filters') || 'all';
if (activeFilters && activeFilters!== 'all') queryParts.push(`filters=${activeFilters}`);
}
if (queryParts.length) targetUrl += (targetUrl.includes('?')? '&': '?') + queryParts.join('&');

try {
const res = await fetchWithFallback(targetUrl);
const vodList = parseCards(res.text, parseMode);
return {
page,
pagecount: vodList.length >= 12? page + 1: page,
limit: vodList.length,
total: 999,
list: vodList,
};
} catch (e) {
console.error('[missav] category error:', e.message);
return { page, pagecount: page, limit: 0, total: 999, list: []};
}
}

// /detail：@@ 拆番號；surrit UUID 拼 m3u8
async function detail(inReq) {
const rawId = inReq.body?.id;
const raw = Array.isArray(rawId)? String(rawId[0] || ''): toStr(rawId);
let vid;
let originHref;
if (raw.includes('@@')) {
[vid, originHref] = raw.split('@@');
} else {
vid = raw.replace(/^vod@/, '').replace(/^\/+|\/+$/g, '');
originHref = `${PRIMARY_HOST}/dm247/cn/${vid}`;
}
const candUrls = [
/^https?:\/\//i.test(originHref)? originHref: PRIMARY_HOST + originHref,
`${PRIMARY_HOST}/dm247/cn/${vid}`,
`${FALLBACK_HOST}/dm247/cn/${vid}`,
];

let html = '';
try {
for (const u of candUrls) {
const res = await fetchWithFallback(u);
if (res.code === 200 && res.text.length > 3000) {
html = res.text;
break;
}
}

let vodName = vid.toUpperCase();
const titleM = /<title>(.*?)<\/title>/i.exec(html);
if (titleM) {
const tRaw = titleM[1].split(' | ')[0].split(' - ')[0].trim();
if (tRaw) vodName = tRaw;
}

const cleanActresses = [];
for (const am of html.matchAll(/<a[^>]+href=["'][^"']*\/actresses\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/g)) {
const name = am[1].replace(/<[^>]+>/g, '').trim();
if (name && !['排行', 'Ranking', '一览', 'SEP', 'OCT', 'NOV', '202'].some((k) => name.includes(k))) {
if (!cleanActresses.includes(name)) cleanActresses.push(name);
}
}
const actorText = cleanActresses.length? cleanActresses.join(', '): 'TG群: @tvshare23';

const descM = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/.exec(html);
const desc = descM? descM[1].trim(): '蝴蝶影视高清聚合，全网同步更新。';
const vodContent = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${desc}`;
const escapedDesc = vodContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const surritUuid = extractSurritUuid(html);
const playFroms = [];
const playUrls = [];
if (surritUuid) {
playFroms.push('蝴蝶正片专线');
playUrls.push(`超清原画正片$https://surrit.com/${surritUuid}/playlist.m3u8`);
}

return {
list: [{
vod_id: raw,
vod_name: htmlUnescape(vodName),
vod_pic: `https://fourhoi.com/${vid}/cover-n.jpg`,
vod_actor: actorText,
vod_director: '蝴蝶影视',
vod_remarks: '蝴蝶影视',
vod_content: escapedDesc,
vod_play_from: playFroms.length? playFroms.join('$$$'): '蝴蝶专线',
vod_play_url: playUrls.length? playUrls.join('$$$'): '超清原画正片$' + candUrls[0],
}],
};
} catch (e) {
console.error('[missav] detail error:', e.message);
return { list: []};
}
}

// /search：/dm247/cn/search/{key}
async function search(inReq) {
let pg = inReq.body?.page || 1;
if (pg == 0) pg = 1;
const page = /^\d+$/.test(String(pg))? parseInt(pg, 10): 1;
const key = toStr(inReq.body?.wd?? inReq.body?.key);
try {
let searchUrl = `${PRIMARY_HOST}/dm247/cn/search/${encodeURIComponent(key)}`;
if (page > 1) searchUrl += `?page=${page}`;
const res = await fetchWithFallback(searchUrl);
const vodList = parseCards(res.text, 'video');
return {
page,
pagecount: vodList.length >= 12? page + 1: page,
limit: vodList.length,
total: 999,
list: vodList,
};
} catch (e) {
console.error('[missav] search error:', e.message);
return { page, pagecount: page, limit: 0, total: 999, list: []};
}
}

// /play：直接播（surrit m3u8 或詳情頁地址）
async function play(inReq) {
const url = toStr(inReq.body?.id).trim();
return {
parse: 0,
jx: 0,
url,
header: {
'User-Agent': UA,
Referer: 'https://missav.ws/',
Origin: 'https://missav.ws',
Accept: '*/*',
Connection: 'keep-alive',
},
};
}

export default {
meta: { key: 'missav', name: '蝴蝶影视·MissAV', type: 3},
api: async (fastify) => {
fastify.post('/init', init);
fastify.post('/home', home);
fastify.post('/category', category);
fastify.post('/detail', detail);
fastify.post('/play', play);
fastify.post('/search', search);
},
};
