// 18AV —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 18av.py 移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端，'crypto' 為 node:crypto。
import req from '../../util/req.js';
import crypto from 'crypto';

let HOST = 'https://18av01.cc';
const BASE = '/zh';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 播放 id 解密參數（詳情頁 _refresh_crypto 會動態刷新，對應 Python 實例屬性）
let AES_KEY = Buffer.from('f2de1cc5a09e548a', 'utf8');
let AES_IV = Buffer.from('14799105d5ff0474', 'utf8');
let HCDEED = 21;
let HADEED = 26;

const CHANNELS = {
    chinese: { name: '中文字幕', path: '/zh/chinese_random/all/index.html' },
    censored: { name: '有码AV', path: '/zh/censored_random/all/index.html' },
    uncensored: { name: '无码AV', path: '/zh/uncensored_random/all/index.html' },
    amateur: { name: '素人AV', path: '/zh/amateurjav_random/all/index.html' },
    mosaic: { name: '无码破解', path: '/zh/reducing-mosaic_random/all/index.html' },
    animation: { name: 'H动画', path: '/zh/animation_random/all/index.html' },
    c_anim: { name: 'H有码动画', path: '/zh/CensoredAnimation_random/all/index.html' },
    u_anim: { name: 'H无码动画', path: '/zh/UncensoredAnimation_random/all/index.html' },
    td_anim: { name: 'H_3D动画', path: '/zh/tdAnimation_random/all/index.html' },
    dt: { name: '国产自拍', path: '/zh/dt_random/all/index.html' },
    news: { name: '每日更新', path: '/zh/content_news/all/index.html' },
};

const NAME_TO_ID = {};
for (const [k, v] of Object.entries(CHANNELS)) {
    NAME_TO_ID[k] = k;
    NAME_TO_ID[v.name] = k;
}

const toStr = (v) => (v == null ? '' : String(v));

// 對應 Python urllib.parse.quote(s, safe='/')：encodeURIComponent 再還原 /，並把 !'()* 也編碼。
function pyQuote(s) {
    return encodeURIComponent(toStr(s))
        .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)
        .replace(/%2F/gi, '/');
}

