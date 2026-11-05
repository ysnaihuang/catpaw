// SupJav —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 supjav_2_a15i.py（tvbox python 源）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
// 註：站內頁面走代理 /fs 過 Cloudflare 盾（clearance 快速通道 + FlareSolverr 兜底）；
// 播放鏈：詳情 data-link(hex) → supjav.php?l= → OLID 反轉 → supjav.php?c= → 各線路抽流。
import req from '../../util/req.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const HOST = 'https://supjav.com';
const PROXY_BASE = 'https://py.fzcrym.link:1314';
const FS_PAGE_API = PROXY_BASE + '/fs?u=';
const PAGE_API = PROXY_BASE + '/page?u=';
const STREAM_API = PROXY_BASE + '/stream?u=';
const SJ_HLS_API = PROXY_BASE + '/sj_hls?u=';
const SJ_IMG_API = PROXY_BASE + '/sj_img?u=';
const LK_BASE = 'https://lk1.supremejav.com/supjav.php';

// 分類嚴格對齊站點導航欄
const CATS = [
    ['__home', '最新'],
    ['__popular', '热门'],
    ['censored-jav', '有码 Censored'],
    ['uncensored-jav', '无码 Uncensored'],
    ['amateur', '素人 Amateur'],
    ['chinese-subtitles', '中文字幕 Chn Sub'],
    ['reducing-mosaic', '破解 Reducing Mosaic'],
    ['english-subtitles', '英文字幕 Eng Sub'],
];

// 線路排序（數字越小越靠前）：VOE 第一，TV 最後
const LINE_ORDER = { VOE: 0, FST: 10, ST: 20, TV: 90 };

const toStr = (v) => (v == null ? '' : String(v));
const trim = (s) => toStr(s).replace(/^\s+|\s+$/g, '');

// ===================== 網絡層 =====================
async function httpGet(url, timeout) {
    try {
        const resp = await req.get(url, {
            headers: { 'User-Agent': UA },
            timeout: timeout || 60000,
            validateStatus: () => true,
        });
        if ((resp.status ?? 0) !== 200) return '';
        const data = resp.data;
        return typeof data === 'string' ? data : toStr(data);
    } catch {
        return '';
    }
}

// 站內頁面：走代理 /fs（clearance 快速通道 + FlareSolverr 兜底）
async function fetchPage(url, retries) {
    const n = Math.max(1, retries == null ? 2 : retries);
    for (let i = 0; i < n; i++) {
        const html = await httpGet(FS_PAGE_API + encodeURIComponent(url), 220000);
        if (html && !html.includes('Just a moment') && html.length > 3000) return html;
    }
    const html2 = await httpGet(PAGE_API + encodeURIComponent(url), 90000);
    if (html2 && !html2.includes('Just a moment') && html2.length > 3000) return html2;
    return '';
}

// 第三方跳轉頁：走代理並帶 Referer
async function fetchStream(url, referer, timeout) {
    let api = STREAM_API + encodeURIComponent(url);
    if (referer) api += '&r=' + encodeURIComponent(referer);
    return httpGet(api, timeout || 90000);
}

// 播放地址解析緩存：三跳解析每次 3~6s，token 有效期遠大於 90s
const PLAY_CACHE = new Map();
const PLAY_TTL = 90;

function playCacheGet(key) {
    const v = PLAY_CACHE.get(key);
    if (!v) return null;
    if (Date.now() / 1000 - v.ts > PLAY_TTL) {
        PLAY_CACHE.delete(key);
        return null;
    }
    return v.val;
}

