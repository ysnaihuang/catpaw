// 欲女心经 —— catBridge 单档 cat 源（后台「Cat 源」→ 上传导入，热重载）
// 由 _____3_cih4.py（tvbox python 源）移植。六接口契约见模板 __4K_5_791a.js。
// 沙箱内 import 会被改写为 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客户端。
// 原 Python localProxy（m3u8 广告清洗）移植为扩展 GET 路由 /yuxj_m3u8（超出标准六接口，
// 目前不在播放链路上：play 直接返回原始 m3u8 地址，与 Python 无 getProxyUrl 时的行为一致）。
import req from '../../util/req.js';

const DEFAULT_HOST = 'https://rzj.ynxj9.work';
const PAGE_SIZE = 20;
const DEFAULT_UA = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const PLAYER_UA = DEFAULT_UA;
// 默认反代常量（原 Python 读磁盘 proxy_config.json，JS 沙箱不读盘，直接用内置回退地址）
const DEFAULT_PROXY_FALLBACK = 'https://xsz-shared-proxy.97471201.workers.dev';

const NAV_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    'Accept-Encoding': 'gzip, deflate',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-User': '?1',
};

const SORTS = [
    ['new', '最新'],
    ['hot', '最热'],
];

// ========== 敏感词古典映射脱敏表（完整移植） ==========
const CLASSICAL_MAP = {
    '成人': '风月', '色情': '风月', '情色': '春宫', '淫': '风月', '黄色': '春宫', '淫秽': '猥亵',
    '激情': '云雨', '做爱': '云雨', '性交': '交欢', '欲': '情思', '高潮': '云端',
    '偷拍': '窥帘', '偷窥': '窥帘', '乱伦': '禁脔', '强奸': '强占', '轮奸': '群辱',
    '迷奸': '迷占', '无码': '素纱', '有码': '遮面', '熟女': '徐娘',
    '萝莉': '豆蔻', '幼女': '玉蕊', '少女': '碧玉', '学生': '书生',
    '人妻': '罗敷', '少妇': '艳妇', '御姐': '玉人', '护士': '药女',
    '教师': '先生', '医生': '郎中', '警察': '捕快', '军人': '军爷',
    '秘书': '掌印', '老板': '东家', '丈夫': '夫君', '妻子': '拙荆',
    '情人': '相好', '小三': '外遇', '二奶': '外室', '出轨': '翻墙',
    '偷情': '私会', '通奸': '私通', '嫖娼': '寻花', '卖淫': '卖身',
    '妓女': '花娘', '性骚扰': '轻薄', '猥亵': '猥亵', '露阴': '曝玉',
    '咸猪手': '禄山爪', '丝袜': '丝履', '网袜': '网履', '内衣': '亵衣',
    '内裤': '亵裤', '情趣': '风月', '春药': '催情', '巨乳': '丰盈',
    '爆乳': '丰盈', '胸': '酥胸', '乳': '玉兔', '美乳': '玉兔',
    '臀': '玉臀', '屁股': '玉臀', '脚': '莲步', '玉足': '莲步',
    '腿': '玉腿', '裸体': '玉体', '全裸': '玉体', '半裸': '半褪',
    '走光': '泄春', '露点': '泄玉', '自慰': '弄玉', '口交': '含朱',
    '口活': '含朱', '肛交': '后庭', '屁眼': '后庭', '肛门': '后庭',
    '群交': '合卺', '乳交': '玉兔', '足交': '莲步', '车震': '车行',
    '野战': '郊合', '精液': '元阳', '精子': '元阳', '阴道': '幽处',
    '阴户': '幽处', '阴茎': '玉茎', '阳具': '玉茎', 'SM': '调教',
    '制服': '官衣', 'OL': '衙内', '空姐': '行云', '继母': '继室',
    '姐妹': '同根', '同学': '同窗', '邻居': '东邻', '处女': '处子',
    '初夜': '破瓜', '暴力': '杀伐', '血腥': '殷红', '恐怖': '幽冥',
    '赌博': '孤注', '毒品': '药石', '枪支': '火器', '刀具': '利刃',
    '国产': '华夏', '日韩': '东瀛', '欧美': '西洋', '港台': '香江',
    '直播': '云演', '自拍': '自照',
};

const MINOR_KEYWORDS = [
    '豆蔻', '玉蕊', '碧玉', '书生', '稚子', '未成年', 'teen', 'loli',
    'schoolgirl',
];