function resNum(k) {
    const m = toStr(k).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

function headers(referer, accept) {
    return {
        'User-Agent': UA,
        'Accept': accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': referer || (HOST + BASE + '/'),
    };
}

// 對應 Python _get：失敗 / 非 200 返回空串，不拋異常。
async function getText(url, referer, accept) {
    try {
        const resp = await req.get(url, { headers: headers(referer, accept), timeout: 20000 });
        const data = resp?.data;
        return typeof data === 'string' ? data : toStr(data);
    } catch (e) {
        console.error('[18AV] GET error', url, e.message);
        return '';
    }
}

// 對應 Python _abs：\/ 還原、&amp; 還原、// 與相對路徑補 host。
function absUrl(u) {
    if (!u) return '';
    u = toStr(u).trim().replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/')) return HOST + u;
    if (!u.startsWith('http')) return HOST + '/' + u;
    return u;
}

// ===================== 播放 id 解密 =====================

// 對應 Python _refresh_crypto：從詳情頁提取 aes_key / aes_iv / hadeed / hcdeed。
function refreshCrypto(html) {
    const text = toStr(html);
    let m = text.match(/argdeqweqweqwe\s*=\s*'([0-9a-fA-F]{16})'/);
    if (m) AES_KEY = Buffer.from(m[1], 'utf8');
    m = text.match(/hdddedg252\s*=\s*'([0-9a-fA-F]{16})'/);
    if (m) AES_IV = Buffer.from(m[1], 'utf8');
    m = text.match(/hadeedg252\s*=\s*(\d+)/);
    if (m) HADEED = parseInt(m[1], 10);
    m = text.match(/hcdeedg252\s*=\s*(\d+)/);
    if (m) HCDEED = parseInt(m[1], 10);
}

// 對應 Python int(p, radix)：整串校驗，非法字元返回 null（Python 會拋 ValueError 被 except 吞掉）。
function pyInt(s, radix) {
    const t = toStr(s).trim();
    if (!/^[+-]?[0-9a-z]+$/i.test(t)) return null;
    let neg = false;
    let digits = t;
    if (digits[0] === '+' || digits[0] === '-') {
        neg = digits[0] === '-';
        digits = digits.slice(1);
    }
    let val = 0;
    for (const ch of digits.toLowerCase()) {
        const d = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 87;
        if (d >= radix) return null;
        val = val * radix + d;
    }
    return neg ? -val : val;
}

// 對應 Python _decrypto：按分隔符切分 -> 整數 -> 異或 hadeed -> 字符。
function decrypto(g) {
    if (!g) return '';
    const radix = HCDEED >= 2 ? HCDEED : 21;
    const sep = String.fromCharCode((radix <= 25 ? radix : radix % 25) + 97);
    const out = [];
    for (const p of toStr(g).split(sep)) {
        if (!p) continue;
        const k = pyInt(p, radix);
        if (k === null) continue;
        const x = k ^ HADEED;
        if (x >= 0 && x <= 0x10FFFF) {
            try {
                out.push(x <= 0xFFFF ? String.fromCharCode(x) : String.fromCodePoint(x));
            } catch {
                continue;
            }
        }
    }
    return out.join('');
}

// 對應 Python _aes_decrypt：base64 補齊 -> AES-CBC 解密 -> 手動 PKCS7 去填充 -> utf-8。
function aesDecrypt(b64text) {
    if (!b64text) return '';
    try {
        const padLen = ((-toStr(b64text).length) % 4 + 4) % 4;
        const raw = Buffer.from(toStr(b64text) + '='.repeat(padLen), 'base64');
        const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
        decipher.setAutoPadding(false);
        let pt = Buffer.concat([decipher.update(raw), decipher.final()]);
        const pad = pt.length ? pt[pt.length - 1] : 0;
        if (pad >= 1 && pad <= 16) pt = pt.slice(0, pt.length - pad);
        return pt.toString('utf-8');
    } catch (e) {
        console.error('[18AV] AES error', e.message);
        return '';
    }
}

// 對應 Python _decode_play_id：_decrypto -> _aes_decrypt。
function decodePlayId(enc) {
    const step1 = decrypto(enc);
    if (!step1) return '';
    return aesDecrypt(step1);
}

// ===================== 頁面解析 =====================

// 對應 Python _parse_mvarr：mvarr['n_m'] = [[ ... ]] 內取 enc 與 play.php 底址。
function parseMvarr(html) {
    const items = [];
    if (!html) return items;
    const re = /mvarr\['(\d+_\d+)'\]\s*=\s*\[\[/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const label = m[1];
        let chunk = html.slice(m.index + m[0].length, m.index + m[0].length + 2500);
        const end = chunk.indexOf('];');
        if (end > 0) chunk = chunk.slice(0, end);
        const parts = [...chunk.matchAll(/'([^']*)'/g)].map((x) => x[1]);
        let enc = '';
        let playBase = '';
        for (const p of parts) {
            if (!enc && /^[0-9a-z]{20,}$/.test(p)) enc = p;
            if (p.includes('play.php') && p.includes('id=')) playBase = p;
        }
        if (enc && playBase) items.push([label, enc, playBase]);
    }
    return items;
}

// 對應 Python _parse_list：詳情連結 + 標題 + 封面 + 時長備註。
function parseList(html) {
    const videos = [];
    const seen = new Set();
    if (!html) return videos;
    const re = /href="((?:https?:\/\/(?:www\.)?18av01\.cc)?(\/zh\/[\w-]+_content\/\d+\/[^"]+\.html))"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const full = absUrl(m[1].startsWith('http') ? m[1] : m[2]);
        if (seen.has(full)) continue;
        seen.add(full);
        const block = html.slice(Math.max(0, m.index - 300), m.index + m[0].length + 500);
        let title = '';
        const tm = block.match(/(?:title|alt)=["']([^"']{2,200})["']/);
        if (tm) title = tm[1].trim();
        if (!title) {
            const cm = full.match(/\/([^/]+)\.html/);
            title = cm ? cm[1] : '18AV';
        }
        let pic = '';
        for (const pat of [
            /data-src=["']([^"']+)["']/,
            /src=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
        ]) {
            const pm = block.match(pat);
            if (pm && !/logo|loading|icon/i.test(pm[1])) {
                pic = absUrl(pm[1]);
                break;
            }
        }
        let tips = '';
        const dm = block.match(/(\d+\s*分)/);
        if (dm) tips = dm[1];
        videos.push({ vod_id: full, vod_name: title.slice(0, 120), vod_pic: pic, vod_remarks: tips });
    }
    return videos;
}

