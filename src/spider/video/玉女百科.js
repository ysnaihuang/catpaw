// 玉女百科 —— catBridge 单档 cat 源（后台「Cat 源」→ 上传导入，热重载）
// 由 _____2_fe67.py（四壳通用 Python Spider）移植。六接口契约见 docs/spider.md。
// Python 的 localProxy 恒返回 404（占位、无实质功能），未移植。
// 沙箱内 import 会被改写为 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客户端。
import req from '../../util/req.js';

const RAW_SITE = 'https://cqglgo.ynbk6.mom';
let siteUrl = RAW_SITE;
let host = RAW_SITE;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
    'User-Agent': UA,
    'Referer': RAW_SITE + '/',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const CLASSES = [
    { type_id: '21', type_name: '女神学生' },
    { type_id: '22', type_name: '美女直播' },
    { type_id: '23', type_name: '人妻系列' },
    { type_id: '24', type_name: '强奸乱伦' },
    { type_id: '25', type_name: '自拍偷拍' },
    { type_id: '26', type_name: '制服诱惑' },
    { type_id: '27', type_name: '巨乳系列' },
    { type_id: '28', type_name: '自慰系列' },
    { type_id: '29', type_name: '国产视频' },
    { type_id: '30', type_name: '无码视频' },
    { type_id: '31', type_name: '有码视频' },
    { type_id: '32', type_name: '中文字幕' },
    { type_id: '33', type_name: '日韩精品' },
    { type_id: '34', type_name: '欧美精品' },
    { type_id: '35', type_name: '动漫精品' },
    { type_id: '36', type_name: '三级伦理' },
];

// 对应 Python _is_minor：标题含以下任一（大小写不敏感）即剔除该条目。
const MINOR_KEYWORDS = ['萝莉', '幼女', '少女', 'loli', 'teen', 'schoolgirl',
    '童颜', '小学生', '初中生', '高中生', 'jk', '女子校生',
    '18岁以下', '未成年'];

const toStr = (v) => (v == null ? '' : String(v));

function isMinor(text) {
    if (!text) return false;
    const t = toStr(text).toLowerCase();
    return MINOR_KEYWORDS.some((kw) => t.includes(kw));
}

// 对应 Python _fetch：返回 HTML 文本
async function fetchHtml(url) {
    const resp = await req.get(url, { headers: HEADERS, timeout: 15000 });
    return toStr(resp.data);
}

// 对应 Python _parse_list
const LIST_RE = /<a[^>]*class="videoBox"[^>]*href="(?:\/cn\/home\/web\/index\.php\/vodplay\/|\/)(\d+)\.html"[^>]*>(.*?)<\/a>\s*<div[^>]*class="videoBox-actor"[^>]*>(.*?)<\/div>/gs;
function parseList(html) {
    const results = [];
    for (const m of toStr(html).matchAll(LIST_RE)) {
        const vid = m[1];
        const inner = m[2];
        const picM = /data-src="([^"]+)"/.exec(inner);
        const pic = picM ? picM[1] : '';
        const titleM = /<h4[^>]*class="title"[^>]*>([^<]+)<\/h4>/.exec(inner);
        const title = titleM ? titleM[1].trim() : '';
        const remarkM = /<div[^>]*class="videoBox-time"[^>]*>([^<]*)<\/div>/.exec(inner);
        const remark = remarkM ? remarkM[1].trim() : '';
        if (isMinor(title)) continue;
        results.push({
            vod_id: vid,
            vod_name: title,
            vod_pic: pic,
            vod_remarks: remark,
        });
    }
    return results;
}