const toStr = (v) => (v == null ? '' : String(v));

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function boolVal(value, def = false) {
    if (typeof value === 'boolean') return value;
    if (value == null || value === '') return def;
    return ['1', 'true', 'yes', 'on', 'y'].includes(String(value).trim().toLowerCase());
}

function boundedInt(value, def, min, max) {
    let num;
    if (typeof value === 'number') {
        num = Math.trunc(value);
    } else if (typeof value === 'string') {
        const t = value.trim();
        if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return def;
        num = Math.trunc(Number(t));
    } else {
        return def;
    }
    if (!Number.isFinite(num)) return def;
    return Math.min(Math.max(num, min), max);
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeDecode(s) {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function urljoin(base, rel) {
    try {
        return new URL(rel, base).toString();
    } catch {
        return rel;
    }
}

function pathOf(u) {
    try {
        return new URL(u).pathname.toLowerCase();
    } catch {
        return '';
    }
}

// 对应 Python ast.literal_eval：把 Python 字面量风格（单引号 / True / False / None / 元组）转 JSON 再解析。
function parsePyLiteral(text) {
    let i = 0;
    const n = text.length;
    let out = '';
    while (i < n) {
        const ch = text[i];
        if (ch === "'" || ch === '"') {
            const quote = ch;
            let j = i + 1;
            let buf = '';
            let closed = false;
            while (j < n) {
                const c = text[j];
                if (c === '\\' && j + 1 < n) {
                    buf += c + text[j + 1];
                    j += 2;
                    continue;
                }
                if (c === quote) {
                    closed = true;
                    break;
                }
                buf += c;
                j++;
            }
            if (!closed) return null;
            const unescaped = buf.replace(/\\(.)/g, (_, e) => {
                if (e === 'n') return '\n';
                if (e === 't') return '\t';
                if (e === 'r') return '\r';
                if (e === 'b') return '\b';
                if (e === 'f') return '\f';
                if (e === 'v') return '\v';
                if (e === '0') return '\0';
                return e;
            });
            out += JSON.stringify(unescaped);
            i = j + 1;
        } else if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
            const word = text.slice(i, j);
            if (word === 'True') out += 'true';
            else if (word === 'False') out += 'false';
            else if (word === 'None') out += 'null';
            else out += word;
            i = j;
        } else if (ch === '(' || ch === ')') {
            out += ch === '(' ? '[' : ']';
            i++;
        } else {
            out += ch;
            i++;
        }
    }
    return JSON.parse(out);
}

// 对应 Python _parse_config：对象 / JSON 字符串 / ast 字面量风格 / 列表合并。
function parseConfig(value) {
    if (value == null) return {};
    if (Array.isArray(value)) {
        const merged = {};
        for (const item of value) Object.assign(merged, parseConfig(item));
        return merged;
    }
    if (typeof value === 'object') return { ...value };
    const text = String(value).trim();
    if (!text) return {};
    try {
        const d = JSON.parse(text);
        if (d && typeof d === 'object') {
            if (Array.isArray(d)) {
                const merged = {};
                for (const item of d) if (item && typeof item === 'object') Object.assign(merged, item);
                return merged;
            }
            return d;
        }
    } catch {
        // 不是 JSON，继续尝试 ast 字面量
    }
    try {
        const d = parsePyLiteral(text);
        if (d && typeof d === 'object') {
            if (Array.isArray(d)) {
                const merged = {};
                for (const item of d) if (item && typeof item === 'object') Object.assign(merged, item);
                return merged;
            }
            return d;
        }
    } catch {
        // 解析失败，返回空配置
    }
    return {};
}

function normalizeOrigin(value) {
    let text = String(value || DEFAULT_HOST).trim().replace(/\/+$/, '');
    if (text && !text.includes('://')) text = `https://${text}`;
    try {
        const parsed = new URL(text);
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return DEFAULT_HOST;
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return DEFAULT_HOST;
    }
}

// ===================== 模块状态 =====================

let rawSite = DEFAULT_HOST;
let siteUrl = DEFAULT_HOST;
let host = DEFAULT_HOST;
let useProxy = false;
let timeout = 15;
let cookie = '';
let maxRetries = 2;
let cacheTtl = 60;
let warmupEnabled = true;
let categories = [];
const pageCache = new Map();

function cachePut(key, value) {
    pageCache.set(key, { t: Date.now(), value });
    if (pageCache.size > 24) {
        const oldest = [...pageCache.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, 8);
        for (const [k] of oldest) pageCache.delete(k);
    }
}

function cacheGet(key) {
    const hit = pageCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > cacheTtl * 1000) {
        pageCache.delete(key);
        return null;
    }
    return hit.value;
}