// 對應 Python _m3u8_from_play_page：{src, size} / size+src / 裸 m3u8 三重提取，按 size 降序。
async function m3u8FromPlayPage(playUrl, referer) {
    const html = await getText(playUrl, referer || (HOST + BASE + '/'));
    if (!html) return [];
    const urls = [];
    const seen = new Set();
    const push = (size, name, u) => {
        const a = absUrl(u);
        if (seen.has(a)) return;
        seen.add(a);
        urls.push([size, name, a]);
    };
    let re = /\{src:\s*['"]([^'"]+\.m3u8[^'"]*)['"][^}]*size:\s*(\d+)/gi;
    let m;
    while ((m = re.exec(html)) !== null) push(parseInt(m[2], 10), m[2] + 'P', m[1]);
    if (!urls.length) {
        re = /size:\s*(\d+)[^}]*src:\s*['"]([^'"]+\.m3u8[^'"]*)['"]/gi;
        while ((m = re.exec(html)) !== null) push(parseInt(m[1], 10), m[1] + 'P', m[2]);
    }
    if (!urls.length) {
        re = /(?:https?:)?\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g;
        while ((m = re.exec(html)) !== null) push(0, 'HLS', m[0]);
    }
    urls.sort((a, b) => b[0] - a[0]);
    return urls.map(([, name, u]) => [name, u]);
}

// 對應 Python _collect_resolutions：刷新 crypto -> 逐 mvarr 解密 play id -> 取各清晰度 m3u8。
async function collectResolutions(html, pageUrl) {
    const resMap = {};
    const phpList = [];
    if (!html) return [resMap, phpList];
    refreshCrypto(html);
    for (const [labelKey, encId, playBase] of parseMvarr(html)) {
        const decoded = decodePlayId(encId);
        if (!decoded) {
            console.error('[18AV] decode fail', encId.slice(0, 40));
            continue;
        }
        const playPage = absUrl(playBase + decoded);
        const reqM = playBase.match(/numresolution=(\d+)/);
        const reqName = reqM ? reqM[1] + 'P' : null;
        // Python 原版 `if play_page not in php_list` 中 php_list 是元組列表，字符串恆不在其中，故恆 append，此處保持一致。
        phpList.push([reqName || ('线路' + labelKey.split('_')[0]), playPage]);
        const m3u8s = await m3u8FromPlayPage(playPage, pageUrl);
        for (const [lab, u] of m3u8s) {
            if (!/\.m3u8(\?|$)/i.test(u)) continue;
            const key = lab !== 'HLS' ? lab : (reqName || 'HLS');
            if (!(key in resMap)) resMap[key] = u;
        }
    }
    return [resMap, phpList];
}

function resolveTid(tid) {
    const s = toStr(tid || 'chinese').trim();
    if (Object.prototype.hasOwnProperty.call(CHANNELS, s)) return s;
    if (Object.prototype.hasOwnProperty.call(NAME_TO_ID, s)) return NAME_TO_ID[s];
    return 'chinese';
}

function playHeader() {
    return {
        'User-Agent': UA,
        'Referer': HOST + '/js/player/play.php',
        'Origin': HOST,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    };
}

// ===================== 六大介面 =====================

// /init：可選 JSON 配置覆蓋 host（對應 Python init 的 extend 解析）。
async function init(inReq) {
    try {
        const body = inReq?.body;
        let conf = null;
        if (typeof body === 'string' && body.trim().startsWith('{')) {
            conf = JSON.parse(body);
        } else if (body && typeof body === 'object') {
            if (typeof body.extend === 'string' && body.extend.trim().startsWith('{')) conf = JSON.parse(body.extend);
            else if (body.extend && typeof body.extend === 'object') conf = body.extend;
            else conf = body;
        }
        if (conf && conf.host) HOST = toStr(conf.host).replace(/\/$/, '');
    } catch (e) {
        console.error('[18AV] init error:', e.message);
    }
    return {};
}

// /home：分類 + 每日推薦列表（合併 Python homeContent + homeVideoContent）。
async function home() {
    const classes = Object.entries(CHANNELS).map(([k, v]) => ({ type_id: k, type_name: v.name }));
    let list = [];
    try {
        const html = await getText(HOST + '/zh/chinese_random/all/index.html');
        list = parseList(html).slice(0, 24);
    } catch (e) {
        console.error('[18AV] home error:', e.message);
    }
    return { class: classes, filters: {}, list };
}

// /category：頻道隨機列表，分頁 index_N.html。
async function category(inReq) {
    const pg = parseInt(toStr(inReq.body?.page || 1), 10) || 1;
    const tid = resolveTid(inReq.body?.id);
    const info = CHANNELS[tid] || CHANNELS.chinese;
    let url;
    if (pg <= 1) url = HOST + info.path;
    else url = HOST + info.path.replace('index.html', `index_${pg}.html`);
    try {
        const html = await getText(url);
        const videos = parseList(html);
        const pagecount = videos.length >= 12 ? pg + 1 : pg;
        return { list: videos, page: pg, pagecount, limit: 24, total: 9999 };
    } catch (e) {
        console.error('[18AV] category error:', e.message);
        return { list: [], page: pg, pagecount: pg, limit: 24, total: 0 };
    }
}

