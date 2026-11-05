// XN69 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 xn69.py（tvbox python 源，https://xn--69-6tia3cb.net 泰國站）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
// 註：原 localProxy 僅返回佔位 [200, "text/plain", ""]，無實質功能，未移植。
// 註：播放鏈需要向 PLAYER_PROXY_SELECTION_URL POST JSON（取 p2p token → masterUrl），
//     用宿主 HTTP 客戶端的 req.post 發送；若宿主僅實現 req.get，將回落 parse:1。
import req from '../../util/req.js';

const SITE_URL = 'https://xn--69-6tia3cb.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BASE_HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
};

const PLAYER_HEADERS = {
    'User-Agent': UA,
    Referer: 'https://lumierecore.com/',
    Origin: 'https://lumierecore.com',
};

const toStr = (v) => (v == null ? '' : String(v));

const CLASSES = [
    { type_id: 'คลิปหลุด', type_name: '偷拍泄密' },
    { type_id: 'onlyfans', type_name: 'OnlyFans' },
    { type_id: 'mlive', type_name: 'Mlive直播' },
    { type_id: 'thlive', type_name: 'THLive直播' },
    { type_id: 'jav', type_name: '日本JAV' },
    { type_id: 'xxx', type_name: '欧美XXX' },
    { type_id: 'หนังโป๊ไทย', type_name: '泰国本土' },
    { type_id: 'เอวีจีน', type_name: '华人AV' },
    { type_id: 'ห้องเชือด', type_name: '私房约炮' },
];

async function fetchText(url, headers) {
    const resp = await req.get(url, { headers: headers || BASE_HEADERS, timeout: 15000, validateStatus: () => true });
    const data = resp.data;
    const text = typeof data === 'string' ? data : toStr(data);
    return { text, status: resp.status ?? 0 };
}

async function postJson(url, payload, headers) {
    if (typeof req.post !== 'function') throw new Error('host req.post not available');
    const resp = await req.post(url, payload, { headers, timeout: 15000, validateStatus: () => true });
    const data = resp.data;
    return { text: typeof data === 'string' ? data : JSON.stringify(data ?? ''), status: resp.status ?? 0, data };
}

function absPic(pic) {
    if (!pic) return '';
    if (pic.startsWith('//')) return 'https:' + pic;
    if (pic.startsWith('/')) return SITE_URL + pic;
    return pic;
}