function requestHeaders(referer) {
    const h = { ...NAV_HEADERS, 'User-Agent': DEFAULT_UA };
    if (referer) {
        h.Referer = referer;
        h['Sec-Fetch-Site'] = 'same-origin';
    }
    if (cookie) h.Cookie = cookie;
    return h;
}

async function fetchDirect(url, referer, timeoutSec, retries, postData) {
    const headers = requestHeaders(referer);
    let lastErr = null;
    for (let attempt = 0; attempt <= Math.max(retries, 0); attempt++) {
        try {
            let resp;
            if (postData != null) {
                const body = new URLSearchParams(postData).toString();
                resp = await req.post(url, body, {
                    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: timeoutSec * 1000,
                    validateStatus: () => true,
                });
            } else {
                resp = await req.get(url, { headers, timeout: timeoutSec * 1000, validateStatus: () => true });
            }
            const status = Number(resp?.status ?? resp?.statusCode ?? 0);
            if (status >= 400) throw new Error(`HTTP ${status}`);
            const text = typeof resp?.data === 'string' ? resp.data : toStr(resp?.data);
            if (!text.trim()) throw new Error('空响应');
            return [text, url];
        } catch (e) {
            lastErr = e;
            if (attempt < retries) await sleep(Math.min(0.6 * (attempt + 1), 2.0) * 1000);
        }
    }
    throw lastErr || new Error('请求失败');
}

async function fetchUrl(url, referer, timeoutSec, retries, postData) {
    const t = timeoutSec ?? timeout;
    const r = retries ?? maxRetries;
    const cacheKey = url + (postData ? '_post' : '');
    const cached = cacheGet(cacheKey);
    if (cached != null) return cached;
    const result = await fetchDirect(url, referer, t, r, postData);
    cachePut(cacheKey, result);
    return result;
}

// ===================== 脱敏 =====================

function desensitize(text) {
    if (text == null) return '';
    let result = String(text);
    const keys = Object.keys(CLASSICAL_MAP).sort((a, b) => b.length - a.length);
    for (const key of keys) {
        if (result.includes(key)) result = result.split(key).join(CLASSICAL_MAP[key]);
    }
    const lower = result.toLowerCase();
    for (const kw of MINOR_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) return '';
    }
    return result;
}

function isMinorContent(text) {
    if (!text) return false;
    const lower = String(text).toLowerCase();
    for (const kw of MINOR_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) return true;
    }
    return false;
}

function sanitizeVod(vod) {
    if (!vod || typeof vod !== 'object') return vod;
    const name = vod.vod_name ?? '';
    const remarks = vod.vod_remarks ?? '';
    const content = vod.vod_content ?? '';
    if (isMinorContent(name) || isMinorContent(remarks) || isMinorContent(content)) return null;
    vod.vod_name = desensitize(name);
    if (vod.vod_remarks != null) vod.vod_remarks = desensitize(remarks);
    if (vod.vod_content != null) vod.vod_content = desensitize(content);
    if (!vod.vod_name) return null;
    return vod;
}

function sanitizeList(vodList) {
    if (!Array.isArray(vodList)) return vodList;
    const result = [];
    for (const item of vodList) {
        const cleaned = sanitizeVod(item);
        if (cleaned != null) result.push(cleaned);
    }
    return result;
}

function sanitizeClasses(classes) {
    if (!Array.isArray(classes)) return classes;
    const result = [];
    for (const cat of classes) {
        if (!cat || typeof cat !== 'object') {
            result.push(cat);
            continue;
        }
        const name = cat.type_name ?? '';
        if (isMinorContent(name)) continue;
        cat.type_name = desensitize(name);
        if (cat.type_name) result.push(cat);
    }
    return result;
}

// ===================== 解析 =====================

function parseCategories(html) {
    const classes = [];
    const seen = new Set();
    const re = /<a[^>]*href="\/vodtype\/(\d+)\.html"[^>]*>\s*<span>([^<]+)<\/span>/g;
    let m;
    while ((m = re.exec(String(html || '')))) {
        const tid = m[1];
        const tname = m[2].trim();
        if (seen.has(tid) || !tname) continue;
        seen.add(tid);
        classes.push({ type_id: tid, type_name: tname });
    }
    return classes;
}