// /detail：多清晰度 $$$ 分隔線路；解密失敗兜底 play.php，仍無則兜底詳情頁。
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const id = Array.isArray(rawId) ? rawId[0] : toStr(rawId);
    if (!id) return { list: [] };
    let pageUrl = toStr(id);
    if (!pageUrl.startsWith('http')) {
        pageUrl = HOST + (pageUrl.startsWith('/') ? pageUrl : BASE + '/' + pageUrl);
    }
    try {
        const html = await getText(pageUrl);
        if (!html) return { list: [] };
        let name = '';
        let m = html.match(/<h1[^>]*>\s*<b>([^<]+)<\/b>/i);
        if (m) name = m[1].trim();
        if (!name) {
            m = html.match(/<title>([^<]+)<\/title>/i);
            if (m) name = m[1].replace(/\s*18AV.*$/i, '').trim();
        }
        let pic = '';
        m = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i);
        if (m) pic = absUrl(m[1]);
        const [resMap, phpList] = await collectResolutions(html, pageUrl);
        const ordered = Object.keys(resMap).sort((a, b) => resNum(b) - resNum(a));
        let playFrom;
        let playUrl;
        if (ordered.length) {
            playFrom = ordered.join('$$$');
            playUrl = ordered.map((k) => `正片$${resMap[k]}`).join('$$$');
        } else if (phpList.length) {
            playFrom = phpList.map(([n]) => n).join('$$$');
            playUrl = phpList.map(([, u]) => `正片$${u}`).join('$$$');
        } else {
            playFrom = '18AV';
            playUrl = `正片$${pageUrl}`;
        }
        return {
            list: [{
                vod_id: pageUrl,
                vod_name: name || '18AV',
                vod_pic: pic,
                vod_remarks: ordered.length ? ordered[0] : '',
                vod_actor: '',
                vod_director: '',
                vod_content: '',
                vod_play_from: playFrom,
                vod_play_url: playUrl,
            }],
        };
    } catch (e) {
        console.error('[18AV] detail error:', e.message);
        return { list: [] };
    }
}

// /play：直鏈 / play.php / 詳情頁重新解碼三路。
async function play(inReq) {
    let playUrl = toStr(inReq.body?.id).trim();
    const header = playHeader();
    try {
        if (playUrl.startsWith('//')) playUrl = 'https:' + playUrl;
        if (playUrl.startsWith('http') && /\.(m3u8|mp4)(\?|$)/i.test(playUrl)) {
            return { parse: 0, jx: 0, url: playUrl, header };
        }
        if (playUrl.includes('play.php')) {
            const m3u8s = await m3u8FromPlayPage(playUrl, HOST + BASE + '/');
            if (m3u8s.length) return { parse: 0, jx: 0, url: m3u8s[0][1], header };
        }
        if (!playUrl.startsWith('http')) playUrl = absUrl(playUrl);
        if (playUrl.includes('_content/') || /\.html(\?|$)/.test(playUrl)) {
            const html = await getText(playUrl, HOST + BASE + '/');
            const [resMap, phpList] = await collectResolutions(html || '', playUrl);
            if (Object.keys(resMap).length) {
                const ordered = Object.keys(resMap).sort((a, b) => resNum(b) - resNum(a));
                return { parse: 0, jx: 0, url: resMap[ordered[0]], header };
            }
            for (const [, php] of phpList) {
                const m3u8s = await m3u8FromPlayPage(php, playUrl);
                if (m3u8s.length) return { parse: 0, jx: 0, url: m3u8s[0][1], header };
            }
        }
        return { parse: 0, jx: 0, url: '', header };
    } catch (e) {
        console.error('[18AV] play error:', e.message);
        return { parse: 0, jx: 0, url: '', header };
    }
}

// /search：/zh/search/?kw=，pg>1 追加 &page=。
async function search(inReq) {
    const pg = parseInt(toStr(inReq.body?.page || 1), 10) || 1;
    const key = toStr(inReq.body?.wd ?? inReq.body?.key).trim();
    if (!key) return { list: [], page: 1, pagecount: 1, limit: 24, total: 0 };
    let url = HOST + '/zh/search/?kw=' + pyQuote(key);
    if (pg > 1) url += `&page=${pg}`;
    try {
        const html = await getText(url);
        const videos = parseList(html);
        return {
            list: videos,
            page: pg,
            pagecount: videos.length >= 12 ? pg + 1 : pg,
            limit: 24,
            total: videos.length,
        };
    } catch (e) {
        console.error('[18AV] search error:', e.message);
        return { list: [], page: pg, pagecount: pg, limit: 24, total: 0 };
    }
}

export default {
    meta: { key: '18av', name: '18AV', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