function playCachePut(key, val) {
    PLAY_CACHE.set(key, { ts: Date.now() / 1000, val });
    if (PLAY_CACHE.size > 60) {
        const sorted = [...PLAY_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (const [k] of sorted.slice(0, 20)) PLAY_CACHE.delete(k);
    }
}

// ===================== 解析層 =====================

// 列表卡片：<div class="post"> 塊 → 去重列表
function parseCards(html) {
    const out = [];
    const seen = new Set();
    if (!html) return out;
    const hostRe = HOST.replace(/\./g, '\\.');
    const blocks = toStr(html).split('<div class="post">').slice(1);
    for (const b of blocks) {
        const m = new RegExp('href="' + hostRe + '/(\\d+)\\.html"').exec(b);
        if (!m) continue;
        const vid = m[1];
        if (seen.has(vid)) continue;

        const t = /title="([^"]+)"/.exec(b);
        let title = t ? t[1] : '';
        title = title.replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;/g, '-').trim();
        if (!title) continue;
        seen.add(vid);

        // 站點用 lazy-load：真實地址在 data-original，src 是 data: 佔位符
        let pic = '';
        for (const pat of [/<img[^>]+data-original="([^"]+)"/, /<img[^>]+data-src="([^"]+)"/, /<img[^>]+src="(https?:\/\/[^"]+)"/]) {
            const pm = pat.exec(b);
            if (pm) {
                pic = pm[1];
                break;
            }
        }
        if (pic.startsWith('//')) pic = 'https:' + pic;
        // img.supjav.com 有 UA 門檻 → 統一走代理補 header
        if (/^https?:\/\//i.test(pic)) pic = SJ_IMG_API + encodeURIComponent(pic);

        // 番號：標題裡的 ABC-123 / FC2PPV 1234567
        let code = '';
        const cm = /\b([A-Z]{2,6}-?\d{2,6}|FC2PPV[\s-]?\d{5,8})\b/.exec(title);
        if (cm) code = cm[1];

        out.push({ vod_id: vid, vod_name: title.slice(0, 90), vod_pic: pic, vod_remarks: code });
    }
    return out;
}

function pageCount(html, cur) {
    const nums = [...toStr(html).matchAll(/\/page\/(\d+)/g)].map((m) => parseInt(m[1], 10));
    if (!nums.length) return cur;
    const mx = Math.max(...nums);
    return mx > 0 && mx <= 5000 ? mx : cur;
}

// 對應 Python unicode_escape：解 \x41 \u0041 \n \r \t 等轉義
function unicodeEscape(s) {
    return s.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|([nrt0\\'"]))/g, (m, x, u, c) => {
        if (x) return String.fromCharCode(parseInt(x, 16));
        if (u) return String.fromCharCode(parseInt(u, 16));
        switch (c) {
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case '0': return '\0';
            case '\\': return '\\';
            case "'": return "'";
            case '"': return '"';
            default: return m;
        }
    });
}

// 對應 Python _unpack：Dean Edwards packer 解包
function unpackPacker(text) {
    const m = /\}\('([\s\S]*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/.exec(toStr(text));
    if (!m) return '';
    let payload = m[1];
    const base = parseInt(m[2], 10);
    const count = parseInt(m[3], 10);
    const keys = m[4].split('|');
    try {
        payload = unicodeEscape(payload);
    } catch {
        // 保留原始 payload
    }
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
    const enc = (num) => {
        let out = '';
        while (num > 0) {
            out = digits[num % base] + out;
            num = Math.floor(num / base);
        }
        return out || '0';
    };
    const table = {};
    for (let i = 0; i < count; i++) {
        if (i < keys.length && keys[i]) table[enc(i)] = keys[i];
    }
    return payload.replace(/\b\w+\b/g, (w) => (Object.prototype.hasOwnProperty.call(table, w) ? table[w] : w));
}

function rot13(s) {
    return s.replace(/[a-zA-Z]/g, (c) => {
        const code = c.charCodeAt(0);
        const base = code < 97 ? 65 : 97;
        return String.fromCharCode(((code - base + 13) % 26) + base);
    });
}