async function ensureCategories() {
    if (categories.length) return categories;
    try {
        const [html] = await fetchUrl(`${host}/ynxj/`, `${rawSite}/`);
        categories = parseCategories(html);
    } catch {
        categories = [];
    }
    return categories;
}

async function filters() {
    const options = SORTS.map(([v, n]) => ({ n, v }));
    const cats = await ensureCategories();
    const out = {};
    for (const cat of cats) out[cat.type_id] = [{ key: 'sort', name: '排序', init: '', value: options }];
    return out;
}

function parseList(html) {
    const text = String(html || '');
    const ids = [];
    const seen = new Set();
    for (const m of text.matchAll(/href="\/(\d+)\.html"/g)) {
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            ids.push(m[1]);
        }
    }
    const bgImgs = [...text.matchAll(/background(?:-image)?:\s*url\(["']?([^"'\)]+)["']?\)/g)].map((m) => m[1]);
    const titles = [];
    for (const m of text.matchAll(/<a[^>]*href="\/\d+\.html"[^>]*>([^<]{5,})<\/a>/g)) {
        const t = m[1].trim();
        if (t) titles.push(t);
    }
    const items = [];
    for (let i = 0; i < ids.length; i++) {
        const pic = i < bgImgs.length ? bgImgs[i] : '';
        const name = i < titles.length ? titles[i] : '';
        if (!name) continue;
        items.push({ vod_id: ids[i], vod_name: name, vod_pic: pic, vod_remarks: '' });
    }
    return items;
}

function parsePagecount(html, current, tid) {
    const pages = [current];
    const re = new RegExp(`/vodtype/${escapeRegExp(String(tid))}-(\\d+)\\.html`, 'g');
    for (const m of String(html || '').matchAll(re)) {
        pages.push(boundedInt(m[1], current, 1, 100000));
    }
    return Math.max(...pages);
}

function parseDetail(html, vid) {
    const text = String(html || '');
    let name = '';
    let m = /<h1[^>]*>([^<]+)<\/h1>/.exec(text);
    if (m) name = m[1].trim();
    if (!name) {
        m = /<title>([^<]+)<\/title>/.exec(text);
        if (m) name = m[1].split('-')[0].trim();
    }
    if (!name) name = vid;
    let pic = '';
    m = /background(?:-image)?:\s*url\(["']?([^"'\)]+)["']?\)/.exec(text);
    if (m) pic = m[1];
    let playUrl = '';
    m = /const\s+rawUrl\s*=\s*['"]([^'"]+)['"]/.exec(text);
    if (m) playUrl = m[1];
    if (!playUrl) {
        m = /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/.exec(text);
        if (m) playUrl = m[1];
    }
    let content = '';
    m = /class="[^"]*(?:content|desc|intro|detail)[^"]*"[^>]*>(.*?)<\//s.exec(text);
    if (m) content = m[1].replace(/<[^>]+>/g, '').trim();
    if (!content) content = name;
    return {
        vod_id: vid,
        vod_name: name,
        vod_pic: pic,
        vod_remarks: '',
        vod_content: content,
        vod_play_from: '欲女心经',
        vod_play_url: playUrl ? `正片$${playUrl}` : '',
    };
}

function emptyPage(page) {
    return { page, pagecount: page, limit: PAGE_SIZE, total: 0, list: [] };
}

// ===================== 六大接口 =====================

// /init：解析配置（字符串 JSON / ast 字面量风格 / 对象），轻量不联网，不做 Python 的 warmup 预热。
async function init(inReq) {
    const config = parseConfig(inReq.body);
    rawSite = normalizeOrigin(config.host || config.siteUrl || DEFAULT_HOST);
    const direct = boolVal(config.direct, true);
    const extProxy = String(config.proxy || '').trim();
    if (extProxy) {
        useProxy = true;
        siteUrl = normalizeOrigin(extProxy);
    } else if (!direct) {
        useProxy = true;
        siteUrl = DEFAULT_PROXY_FALLBACK;
    } else {
        useProxy = false;
        siteUrl = rawSite;
    }
    host = siteUrl;
    timeout = boundedInt(config.timeout, 15, 5, 40);
    cookie = String(config.cookie || '').trim();
    maxRetries = boundedInt(config.max_retries, 2, 0, 6);
    cacheTtl = boundedInt(config.cache_ttl, 60, 0, 900);
    warmupEnabled = boolVal(config.warmup, true);
    categories = [];
    pageCache.clear();
    return {};
}

