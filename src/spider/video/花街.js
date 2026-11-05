// 花街影院 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 upload-4.py（tvbox python 源，https://jx2huajy55.a6.yachts）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
//
// 擴展路由（模板六接口之外，原 localProxy 的功能）：
//   GET /huajie_img?url=<加密圖地址> —— 對站內 XOR 加密封面做 base64+XOR 解密後返回圖片。
//   加密圖判斷：域名在 ENC_DOMAINS 或後綴 .txt（對應 Python _is_enc_pic）。
//   僅當宿主實際 serve 此源註冊的路由時可用；不可用时封面返回原地址（可能無法顯示）。
import req from '../../util/req.js';

let SITE_URL = 'https://jx2huajy55.a6.yachts';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Connection: 'keep-alive',
};

// 圖片 XOR 密鑰（對應 Python _img_key）
const IMG_KEY = Buffer.from('OzoTeoS7D>6Y^@z39JmD', 'utf8');
const ENC_DOMAINS = [
    'cdn.bcebos.com', 'vfile.meituan.net', 'huaweicloudobs.ahjxjy.cn',
    'file.zhuyitai.com', 'oss.zhuyitai.com', 'ucloudqn.unipus.cn',
];

const toStr = (v) => (v == null ? '' : String(v));

function cleanText(text) {
    if (!text) return '';
    return htmlUnescape(text).replace(/<[^>]+>/g, '').trim();
}

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

function absUrl(url) {
    if (!url) return '';
    url = url.trim();
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('//')) return 'https:' + url;
    try {
        return new URL(url, SITE_URL).href;
    } catch {
        return url;
    }
}

function isEncPic(url) {
    const u = (url || '').toLowerCase();
    return ENC_DOMAINS.some((d) => u.includes(d)) || u.endsWith('.txt');
}

// 從請求頭推導本機 base（供圖片代理地址使用）
function hostBaseOf(inReq) {
    const headers = (inReq && inReq.headers) || {};
    const proto = headers['x-forwarded-proto'] || 'http';
    const host = headers['x-forwarded-host'] || headers.host || '127.0.0.1';
    return `${proto}://${host}`;
}

function proxyPicUrl(picUrl, inReq) {
    const url = absUrl(picUrl);
    if (!url) return '';
    if (!isEncPic(url)) return url;
    return `${hostBaseOf(inReq)}/huajie_img?url=${encodeURIComponent(url)}`;
}

async function fetchText(url, referer) {
    const headers = { ...HEADERS };
    if (referer) headers.Referer = referer;
    for (let i = 0; i < 2; i++) {
        try {
            const resp = await req.get(url, { headers, timeout: 10000, validateStatus: () => true });
            const data = resp.data;
            const html = typeof data === 'string' ? data : toStr(data);
            if ((resp.status ?? 0) === 200 && html) return html;
            if (html) return html;
        } catch {
            // 重試
        }
    }
    return '';
}

// ===================== 頁面解碼（對應 Python _decode_page） =====================
// var str = '...' 雙層 base64，解出長度 > 1000 才採用
function decodePage(htmlData) {
    if (!htmlData) return '';
    const m = /var str = '([^']+)'/.exec(htmlData);
    if (!m) return htmlData;
    try {
        const d1 = Buffer.from(m[1], 'base64').toString('utf8');
        const d2 = Buffer.from(d1.trim(), 'base64').toString('utf8');
        return d2.length > 1000 ? d2 : htmlData;
    } catch {
        return htmlData;
    }
}

async function fetchHtml(url, mustContain, referer) {
    let htmlData = '';
    for (let i = 0; i < 2; i++) {
        const raw = await fetchText(url, referer);
        htmlData = decodePage(raw);
        if (raw && (!mustContain || htmlData.includes(mustContain))) return htmlData;
    }
    return htmlData;
}