// ===================== 卡片解析（對應 Python _parse_card_list） =====================
function parseCardList(html) {
    const cards = [];
    if (!html) return cards;

    let blocks = html.match(/<div[^>]*data-post-id=["']\d+["'][^>]*class=["'][^"']*loop-video[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*data-post-id=|<nav[^>]*pagination|<footer>|$)/g);
    if (!blocks) {
        blocks = html.match(/<div[^>]*class=["'][^"']*loop-video[^"']*["'][^>]*>[\s\S]*?(?=<div[^>]*class=["'][^"']*loop-video|<nav[^>]*pagination|<footer>|$)/g);
    }
    if (!blocks) return cards;

    for (const block of blocks) {
        if (block.includes('hot-video-loop') || block.includes('swiper-slide')) continue;

        let hrefMatch = /<a[^>]*class=["']post-video["'][^>]*href=["']([^"']+)["']/.exec(block)
            || /<a[^>]*href=["']([^"']+)["'][^>]*class=["']post-video["']/.exec(block);
        if (!hrefMatch) continue;
        const detailUrl = hrefMatch[1].trim();

        let titleMatch = /title=["']([^"']+)["']/.exec(block);
        let title = titleMatch ? titleMatch[1].trim() : '';
        if (!title) {
            const altMatch = /alt=["']([^"']+)["']/.exec(block);
            title = altMatch ? altMatch[1].trim() : '无标题';
        }

        let imgMatch = /<img[^>]*data-src=["']([^"']+)["']/.exec(block)
            || /<img[^>]*data-default-src=["']([^"']+)["']/.exec(block)
            || /<img[^>]*src=["']([^"']+)["']/.exec(block);
        const pic = imgMatch ? absPic(imgMatch[1].trim()) : '';

        const durMatch = /class=["']post-duration["'][^>]*>\s*<span>([\s\S]*?)<\/span>/.exec(block);
        const duration = durMatch ? durMatch[1].trim() : '';
        const viewMatch = /class=["']post-views["'][^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/.exec(block);
        const views = viewMatch ? viewMatch[1].trim() : '';

        let remarks;
        if (duration && views) remarks = `蝴蝶影视 | ${duration} · ${views}`;
        else if (duration) remarks = `蝴蝶影视 | ${duration}`;
        else if (views) remarks = `蝴蝶影视 | ${views}`;
        else remarks = '蝴蝶影视';

        cards.push({ vod_id: detailUrl, vod_name: title, vod_pic: pic, vod_remarks: remarks, style: { type: 'rect', ratio: 1.78 } });
    }
    return cards;
}

function paging(html, page) {
    const hasNext = html.includes('class="pagination-next"') || html.includes(`/page/${page + 1}/`);
    const totalPages = hasNext ? page + 1 : page;
    return { pagecount: totalPages, total: totalPages * 20 };
}

// ===================== 六大介面 =====================

// /home：靜態分類（type_id 為泰文，需 URL 編碼）
async function home() {
    return { class: CLASSES, filters: {}, style: { type: 'rect', ratio: 1.78 } };
}

// /category
async function category(inReq) {
    const tid = toStr(inReq.body?.id);
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    try {
        const q = encodeURIComponent(tid);
        const url = pg <= 1 ? `${SITE_URL}/category/${q}/` : `${SITE_URL}/category/${q}/page/${pg}/`;
        const { text } = await fetchText(url, { ...BASE_HEADERS, Referer: SITE_URL + '/' });
        const cards = parseCardList(text);
        const { pagecount, total } = paging(text, pg);
        return { page: pg, pagecount, limit: 20, total, style: { type: 'rect', ratio: 1.78 }, list: cards };
    } catch (e) {
        console.error('[xn69] category error:', e.message);
        return { page: pg, pagecount: pg, limit: 20, total: 0, list: [] };
    }
}

// /detail：og 標題/封面，iframe 播放地址
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const detailUrl = Array.isArray(rawId) ? String(rawId[0] || '') : toStr(rawId);
    try {
        const { text } = await fetchText(detailUrl, { ...BASE_HEADERS, Referer: SITE_URL + '/' });

        let title = '正片播放';
        const ogMatch = /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/.exec(text);
        if (ogMatch) title = ogMatch[1].trim();
        else {
            const tMatch = /<title>([\s\S]*?)<\/title>/.exec(text);
            if (tMatch) title = tMatch[1].trim();
        }
        title = title.replace(/\s*-\s*หี.*$/i, '').trim();

        const imgMatch = /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/.exec(text);
        const pic = imgMatch ? imgMatch[1].trim() : '';

        const iframeMatch = /<iframe[^>]+src=["']([^"']+)["']/i.exec(text);
        const iframeUrl = iframeMatch ? iframeMatch[1].trim() : '';

        return {
            list: [{
                vod_id: detailUrl,
                vod_name: title,
                vod_pic: pic,
                type_name: '蝴蝶影视',
                vod_year: '',
                vod_area: '',
                vod_remarks: '蝴蝶影视',
                vod_actor: '🦋 TG群: @tvshare23',
                vod_director: '🦋 蝙蝠影视',
                vod_content: '🦋 官方交流TG群: @tvshare23 | 严禁盗链贩卖。已接入原盘高清直链秒播。',
                vod_play_from: '蝴蝶专线',
                vod_play_url: '正片$' + (iframeUrl || detailUrl),
            }],
        };
    } catch (e) {
        console.error('[xn69] detail error:', e.message);
        return { list: [] };
    }
}

// /play：player-config/v2 → PLAYER_PROXY_SELECTION_URL POST 取 masterUrl
async function play(inReq) {
    const targetUrl = toStr(inReq.body?.id);
    let playUrl = '';
    try {
        const { text } = await fetchText(targetUrl, { ...BASE_HEADERS, Referer: SITE_URL + '/' });

        const configMatch = /<script[^>]+src=["']([^"']*player-config\/v2\/[^"']+)["']/.exec(text);
        if (configMatch) {
            let configUrl = configMatch[1];
            if (configUrl.startsWith('//')) configUrl = 'https:' + configUrl;
            else if (configUrl.startsWith('/')) configUrl = 'https://lumierecore.com' + configUrl;

            const { text: cfgJs } = await fetchText(configUrl, { ...BASE_HEADERS, Referer: targetUrl });

            let p2pToken = '';
            const p2pMatch = /p2p=([a-f0-9]+)/.exec(configUrl);
            if (p2pMatch) p2pToken = p2pMatch[1];

            const proxyMatch = /PLAYER_PROXY_SELECTION_URL\s*=\s*["']([^"']+)["']/.exec(cfgJs);
            if (proxyMatch) {
                const proxyUrl = proxyMatch[1].replace(/\\\//g, '/');
                const postHeaders = {
                    'User-Agent': PLAYER_HEADERS['User-Agent'],
                    Referer: targetUrl,
                    Origin: 'https://lumierecore.com',
                    Accept: 'application/json, text/plain, */*',
                    'Content-Type': 'application/json;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest',
                };
                const payload = p2pToken ? { p2p: p2pToken } : {};
                const res = await postJson(proxyUrl, payload, postHeaders);
                if (res.status === 200 && res.text) {
                    try {
                        const resJson = typeof res.data === 'object' && res.data ? res.data : JSON.parse(res.text);
                        if (resJson.masterUrl && String(resJson.masterUrl).startsWith('http')) playUrl = resJson.masterUrl;
                        else if (resJson.url && String(resJson.url).startsWith('http')) playUrl = resJson.url;
                        else if (resJson.file && String(resJson.file).startsWith('http')) playUrl = resJson.file;
                    } catch {
                        // 非 JSON 則走正則兜底
                    }
                    if (!playUrl) {
                        const mm = res.text.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
                        if (mm) playUrl = mm[0];
                    }
                }
            }
        }
    } catch (e) {
        console.error('[xn69] play error:', e.message);
    }

    if (!playUrl) return { parse: 1, url: targetUrl, header: PLAYER_HEADERS };
    return { parse: 0, url: playUrl, header: PLAYER_HEADERS };
}

// /search
async function search(inReq) {
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    const key = toStr(inReq.body?.wd ?? inReq.body?.key);
    try {
        const q = encodeURIComponent(key);
        const url = pg <= 1 ? `${SITE_URL}/?s=${q}` : `${SITE_URL}/page/${pg}/?s=${q}`;
        const { text } = await fetchText(url, { ...BASE_HEADERS, Referer: SITE_URL + '/' });
        const cards = parseCardList(text);
        const { pagecount, total } = paging(text, pg);
        return { page: pg, pagecount, limit: 20, total, style: { type: 'rect', ratio: 1.78 }, list: cards };
    } catch (e) {
        console.error('[xn69] search error:', e.message);
        return { page: pg, pagecount: pg, limit: 0, total: 0, list: [] };
    }
}

export default {
    meta: { key: 'xn69', name: 'XN69', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', async () => ({}));
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