// /home：分类（脱敏后）+ filters + /ynxj/ 列表（脱敏后）
async function home() {
    const cats = sanitizeClasses(await ensureCategories());
    let list = [];
    try {
        const [html] = await fetchUrl(`${host}/ynxj/`, `${rawSite}/`);
        list = sanitizeList(parseList(html));
    } catch (e) {
        console.error('[欲女心经] home error:', e.message);
    }
    return { class: cats, filters: await filters(), list };
}

// /category：pg==1 → /vodtype/{slug}.html，否则 /vodtype/{slug}-{pg}.html
async function category(inReq) {
    const page = boundedInt(inReq.body?.page, 1, 1, 100000);
    const slug = toStr(inReq.body?.id).trim();
    if (!slug) return emptyPage(page);
    const url = page === 1 ? `${host}/vodtype/${slug}.html` : `${host}/vodtype/${slug}-${page}.html`;
    try {
        const [html] = await fetchUrl(url, `${rawSite}/`);
        const items = parseList(html);
        const pagecount = parsePagecount(html, page, slug);
        const limit = items.length || PAGE_SIZE;
        const total = pagecount > 0 ? pagecount * limit : 0;
        return { page, pagecount, limit, total, list: sanitizeList(items) };
    } catch (e) {
        console.error('[欲女心经] category error:', e.message);
        return emptyPage(page);
    }
}

// /search：POST 到 /s/index.html，表单 {wd: keyword}；req.post 不可用时回退 GET ?wd=
async function search(inReq) {
    const keyword = cleanText(inReq.body?.wd ?? inReq.body?.key);
    const page = boundedInt(inReq.body?.page, 1, 1, 100000);
    if (!keyword) return emptyPage(page);
    const url = `${host}/s/index.html`;
    try {
        let text;
        if (typeof req.post === 'function') {
            try {
                [text] = await fetchUrl(url, `${rawSite}/`, undefined, undefined, { wd: keyword });
            } catch (e) {
                console.error('[欲女心经] search post failed, fallback GET:', e.message);
                [text] = await fetchUrl(`${url}?wd=${encodeURIComponent(keyword)}`, `${rawSite}/`);
            }
        } else {
            [text] = await fetchUrl(`${url}?wd=${encodeURIComponent(keyword)}`, `${rawSite}/`);
        }
        const items = parseList(text);
        return { page, pagecount: page, limit: items.length || PAGE_SIZE, total: items.length, list: sanitizeList(items) };
    } catch (e) {
        console.error('[欲女心经] search error:', e.message);
        return emptyPage(page);
    }
}

// /detail：/{vid}.html
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const vid = toStr(Array.isArray(rawId) ? rawId[0] : rawId).trim();
    if (!vid || !/\d/.test(vid)) return { list: [] };
    try {
        const [html] = await fetchUrl(`${host}/${vid}.html`, `${rawSite}/`);
        const vod = parseDetail(html, vid);
        const cleaned = vod ? sanitizeVod(vod) : null;
        return { list: cleaned ? [cleaned] : [] };
    } catch (e) {
        console.error('[欲女心经] detail error:', e.message);
        return { list: [] };
    }
}

// /play：直接返回原始 m3u8 地址（与 Python 一致：仅当壳提供 getProxyUrl 时才走代理清洗；
// catBridge JS 宿主无 getProxyUrl 等价物，强制改写为相对路径 /yuxj_m3u8 会导致播放器拿不到可播地址）
async function play(inReq) {
    const playUrl = toStr(inReq.body?.id);
    if (!playUrl) {
        return {
            parse: 0, jx: 0, playUrl: '', url: '', header: {},
            format: 'application/x-mpegURL', contentType: 'application/x-mpegURL', msg: '空播放地址',
        };
    }
    return {
        parse: 0,
        jx: 0,
        playUrl: '',
        url: playUrl,
        header: { 'User-Agent': PLAYER_UA, Referer: `${rawSite}/`, Origin: rawSite },
        format: 'application/x-mpegURL',
        contentType: 'application/x-mpegURL',
    };
}

