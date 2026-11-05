// 国色天香 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 1.py（tvbox python 源，PyramidStore 插件，動態域名）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
//
// 移植說明：
// - 站點域名動態（/data.json 下發 css/pic/novel 域名，支持 881 跳轉）；
//   原 _resolve_site_url 的「本地文件緩存」在 catBridge 無對應持久化位置，
//   改為模組內存 + 每次 init 重新解析（候選域名逐個試 /data.json，881 則跟跳轉）。
// - 封面走遠程 PHP 代理解密（http://xg3.mingapi.top/tvbox/php/国色天香_pic.php），
//   與原 cover_url 一致，客戶端可直接加載。
// - 原 localProxy 的 action=proxy 分支在站內無任何調用方（封面走遠程 PHP），
//   模板六接口亦無對應項，未移植。
import req from '../../util/req.js';

// 解密映射表（來自 public.min.js），對應 Python _DECRYPT_MAP
const DECRYPT_MAP = {
    e: 'P', w: 'D', T: 'y', '+': 'J', l: '!', t: 'L', E: 'E', '@': '2', d: 'a', b: '%',
    q: 'l', X: 'v', '~': 'R', 5: 'r', '&': 'X', C: 'j', ']': 'F', a: ')', '^': 'm', ',': '~',
    '}': '1', x: 'C', c: '(', G: '@', h: 'h', '.': '*', L: 's', '=': ':', p: 'g', I: 'Q',
    1: '7', _: 'u', K: '6', F: 't', 2: 'n', 8: '=', k: 'G', Z: ']', ')': 'b', P: '}',
    B: 'U', S: 'k', 6: 'i', g: ':', N: 'N', i: 'S', '%': '+', '-': 'Y', '?': '|', 4: 'z',
    '*': '-', 3: '^', '[': '{', '(': 'c', u: 'B', y: 'M', U: 'Z', H: '[', z: 'K', 9: 'H',
    7: 'f', R: 'x', v: '&', '!': ';', M: '_', Q: '9', Y: 'e', o: '4', r: 'A', m: '.',
    O: 'o', V: 'W', J: 'p', f: 'd', ':': 'q', '{': '8', W: 'I', j: '?', n: '5', s: '3',
    '|': 'T', A: 'V', D: 'w', ';': 'O',
};

// 默認基礎域名（緩存和跳轉都失敗時的保底），對應 Python _BACKUP_BASE_URLS
const BACKUP_BASE_URLS = [
    'https://VwLYxvSnvzcai.wckz813.vip:8801',
    'https://2tcW6DEkfnvzcai.wckz813.vip:8801',
    'https://QXxadAnnvzcai.wckz813.vip:8801',
    'https://iin.wckk799.vip:8801',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const JSON_HEADERS = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
};

// 模組級站點狀態（對應 Python 的 self.siteUrl / css_domain / ...）
const S = {
    siteUrl: BACKUP_BASE_URLS[0],
    cssDomain: '',
    picDomain: '',
    novelDomain: '',
    csstime: '',
    channelId: '',
    ready: false,
};

const toStr = (v) => (v == null ? '' : String(v));

function htmlUnescape(s) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return toStr(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, ent) => {
        if (ent[0] === '#') {
            const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
            if (!Number.isNaN(code)) {
                try {
                    return String.fromCodePoint(code);
                } catch {
                    return m;
                }
            }
            return m;
        }
        return Object.prototype.hasOwnProperty.call(named, ent) ? named[ent] : m;
    });
}

// 解密網站加密文本（標題/分類名等），對應 Python decrypt_text
function decryptText(text) {
    if (!text || typeof text !== 'string') return '';
    const mapped = [...text].map((ch) => (Object.prototype.hasOwnProperty.call(DECRYPT_MAP, ch) ? DECRYPT_MAP[ch] : ch)).join('');
    return htmlUnescape(mapped);
}