// 对应 Python _parse_page_info
function parsePageInfo(html, baseUrl) {
    let page = 1;
    let pagecount = 1;
    const pm = /-(\d+)\.html/.exec(toStr(baseUrl));
    if (pm) page = parseInt(pm[1], 10);
    const lm = /\/vodtype\/\d+-(\d+)\.html[^>]*>尾页/.exec(html);
    if (lm) {
        pagecount = parseInt(lm[1], 10);
    } else {
        const lm2 = /\/s\/[^"']+-(\d+)\.html[^>]*>尾页/.exec(html);
        if (lm2) pagecount = parseInt(lm2[1], 10);
    }
    return { page, pagecount };
}

// ===================== 六大接口 =====================

// /init：读 inReq.body（字符串 JSON 或对象），支持 proxy/siteUrl/direct 覆盖（direct 为真时重置回原始站），轻量不联网
async function init(inReq) {
    try {
        let cfg = inReq.body;
        if (typeof cfg === 'string') {
            try {
                cfg = JSON.parse(cfg);
            } catch {
                cfg = {};
            }
        }
        if (!cfg || typeof cfg !== 'object') cfg = {};
        if (cfg.proxy) {
            siteUrl = cfg.proxy;
            host = siteUrl;
        }
        if (cfg.siteUrl) {
            siteUrl = cfg.siteUrl;
            host = siteUrl;
        }
        if (cfg.direct) {
            siteUrl = RAW_SITE;
            host = siteUrl;
        }
    } catch (e) {
        console.error('[玉女百科] init error:', e.message);
    }
    return {};
}

// /home：16 个硬编码分类 + filters {}，homeVideoContent 抓 /ynbk/ 解析列表
async function home() {
    let list = [];
    try {
        const html = await fetchHtml(`${host}/ynbk/`);
        list = parseList(html);
    } catch (e) {
        console.error('[玉女百科] home error:', e.message);
    }
    return { class: CLASSES, filters: {}, list };
}

// /category：pg<=1 → /vodtype/{tid}.html，否则 /vodtype/{tid}-{pg}.html；total = pagecount*20
async function category(inReq) {
    const tid = toStr(inReq.body?.id);
    let pg = parseInt(inReq.body?.page, 10);
    if (!Number.isFinite(pg)) pg = 1;
    const url = pg <= 1
        ? `${host}/vodtype/${tid}.html`
        : `${host}/vodtype/${tid}-${pg}.html`;
    try {
        const html = await fetchHtml(url);
        const list = parseList(html);
        const { page, pagecount } = parsePageInfo(html, url);
        return { list, page, pagecount, limit: 20, total: pagecount * 20 };
    } catch (e) {
        console.error('[玉女百科] category error:', e.message);
        return { list: [], page: 1, pagecount: 1, limit: 20, total: 0 };
    }
}

// /detail：/{vid}.html；标题 h1.video-title > span.title；封面 og:image；分类 span.cates > a；m3u8 取 const rawUrl = '...'；简介 og:description
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const vid = Array.isArray(rawId) ? toStr(rawId[0]) : toStr(rawId);
    try {
        const html = await fetchHtml(`${host}/${vid}.html`);
        const titleM = /<h1[^>]*class="video-title"[^>]*>.*?<span[^>]*class="title"[^>]*>([^<]+)<\/span>/s.exec(html);
        const picM = /property="og:image"\s+content="([^"]+)"/.exec(html);
        const typeM = /<span[^>]*class="cates"[^>]*>.*?<a[^>]*>([^<]+)<\/a>/s.exec(html);
        const m3u8M = /const\s+rawUrl\s*=\s*'([^']+)'/.exec(html);
        const descM = /property="og:description"\s+content="([^"]+)"/.exec(html);
        return {
            list: [{
                vod_id: vid,
                vod_name: titleM ? titleM[1].trim() : '',
                vod_pic: picM ? picM[1] : '',
                vod_remarks: typeM ? typeM[1].trim() : '',
                vod_year: '',
                vod_area: '',
                vod_content: descM ? descM[1] : '',
                vod_play_from: '玉女百科',
                vod_play_url: '正片$' + (m3u8M ? m3u8M[1] : ''),
            }],
        };
    } catch (e) {
        console.error('[玉女百科] detail error:', e.message);
        return { list: [] };
    }
}

// /play：pid 即 m3u8 地址；若不是 http 开头，抓 /{pid}.html 取 rawUrl
async function play(inReq) {
    let url = toStr(inReq.body?.id);
    if (!url.startsWith('http')) {
        try {
            const html = await fetchHtml(`${host}/${url}.html`);
            const m = /const\s+rawUrl\s*=\s*'([^']+)'/.exec(html);
            if (m) url = m[1];
        } catch (e) {
            console.error('[玉女百科] play error:', e.message);
        }
    }
    return {
        parse: 0,
        jx: 0,
        url,
        header: { 'User-Agent': UA, Referer: RAW_SITE + '/' },
        format: 'application/x-mpegURL',
    };
}

// /search：/s/{encodeURIComponent(wd)}.html，pg>1 → /s/{enc}-{pg}.html；total = pagecount*20
async function search(inReq) {
    const wd = toStr(inReq.body?.wd ?? inReq.body?.key);
    let pg = parseInt(inReq.body?.page, 10);
    if (!Number.isFinite(pg)) pg = 1;
    const enc = encodeURIComponent(wd);
    const url = pg <= 1
        ? `${host}/s/${enc}.html`
        : `${host}/s/${enc}-${pg}.html`;
    try {
        const html = await fetchHtml(url);
        const list = parseList(html);
        const { page, pagecount } = parsePageInfo(html, url);
        return { list, page, pagecount, limit: 20, total: pagecount * 20 };
    } catch (e) {
        console.error('[玉女百科] search error:', e.message);
        return { list: [], page: 1, pagecount: 1, limit: 20, total: 0 };
    }
}

export default {
    meta: { key: 'yunvbaike', name: '玉女百科', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