// ===================== m3u8 广告清洗 + 本地代理 =====================

function sanitizeM3u8Url(url) {
    if (!url) return url;
    let out = safeDecode(url);
    out = out.replace(/&[Cc]over=.*/, '');
    out = out.replace(/&[Pp]oster=.*/, '');
    out = out.replace(/&[Tt]humb=.*/, '');
    out = out.replace(/&[Pp]ic=.*/, '');
    return out.replace(/[&?]+$/, '');
}

function proxyM3u8Url(url, referer) {
    return `/yuxj_m3u8?type=m3u8&url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer || rawSite)}`;
}

async function getM3u8Content(url, referer) {
    try {
        const headers = {
            'User-Agent': PLAYER_UA,
            Accept: '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Referer: referer,
            Origin: rawSite,
            Connection: 'keep-alive',
        };
        const resp = await req.get(url, { headers, timeout: 10000, validateStatus: () => true });
        const status = Number(resp?.status ?? 0);
        if (status && status !== 200) return null;
        const text = typeof resp?.data === 'string' ? resp.data : toStr(resp?.data);
        return text || null;
    } catch {
        return null;
    }
}

// 广告片段识别：关键词匹配 + 短时长判定（完整移植 Python 关键词表）
const AD_WORDS = [
    'advertisement', 'advertise', 'advert', 'commercial', 'sponsor', 'sponsorship',
    'preroll', 'pre-roll', 'pre_roll', 'midroll', 'mid-roll', 'postroll', 'post-roll',
    'banner', 'banners', 'popup', 'pop-up', 'interstitial', 'overlay', 'splash',
    'bumper', 'stinger', 'vast', 'vpaid', 'vmap',
    'doubleclick', 'googleads', 'googlesyndication', 'googletag', 'adsense', 'admob',
    'adx', 'adnetwork', 'adserving', 'ad-serving', 'adserver', 'ad-server',
    'inmobi', 'unityads', 'applovin', 'ironsource', 'vungle', 'chartboost', 'tapjoy',
    'mintegral', 'pangle', 'bytedance', 'tiktokads', 'kuaishou', 'ks-ad',
    'tracking', 'tracker', 'beacon', 'pixel', 'analytics', 'statistic',
    'leaderboard', 'skyscraper', 'rectangle', 'filler',
    '广告', '片头', '片尾', '贴片', '赞助商', '赞助', '推广', '硬广',
    '前贴', '中插', '后贴', '角标', '广告位', '广告片', '广告段', '广告视频',
    '广告素材', '弹窗', '悬浮', '开屏', '插屏', '激励视频', '激励广告',
    'guanggao', 'ggao', 'ggvideo', 'ggmedia',
    '/ad/', '/ads/', '/adv/', '/adver/', '/gg/', '/gga/', '/ggb/', '/ggc/', '/ggd/',
    '_ad.', '.ad/', '_ads.', '_adv.', '_gg.', 'gg_', '_gg', '/gg', 'gg.',
    '/ad_', '/ads_', '/adv_', '/sponsor/', '/banner/', '/promo/', '/commercial/',
    '/preroll/', '/midroll/', '/postroll/', '/popup/', '/interstitial/', '/overlay/',
    '/splash/', '/bumper/', '/vast/', '/vpaid/', '/adnetwork/', '/adserving/',
    '/doubleclick/', '/googleads/', '/googlesyndication/', '/adsense/', '/admob/',
    '/tracking/', '/tracker/', '/beacon/', '/pixel/', '/analytics/',
];

function isAdSegment(uri, dur = 0, prevTags) {
    const u = String(uri || '').trim().toLowerCase();
    if (!u) return false;
    if (AD_WORDS.some((w) => u.includes(w))) return true;
    const d = Number(dur);
    if (d > 0 && d <= 1.2) return true;
    return false;
}