function b64DecodeUtf8(x) {
    const clean = toStr(x).replace(/[^A-Za-z0-9+/=]/g, '');
    const padded = clean + '='.repeat(((-clean.length % 4) + 4) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
}

// 對應 Python _voe_decode：VOE 系六層混淆解包
// 哨兵串 → rot13 → base64 → 每字符 -3 → 反轉 → base64 → JSON
function voeDecode(html) {
    const m = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/.exec(toStr(html));
    if (!m) return {};
    const blk = m[1].trim();
    let raw;
    try {
        const j = JSON.parse(blk);
        raw = Array.isArray(j) && j.length ? j[0] : blk;
    } catch {
        raw = blk;
    }

    let s = toStr(raw);
    for (const k of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) s = s.split(k).join('');

    try {
        let t = b64DecodeUtf8(rot13(s));
        t = [...t].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join('');
        t = b64DecodeUtf8([...t].reverse().join(''));
        const cfg = JSON.parse(t);
        return cfg && typeof cfg === 'object' ? cfg : {};
    } catch {
        return {};
    }
}

// 從 step2 頁面抽取播放地址。返回 [m3u8, direct_mp4]
async function extractStream(s2, ref) {
    const text = toStr(s2);

    // 1) 明文 m3u8（TV 線路 turboviplay）
    let hits = [...text.matchAll(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g)].map((m) => m[0]);
    if (hits.length) return [hits[0], ''];

    // 2) packer 解包（FST 線路 premilkyway）
    if (text.includes('eval(function(p,a,c,k,e')) {
        const dec = unpackPacker(text);
        hits = [...dec.matchAll(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g)].map((m) => m[0]);
        if (hits.length) return [hits[0], ''];
    }

    // 3) Streamtape：/e/<id> → robotlink 拼 get_video
    const em = /https?:\/\/streamtape\.com\/e\/([A-Za-z0-9]+)/.exec(text);
    if (em) {
        const eurl = `https://streamtape.com/e/${em[1]}/`;
        const page = await fetchStream(eurl, HOST + '/');
        const pats = [
            /innerHTML\s*=\s*'([^']+)'\s*\+\s*\('([^']+)'\)\.substring\((\d+)\)/,
            /innerHTML\s*=\s*"([^"]+)"\s*\+\s*\("([^"]+)"\)\.substring\((\d+)\)/,
        ];
        for (const pat of pats) {
            const mm = pat.exec(toStr(page));
            if (!mm) continue;
            let link = mm[1] + mm[2].substring(parseInt(mm[3], 10));
            if (link.startsWith('//')) link = 'https:' + link;
            if (!link.includes('dl=')) link += link.includes('?') ? '&dl=1' : '?dl=1';
            return ['', link];
        }
    }

    // 4) VOE 系：二跳後解混淆 JSON
    const tgt = [...text.matchAll(/window\.location\.href\s*=\s*'([^']+)'/g)].map((m) => m[1])
        .concat([...text.matchAll(/https?:\/\/[a-z0-9.-]+\/e\/[a-z0-9]{8,}/g)].map((m) => m[0]));
    if (tgt.length) {
        const page = await fetchStream(tgt[0], ref);
        const cfg = voeDecode(page);
        const src = toStr(cfg.source || '');
        if (src.includes('.m3u8')) return [src, ''];
        const dau = toStr(cfg.direct_access_url || '');
        if (/^https?:\/\//i.test(dau)) return ['', dau];
        if (/^https?:\/\//i.test(src)) return ['', src];
    }

    return ['', ''];
}

// ===================== 六大介面 =====================

// /home：分類 + 篩選器；推薦列表取首頁（對應 Python homeVideoContent）
async function home() {
    const classes = CATS.map(([cid, cname]) => ({ type_id: cid, type_name: cname }));
    // 只有真實 /category/ 分類支持 ?sort=views，首頁/熱門不支持
    const filters = {};
    for (const [cid] of CATS) {
        if (!cid.startsWith('__')) {
            filters[cid] = [{ key: 'sort', name: '排序', value: [{ n: '最新', v: '' }, { n: '最多观看', v: 'views' }] }];
        }
    }
    let list = [];
    try {
        const html = await fetchPage(HOST + '/');
        list = parseCards(html);
    } catch (e) {
        console.error('[supjav] home list error:', e.message);
    }
    return { class: classes, filters, list };
}

// /category
async function category(inReq) {
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = Math.max(1, parseInt(pg, 10) || 1);
    const tid = trim(inReq.body?.id);
    const extend = inReq.body?.filters && typeof inReq.body.filters === 'object' ? inReq.body.filters : {};
    const sortRaw = extend.sort;
    const sortStr = toStr(Array.isArray(sortRaw) ? sortRaw[0] : sortRaw).trim();
    try {
        let url;
        // 站點導航裡的 Home / Popular 不是 /category/ 路徑
        if (tid === '__home') {
            url = pg === 1 ? HOST + '/' : `${HOST}/page/${pg}/`;
        } else if (tid === '__popular') {
            url = pg === 1 ? HOST + '/popular/' : `${HOST}/popular/page/${pg}/`;
        } else {
            const base = `${HOST}/category/${tid}`;
            // 尾斜杠形式更穩（無斜杠更容易觸發 CF challenge）
            url = pg === 1 ? base + '/' : `${base}/page/${pg}/`;
            if (sortStr) url += '?sort=' + encodeURIComponent(sortStr);
        }

        let html = await fetchPage(url);
        let items = parseCards(html);
        if (!items.length) {
            // CF 間歇攔截兜底：再試兩輪
            for (let i = 0; i < 2; i++) {
                html = await fetchPage(url, 2);
                items = parseCards(html);
                if (items.length) break;
            }
        }
        return { page: pg, pagecount: pageCount(html, pg), limit: items.length || 24, total: items.length, list: items };
    } catch (e) {
        console.error('[supjav] category error:', e.message);
        return { page: pg, pagecount: pg, limit: 0, total: 0, list: [] };
    }
}

// /search
async function search(inReq) {
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = Math.max(1, parseInt(pg, 10) || 1);
    const key = toStr(inReq.body?.wd ?? inReq.body?.key);
    try {
        const kw = encodeURIComponent(key);
        const url = pg === 1 ? `${HOST}/?s=${kw}` : `${HOST}/page/${pg}/?s=${kw}`;
        let html = await fetchPage(url);
        let items = parseCards(html);
        if (!items.length) {
            for (let i = 0; i < 2; i++) {
                html = await fetchPage(url, 2);
                items = parseCards(html);
                if (items.length) break;
            }
        }
        return { page: pg, pagecount: pageCount(html, pg), limit: items.length || 24, total: items.length, list: items };
    } catch (e) {
        console.error('[supjav] search error:', e.message);
        return { page: pg, pagecount: pg, limit: 0, total: 0, list: [] };
    }
}

// /detail：標題 / 封面 / 標籤 / data-link 線路（VOE 優先，TV 墊底）
async function detail(inReq) {
    const rawId = inReq.body?.id;
    let vid = Array.isArray(rawId) ? String(rawId[0] || '') : toStr(rawId);
    try {
        const seg = vid.split('/').pop().replace('.html', '');
        const digits = seg.replace(/\D/g, '');
        vid = digits || vid;

        const durl = `${HOST}/${vid}.html`;
        const html = await fetchPage(durl);

        let title = '';
        const tm = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
        if (tm) {
            title = tm[1].replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8211;/g, '-').trim();
        }

        let pic = '';
        const pm = /background-image:\s*url\((https:\/\/img\.supjav\.com\/[^)]+)\)/.exec(html);
        if (pm) pic = pm[1];
        if (!pic) {
            const im = /(https:\/\/img\.supjav\.com\/[^\s"'<>)]+\.(?:jpg|jpeg|png|webp)[^\s"'<>)]*)/i.exec(html);
            if (im) pic = im[1];
        }
        if (pic.startsWith('//')) pic = 'https:' + pic;
        if (/^https?:\/\//i.test(pic)) pic = SJ_IMG_API + encodeURIComponent(pic);

        let views = '';
        const vm = /<span class="views">([^<]+)<\/span>/.exec(html);
        if (vm) views = vm[1].trim();

        // 標籤 / 演員
        const tags = [];
        const tagRe = new RegExp('href="' + HOST.replace(/\./g, '\\.') + '/(tag|actress)/([^"/]+)', 'g');
        let tagM;
        while ((tagM = tagRe.exec(html)) !== null) {
            const s = tagM[2].replace(/-/g, ' ').trim();
            if (s && !tags.includes(s)) tags.push(s);
        }
        let year = '';
        const ym = /\/images\/(\d{4})\//.exec(html);
        if (ym) year = ym[1];

        // 線路：data-link
        const links = [...html.matchAll(/data-link="([0-9a-f]{40,})"/g)].map((m) => m[1]);
        const names = [...html.matchAll(/data-link="[0-9a-f]{40,}"[^>]*>([^<]{1,12})</g)].map((m) => m[1]);
        const pairs = links.map((lk, i) => [
            names[i] ? names[i].trim() : `线路${i + 1}`,
            `正片$${vid}|${lk}`,
        ]);
        const rank = (nm) => (Object.prototype.hasOwnProperty.call(LINE_ORDER, toStr(nm).trim().toUpperCase())
            ? LINE_ORDER[toStr(nm).trim().toUpperCase()] : 50);
        pairs.sort((a, b) => rank(a[0]) - rank(b[0]));

        let content = title;
        if (tags.length) content += '\n标签: ' + tags.slice(0, 10).join(', ');

        return {
            list: [{
                vod_id: vid,
                vod_name: title || 'SupJav ' + vid,
                vod_pic: pic,
                vod_year: year,
                vod_remarks: views,
                vod_content: content.slice(0, 600),
                vod_play_from: pairs.length ? pairs.map((p) => p[0]).join('$$$') : 'SupJav',
                vod_play_url: pairs.length ? pairs.map((p) => p[1]).join('$$$') : `正片$${vid}|`,
            }],
        };
    } catch (e) {
        console.error('[supjav] detail error:', e.message);
        return { list: [] };
    }
}

// /play：三跳解析（?l= → OLID 反轉 → ?c= → 抽流）
async function play(inReq) {
    const raw = toStr(inReq.body?.id);
    const fail = { parse: 0, playUrl: '', url: '', jx: 0 };
    try {
        const sepIdx = raw.indexOf('|');
        let vid = sepIdx >= 0 ? raw.slice(0, sepIdx) : raw;
        const lk = sepIdx >= 0 ? raw.slice(sepIdx + 1) : '';
        vid = vid.replace(/\D/g, '') || vid;
        const detailUrl = `${HOST}/${vid}.html`;
        if (!lk) return fail;

        // 命中解析緩存直接返回
        const cached = playCacheGet(lk);
        if (cached) return cached;

        // step1：supjav.php?l=<hex>（Referer=詳情頁）→ 頁內 OLID 反轉
        const s1Url = `${LK_BASE}?l=${lk}`;
        const s1 = await fetchStream(s1Url, detailUrl);
        let olid = '';
        const om = /var\s+OLID\s*=\s*'([0-9a-f]{40,})'/.exec(toStr(s1));
        if (om) olid = [...om[1]].reverse().join('');
        else olid = [...lk].reverse().join(''); // 兜底：JS 邏輯固定為反轉 data-link

        // step2：supjav.php?c=<reversed>（Referer=step1）→ 各家播放頁
        const s2 = await fetchStream(`${LK_BASE}?c=${olid}`, s1Url);
        if (!s2) return fail;

        const [m3u8, direct] = await extractStream(s2, s1Url);
        if (!m3u8 && !direct) return fail;

        if (direct) {
            // Streamtape / VOE mp4 直鏈：get_video 不綁 IP，由播放器自己跟 302
            const res = {
                parse: 0, playUrl: '', url: direct, jx: 0,
                header: { 'User-Agent': UA, Referer: HOST + '/' },
            };
            playCachePut(lk, res);
            return res;
        }

        const cleanM3u8 = m3u8.replace(/\\\//g, '/').replace(/&amp;/g, '&');
        const low = cleanM3u8.toLowerCase();
        // turbosplayer（TV）：分片偽裝 PNG → 走 /sj_hls 拍平剝頭；其餘走 /stream 轉流
        const playUrl = (low.includes('turbosplayer') || low.includes('turboviplay'))
            ? SJ_HLS_API + encodeURIComponent(cleanM3u8)
            : STREAM_API + encodeURIComponent(cleanM3u8);
        const res = { parse: 0, playUrl: '', url: playUrl, jx: 0, header: { 'User-Agent': UA } };
        playCachePut(lk, res);
        return res;
    } catch (e) {
        console.error('[supjav] play error:', e.message);
        return fail;
    }
}

export default {
    meta: { key: 'supjav', name: 'SupJav', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', async () => ({}));
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