// 從 HTTP 881 響應 HTML 提取跳轉目標（對應 Python _extract_redirect_url_from_881）
function extractRedirectUrlFrom881(htmlText) {
    if (!htmlText) return '';
    const stripIndex = (u) => (u.endsWith('/index.htm') ? u.slice(0, -'/index.htm'.length) : u);

    // 格式1: document.write(decodeURIComponent("...")) 嵌套
    let m = /document\.write\(decodeURIComponent\("([^"]+)"\)\)/.exec(htmlText);
    if (m) {
        const decoded = decodeURIComponent(htmlUnescape(m[1]));
        let m2 = /var\s+url\s*=\s*["'](https?:\/\/[^"']+)["']/.exec(decoded);
        if (m2) return stripIndex(m2[1]);
        const m3 = /window\.location\.replace\(["'](https?:\/\/[^"']+)["']\)/.exec(decoded);
        if (m3) return stripIndex(m3[1]);
    }
    // 格式2: 直接的 var url
    m = /var\s+url\s*=\s*["'](https?:\/\/[^"']+)["']/.exec(htmlText);
    if (m) return stripIndex(m[1]);
    // 格式3: window.location.replace
    m = /window\.location\.replace\(["'](https?:\/\/[^"']+)["']\)/.exec(htmlText);
    if (m) return stripIndex(m[1]);
    // 格式4: location.href
    m = /location\.href\s*=\s*["'](https?:\/\/[^"']+)["']/.exec(htmlText);
    if (m) return stripIndex(m[1]);
    return '';
}

async function httpGet(url, timeout = 15000) {
    const resp = await req.get(url, { headers: JSON_HEADERS, timeout, validateStatus: () => true });
    const data = resp.data;
    return { status: resp.status ?? 0, text: typeof data === 'string' ? data : toStr(data) };
}

// 解析 data.json（JS 變量格式 var Group=...;var Token=...），對應 Python refresh_domains
function parseDataJson(content) {
    let start = content.indexOf('var Group=');
    if (start === -1) start = content.indexOf('var Group =');
    let end = start === -1 ? -1 : content.indexOf('var Token=', start);
    if (end === -1 && start !== -1) end = content.indexOf('var Token =', start);
    if (start === -1 || end === -1) return null;
    let jsonStr = content.slice(start, end).trim();
    jsonStr = jsonStr.replace(/var\s+Group\s*=\s*/, '').replace(/;$/, '').trim();
    try {
        return JSON.parse(jsonStr);
    } catch {
        return null;
    }
}

// 動態域名解析 + 刷新（合併 Python _resolve_site_url / refresh_domains；無文件緩存）
async function ensureInit() {
    if (S.ready) return true;
    const candidates = [];
    for (const c of [S.siteUrl, ...BACKUP_BASE_URLS]) {
        if (c && !candidates.includes(c)) candidates.push(c);
    }
    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        try {
            let res = await httpGet(`${candidate}/data.json`);
            if (res.status === 881) {
                const redirectUrl = extractRedirectUrlFrom881(res.text);
                if (redirectUrl && !candidates.includes(redirectUrl)) {
                    candidates.push(redirectUrl);
                    try {
                        const res2 = await httpGet(`${redirectUrl}/data.json`);
                        if (res2.status === 200) {
                            res = res2;
                            candidates[i] = redirectUrl;
                        } else {
                            continue;
                        }
                    } catch {
                        continue;
                    }
                } else {
                    continue;
                }
            }
            if (res.status !== 200) continue;
            const group = parseDataJson(res.text);
            if (!group) continue;
            S.siteUrl = candidates[i];
            S.cssDomain = group.css_domain || '';
            S.picDomain = group.pic_domain || '';
            S.novelDomain = group.novel_domain || '';
            S.csstime = String(group.csstime || '');
            S.channelId = String(group.channel_id || '');
            if (!S.picDomain) S.picDomain = S.siteUrl;
            if (!S.novelDomain) S.novelDomain = S.siteUrl;
            if (!S.cssDomain) S.cssDomain = S.siteUrl;
            S.ready = true;
            return true;
        } catch (e) {
            console.error('[guosetianxiang] domain candidate error:', e.message);
        }
    }
    return false;
}