function parseM3u8Segments(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map((s) => s.trim()).filter((s) => s);
    const header = [];
    const segments = [];
    const tail = [];
    let pendingTags = [];
    let mediaSequence = 0;
    let targetDuration = 0;
    let started = false;
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
            const part = line.split(':', 2)[1];
            if (part != null && /^[+-]?\d+$/.test(part.trim())) mediaSequence = parseInt(part.trim(), 10);
            if (!started) header.push(line);
            else pendingTags.push(line);
        } else if (line.startsWith('#EXT-X-TARGETDURATION')) {
            const part = line.split(':', 2)[1];
            if (part != null && part.trim() !== '') {
                const v = Number(part.trim());
                if (Number.isFinite(v)) targetDuration = v;
            }
            if (!started) header.push(line);
            else pendingTags.push(line);
        } else if (line.startsWith('#EXTINF')) {
            started = true;
            let dur = targetDuration || 3.0;
            const m = /#EXTINF:\s*([\d.]+)/.exec(line);
            if (m) {
                const v = Number(m[1]);
                if (Number.isFinite(v)) dur = v;
            }
            const tags = [...pendingTags, line];
            pendingTags = [];
            let uri = '';
            let j = i + 1;
            while (j < lines.length) {
                if (lines[j].startsWith('#')) {
                    tags.push(lines[j]);
                    j++;
                    continue;
                }
                uri = lines[j];
                break;
            }
            if (uri) {
                segments.push({ tags, uri, dur });
                i = j;
            } else {
                tail.push(...tags);
            }
        } else if (line.startsWith('#EXT-X-ENDLIST')) {
            tail.push(line);
        } else if (line.startsWith('#')) {
            if (started) pendingTags.push(line);
            else header.push(line);
        } else {
            started = true;
            segments.push({ tags: pendingTags, uri: line, dur: targetDuration || 3.0 });
            pendingTags = [];
        }
        i += 1;
    }
    return { header, segments, tail, mediaSequence, targetDuration };
}

function segmentHostKey(uri, baseUrl) {
    try {
        const full = urljoin(baseUrl, uri);
        const p = new URL(full);
        const path = (p.pathname || '/').replace(/\/[^/]*$/, '/').toLowerCase();
        return `${p.host.toLowerCase()}\u0000${path}`;
    } catch {
        return '\u0000';
    }
}

function mainPathMarker(m3u8Url) {
    try {
        const p = new URL(m3u8Url).pathname;
        let m = /(\/\d{8}\/[^/]+\/\d+kb\/hls\/)/.exec(p);
        if (m) return m[1].toLowerCase();
        m = /(\/\d{8}\/[^/]+\/)/.exec(p);
        if (m) return m[1].toLowerCase();
    } catch {
        // 相对地址等无法解析时返回空标记
    }
    return '';
}

