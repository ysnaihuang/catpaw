// 柳州丈母 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 upload-2.py（tvbox python 源）移植，格式對齊 __4K_5_791a.js（新模板）。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
import req from '../../util/req.js';

const HOST = 'https://913453.lzzmn101.top';
const BASE = HOST + '/lzzmn';
const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const HEADERS = {
    'User-Agent': UA,
    Referer: BASE + '/',
    'Accept-Encoding': 'gzip, deflate',
    Connection: 'close',
};

// ===================== 工具 =====================
const toStr = (v) => (v == null ? '' : String(v));
const trim = (s) => toStr(s).replace(/^\s+|\s+$/g, '');

function htmlUnescape(s) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return trim(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, ent) => {
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

// 對應 Python _get：帶 3 次重試的文本請求
async function fetchText(url) {
    for (let i = 0; i < 3; i++) {
        try {
            const resp = await req.get(url, {
                headers: HEADERS,
                timeout: 12000,
                validateStatus: () => true,
            });
            if (resp.status < 200 || resp.status >= 400) continue;
            const data = resp.data;
            const text = typeof data === 'string' ? data : toStr(data);
            if (text) return text;
        } catch {
            // 重試
        }
    }
    return '';
}

function absUrl(u) {
    if (!u) return '';
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/')) return HOST + u;
    return BASE + '/' + u;
}

// 對應 Python _pick_pic：按 data-original / data-src / src 優先級取圖，過濾占位圖
function pickPic(block) {
    for (const attr of ['data-original', 'data-src', 'src']) {
        const m = new RegExp('<img[^>]*?\\b' + attr + '=["\']([^"\']+)["\']').exec(block);
        if (m) {
            const u = m[1].trim();
            if (!u || u.includes('data:image')) continue;
            const low = u.toLowerCase();
            if (['loading', 'load.svg', 'placeholder', 'blank'].some((k) => low.includes(k))) continue;
            return absUrl(u);
        }
    }
    return '';
}

// 新模板：圖片直接透傳，不再走宿主 /imageProxy
function directPic(rawUrl) {
    let pic = trim(rawUrl);
    if (!pic) return '';
    if (pic.startsWith('//')) pic = 'https:' + pic;
    return pic;
}

// ===================== 列表解析 =====================
// 對應 Python _cards
function parseCards(h) {
    const lst = [];
    const seen = new Set();
    if (!h) return lst;
    for (const m of h.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
        const block = m[1];
        const um = /href=["'](\/lzzmn\/index\.php\/vod\/detail\/id\/(\d+)\.html)["']/.exec(block);
        if (!um) continue;
        const vid = um[2];
        if (seen.has(vid)) continue;
        seen.add(vid);

        const nm = /<h5><a[^>]*>([^<]+)<\/a><\/h5>/.exec(block);
        const name = nm ? htmlUnescape(nm[1].trim()) : '';
        if (!name) continue;

        lst.push({
            vod_id: vid,
            vod_name: name,
            vod_pic: directPic(pickPic(block)),
            vod_remarks: '蝴蝶影视 | 高清',
            style: { type: 'rect', ratio: 1.78 },
        });
    }
    return lst;
}

// ===================== 播放地址提取 =====================
// 對應 Python _parse_player_json：按變量名做花括號配平提取 JSON
function parsePlayerJson(h, varname) {
    const idx = h.indexOf(`var ${varname}=`);
    if (idx < 0) return null;
    const seg = h.slice(idx, idx + 12000);
    const start = seg.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < seg.length; i++) {
        const c = seg[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(seg.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}

// 對應 Python _decode_url：encrypt 1=unquote，2=base64(unquote)
function decodePlayUrl(url, encrypt) {
    if (!url) return '';
    try {
        const e = Number(encrypt) || 0;
        if (e === 1) return decodeURIComponent(url);
        if (e === 2) return decodeURIComponent(Buffer.from(decodeURIComponent(url), 'base64').toString('utf8'));
    } catch {
        // ignore
    }
    return url;
}

function extractPlayUrl(h) {
    for (const varname of ['player_aaaa', 'player_data']) {
        const data = parsePlayerJson(h, varname);
        if (data && data.url) {
            const u = decodePlayUrl(data.url, data.encrypt || 0);
            if (u) return u;
        }
    }

    let m = /MacPlayer\.PlayUrl\s*=\s*["']([^"']+)["']/.exec(h);
    if (m && m[1].trim()) return m[1].trim();

    m = /<iframe[^>]+src=["']([^"']+)["']/i.exec(h);
    if (m) return m[1];

    const reUrl = /"url"\s*:\s*"([^"]+)"/g;
    while ((m = reUrl.exec(h)) !== null) {
        const u = m[1].replace(/\\\//g, '/').replace(/\\/g, '');
        if (/\.(?:m3u8|mp4)(\?|$)/.test(u) && u.startsWith('http')) return u;
    }
    return '';
}

// ===================== 六大介面 =====================

// /init
async function init() {
    return {};
}

// /home：解析 category-subs 分類
async function home() {
    try {
        const h = await fetchText(BASE + '/');
        const cats = [];
        const seen = new Set();
        for (const m of h.matchAll(/<div class="category-subs">([\s\S]*?)<\/div>/g)) {
            for (const cm of m[1].matchAll(/href="\/lzzmn\/index\.php\/vod\/type\/id\/(\d+)\.html"[^>]*>([^<]+)<\/a>/g)) {
                const cid = cm[1];
                const name = cm[2].trim();
                if (seen.has(cid) || !name) continue;
                seen.add(cid);
                cats.push({ type_id: cid, type_name: htmlUnescape(name) });
            }
        }
        return { class: cats, filters: {}, list: [] };
    } catch (e) {
        console.error('[lzzm] home error:', e.message);
        return { class: [], filters: {}, list: [] };
    }
}

// /category
async function category(inReq) {
    const tid = toStr(inReq.body?.id);
    const pgRaw = inReq.body?.page;
    const pageNum = /^\d+$/.test(String(pgRaw)) ? parseInt(String(pgRaw), 10) : 1;
    try {
        const url =
            pageNum <= 1
                ? `${BASE}/index.php/vod/type/id/${tid}.html`
                : `${BASE}/index.php/vod/type/id/${tid}/page/${pageNum}.html`;
        const h = await fetchText(url);
        const lst = parseCards(h);
        return {
            list: lst,
            page: pageNum,
            pagecount: lst.length >= 12 ? pageNum + 1 : pageNum,
            limit: 20,
            total: 9999,
        };
    } catch (e) {
        console.error('[lzzm] category error:', e.message);
        return { list: [], page: 1, pagecount: 1, limit: 20, total: 0 };
    }
}

// /detail：標題 / 封面 / 劇集列表
async function detail(inReq) {
    try {
        const raw = inReq.body?.id;
        const vid = Array.isArray(raw) ? toStr(raw[0]) : toStr(raw);
        if (!vid) return { list: [] };

        const h = await fetchText(`${BASE}/index.php/vod/detail/id/${vid}.html`);

        let name = '';
        const t = /<title>([^<]+)<\/title>/.exec(h);
        if (t) name = htmlUnescape(t[1].split('在线播放')[0].split('-')[0].trim());

        const plays = [];
        for (const m of h.matchAll(
            /href=["'](\/lzzmn\/index\.php\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)["'][^>]*>([^<]{1,15})<\/a>/g
        )) {
            const u = m[1];
            const n = htmlUnescape(m[2].trim());
            if (!n || !u) continue;
            // 排除縮略圖區域的鏈接（對應 Python 的 thumbnail 判斷）
            const idx = h.indexOf(u);
            const before = idx >= 0 ? h.slice(Math.max(0, idx - 200), idx) : '';
            if (before.includes('thumbnail')) continue;
            plays.push(`${n}$${absUrl(u)}`);
        }
        const seenUrl = new Set();
        const uniqPlays = [];
        for (const p of plays) {
            const u = p.split('$', 2)[1];
            if (!seenUrl.has(u)) {
                seenUrl.add(u);
                uniqPlays.push(p);
            }
        }

        return {
            list: [
                {
                    vod_id: vid,
                    vod_name: name,
                    vod_pic: directPic(pickPic(h)),
                    type_name: '蝴蝶专区',
                    vod_year: '2026',
                    vod_area: '华语',
                    vod_remarks: '蝴蝶影视 | 高清原画',
                    vod_actor: '🦋 TG群: @tvshare23',
                    vod_director: '🦋 蝴蝶影视',
                    vod_content: '🦋 蝴蝶影视 | TG群: @tvshare23\n蝴蝶影视官方正版资源，关注TG群获取最新动态与防失联地址。',
                    vod_play_from: '蝴蝶秒播云',
                    vod_play_url: uniqPlays.length
                        ? uniqPlays.join('#')
                        : `正片$${BASE}/index.php/vod/play/id/${vid}/sid/1/nid/1.html`,
                },
            ],
        };
    } catch (e) {
        console.error('[lzzm] detail error:', e.message);
        return { list: [] };
    }
}

// /search
async function search(inReq) {
    try {
        const key = trim(inReq.body?.wd ?? inReq.body?.key);
        if (!key) return { list: [] };
        const url = `${BASE}/index.php/vod/search/wd/${encodeURIComponent(key)}.html`;
        const h = await fetchText(url);
        return { list: parseCards(h) };
    } catch (e) {
        console.error('[lzzm] search error:', e.message);
        return { list: [] };
    }
}

// /play：抓播放頁提取真實地址（player JSON / MacPlayer / iframe / "url"）；
// 非 m3u8/mp4 時二次抓取找 m3u8（對應 Python playerContent）
async function play(inReq) {
    const rawId = toStr(inReq.body?.id);
    try {
        const h = await fetchText(rawId);
        let url = extractPlayUrl(h);
        if (!url) return { parse: 1, url: rawId };

        if (url.startsWith('/')) url = absUrl(url);

        if (!/\.(?:m3u8|mp4)(\?|$)/i.test(url)) {
            const shareH = await fetchText(url);
            if (shareH) {
                let dpM = /url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i.exec(shareH);
                if (!dpM) dpM = /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(shareH);
                if (dpM) url = dpM[1].replace(/\\\//g, '/');
            }
        }

        return {
            parse: 0,
            url,
            header: { 'User-Agent': 'Mozilla/5.0', Referer: rawId },
        };
    } catch (e) {
        console.error('[lzzm] play error:', e.message);
        return { parse: 1, url: rawId };
    }
}

export default {
    meta: { key: 'lzzm', name: '柳州丈母', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