async function getJson(path, params) {
    let url;
    if (path.includes('?')) {
        const [basePath, existingQuery] = path.split('?', 2);
        url = `${S.siteUrl}${basePath}?${existingQuery}`;
    } else {
        url = `${S.siteUrl}${path}`;
    }
    if (params && Object.keys(params).length) {
        const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
        url += (url.includes('?') ? '&' : '?') + query;
    }
    try {
        const res = await httpGet(url);
        if (res.status !== 200 || !res.text) return null;
        return JSON.parse(res.text);
    } catch (e) {
        console.error('[guosetianxiang] getJson error:', e.message);
        return null;
    }
}

// 封面 URL（遠程 PHP 代理解密 XOR 加密圖），對應 Python cover_url
function coverUrl(serialNumber) {
    if (!serialNumber) return '';
    const picBase = S.picDomain || S.siteUrl;
    const cssUrl = `${picBase}/pic/${serialNumber}/thumbnail.css`;
    return `http://xg3.mingapi.top/tvbox/php/国色天香_pic.php?url=${encodeURIComponent(cssUrl)}`;
}

function m3u8Url(serialNumber) {
    if (!serialNumber) return '';
    const novelBase = S.novelDomain || S.siteUrl;
    return `${novelBase}/m3u8/${serialNumber}/index_domain.m3u8?${S.csstime}`;
}

function formatVod(item) {
    const serial = item.serial_number || '';
    return {
        vod_id: String(item.id || ''),
        vod_name: decryptText(item.title || ''),
        vod_pic: serial ? coverUrl(serial) : '',
        vod_remarks: String(item.read_number || ''),
    };
}

function isVideoFormat(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
    const low = url.toLowerCase();
    return ['.mp4', '.m3u8', '.ts', '.mkv', '.avi', '.webm', '.flv'].some((f) => low.includes(f));
}

// ===================== 六大介面 =====================

// /init：自定義域名（逗號分隔）+ 動態解析
async function init(inReq) {
    const ext = inReq?.body;
    if (typeof ext === 'string' && ext.trim()) {
        const customUrls = ext.split(',').map((u) => u.trim()).filter((u) => u.startsWith('http'));
        if (customUrls.length) {
            BACKUP_BASE_URLS.unshift(...customUrls.filter((u) => !BACKUP_BASE_URLS.includes(u)));
            S.siteUrl = customUrls[0];
        }
    } else if (ext && typeof ext === 'object' && ext.host) {
        S.siteUrl = String(ext.host);
    }
    S.ready = false;
    const ok = await ensureInit();
    if (!ok) console.error('[guosetianxiang] domain refresh failed, some features may be limited');
    return {};
}

// /home：/index.json 取分類 + 流派/標籤篩選
async function home() {
    const result = { class: [], filters: {} };
    const defaultClasses = [
        { type_id: '1', type_name: '国产' }, { type_id: '2', type_name: '日本' },
        { type_id: '3', type_name: '韩国' }, { type_id: '4', type_name: '欧美' },
    ];
    try {
        await ensureInit();
        const data = await getJson(`/index.json?${S.csstime}`);
        const classes = [];
        const filtersMap = {};
        if (data && data.index_videos) {
            for (const key of Object.keys(data.index_videos)) {
                const cat = data.index_videos[key];
                const catId = String(cat.id ?? key);
                const catName = decryptText(cat.name || '');
                if (!catName) continue;
                classes.push({ type_id: catId, type_name: catName });

                const genreFilter = { key: 'genre', name: '流派', value: [{ n: '全部', v: '' }] };
                for (const g of cat.genres || []) {
                    const gName = decryptText(g.name || '');
                    if (gName) genreFilter.value.push({ n: gName, v: String(g.id || '') });
                }
                const labelFilter = { key: 'label', name: '标签', value: [{ n: '全部', v: '' }] };
                for (const l of cat.labels || []) {
                    const lName = htmlUnescape(l.name || '');
                    if (lName) labelFilter.value.push({ n: lName, v: String(l.id || '') });
                }
                filtersMap[catId] = [genreFilter, labelFilter];
            }
        }
        result.class = classes.length ? classes : defaultClasses;
        result.filters = classes.length ? filtersMap : {};
        return result;
    } catch (e) {
        console.error('[guosetianxiang] home error:', e.message);
        result.class = defaultClasses;
        return result;
    }
}