// 核心 m3u8 广告清洗：五重广告识别 + 主 CDN 统计 + 前置贴片切除 + 多码率递归代理
function cleanM3u8(m3u8Text, m3u8Url = '', referer = '', skipSeconds = 25) {
    const text = String(m3u8Text || '').replace(/\r/g, '');
    // 多码率 m3u8：递归代理子 m3u8
    if (text.includes('#EXT-X-STREAM-INF')) {
        const out = [];
        let lastStream = false;
        for (const raw of text.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith('#')) {
                out.push(line);
                lastStream = line.startsWith('#EXT-X-STREAM-INF');
            } else {
                const absUrl = urljoin(m3u8Url, line);
                if (lastStream || line.toLowerCase().includes('.m3u8')) out.push(proxyM3u8Url(absUrl, referer || rawSite));
                else out.push(absUrl);
                lastStream = false;
            }
        }
        return `${out.join('\n')}\n`;
    }

    const { header, segments, tail, mediaSequence, targetDuration } = parseM3u8Segments(text);
    if (!segments.length) return text;

    const marker = mainPathMarker(m3u8Url);

    // 统计各主机路径的总时长，找出主 CDN
    const stat = new Map();
    for (const seg of segments) {
        const key = segmentHostKey(seg.uri, m3u8Url);
        stat.set(key, (stat.get(key) || 0) + (Number(seg.dur) || 0));
    }
    let mainKey = '';
    let mainDur = 0;
    for (const [k, v] of stat) {
        if (v > mainDur) {
            mainDur = v;
            mainKey = k;
        }
    }
    const totalDur = [...stat.values()].reduce((a, b) => a + b, 0);

    // 五重广告识别
    let cleaned = [];
    let removed = 0;
    for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx];
        const key = segmentHostKey(seg.uri, m3u8Url);
        const isFront = idx < 12;
        const absUri = urljoin(m3u8Url, seg.uri || '');
        let isAd = isAdSegment(seg.uri, seg.dur, seg.tags);
        // 第二重：路径标记不匹配主路径
        if (marker && !pathOf(absUri).includes(marker)) isAd = true;
        const tagsText = (seg.tags || []).join('\n').toUpperCase();
        // 第三重：前置 12 片段 + METHOD=NONE + 路径不匹配
        if (isFront && tagsText.includes('METHOD=NONE') && marker && !pathOf(absUri).includes(marker)) isAd = true;
        // 第四重：前置 12 片段 + 主 CDN 占比 >= 60% + 非主 CDN 且时长 <= 90 秒
        if (!isAd && isFront && totalDur > 0 && mainDur >= totalDur * 0.6) {
            if (key !== mainKey && (stat.get(key) || 0) <= 90) isAd = true;
        }
        if (isAd) {
            removed += 1;
            continue;
        }
        seg._idx = idx;
        cleaned.push(seg);
    }

    // 兜底策略：没删到广告时，前 12 片段累计 >= 25 秒且第一个不是主 CDN，则切掉前置贴片
    if (removed === 0 && segments.length > 4) {
        let acc = 0;
        let cut = 0;
        for (let idx = 0; idx < Math.min(12, segments.length); idx++) {
            const seg = segments[idx];
            const key = segmentHostKey(seg.uri, m3u8Url);
            if (key === mainKey && acc >= 3) break;
            acc += Number(seg.dur) || targetDuration || 3;
            cut = idx + 1;
            if (acc >= skipSeconds) break;
        }
        if (cut > 0 && cut < segments.length) {
            const firstKey = segmentHostKey(segments[0].uri, m3u8Url);
            if (firstKey !== mainKey) {
                cleaned = segments.slice(cut);
                removed = cut;
            }
        }
    }

    if (!cleaned.length) {
        cleaned = segments;
        removed = 0;
    }

    // 重新生成干净的 m3u8
    const newLines = [];
    let hasM3u = false;
    for (const line of header) {
        if (line.startsWith('#EXTM3U')) hasM3u = true;
        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE') || line.startsWith('#EXT-X-START')) continue;
        if (line.startsWith('#EXT-X-KEY') && line.toUpperCase().includes('METHOD=NONE') && removed > 0) continue;
        newLines.push(line);
    }
    if (!hasM3u) newLines.unshift('#EXTM3U');
    const firstIdx = cleaned.length ? (cleaned[0]._idx ?? removed) : removed;
    newLines.push(`#EXT-X-MEDIA-SEQUENCE:${mediaSequence + firstIdx}`);

    for (const seg of cleaned) {
        for (let tag of seg.tags || []) {
            if (tag.startsWith('#EXT-X-KEY') || tag.startsWith('#EXT-X-MAP')) {
                tag = tag.replace(/URI="([^"]+)"/g, (_, g1) => `URI="${urljoin(m3u8Url, g1)}"`);
            }
            newLines.push(tag);
        }
        newLines.push(urljoin(m3u8Url, seg.uri || ''));
    }
    if (tail.length) {
        for (const line of tail) {
            if (line.startsWith('#EXT-X-ENDLIST')) newLines.push(line);
        }
    } else if (text.includes('#EXT-X-ENDLIST')) {
        newLines.push('#EXT-X-ENDLIST');
    }
    return `${newLines.join('\n')}\n`;
}

export default {
    meta: { key: 'yunvxj', name: '欲女心经', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
        // 扩展：m3u8 广告清洗代理（原 Python localProxy，超出标准六接口；play 已不再走此路由）
        fastify.get('/yuxj_m3u8', async (request, reply) => {
            try {
                const q = request.query || {};
                const first = (v) => (Array.isArray(v) ? v[0] : v);
                const type = String(first(q.type || q.action || q.do) || '');
                const url = safeDecode(String(first(q.url) || ''));
                const referer = safeDecode(String(first(q.referer) || '')) || rawSite;
                if (type !== 'm3u8' && type !== 'py' && !url) return reply.code(404).type('text/plain').send('not found');
                if (!/^https?:\/\//i.test(url)) return reply.code(404).type('text/plain').send('bad url');
                const text = await getM3u8Content(url, referer);
                if (!text) return reply.code(502).type('text/plain').send('m3u8 download failed');
                const cleaned = cleanM3u8(text, url, referer);
                return reply.type('application/vnd.apple.mpegurl').send(cleaned);
            } catch (e) {
                console.error('[欲女心经] yuxj_m3u8 error:', e.message);
                return reply.code(500).type('text/plain').send('proxy error');
            }
        });
    },
};
