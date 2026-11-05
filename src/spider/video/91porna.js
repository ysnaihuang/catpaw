// 91PornA·蝴蝶影视 —— catBridge 单档 cat 源（后台「Cat 源」→ 上传导入，热重载）
// 由 91porna_0_3t73.py（tvbox python 源）移植。六接口契约见 docs/spider.md。
// 扩展路由（超出标准六接口）：GET /porna_pic?url=... 封面解密图片代理，仅宿主实际 serve 该路由时可用。
// 沙箱内 import 会被改写为 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客户端，'crypto' 为 node:crypto。
import req from '../../util/req.js';
import crypto from 'crypto';

const DEFAULT_HOST = 'https://91porna.com';
let siteUrl = DEFAULT_HOST;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const TG_GROUP = 'https://t.me/tvshare23';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';

// 封面解密密钥（对应 Python _cover_key / _post_key / _post_iv）
const COVER_KEY = Buffer.from('525202f9149e061d', 'utf8');
const POST_KEY = Buffer.from('f5d965df75336270', 'utf8');
const POST_IV = Buffer.from('97b60394abc2fbe1', 'utf8');

// 封面解密结果缓存（对应 Python _pic_cache，上限 80 条）
const picCache = new Map();

const CATEGORY_ROUTES = {
now_month_hot: '/comic/index/video?category=now_month_hot',
original: '/comic/index/video?category=original',
shunv: '/comic/index/search?keyword=%E7%86%9F%E5%A5%B3',
luoli: '/comic/index/search?keyword=%E8%90%9D%E8%8E%89',
dongman: '/comic/index/search?keyword=%E5%8A%A8%E6%BC%AB',
heiren: '/comic/index/search?keyword=%E9%BB%91%E4%BA%BA',
juru: '/comic/index/search?keyword=%E5%B7%A8%E4%B9%B3',
huanqi: '/comic/index/search?keyword=%E6%8D%A2%E5%A6%BB',
neishe: '/comic/index/search?keyword=%E5%86%85%E5%B0%84',
anmo: '/comic/index/search?keyword=%E6%8C%89%E6%91%A9',
tanhua: '/comic/index/search?keyword=%E6%8E%A2%E8%8A%B1',
luanlun: '/comic/index/search?keyword=%E5%AE%B6%E5%BA%AD%E4%B9%B1%E4%BC%A6',
sanji: '/comic/index/search?keyword=%E4%B8%89%E7%BA%A7%E7%89%87',
cr_duanju: '/ai/chengren-duanju',
cr_manju: '/ai/chengren-manju',
ai_huanlian: '/ai/ai-huanlian',
ai_mogai: '/ai/ai-mogai',
ai_91duanju: '/ai',
ms_amateur: '/melonshort/amateur',
ms_hunjian: '/melonshort/hunjian',
ms_fancha: '/melonshort/fancha',
ms_wanghong: '/melonshort/wanghong',
ms_mingxing: '/melonshort/mingxing',
ms_zipai: '/melonshort/zipai',
theme_1: '/comic/av/relvideo?model=1&type=theme&order=week',
theme_12: '/comic/av/relvideo?model=12&type=theme&order=week',
theme_5: '/comic/av/relvideo?model=5&type=theme&order=week',
theme_6: '/comic/av/relvideo?model=6&type=theme&order=week',
tag_107: '/comic/av/relvideo?model=107&type=tag&order=week',
theme_7: '/comic/av/relvideo?model=7&type=theme&order=week',
};

const toStr = (v) => (v == null? '': String(v));

