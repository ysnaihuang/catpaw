// 萝莉岛 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 upload-5.py（tvbox python 源）移植。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
// 註：原文件用 requests Session + 文件緩存 domain_cache.json；此處用模組內存
//     保存域名/工作域名/token（宿主重載後重新走初始化流程），行為等價。
// 註：原 playerContent 的 header 用了 json.dumps 轉字符串，catBridge 契約要求
//     對象，此處直接傳對象。
// 註：POST 走 application/x-www-form-urlencoded，與原 requests data= 字典一致；
//     需宿主 HTTP 客戶端實現 req.post。
import req from '../../util/req.js';

const UA = 'Mozilla/5.0 (Linux; Android 12; TFY-AN00 Build/HONORTFY-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/92.0.4515.105 Mobile Safari/537.36 uni-app Html5Plus/1.0 (Immersed/33.0)';
const DOMAIN_API = 'https://lwncnss3api.cc/api/getapi.php';

// 硬编码备用域名（原 BACKUP_DOMAINS）
const BACKUP_DOMAINS = [
    'dag29jmgma1g.site', 'ldngksapi.cc', 'lagh23ksapi.cc', 'ldagwhdgpi.cc',
    'lwetasdf3api.cc', 'lwasga289api.cc', 'lw2wthchhaapi.cc', 'lwncnss3api.cc',
    'lw23412gaapi.cc',
];

const SESSION_HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip', 'Content-Type': 'application/x-www-form-urlencoded' };

// 模組級狀態（對應 Python 的 self.s / self.token / self.domains / self.working_domains）
const state = {
    domains: [],
    workingDomains: [],
    token: '',
    ready: false,
};

const toStr = (v) => (v == null ? '' : String(v));

function formBody(data) {
    return new URLSearchParams(Object.entries(data || {}).map(([k, v]) => [k, toStr(v)])).toString();
}

async function httpGet(url, timeout = 10000) {
    const resp = await req.get(url, { headers: SESSION_HEADERS, timeout, validateStatus: () => true });
    const data = resp.data;
    return { status: resp.status ?? 0, text: typeof data === 'string' ? data : JSON.stringify(data ?? ''), data };
}

async function httpPost(url, data, timeout = 10000) {
    if (typeof req.post !== 'function') throw new Error('host req.post not available');
    const resp = await req.post(url, formBody(data), {
        headers: SESSION_HEADERS,
        timeout,
        validateStatus: () => true,
    });
    const rdata = resp.data;
    return { status: resp.status ?? 0, text: typeof rdata === 'string' ? rdata : JSON.stringify(rdata ?? ''), data: rdata };
}

// ===================== 域名池（對應 Python _load_domains/_fetch_domains） =====================
async function fetchDomainsFromApi() {
    try {
        const { text } = await httpGet(DOMAIN_API);
        let data = null;
        try {
            data = JSON.parse(text);
        } catch {
            // JSON 解析失敗則正則提取域名
            const domains = [...new Set(text.match(/[\w\-.]+?\.(?:com|cc|net|org|site|top|xyz)/g) || [])];
            if (domains.length) return domains;
        }
        if (data && data.code === 200) {
            let domains = data.data || [];
            const blacklist = data.blacklist || data.blackdomain || [];
            if (typeof domains === 'string') {
                try {
                    domains = JSON.parse(domains);
                } catch {
                    domains = [domains];
                }
            }
            if (!Array.isArray(domains)) domains = domains ? [String(domains)] : [];
            // 不過濾黑名單，合併全部（與原邏輯一致）
            const all = [...new Set([...domains, ...(Array.isArray(blacklist) ? blacklist : [])])];
            const valid = all.filter((d) => d && typeof d === 'string' && d.includes('.'));
            const priority = domains.filter((d) => d && d.includes('.'));
            const others = valid.filter((d) => !priority.includes(d));
            if (valid.length) return [...priority, ...others];
        }
    } catch (e) {
        console.error('[luolidao] fetch domains error:', e.message);
    }
    return [...BACKUP_DOMAINS];
}

async function testDomain(domain) {
    // 優先 https，失敗則 http（對應 Python _test_domain）
    for (const protocol of ['https', 'http']) {
        try {
            const { status } = await httpGet(`${protocol}://${domain}/api/setapp.php`, 5000);
            if (status === 200) return true;
        } catch {
            // 換下一個協議
        }
    }
    return false;
}

async function findWorkingDomain() {
    for (const domain of [...state.workingDomains]) {
        if (await testDomain(domain)) return domain;
        state.workingDomains = state.workingDomains.filter((d) => d !== domain);
    }
    for (const domain of state.domains) {
        if (await testDomain(domain)) {
            if (!state.workingDomains.includes(domain)) state.workingDomains.push(domain);
            return domain;
        }
    }
    return null;
}

