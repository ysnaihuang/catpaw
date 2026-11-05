// 欲望之眼 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 upload-3.py（tvbox python 源）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
// 註：原 localProxy 僅返回佔位 [200, "video/mp2t", "", {}]，無實質功能，未移植。
import req from '../../util/req.js';

const HOST = 'https://ywatomiczenxgridhub.xyz';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://ywatomiczenxgridhub.xyz/',
};

const toStr = (v) => (v == null ? '' : String(v));
const trim = (s) => toStr(s).replace(/^\s+|\s+$/g, '');

const CATS = [
    ['35', '中文字幕'], ['43', '国产视频'], ['53', '国产传媒'], ['29', '人妖'],
    ['47', '萝莉女孩'], ['23', '女同性爱'], ['33', '日本女优'], ['55', '三级片'],
    ['39', '欧美视频'], ['31', 'SM调教'], ['49', '顶级主播'],
];

const ORDERBYS = [
    { n: '最新', v: 'time' },
    { n: '最热', v: 'hits' },
    { n: '评分', v: 'score' },
];

async function fetchText(url, referer) {
    const headers = { ...HEADERS };
    if (referer) headers.Referer = referer;
    for (let i = 0; i < 3; i++) {
        try {
            const resp = await req.get(url, { headers, timeout: 15000, validateStatus: () => true });
            const data = resp.data;
            const text = typeof data === 'string' ? data : toStr(data);
            if ((resp.status ?? 0) === 200 && text) return text;
            if (text) return text;
        } catch {
            // 重試
        }
    }
    return '';
}

// ===================== 列表解析（對應 Python _items） =====================
function parseItems(html) {
    const out = [];
    const seen = new Set();
    if (!html) return out;
    const re = /<a[^>]*class="model-list-item-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<div[^>]*class="model-list-item-lower"[^>]*>([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        try {
            const href = m[1];
            if (!href.includes('/vod/play/id/')) continue;
            const url = href.startsWith('http') ? href : HOST + href;
            if (seen.has(url)) continue;
            seen.add(url);

            const upper = m[2];
            const lower = m[3];
            const img = /<img[^>]*src="([^"]+)"/.exec(upper);
            const pic = img ? img[1] : '';
            const dur = /ModelListItemBadge[^"]*"\s*>\s*([^<]+)</.exec(upper);
            const remark = dur ? dur[1].trim() : '';
            const title = lower.replace(/<[^>]+>/g, '').trim();
            if (!title) continue;

            out.push({ vod_id: url, vod_name: title, vod_pic: pic, vod_remarks: remark });
        } catch {
            // 單條失敗則跳過
        }
    }
    return out;
}

function pageCount(html, pg) {
    const pages = [...html.matchAll(/\/page\/(\d+)\.html/g)].map((m) => parseInt(m[1], 10));
    if (pages.length) {
        try {
            return Math.max(...pages);
        } catch {
            // 忽略
        }
    }
    return pg + 1;
}

// ===================== 播放信息（對應 Python _player_info） =====================
async function playerInfo(playUrl) {
    const info = { name: '', vclass: '', m3u8: '', pic: '' };
    if (!playUrl) return info;
    const html = await fetchText(playUrl, HOST + '/');
    if (!html) return info;

    const m = /var player_aaaa=\{(.*?)\};?\s*<\/script>/s.exec(html);
    if (m) {
        try {
            const d = JSON.parse('{' + m[1] + '}');
            const vd = d.vod_data || {};
            info.name = vd.vod_name || '';
            info.vclass = vd.vod_class || '';
            info.m3u8 = (d.url || '').trim();
            if (info.m3u8) {
                // 封面：img 的 src 包含 m3u8 的目錄路徑
                const dpath = info.m3u8.split('://').slice(-1)[0].split('/').slice(1, -1).join('/');
                for (const im of html.matchAll(/<img[^>]*src="([^"]+)"/g)) {
                    if (dpath && im[1].includes(dpath)) {
                        info.pic = im[1];
                        break;
                    }
                }
            }
        } catch {
            // 解析失敗則返回空信息
        }
    }
    return info;
}

// ===================== 六大介面 =====================

// /home：靜態分類 + 排序篩選器
async function home() {
    const classes = CATS.map(([t, n]) => ({ type_id: t, type_name: n }));
    const filters = {};
    for (const [t] of CATS) filters[t] = [{ key: 'orderby', name: '排序', value: ORDERBYS }];
    return { class: classes, filters, list: [] };
}

// /category
function catUrl(tid, pg, orderby) {
    const base = `${HOST}/index.php/vod/type/id/${tid}`;
    const by = orderby && orderby !== 'time' ? `/by/${orderby}` : '';
    if (pg <= 1) return base + by + '.html';
    return `${base}${by}/page/${pg}.html`;
}

async function category(inReq) {
    const tid = toStr(inReq.body?.id);
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    const extend = inReq.body?.filters && typeof inReq.body.filters === 'object' ? inReq.body.filters : {};
    let orderby = 'time';
    const v = Array.isArray(extend.orderby) ? extend.orderby[0] : extend.orderby;
    if (typeof v === 'string' && v) orderby = v;
    try {
        const html = await fetchText(catUrl(tid, pg, orderby), HOST + '/');
        const list = parseItems(html);
        return { list, page: pg, pagecount: pageCount(html, pg), limit: 48, total: 999999 };
    } catch (e) {
        console.error('[yuwangzhiyan] category error:', e.message);
        return { list: [], page: pg, pagecount: pg, limit: 48, total: 0 };
    }
}

// /detail：vod_id 即播放頁地址
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const playUrl = Array.isArray(rawId) ? String(rawId[0] || '') : toStr(rawId);
    try {
        const info = playUrl ? await playerInfo(playUrl) : { name: '', vclass: '', m3u8: '', pic: '' };
        return {
            list: [{
                vod_id: playUrl,
                vod_name: info.name || '视频',
                vod_pic: info.pic,
                type_name: info.vclass,
                vod_play_from: '欲望之眼',
                vod_play_url: '第01集$' + playUrl,
            }],
        };
    } catch (e) {
        console.error('[yuwangzhiyan] detail error:', e.message);
        return { list: [] };
    }
}

// /search
async function search(inReq) {
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    const key = toStr(inReq.body?.wd ?? inReq.body?.key);
    try {
        const url = `${HOST}/index.php/vod/search/page/${pg}/wd/${encodeURIComponent(key)}.html`;
        const html = await fetchText(url, HOST + '/');
        const list = parseItems(html);
        return { list, page: pg, pagecount: pageCount(html, pg), limit: 48, total: 999999 };
    } catch (e) {
        console.error('[yuwangzhiyan] search error:', e.message);
        return { list: [], page: pg, pagecount: pg, limit: 48, total: 0 };
    }
}

// /play：從播放頁提取 m3u8 直鏈
async function play(inReq) {
    let playUrl = toStr(inReq.body?.id);
    if (playUrl.includes('$')) playUrl = playUrl.split('$').slice(-1)[0];
    try {
        const info = playUrl ? await playerInfo(playUrl) : { m3u8: '' };
        const url = info.m3u8 || '';
        if (url) return { parse: 0, url, header: HEADERS };
        return { parse: 1, url: playUrl, header: HEADERS };
    } catch (e) {
        console.error('[yuwangzhiyan] play error:', e.message);
        return { parse: 1, url: playUrl, header: HEADERS };
    }
}

export default {
    meta: { key: 'yuwangzhiyan', name: '欲望之眼', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', async () => ({}));
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