// 对应 Python urllib.parse.urljoin
function urlJoin(base, rel) {
if (!rel) return '';
if (/^https?:\/\//i.test(rel)) return rel;
try {
return new URL(rel, base).href;
} catch {
return rel;
}
}

// 对应 Python format_remarks
function formatRemarks(brand, meta) {
const cleanMeta = toStr(meta || '').trim().replace(/[\r\n\t]+/g, ' ').trim();
if (cleanMeta) return `${brand} | ${cleanMeta}`;
return brand;
}

// 对应 Python html.unescape（常用命名实体 + 数字实体，&amp; 最后替换，避免二次解码）
function decodeEntities(s) {
return s
.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
.replace(/&quot;/g, '"')
.replace(/&apos;/g, "'")
.replace(/&#39;/g, "'")
.replace(/&lt;/g, '<')
.replace(/&gt;/g, '>')
.replace(/&nbsp;/g, ' ')
.replace(/&amp;/g, '&');
}

// 对应 Python _clean_text
function cleanText(text) {
const clean = toStr(text).replace(/<[^>]+>/g, '');
const decoded = decodeEntities(clean);
return decoded.replace(/[\r\n\t\s]+/g, ' ').trim();
}

// 对应 Python _extract_pic_clean
function extractPicClean(block) {
for (const attr of ['data-src', 'data-original', 'data-thumb', 'data-url']) {
const m = block.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'));
if (m) {
const cand = m[1].trim();
if (cand &&!cand.startsWith('data:image') &&!cand.toLowerCase().includes('loading')) return cand;
}
}
const srcM = block.match(/src=["']([^"']+)["']/i);
if (srcM) {
const cand = srcM[1].trim();
if (cand &&!cand.startsWith('data:image') &&!cand.toLowerCase().includes('loading')) return cand;
}
return '';
}

// 封面解密图片代理地址（对应 Python _proxy_pic_url，改用本站扩展路由 /porna_pic）
function proxyPicUrl(pic) {
if (!pic || pic.startsWith('http://127.0.0.1')) return pic;
return `/porna_pic?url=${encodeURIComponent(pic)}`;
}

// ===================== 封面解密 =====================

// 对应 Python _mime
function mimeOf(data) {
if (!data || data.length < 12) return '';
if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return 'image/png';
if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp';
return '';
}

// 对应 Python _pkcs7_unpad：填充合法才剥离，否则原样返回
function pkcs7Unpad(data) {
if (!data.length) return data;
const pad = data[data.length - 1];
if (pad >= 1 && pad <= 16 && data.length >= pad && data.subarray(data.length - pad).every((b) => b === pad)) {
return data.subarray(0, data.length - pad);
}
return data;
}

// 对应 Python _aes_ecb_decrypt：AES-128-ECB + 手动 PKCS7 去填充
function aesEcbDecrypt(key, data) {
const truncated = data.subarray(0, data.length - (data.length % 16));
if (truncated.length < 16) return null;
try {
const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
decipher.setAutoPadding(false);
const out = Buffer.concat([decipher.update(truncated), decipher.final()]);
return pkcs7Unpad(out);
} catch {
return null;
}
}

// 对应 Python _aes_cbc_decrypt：AES-128-CBC，不去填充，原样返回解密字节
function aesCbcDecrypt(key, iv, data) {
const truncated = data.subarray(0, data.length - (data.length % 16));
if (truncated.length < 16) return null;
try {
const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
decipher.setAutoPadding(false);
return Buffer.concat([decipher.update(truncated), decipher.final()]);
} catch {
return null;
}
}

// 对应 Python _decrypt_cover：已是图片原样返回；否则.bnc 先 ECB 后 CBC，非.bnc 先 CBC 后 ECB；取首个通过图片魔数校验的结果
function decryptCover(raw, url = '') {
if (!raw ||!raw.length) return Buffer.alloc(0);
if (mimeOf(raw)) return raw;
const isBnc = url.toLowerCase().split('?')[0].endsWith('.bnc');
const modes = isBnc? ['ecb', 'cbc']: ['cbc', 'ecb'];
for (const mode of modes) {
try {
const pt = mode === 'ecb'? aesEcbDecrypt(COVER_KEY, raw): aesCbcDecrypt(POST_KEY, POST_IV, raw);
if (pt && mimeOf(pt)) return pt;
} catch {
// 换下一种模式继续尝试
}
}
return Buffer.alloc(0);
}

// ===================== 网络 =====================

function toBuffer(data) {
if (!data) return Buffer.alloc(0);
if (Buffer.isBuffer(data)) return data;
if (data instanceof ArrayBuffer) return Buffer.from(data);
if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
if (typeof data === 'string') return Buffer.from(data, 'latin1');
return Buffer.alloc(0);
}

function decodeUtf8(buf) {
try {
return new TextDecoder('utf-8', { fatal: true}).decode(buf);
} catch {
return buf.toString('latin1');
}
}

// 宿主 req 客户端一般已自动解压；若返回原始 gzip 字节且沙箱提供 DecompressionStream，则在此解压
async function maybeGunzip(buf) {
if (buf.length < 2 || buf[0]!== 0x1f || buf[1]!== 0x8b) return buf;
if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined' || typeof Response === 'undefined') return buf;
try {
const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
return Buffer.from(await new Response(stream).arrayBuffer());
} catch {
return buf;
}
}

// 对应 Python _fetch：绝对化 URL、带 UA/Referer/Accept/Accept-Language，失败重试一次
async function fetchPage(targetUrl, referer = '') {
if (!targetUrl) return { code: 0, text: '', err: ''};
let url = targetUrl;
if (url.startsWith('//')) url = `https:${url}`;
else if (url.startsWith('/')) url = siteUrl + url;

const headers = {
'User-Agent': UA,
Referer: referer || `${siteUrl}/`,
Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
'Accept-Encoding': 'gzip, deflate',
Connection: 'keep-alive',
};

let lastErr = '';
for (let attempt = 0; attempt < 2; attempt++) {
try {
const resp = await req.get(url, { headers, timeout: 12000});
const status = Number(resp?.status) || 200;
if (status >= 400) {
if ((status === 451 || status === 403 || status === 429) && attempt === 0) continue;
const text = typeof resp?.data === 'string'? resp.data: '';
return { code: status, text, err: `HTTP ${status}`};
}
let text;
if (typeof resp?.data === 'string') {
text = resp.data;
} else {
let buf = toBuffer(resp?.data);
buf = await maybeGunzip(buf);
text = decodeUtf8(buf);
}
return { code: status, text, err: ''};
} catch (e) {
lastErr = e?.message || String(e);
const status = e?.response?.status?? e?.status?? 0;
if (status && status!== 451 && status!== 403 && status!== 429) {
const text = typeof e?.response?.data === 'string'? e.response.data: '';
return { code: status, text, err: lastErr};
}
if (attempt === 0) continue;
return { code: status || -1, text: '', err: lastErr};
}
}
return { code: -1, text: '', err: lastErr};
}

// ===================== 卡片解析 =====================

function parseVideoItems(html) {
const list = [];
const blocks = html.split('class="video-item"');
for (let i = 1; i < blocks.length; i++) {
const block = blocks[i];
const hrefM = block.match(/<a\s+[^>]*href=["']([^"']+)["']/i);
if (!hrefM) continue;
const vHref = hrefM[1].trim();
if (/javascript|#|login|register/.test(vHref)) continue;

let title = '';
const titleM = block.match(/title=["']([^"']+)["']/i);
if (titleM) title = cleanText(titleM[1]);
if (!title) {
const altM = block.match(/alt=["']([^"']+)["']/i);
if (altM) title = cleanText(altM[1]);
}
if (!title) {
const textM = block.match(/<(?:h\d|div|p|span)[^>]*class=["'][^"']*(?:title|name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h\d|div|p|span)>/i);
if (textM) title = cleanText(textM[1]);
}

const pic = extractPicClean(block);
const durM = block.match(/(?:class=["'][^"']*(?:duration|time)[^"']*["'][^>]*>|>\s*)(\d{1,2}:\d{2}(?::\d{2})?)/i);
const duration = durM? durM[1].trim(): '';

list.push({
vod_id: urlJoin(siteUrl, vHref),
vod_name: title || '正片视频',
vod_pic: proxyPicUrl(pic? urlJoin(siteUrl, pic): ''),
vod_remarks: formatRemarks('蝴蝶影视', duration),
style: { type: 'rect', ratio: 1.78},
});
}
return list;
}

function parseDramaCards(html) {
const list = [];
const cards = [...html.matchAll(/<a[^>]*class=["'][^"']*drama-card[^"']*["'][^>]*>[\s\S]*?<\/a>/gi)].map((m) => m[0]);
for (const block of cards) {
const hrefM = block.match(/href=["']([^"']+)["']/i);
if (!hrefM) continue;
const vHref = hrefM[1].trim();

let title = '';
const titleM = block.match(/title=["']([^"']+)["']/i);
if (titleM) title = cleanText(titleM[1]);
if (!title) {
const h3M = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
if (h3M) title = cleanText(h3M[1]);
}

const pic = extractPicClean(block);
const epsM = block.match(/class=["'][^"']*drama-card__eps[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
const epsStr = epsM? cleanText(epsM[1]): '';

list.push({
vod_id: urlJoin(siteUrl, vHref),
vod_name: title || '成人短剧',
vod_pic: proxyPicUrl(pic? urlJoin(siteUrl, pic): ''),
vod_remarks: formatRemarks('蝴蝶影视', epsStr),
style: { type: 'rect', ratio: 0.75},
});
}
return list;
}

function parseVideoCards(html) {
let cards = [...html.matchAll(/<article[^>]*class=["'][^"']*video-card[^"']*["'][^>]*>[\s\S]*?<\/article>/gi)].map((m) => m[0]);
if (!cards.length) {
cards = [...html.matchAll(/<(?:div|article|li)[^>]*class=["'][^"']*video-card[^"']*["'][^>]*>[\s\S]*?<\/(?:div|article|li)>/gi)].map((m) => m[0]);
}
if (!cards.length) {
cards = html.split('class="video-card').slice(1);
}

const list = [];
for (const block of cards) {
const hrefM = block.match(/<a[^>]*href=["']([^"']+)["']/i);
if (!hrefM) continue;
const vHref = hrefM[1].trim();

let title = '';
const titleM = block.match(/title=["']([^"']+)["']/i);
if (titleM) title = cleanText(titleM[1]);
if (!title) {
const altM = block.match(/alt=["']([^"']+)["']/i);
if (altM) title = cleanText(altM[1]);
}
if (!title) {
const tM = block.match(/<[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\//i);
if (tM) title = cleanText(tM[1]);
}

const pic = extractPicClean(block);
const durM = block.match(/class=["'][^"']*badge-duration[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
const durStr = durM? cleanText(durM[1]): '';

list.push({
vod_id: urlJoin(siteUrl, vHref),
vod_name: title || '微视频',
vod_pic: proxyPicUrl(pic? urlJoin(siteUrl, pic): ''),
vod_remarks: formatRemarks('蝴蝶影视', durStr),
style: { type: 'rect', ratio: 1.78},
});
}
return list;
}

// 按优先级解析三种卡片：video-item → drama-card → video-card（对应 Python if/elif/elif）
function parseCards(htmlText) {
const cleanHtml = htmlText.replace(/<(?:header|nav|footer|aside)[^>]*>[\s\S]*?<\/(?:header|nav|footer|aside)>/gi, '');
if (cleanHtml.includes('video-item')) return parseVideoItems(cleanHtml);
if (cleanHtml.includes('drama-card')) return parseDramaCards(cleanHtml);
if (cleanHtml.includes('video-card')) return parseVideoCards(cleanHtml);
return [];
}

// ===================== 六大接口 =====================

// /init：读 inReq.body（字符串 JSON 或对象）支持 host 覆盖，轻量不联网
async function init(inReq) {
try {
const body = inReq?.body;
let options = {};
if (body) {
if (typeof body === 'string') {
try {
options = JSON.parse(body);
} catch {
options = {};
}
} else if (typeof body === 'object') {
options = body;
}
}
const host = toStr(options.host).trim().replace(/\/+$/, '');
if (host) siteUrl = host;
} catch (e) {
console.error('[91PornA] init error:', e.message);
}
return {};
}

// /home：30 个硬编码分类 + 筛选器，列表为空（对应 Python homeContent + homeVideoContent）
async function home() {
const classes = [
{ type_name: '热门排行榜', type_id: 'now_month_hot'},
{ type_name: '国产原创', type_id: 'original'},
{ type_name: '熟女做爱', type_id: 'shunv'},
{ type_name: '可爱萝莉', type_id: 'luoli'},
{ type_name: '成人动漫', type_id: 'dongman'},
{ type_name: '大屌黑人', type_id: 'heiren'},
{ type_name: '童颜巨乳', type_id: 'juru'},
{ type_name: '少妇换妻', type_id: 'huanqi'},
{ type_name: '内射中出', type_id: 'neishe'},
{ type_name: '会所按摩', type_id: 'anmo'},
{ type_name: '91探花', type_id: 'tanhua'},
{ type_name: '家庭乱伦', type_id: 'luanlun'},
{ type_name: '三级片', type_id: 'sanji'},
{ type_name: '成人短剧', type_id: 'cr_duanju'},
{ type_name: '成人漫剧', type_id: 'cr_manju'},
{ type_name: 'AI换脸', type_id: 'ai_huanlian'},
{ type_name: 'AI魔改', type_id: 'ai_mogai'},
{ type_name: '91成人短剧', type_id: 'ai_91duanju'},
{ type_name: '素人自拍', type_id: 'ms_amateur'},
{ type_name: '高燃混剪', type_id: 'ms_hunjian'},
{ type_name: '反差系列', type_id: 'ms_fancha'},
{ type_name: '网红达人', type_id: 'ms_wanghong'},
{ type_name: '明星大瓜', type_id: 'ms_mingxing'},
{ type_name: '原创自拍', type_id: 'ms_zipai'},
{ type_name: '多P群交', type_id: 'theme_1'},
{ type_name: '无码解放', type_id: 'theme_12'},
{ type_name: '中文字幕', type_id: 'theme_5'},
{ type_name: '制服诱惑', type_id: 'theme_6'},
{ type_name: '黑人专区', type_id: 'tag_107'},
{ type_name: 'SM调教', type_id: 'theme_7'},
];

const categoryFilter = {
key: 'category',
name: '榜单子分类',
value: [
{ n: '全部/默认', v: ''},
{ n: '正在播放', v: 'play'},
{ n: '当前最热', v: 'now_hot'},
{ n: '最近更新', v: 'new_update'},
{ n: '91原创', v: 'original'},
{ n: '本月最热', v: 'now_month_hot'},
{ n: '10分钟以上', v: 'ten_minutes'},
{ n: '20分钟以上', v: 'twenty_minutes'},
{ n: '本月收藏', v: 'now_month_collect'},
{ n: '高清', v: 'hd'},
{ n: '每月最热', v: 'month_hot'},
{ n: '本月讨论', v: 'now_month_comment'},
{ n: '收藏最多', v: 'max_collect'},
],
};
const modelFilter = {
key: 'model',
name: '题材标签',
value: [
{ n: '全部', v: ''},
{ n: '多P群交', v: '1'},
{ n: '无码解放', v: '12'},
{ n: '中文字幕', v: '5'},
{ n: '制服诱惑', v: '6'},
{ n: '黑人专区', v: '107'},
{ n: 'SM调教', v: '7'},
],
};
const orderFilter = {
key: 'order',
name: '排序',
value: [
{ n: '本周最热', v: 'week'},
{ n: '最新发布', v: 'new'},
{ n: '最多播放', v: 'play'},
],
};

const filters = {
now_month_hot: [categoryFilter, modelFilter],
original: [categoryFilter, modelFilter],
theme_1: [orderFilter],
theme_12: [orderFilter],
theme_5: [orderFilter],
theme_6: [orderFilter],
tag_107: [orderFilter],
theme_7: [orderFilter],
};

return { class: classes, filters, list: []};
}

// /category：按 categoryRoutes 建 URL，extend 覆盖 category/model/order，三种卡片按优先级解析
async function category(inReq) {
const body = inReq?.body || {};
const tid = toStr(body.id?? body.tid);
let page = Number(body.page) || 1;
if (page === 0) page = 1;
const extend = body.filters || body.extend || {};

const rawTid = tid.trim();
const basePath = CATEGORY_ROUTES[rawTid] || `/comic/index/video?category=${rawTid}`;
let targetUrl;
if (basePath.startsWith('/ai')) {
targetUrl = page > 1? `${basePath.replace(/\/+$/, '')}/page/${page}`: basePath;
} else {
const sep = basePath.includes('?')? '&': '?';
targetUrl = `${basePath}${sep}page=${page}`;
}

if (extend && typeof extend === 'object') {
const cVal = toStr(extend.category);
if (cVal) {
if (/category=[^&]*/.test(targetUrl)) {
targetUrl = targetUrl.replace(/category=[^&]*/, `category=${encodeURIComponent(cVal)}`);
} else {
targetUrl += `${targetUrl.includes('?')? '&': '?'}category=${encodeURIComponent(cVal)}`;
}
}
const mVal = toStr(extend.model);
if (mVal) targetUrl += `&model=${encodeURIComponent(mVal)}`;
const oVal = toStr(extend.order);
if (oVal) targetUrl += `&order=${encodeURIComponent(oVal)}`;
}

try {
const res = await fetchPage(targetUrl);
const list = parseCards(res.text || '');
return { page, pagecount: list.length >= 15? page + 1: page, limit: 20, total: 9999, list};
} catch (e) {
console.error('[91PornA] category error:', e.message);
return { page, pagecount: page, limit: 20, total: 9999, list: []};
}
}

// /detail：标题取 <title> 按 -/_ 切第一段；/ai 页解析剧集链接，否则单集
async function detail(inReq) {
const body = inReq?.body || {};
const rawId = Array.isArray(body.id)? body.id[0]: toStr(body.id);
const targetUrl = /^https?:\/\//i.test(rawId)? rawId: urlJoin(siteUrl, rawId);
try {
const res = await fetchPage(targetUrl);
const detailHtml = res.text || '';

const titleM = detailHtml.match(/<title[^>]*>(.*?)<\/title>/i);
const rawTitle = titleM? titleM[1].split('-')[0].split('_')[0].trim(): '正片详情';
const vodName = cleanText(rawTitle);

const pic = extractPicClean(detailHtml);
const fullPic = pic? urlJoin(siteUrl, pic): '';

const desc = `【🔥 官方交流群: ${TG_GROUP}】\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n蝴蝶专线 极速硬解 | 4K全景原画画质`;

const episodes = [];
if (targetUrl.includes('/ai')) {
const epListM = detailHtml.match(/<(?:div|ul)[^>]*class=["'][^"']*(?:ep|chapter|series|list)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|ul)>/i);
const corpus = epListM? epListM[1]: detailHtml;
const epLinks = [...corpus.matchAll(/<a[^>]+href=["']([^"']*(?:\/ai\/|\?ep=|\/play)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
const seen = new Set();
for (const m of epLinks) {
const epHref = m[1];
const epText = cleanText(m[2]);
if (!epText || /(短剧|漫剧|换脸|魔改|首页|返回)/.test(epText)) continue;
if (seen.has(epHref)) continue;
seen.add(epHref);
episodes.push(`${epText}$${urlJoin(siteUrl, epHref)}`);
}
}
if (!episodes.length) episodes.push(`超清正片$${targetUrl}`);

const vod = {
vod_id: rawId,
vod_name: vodName,
vod_pic: proxyPicUrl(fullPic),
vod_actor: BRAND_ACTOR,
vod_director: BRAND_DIRECTOR,
vod_remarks: formatRemarks('蝴蝶影视', '正片'),
vod_content: desc,
vod_play_from: '蝴蝶专线',
vod_play_url: episodes.join('#'),
};
return { list: [vod]};
} catch (e) {
console.error('[91PornA] detail error:', e.message);
return { list: []};
}
}

// /play：服务端解析真实 m3u8 直链后返回（parse: 0）。
// 原因：TVBox Python 版返回 parse: 1 + 详情页 URL，靠客户端 WebView 嗅探出 m3u8；
// catBridge 宿主不做页面嗅探，parse: 1 交回去播不了。改为服务端解析：
//   ① /ai 剧集页：<script id="ai-play-boot"> 内嵌 JSON，playlist[] 按当前集取 play 直链；
//   ② /comic 详情页：packed 脚本字典里的长 hex token(u) + og:image 封面路径(img) + t=⌊秒/2100⌋
//      → GET /index/detail_play?img=&ads=&u=&h=&t= → packed 响应里提取 m3u8 直链。
// 两种都失败时回退 jx: 1 交客户端解析（parse 恒为 0，模板约定）。
async function play(inReq) {
const body = inReq?.body || {};
const rawTarget = toStr(body.id).trim();
const targetPlayPage = /^https?:\/\//i.test(rawTarget)? rawTarget: urlJoin(siteUrl, rawTarget);
const header = { 'User-Agent': UA, Referer: `${siteUrl}/` };
const direct = (url) => ({ jx: 0, parse: 0, playUrl: '', url, header });
try {
const res = await fetchPage(targetPlayPage);
const html = res.text || '';
let currentPath = '';
try {
currentPath = new URL(targetPlayPage).pathname;
} catch {
// 忽略
}

// ① /ai 剧集页：ai-play-boot JSON 的 playlist 按当前集取 play
const bootM = html.match(/<script[^>]*id=["']ai-play-boot["'][^>]*>([\s\S]*?)<\/script>/i);
if (bootM) {
try {
const boot = JSON.parse(bootM[1]);
const pl = Array.isArray(boot.playlist)? boot.playlist: [];
const hit = pl.find((e) => e && e.play && (e.url === currentPath || e.ep === boot.current))
|| pl.find((e) => e && e.play);
if (hit) return direct(String(hit.play).replace(/&amp;/g, '&'));
} catch {
// 落入 ②
}
}

// ② /comic 详情页：走 /index/detail_play 取 m3u8
const packedM = html.match(/<script>\s*let videoId[\s\S]*?<\/script>/i);
const scope = packedM? packedM[0]: html;
const uM = scope.match(/\|([0-9a-f]{100,})\|/) || html.match(/\|([0-9a-f]{100,})\|/);
let imgPath = '';
const ogM = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
|| html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
if (ogM) {
try {
imgPath = new URL(ogM[1]).pathname;
} catch {
// 忽略
}
}
if (!imgPath) {
const imgM = html.match(/\/upload_01\/[^"'\s?]+\.jpeg/i);
if (imgM) imgPath = imgM[0];
}
if (uM && imgPath) {
const t = Math.floor(Date.now() / 1000 / 2100);
const dpUrl = `${siteUrl}/index/detail_play?img=${encodeURIComponent(imgPath)}&ads=&u=${uM[1]}&h=&t=${t}`;
const dpRes = await fetchPage(dpUrl, targetPlayPage);
const m3u8M = (dpRes.text || '').match(/https?:\/\/[^\s"'\\|]+?\.m3u8[^\s"'\\|]*/i);
if (m3u8M) return direct(m3u8M[0].replace(/&amp;/g, '&'));
}
} catch (e) {
console.error('[91PornA] play error:', e.message);
}
return { jx: 1, parse: 0, playUrl: '', url: targetPlayPage, header };
}

// /search：/comic/index/search?keyword=...&page=N，video-item 卡片解析
async function search(inReq) {
const body = inReq?.body || {};
let page = Number(body.page) || 1;
if (page === 0) page = 1;
const key = toStr(body.wd?? body.key?? body.keyword);
let searchPath = `/comic/index/search?keyword=${encodeURIComponent(key.trim()).replace(/%20/g, '+')}`;
if (page > 1) searchPath += `&page=${page}`;

try {
const res = await fetchPage(searchPath);
const htmlText = res.text || '';
const list = [];
const blocks = htmlText.split('class="video-item"');
for (let i = 1; i < blocks.length; i++) {
const block = blocks[i];
const hrefM = block.match(/<a\s+[^>]*href=["']([^"']+)["']/i);
if (!hrefM) continue;
const vHref = hrefM[1].trim();
const titleM = block.match(/title=["']([^"']+)["']/i);
const title = titleM? cleanText(titleM[1]): '正片视频';
const pic = extractPicClean(block);
list.push({
vod_id: urlJoin(siteUrl, vHref),
vod_name: title,
vod_pic: proxyPicUrl(pic? urlJoin(siteUrl, pic): ''),
vod_remarks: '蝴蝶影视',
style: { type: 'rect', ratio: 1.78},
});
}
return { page, pagecount: list.length >= 15? page + 1: page, limit: 20, total: 9999, list};
} catch (e) {
console.error('[91PornA] search error:', e.message);
return { page, pagecount: page, limit: 20, total: 9999, list: []};
}
}

// ===================== 扩展路由：封面解密图片代理 =====================

// 对应 Python localProxy：取字节 → 解密封面 → 返回图片；失败 404
async function pornaPic(request, reply) {
const url = toStr(request?.query?.url).trim();
if (!url || url.startsWith('http://127.0.0.1')) {
reply.code(404).type('text/plain').send('Not Found');
return;
}
if (picCache.has(url)) {
const cached = picCache.get(url);
reply.type(cached.mime).send(cached.buf);
return;
}
try {
const resp = await req.get(url, {
responseType: 'arraybuffer',
headers: { 'User-Agent': UA, Referer: `${siteUrl}/`},
});
const raw = toBuffer(resp?.data);
if (!raw.length) {
reply.code(404).type('text/plain').send('Not Found');
return;
}
const img = decryptCover(raw, url);
if (img && img.length) {
const mime = mimeOf(img) || 'image/jpeg';
if (picCache.size < 80) picCache.set(url, { mime, buf: img});
reply.type(mime).send(img);
return;
}
} catch (e) {
console.error('[91PornA] porna_pic error:', e.message);
}
reply.code(404).type('text/plain').send('Not Found');
}

export default {
meta: { key: 'porna91', name: '91PornA·蝴蝶影视', type: 3},
api: async (fastify) => {
fastify.post('/init', init);
fastify.post('/home', home);
fastify.post('/category', category);
fastify.post('/detail', detail);
fastify.post('/play', play);
fastify.post('/search', search);
// 扩展路由（超出标准六接口）：封面解密图片代理
fastify.get('/porna_pic', pornaPic);
},
};