// 通用 API 請求，自動輪詢域名（對應 Python _request_api）
async function requestApi(path, method = 'post', data = null, params = null) {
    for (let attempt = 0; attempt < 3; attempt++) {
        let domain = await findWorkingDomain();
        if (!domain) {
            state.domains = await fetchDomainsFromApi();
            domain = await findWorkingDomain();
            if (!domain) return null;
        }
        for (const protocol of ['https', 'http']) {
            let url = `${protocol}://${domain}${path}`;
            if (params) url += (url.includes('?') ? '&' : '?') + new URLSearchParams(params).toString();
            try {
                const res = method.toLowerCase() === 'get' ? await httpGet(url) : await httpPost(url, data || {});
                if (res.status === 200) return res;
            } catch (e) {
                console.error('[luolidao] request error:', e.message);
            }
        }
        state.workingDomains = state.workingDomains.filter((d) => d !== domain);
    }
    return null;
}

async function register() {
    try {
        const res = await requestApi('/api/newreg.php', 'post', { device: 'android', ntoken: '', channel_code: 'vbtQg9D8' });
        if (res) {
            const data = typeof res.data === 'object' && res.data ? res.data : JSON.parse(res.text);
            state.token = (data.user && data.user.token) || '';
        }
    } catch (e) {
        console.error('[luolidao] register error:', e.message);
    }
}

async function ensureInit() {
    if (state.ready) return;
    state.domains = await fetchDomainsFromApi();
    if (state.domains.length < 3) {
        state.domains = [...new Set([...state.domains, ...BACKUP_DOMAINS])];
    }
    await register();
    state.ready = true;
}

// ===================== 六大介面 =====================

// /init：建會話、拉域名、註冊 token
async function init() {
    state.ready = false;
    state.domains = [];
    state.workingDomains = [];
    state.token = '';
    await ensureInit();
    return {};
}

// /home：/api/setapp.php 取 vodtab 分類 + vodtags 篩選
async function home() {
    try {
        await ensureInit();
        const res = await requestApi('/api/setapp.php', 'get');
        if (res) {
            const data = typeof res.data === 'object' && res.data ? res.data : JSON.parse(res.text);
            const classes = [];
            const filters = {};
            const tabs = [...(data.vodtab || []), ...(data.vodtaban || [])];
            for (const tab of tabs) {
                const tid = tab.type_id;
                classes.push({ type_id: tid, type_name: tab.type_name });
                const tags = tab.vodtags || [];
                if (tags.length) {
                    const tagValues = [{ n: '全部', v: '' }];
                    for (const tag of tags) tagValues.push({ n: tag.name, v: tag.name });
                    filters[tid] = [{ key: 'class', name: '标签', value: tagValues }];
                }
            }
            return { class: classes, filters };
        }
        return { class: [], filters: {} };
    } catch (e) {
        console.error('[luolidao] home error:', e.message);
        return { class: [], filters: {} };
    }
}

// /category：POST /api/vlist.php
async function category(inReq) {
    const tid = toStr(inReq.body?.id);
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    pg = parseInt(pg, 10) || 1;
    const extend = inReq.body?.filters && typeof inReq.body.filters === 'object' ? inReq.body.filters : {};
    const cls = Array.isArray(extend.class) ? extend.class[0] : extend.class;
    const payload = {
        num: String((pg - 1) * 30),
        pid: tid,
        area: '全部',
        vodclass: cls || '',
        vodyear: '全部',
        sort: '1',
        token: state.token,
    };
    try {
        await ensureInit();
        const res = await requestApi('/api/vlist.php', 'post', payload);
        if (res) {
            const data = typeof res.data === 'object' && res.data ? res.data : JSON.parse(res.text);
            const videos = (data.list || []).map((item) => ({
                vod_id: String(item.vod_id || ''),
                vod_name: item.vod_name || '',
                vod_pic: item.vod_pic || '',
                vod_remarks: item.vod_class || item.vod_remarks || '',
            }));
            return { list: videos, page: pg };
        }
        return { list: [] };
    } catch (e) {
        console.error('[luolidao] category error:', e.message);
        return { list: [] };
    }
}

// /detail：POST /api/Get_vod_list.php
async function detail(inReq) {
    const rawId = inReq.body?.id;
    const vid = Array.isArray(rawId) ? String(rawId[0] || '') : toStr(rawId);
    try {
        await ensureInit();
        const res = await requestApi('/api/Get_vod_list.php', 'post', { id: vid, token: state.token, channel: '' });
        if (res) {
            const data = (typeof res.data === 'object' && res.data ? res.data : JSON.parse(res.text)).data || {};
            let playUrl = data.vod_play_url || '';
            if (!playUrl) playUrl = '预览$' + (data.preview_url || '');
            return {
                list: [{
                    vod_id: String(data.vod_id ?? vid),
                    vod_name: data.vod_name || '',
                    vod_pic: data.vod_pic || '',
                    vod_remarks: data.vod_remarks || '',
                    vod_content: data.vod_blurb || '暂无简介',
                    vod_play_from: '萝莉岛',
                    vod_play_url: playUrl,
                }],
            };
        }
        return { list: [] };
    } catch (e) {
        console.error('[luolidao] detail error:', e.message);
        return { list: [] };
    }
}

// /play：直連播放
async function play(inReq) {
    const id = toStr(inReq.body?.id);
    return { parse: 0, url: id, header: { 'User-Agent': UA } };
}

// /search：原站未實現，返回空
async function search() {
    return { list: [] };
}

export default {
    meta: { key: 'luolidao', name: '萝莉岛', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    },
};