// ===================== 封面提取（對應 Python _extract_cover） =====================
function extractCover(inner, inReq) {
    if (!inner) return '';
    const cands = [];
    for (const im of inner.matchAll(/<img[^>]+>/gi)) {
        const tag = im[0];
        for (const attr of ['data-original', 'data-src', 'data-lazy-src', 'data-echo', 'srcset', 'src']) {
            const am = new RegExp(attr + '\\s*=\\s*["\']([^"\']+)["\']', 'i').exec(tag);
            if (!am) continue;
            const cand = am[1].trim().split(/\s+/)[0];
            if (!cand || cand.startsWith('data:')) continue;
            const low = cand.toLowerCase();
            if (['loading.gif', 'placeholder', 'blank.', 'pixel.', 'spinner', 'faiusr.com'].some((k) => low.includes(k))) continue;
            cands.push(cand);
        }
    }
    for (const cand of cands) {
        if (isEncPic(cand)) return proxyPicUrl(cand, inReq);
    }
    for (const cand of cands) {
        const low = cand.toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.txt'].some((ext) => low.endsWith(ext) || low.includes(ext))) {
            return isEncPic(cand) ? proxyPicUrl(cand, inReq) : absUrl(cand);
        }
    }
    return cands.length ? proxyPicUrl(cands[0], inReq) : '';
}

// ===================== 列表解析（對應 Python _parse_vod_list） =====================
function parseVodList(htmlData, inReq) {
    const cards = [];
    const seen = new Set();
    if (!htmlData) return cards;
    for (const m of htmlData.matchAll(/<li[^>]*class="[^"]*content-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
        const inner = m[1];
        const am = /href="(\/index\.php\/vod\/detail\/id\/(\d+)\.html)"/.exec(inner);
        if (!am) continue;
        const vid = am[2];
        if (seen.has(vid)) continue;
        seen.add(vid);

        let title = '';
        const tm = /title="([^"]{2,120})"/.exec(inner);
        if (tm) title = tm[1].trim();
        title = cleanText(title);
        if (!title) continue;

        const pic = extractCover(inner, inReq);
        const rmMatch = /<span[^>]+class=['"][^'"]*remarks[^'"]*['"][^>]*>([^<]+)<\/span>/i.exec(inner);
        const rawRm = rmMatch ? rmMatch[1].trim() : '';
        const remarks = rawRm ? `蝴蝶影视 | ${rawRm}` : '蝴蝶影视';

        cards.push({ vod_id: vid, vod_name: title, vod_pic: pic, vod_remarks: remarks, style: { type: 'rect', ratio: 1.78 } });
    }
    if (!cards.length) {
        for (const m of htmlData.matchAll(/href="(\/index\.php\/vod\/detail\/id\/(\d+)\.html)"[^>]*title="([^"]{2,120})"/g)) {
            const vid = m[2];
            if (seen.has(vid)) continue;
            seen.add(vid);
            const seg = htmlData.slice(Math.max(0, m.index - 500), m.index + 1500);
            cards.push({
                vod_id: vid,
                vod_name: cleanText(m[3]),
                vod_pic: extractCover(seg, inReq),
                vod_remarks: '蝴蝶影视',
                style: { type: 'rect', ratio: 1.78 },
            });
        }
    }
    return cards;
}

// ===================== 播放地址提取（對應 Python _extract_play_url） =====================
function isSample(url) {
    const low = (url || '').toLowerCase();
    return ['sample', 'test', 'preview', 'trailer', 'advert'].some((k) => low.includes(k));
}

function isVideoFormat(url) {
    const u = (url || '').toLowerCase();
    return u.endsWith('.m3u8') || u.includes('.m3u8?');
}