// /category：/type/{tid}_{pg}.json
async function category(inReq) {
    const tid = toStr(inReq.body?.id);
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    const extend = inReq.body?.filters && typeof inReq.body.filters === 'object' ? inReq.body.filters : {};
    const firstVal = (k) => {
        const v = extend[k];
        return Array.isArray(v) ? v[0] : v;
    };
    const params = {};
    const genre = firstVal('genre');
    const label = firstVal('label');
    if (genre) params.genre = genre;
    if (label) params.label = label;
    try {
        await ensureInit();
        const data = await getJson(`/type/${tid}_${pg}.json?${S.csstime}`, params);
        if (!data) return { list: [], page: pg, pagecount: 0, limit: 20, total: 0 };
        const videos = ((data.data || {}).videos || []).map(formatVod);
        const pageCount = (data.data || {}).page_count || 1;
        return { list: videos, page: pg, pagecount: pageCount, limit: 20, total: pageCount * 20 };
    } catch (e) {
        console.error('[guosetianxiang] category error:', e.message);
        return { list: [], page: pg, pagecount: 0, limit: 20, total: 0 };
    }
}

// /detail：/video/{id}.json
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const videoId = Array.isArray(rawId) ? String(rawId[0] || '') : toStr(rawId);
    if (!videoId) return { list: [] };
    try {
        await ensureInit();
        const data = await getJson(`/video/${videoId}.json?${S.csstime}`);
        if (!data || !data.video) return { list: [] };
        const video = data.video;
        const serial = video.serial_number || '';
        return {
            list: [{
                vod_id: String(videoId),
                vod_name: decryptText(video.title || ''),
                vod_pic: serial ? coverUrl(serial) : '',
                vod_remarks: String(video.read_number || ''),
                vod_year: '',
                vod_area: '',
                vod_actor: String(video.actresses || ''),
                vod_director: '',
                vod_content: htmlUnescape(video.description || ''),
                vod_play_from: '默认',
                vod_play_url: serial ? `播放$${m3u8Url(serial)}` : '',
            }],
        };
    } catch (e) {
        console.error('[guosetianxiang] detail error:', e.message);
        return { list: [] };
    }
}

// /search：/search.json?search={key}
async function search(inReq) {
    const key = toStr(inReq.body?.wd ?? inReq.body?.key);
    try {
        await ensureInit();
        const data = await getJson('/search.json', { search: key });
        if (!data) return { list: [] };
        return { list: (data.videos || []).map(formatVod) };
    } catch (e) {
        console.error('[guosetianxiang] search error:', e.message);
        return { list: [] };
    }
}

// /play：直鏈 parse:0，否則抓頁面找 m3u8
async function play(inReq) {
    const id = toStr(inReq.body?.id);
    const headers = { 'User-Agent': UA, Referer: S.siteUrl };
    if (!id) return { parse: 1, url: '', header: headers };
    if (isVideoFormat(id)) return { parse: 0, url: id, header: headers };
    try {
        await ensureInit();
        const playUrl = id.startsWith('http') ? id : S.siteUrl + id;
        const res = await httpGet(playUrl);
        const m = /https?:\/\/[^\s"']+\.m3u8[^\s"']*/.exec(res.text);
        if (m) return { parse: 0, url: m[0], header: headers };
        return { parse: 1, url: playUrl, header: headers };
    } catch (e) {
        console.error('[guosetianxiang] play error:', e.message);
        return { parse: 1, url: id, header: headers };
    }
}

export default {
    meta: { key: 'guosetianxiang', name: '国色天香', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