function extractPlayUrl(htmlData) {
    if (!htmlData) return '';
    let m = /var player_aaaa\s*=\s*(\{.*?\})\s*<\/script>/s.exec(htmlData)
        || /var player_aaaa\s*=\s*(\{.*?\});/s.exec(htmlData);
    if (m) {
        try {
            const um = /"url"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(m[1]);
            if (um) {
                const url = um[1].replace(/\\\//g, '/').trim();
                if (url && isVideoFormat(url) && !isSample(url)) return url;
            }
        } catch {
            // 忽略
        }
    }
    for (const pat of [/"(https?:\/\/[^"]+\.m3u8[^"]*)"/gi, /'(https?:\/\/[^']+\.m3u8[^']*)'/gi]) {
        for (const mm of htmlData.matchAll(pat)) {
            const u = mm[1].replace(/\\\//g, '/');
            if (isVideoFormat(u) && !isSample(u)) return u;
        }
    }
    for (const mm of htmlData.matchAll(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi)) {
        const u = mm[0].replace(/\\\//g, '/');
        if (isVideoFormat(u) && !isSample(u)) return u;
    }
    return '';
}

function maxPage(htmlData, tid, pg) {
    let maxPg = pg;
    const re = new RegExp(`/index\\.php/vod/type/id/${tid}/page/(\\d+)\\.html`, 'g');
    for (const pm of htmlData.matchAll(re)) {
        try {
            maxPg = Math.max(maxPg, parseInt(pm[1], 10));
        } catch {
            // 忽略
        }
    }
    return maxPg;
}

// ===================== 加密圖解密（對應 Python localProxy） =====================
// base64 文本 → XOR(IMG_KEY) → 按魔數判斷 mime
function decryptImage(raw) {
    let text = '';
    try {
        text = raw.toString('utf8').trim();
    } catch {
        text = '';
    }
    if (!text) return null;
    text = text.replace(/\s+/g, '');
    let binary;
    try {
        binary = Buffer.from(text, 'base64');
    } catch {
        binary = raw;
    }
    const out = Buffer.alloc(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary[i] ^ IMG_KEY[i % IMG_KEY.length];
    let mime = 'image/jpeg';
    if (out[0] === 0xff && out[1] === 0xd8 && out[2] === 0xff) mime = 'image/jpeg';
    else if (out[0] === 0x89 && out[1] === 0x50 && out[2] === 0x4e && out[3] === 0x47) mime = 'image/png';
    else if (out[0] === 0x47 && out[1] === 0x49 && out[2] === 0x46) mime = 'image/gif';
    else if (out[0] === 0x52 && out[1] === 0x49 && out[2] === 0x46 && out[3] === 0x46) mime = 'image/webp';
    return { mime, data: out };
}

async function fetchBytes(url) {
    const resp = await req.get(url, {
        headers: { 'User-Agent': UA, Referer: SITE_URL + '/', Accept: '*/*' },
        timeout: 10000,
        validateStatus: () => true,
        responseType: 'arraybuffer',
    });
    const data = resp.data;
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof Uint8Array) return Buffer.from(data);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    return Buffer.from(toStr(data), 'utf8');
}

// ===================== 六大介面 =====================

const CATS = [
    ['3', '黑料吃瓜'], ['4', '厂牌原创'], ['5', '国产精选'], ['6', '明星换脸'],
    ['7', 'AV解说'], ['8', '禁漫精选'], ['9', '乱伦'], ['10', '父女'],
    ['11', '母子'], ['12', '兄妹'], ['13', '学生'], ['14', '嫂子'],
    ['15', '姐夫'], ['16', '师生'], ['17', '全家'], ['18', '猎奇'],
    ['28', '国产大片'], ['31', '欧美大片'], ['32', '网红直播'], ['33', '探花约炮'],
    ['34', '三级伦理'], ['35', '萝莉开苞'], ['66', '有声小说'], ['68', 'cosplay'],
    ['69', 'AI魔改'], ['70', 'av综艺'], ['72', '嫩妹下海'], ['74', '每日甄选'],
    ['76', 'ts人妖'], ['77', '姿势玩法'], ['78', '同性恋'], ['79', '真实缅北'],
    ['80', '恶心恐怖'], ['81', '黄金圣水'], ['82', '校园霸凌'], ['83', '战场实录'],
    ['84', '人兽乱交'], ['85', '灵异视频'], ['86', 'N号房'], ['87', '日韩大片'],
    ['88', 'SM调教'],
];

// /home
async function home() {
    return { class: CATS.map(([tid, name]) => ({ type_id: tid, type_name: name })), filters: {} };
}

// /category
async function category(inReq) {
    const tid = toStr(inReq.body?.id);
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    if (pg < 1) pg = 1;
    try {
        const url = pg <= 1
            ? `${SITE_URL}/index.php/vod/type/id/${tid}.html`
            : `${SITE_URL}/index.php/vod/type/id/${tid}/page/${pg}.html`;
        const htmlData = await fetchHtml(url, 'vod/detail', SITE_URL + '/');
        const cards = parseVodList(htmlData, inReq);
        const mp = maxPage(htmlData, tid, pg);
        const pagecount = mp > pg ? mp : (cards.length ? pg + 1 : pg);
        return { list: cards, page: pg, pagecount, limit: cards.length, total: 0 };
    } catch (e) {
        console.error('[huajieyy] category error:', e.message);
        return { list: [], page: pg, pagecount: pg, limit: 0, total: 0 };
    }
}

// /detail：抓播放頁取 player_aaaa（vod_name + m3u8）
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const vid = (Array.isArray(rawId) ? String(rawId[0] || '') : toStr(rawId)).trim();
    if (!vid) return { list: [] };
    const vod = {
        vod_id: vid,
        vod_name: vid,
        vod_pic: '',
        vod_remarks: '蝴蝶影视',
        vod_actor: '🦋 TG群: @tvshare23',
        vod_director: '🦋 蝙蝠影视',
        vod_content: `🦋 官方交流群: @tvshare23 | 严禁盗卖，完全免费！\n\n影片ID: ${vid}`,
        vod_play_from: '蝙蝠专线',
        vod_play_url: `正片$${SITE_URL}/index.php/vod/play/id/${vid}/sid/1/nid/1.html`,
    };
    try {
        const playUrl = `${SITE_URL}/index.php/vod/play/id/${vid}/sid/1/nid/1.html`;
        const ph = await fetchHtml(playUrl, 'player_aaaa', SITE_URL + '/');
        const start = ph.indexOf('var player_aaaa');
        if (start >= 0) {
            const js = ph.indexOf('{', start);
            if (js >= 0) {
                let depth = 0;
                let i = js;
                while (i < ph.length) {
                    if (ph[i] === '{') depth++;
                    else if (ph[i] === '}') {
                        depth--;
                        if (depth === 0) break;
                    }
                    i++;
                }
                try {
                    const cfg = JSON.parse(ph.slice(js, i + 1));
                    const vd = cfg.vod_data || {};
                    if (vd.vod_name) vod.vod_name = cleanText(String(vd.vod_name));
                } catch {
                    // 忽略
                }
            }
        }
        const m3u8 = extractPlayUrl(ph);
        if (m3u8) vod.vod_play_url = '正片$' + m3u8;
        return { list: [vod] };
    } catch (e) {
        console.error('[huajieyy] detail error:', e.message);
        return { list: [vod] };
    }
}

// /play
async function play(inReq) {
    const rawId = toStr(inReq.body?.id).trim();
    const header = { 'User-Agent': UA, Referer: SITE_URL + '/' };
    if (/^https?:\/\//i.test(rawId) && isVideoFormat(rawId)) {
        return { parse: 0, url: rawId, header };
    }
    try {
        const vid = rawId.replace(/\D/g, '');
        if (vid) {
            const d = await detail({ body: { id: vid }, headers: inReq.headers });
            const ep = (d.list[0] && d.list[0].vod_play_url) || '';
            if (ep.includes('$')) {
                const u = ep.split('$', 2)[1];
                if (/^https?:\/\//i.test(u) && isVideoFormat(u)) return { parse: 0, url: u, header };
            }
        }
    } catch (e) {
        console.error('[huajieyy] play error:', e.message);
    }
    return { parse: 1, url: rawId, header };
}

// /search
async function search(inReq) {
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    if (pg < 1) pg = 1;
    const key = toStr(inReq.body?.wd ?? inReq.body?.key).trim();
    try {
        const kw = encodeURIComponent(key);
        const url = pg <= 1
            ? `${SITE_URL}/index.php/vod/search.html?wd=${kw}`
            : `${SITE_URL}/index.php/vod/search/page/${pg}/wd/${kw}.html`;
        const htmlData = await fetchHtml(url, 'vod/detail', SITE_URL + '/');
        const cards = parseVodList(htmlData, inReq);
        return { list: cards, page: pg, pagecount: cards.length ? pg + 1 : pg, limit: cards.length, total: 0 };
    } catch (e) {
        console.error('[huajieyy] search error:', e.message);
        return { list: [], page: pg, pagecount: pg, limit: 0, total: 0 };
    }
}

export default {
    meta: { key: 'huajieyy', name: '花街影院', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', async () => ({}));
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
        // 擴展：加密封面解密代理（原 localProxy）
        fastify.get('/huajie_img', async (request, reply) => {
            try {
                const url = String((request.query && request.query.url) || '').trim();
                if (!/^https?:\/\//i.test(url)) return reply.code(400).type('text/plain; charset=utf-8').send('bad url');
                const raw = await fetchBytes(url);
                const dec = decryptImage(raw);
                if (!dec) return reply.code(502).type('text/plain; charset=utf-8').send('empty');
                return reply.type(dec.mime).send(dec.data);
            } catch (e) {
                console.error('[huajieyy] huajie_img error:', e.message);
                return reply.code(502).type('text/plain; charset=utf-8').send('proxy error');
            }
        });
    },
};
