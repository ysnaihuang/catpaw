// 蝴蝶影视·暗夜蜜桃 —— catBridge 單檔 cat 源
// 由 暗夜蜜桃.py（mitaoline.com）移植并优化播放兼容性
import req from '../../util/req.js';

const SITE_URL = 'https://mitaoline.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const toStr = (v) => (v == null ? '' : String(v));

// 运行态会话缓存
let session = {
    devId: `${Math.floor(Math.random() * 90000000 + 10000000).toString(16)}${Date.now().toString(16)}`,
    sid: '',
    skey: '',
    skExp: 0
};

// ===================== 纯 JS 实现 SHA256 & HMAC-SHA256（兼容全部 JS 宿主） =====================
function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
}

function S(X, n) { return (X >>> n) | (X << (32 - n)); }
function R(X, n) { return X >>> n; }
function Ch(x, y, z) { return (x & y) ^ (~x & z); }
function Maj(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }
function Sigma0256(x) { return S(x, 2) ^ S(x, 13) ^ S(x, 22); }
function Sigma1256(x) { return S(x, 6) ^ S(x, 11) ^ S(x, 25); }
function Gamma0256(x) { return S(x, 7) ^ S(x, 18) ^ R(x, 3); }
function Gamma1256(x) { return S(x, 17) ^ S(x, 19) ^ R(x, 10); }

const K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function coreSha256(m, l) {
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Array(64);
    m[l >> 5] |= 0x80 << (24 - (l % 32));
    m[((l + 64 >> 9) << 4) + 15] = l;

    for (let i = 0; i < m.length; i += 16) {
        let [a, b, c, d, e, f, g, h] = H;
        for (let j = 0; j < 64; j++) {
            if (j < 16) {
                W[j] = m[i + j] | 0;
            } else {
                W[j] = safeAdd(safeAdd(safeAdd(Gamma1256(W[j - 2]), W[j - 7]), Gamma0256(W[j - 15])), W[j - 16]);
            }
            const T1 = safeAdd(safeAdd(safeAdd(safeAdd(h, Sigma1256(e)), Ch(e, f, g)), K256[j]), W[j]);
            const T2 = safeAdd(Sigma0256(a), Maj(a, b, c));
            h = g;
            g = f;
            f = e;
            e = safeAdd(d, T1);
            d = c;
            c = b;
            b = a;
            a = safeAdd(T1, T2);
        }
        H[0] = safeAdd(a, H[0]);
        H[1] = safeAdd(b, H[1]);
        H[2] = safeAdd(c, H[2]);
        H[3] = safeAdd(d, H[3]);
        H[4] = safeAdd(e, H[4]);
        H[5] = safeAdd(f, H[5]);
        H[6] = safeAdd(g, H[6]);
        H[7] = safeAdd(h, H[7]);
    }
    return H;
}

function str2binb(str) {
    const bin = [];
    const mask = (1 << 8) - 1;
    for (let i = 0; i < str.length * 8; i += 8) {
        bin[i >> 5] |= (str.charCodeAt(i / 8) & mask) << (24 - (i % 32));
    }
    return bin;
}

function hex2binb(hex) {
    const bin = [];
    for (let i = 0; i < hex.length; i += 2) {
        bin[i >> 3] |= parseInt(hex.substr(i, 2), 16) << (24 - (4 * (i % 8)));
    }
    return bin;
}

function binb2hex(binarray) {
    const hexTab = '0123456789abcdef';
    let str = '';
    for (let i = 0; i < binarray.length * 4; i++) {
        str += hexTab.charAt((binarray[i >> 2] >> ((3 - (i % 4)) * 8 + 4)) & 0xf) +
               hexTab.charAt((binarray[i >> 2] >> ((3 - (i % 4)) * 8)) & 0xf);
    }
    return str;
}

function utf8Encode(string) {
    return unescape(encodeURIComponent(toStr(string)));
}

function sha256Pure(s) {
    const u = utf8Encode(s);
    return binb2hex(coreSha256(str2binb(u), u.length * 8));
}

function hmacSha256Pure(hexKey, data) {
    let bkey = hex2binb(hexKey);
    const uData = utf8Encode(data);
    if (bkey.length > 16) {
        bkey = coreSha256(bkey, hexKey.length * 4);
    }
    const ipad = new Array(16);
    const opad = new Array(16);
    for (let i = 0; i < 16; i++) {
        ipad[i] = (bkey[i] || 0) ^ 0x36363636;
        opad[i] = (bkey[i] || 0) ^ 0x5c5c5c5c;
    }
    const dBin = str2binb(uData);
    const inner = coreSha256(ipad.concat(dBin), 512 + uData.length * 8);
    const outer = coreSha256(opad.concat(inner), 512 + 256);
    return binb2hex(outer);
}

// ===================== PoW 校验 =====================
function hpHash(s) {
    let h = 0x811C9DC5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

function hpPow(chal, nonce) {
    let h = hpHash(`${chal}:${nonce}`);
    for (let i = 0; i < 4; i++) {
        const hexStr = ('00000000' + h.toString(16)).slice(-8);
        h = hpHash(hexStr + chal);
    }
    return ('00000000' + h.toString(16)).slice(-8);
}

function hpSolve(chal, bits = 16) {
    const want = '0'.repeat(bits >> 2);
    let n = 0;
    while (n < 20000000) {
        const nx = n.toString(16);
        const hx = hpPow(chal, nx);
        if (hx.startsWith(want)) {
            return `${chal}.${nx}`;
        }
        n++;
    }
    return '';
}

// ===================== 网络请求封装 =====================
async function rawFetch(targetUrl, options = {}) {
    const method = options.method || 'GET';
    const headers = {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://honeypeach.cc/',
        'Connection': 'keep-alive',
        ...(options.headers || {})
    };

    try {
        const resp = await req(targetUrl, {
            method,
            headers,
            data: options.data,
            timeout: options.timeout || 8000,
            validateStatus: () => true
        });
        const data = resp.data;
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        return { status: resp.status ?? -1, content: text };
    } catch {
        return { status: 0, content: '' };
    }
}

async function ensureHandshake() {
    const now = Math.floor(Date.now() / 1000);
    if (session.sid && session.skey && now < (session.skExp - 60)) {
        return true;
    }

    const hsUrl = `${SITE_URL}/api/handshake?dev=${encodeURIComponent(session.devId)}`;
    let res = await rawFetch(hsUrl, { method: 'GET', timeout: 6000 });
    if (res.status !== 200 || !res.content) return false;

    let d;
    try {
        d = JSON.parse(res.content);
    } catch {
        return false;
    }

    if (d.need_chal) {
        const chal = d.need_chal;
        const bits = parseInt(d.bits || 16, 10);
        const tok = hpSolve(chal, bits);
        if (!tok) return false;

        const chalUrl = `${hsUrl}&c=${encodeURIComponent(tok)}`;
        res = await rawFetch(chalUrl, { method: 'GET', timeout: 6000 });
        if (res.status !== 200 || !res.content) return false;
        try {
            d = JSON.parse(res.content);
        } catch {
            return false;
        }
    }

    if (d.sid && d.skey) {
        session.sid = d.sid;
        session.skey = d.skey;
        session.skExp = parseInt(d.exp || 0, 10);
        return true;
    }
    return false;
}

async function signedFetch(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const params = options.params;
    const body = options.body;
    const timeout = options.timeout || 8000;

    const queryParts = [];
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) {
                queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
            }
        }
    }
    const queryStr = queryParts.join('&');
    const bodyStr = body !== undefined && body !== null ? JSON.stringify(body) : '';

    const hasHs = await ensureHandshake();
    if (!hasHs) {
        let fullUrl = `${SITE_URL}${path}`;
        if (queryStr) fullUrl += `?${queryStr}`;
        return rawFetch(fullUrl, { method, timeout });
    }

    const bodyHash = sha256Pure(bodyStr);
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = `${Math.floor(Math.random() * 900000 + 100000).toString(16)}${Date.now().toString(16)}`;

    const canon = `${method}\n${path}\n${queryStr}\n${bodyHash}\n${ts}\n${nonce}\n${session.sid}`;

    let sig = '';
    try {
        sig = hmacSha256Pure(session.skey, canon);
    } catch {
        sig = '';
    }

    const reqHeaders = {
        'X-Hp-Sid': session.sid,
        'X-Hp-Ts': ts,
        'X-Hp-Nonce': nonce,
        'X-Hp-Sign': sig
    };
    if (bodyStr) {
        reqHeaders['Content-Type'] = 'application/json';
    }

    let fullUrl = `${SITE_URL}${path}`;
    if (queryStr) fullUrl += `?${queryStr}`;

    let res = await rawFetch(fullUrl, {
        method,
        headers: reqHeaders,
        data: bodyStr || undefined,
        timeout
    });

    if (res.status === 401) {
        session.sid = '';
        session.skey = '';
        if (await ensureHandshake()) {
            return signedFetch(path, options);
        }
    }
    return res;
}

function formatCover(mod, url) {
    if (!url) return '';
    if (mod === 'live' || url.startsWith('/') || !url.includes('://')) {
        if (url.startsWith('/')) {
            return `${SITE_URL}${url}`;
        }
        return url;
    }
    return `${SITE_URL}/cover/${mod}?u=${encodeURIComponent(url)}`;
}

// ===================== 分类与配置 =====================
const CLASSES = [
    { type_id: 'video', type_name: '蜜桃视频' },
    { type_id: 'duanju', type_name: '蜜桃短剧' },
    { type_id: 'hongtao', type_name: '红桃短剧' },
    { type_id: 'caibian', type_name: '擦边短剧' },
    { type_id: 'shortv', type_name: '蜜桃动漫' },
    { type_id: 'guochan', type_name: '国产精品' },
    { type_id: 'heiliao', type_name: '黑料吃瓜' },
    { type_id: 'hbo', type_name: 'HBO精选' },
    { type_id: 'live', type_name: '蜜桃直播' }
];

const FILTERS = {
    video: [{
        key: 'cat', name: '分类',
        value: [
            { n: '最近更新', v: 'new' }, { n: '新作上市', v: 'release' }, { n: '中文字幕', v: 'chinese-subtitle' },
            { n: '麻豆传媒', v: 'madou' }, { n: '无码流出', v: 'uncensored-leak' }, { n: 'FC2', v: 'fc2' },
            { n: '热门', v: 'monthly-hot' }, { n: 'VR', v: 'genres/VR' }, { n: 'HEYZO', v: 'heyzo' },
            { n: '东京热', v: 'tokyohot' }, { n: '一本道', v: '1pondo' }, { n: 'Caribbeancom', v: 'caribbeancom' },
            { n: 'Caribbeancompr', v: 'caribbeancompr' }, { n: 'SIRO', v: 'siro' }, { n: 'LUXU', v: 'luxu' },
            { n: 'TWAV', v: 'twav' }, { n: 'Furuke', v: 'furuke' }, { n: '今日热门', v: 'today-hot' },
            { n: '本週热门', v: 'weekly-hot' }
        ]
    }],
    duanju: [
        {
            key: 'cat', name: '厂牌分类',
            value: [
                { n: '黄桃短剧', v: 'huangtao' }, { n: '黄果短剧', v: 'huangguo' }, { n: '野果短剧', v: 'yeguo' },
                { n: '橙果短剧', v: 'chengguo' }, { n: '一直看短剧', v: 'yizk' }, { n: '黄豆短剧', v: 'huangdou' },
                { n: '赤果短剧', v: 'chiguo' }, { n: '怦然心动', v: 'pengran' }, { n: '动漫', v: 'erciyuan' },
                { n: '金币专区', v: 'jinbi' }, { n: '会员专区', v: 'huiyuan' }
            ]
        },
        {
            key: 'sub', name: '二级筛选',
            value: [
                { n: '全部/精选/推荐', v: '0' }, { n: '子类1(AI短剧/野果原创/国漫)', v: '1' },
                { n: '子类2(AI漫剧/真人短剧/日漫)', v: '2' }, { n: '子类3(魔改漫剧/同人)', v: '3' },
                { n: '子类4(网红改编/游戏同人)', v: '4' }, { n: '子类5(影视魔改/排行榜)', v: '5' }
            ]
        }
    ],
    hongtao: [{
        key: 'cat', name: '频道',
        value: [
            { n: '红桃原创', v: 'zhenren' }, { n: '甜宠言情', v: 'tc' }, { n: '逆袭爽剧', v: 'nx' },
            { n: '古装传奇', v: 'gz' }, { n: '都市生活', v: 'ds' }, { n: '玄幻奇幻', v: 'xh' },
            { n: '悬疑热血', v: 'xy' }, { n: '正经漫剧', v: 'manju' }, { n: '未分类短剧', v: 'unclassified' }
        ]
    }],
    caibian: [{ key: 'cat', name: '排序', value: [{ n: '最新', v: '0' }, { n: '推荐', v: '1' }, { n: '全部', v: '2' }] }],
    shortv: [{
        key: 'cat', name: '源频道',
        value: [
            { n: '全部', v: 'all' }, { n: 'Hanime', v: 'Hanime' },
            { n: 'NaughtyMachinima', v: 'NaughtyMachinima' }, { n: 'HS日本4K动漫', v: 'HS日本4K动漫' }
        ]
    }],
    heiliao: [{ key: 'cat', name: '频道', value: [{ n: '最新', v: '0' }, { n: '推荐', v: '1' }] }],
    hbo: [{ key: 'cat', name: '剧集类型', value: [{ n: '美剧', v: 'meiju' }, { n: '韩剧', v: 'hanju' }] }],
    live: [{
        key: 'cat', name: '分类与地区',
        value: [
            { n: '女主播', v: 'girls' }, { n: '情侣', v: 'couples' }, { n: '男主播', v: 'men' },
            { n: '跨性别', v: 'trans' }, { n: '中国', v: 'cn' }, { n: '日本', v: 'jp' }, { n: '韩国', v: 'kr' }
        ]
    }]
};

const SRC_MAP = {
    huangtao: 'duoju86', huangguo: 'huangguo', yeguo: 'duoju86', chengguo: 'duoju86', yizk: 'duoju86',
    huangdou: 'huangdou', chiguo: 'chiguo', pengran: 'pengran', erciyuan: 'huangdou', jinbi: 'huangdou',
    huiyuan: 'huangdou', zhenren: 'huangdou', tc: 'duoju89', nx: 'duoju89', gz: 'duoju89',
    ds: 'duoju89', xh: 'duoju89', xy: 'duoju89', manju: 'huangdou', unclassified: 'duoju89',
    meiju: 'huangdou', hanju: 'huangdou'
};

function firstVal(extend, key) {
    const v = extend ? extend[key] : undefined;
    return Array.isArray(v) ? v[0] : v;
}

// ===================== 接口定义 =====================
async function init(inReq) {
    try {
        const ext = inReq?.body;
        if (ext && typeof ext === 'object') return { options: ext };
        if (typeof ext === 'string' && ext.trim()) return { options: JSON.parse(ext) };
    } catch {}
    return {};
}

async function home() {
    return {
        class: CLASSES,
        filters: FILTERS,
        list: []
    };
}

async function category(inReq) {
    const tid = toStr(inReq.body?.id).trim();
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    const page = /^\d+$/.test(String(pg)) ? parseInt(pg, 10) : 1;
    const extend = inReq.body?.filters && typeof inReq.body.filters === 'object' ? inReq.body.filters : {};

    const cat = firstVal(extend, 'cat') || '';
    const sub = firstVal(extend, 'sub') || '';

    const params = { key: tid, page };
    let src = 'huangdou';

    if (tid === 'duanju') {
        const catVal = cat || 'huangtao';
        src = SRC_MAP[catVal] || 'duoju86';
        params.cat = catVal;
        params.src = src;
        params.sub = sub ? (/^\d+$/.test(String(sub)) ? parseInt(sub, 10) : sub) : 0;
    } else if (tid === 'hongtao') {
        const catVal = cat || 'zhenren';
        src = SRC_MAP[catVal] || 'huangdou';
        params.cat = catVal;
        params.src = src;
        params.sub = (catVal === 'zhenren' && sub) ? (/^\d+$/.test(String(sub)) ? parseInt(sub, 10) : 0) : 0;
    } else if (tid === 'hbo') {
        const catVal = cat || 'meiju';
        src = 'huangdou';
        params.cat = catVal;
        params.src = src;
        params.sub = 0;
    } else if (tid === 'caibian') {
        const catVal = cat || '0';
        src = 'huangdou';
        params.cat = catVal;
        params.src = src;
        params.nav = 'caibian';
        params.sub = /^\d+$/.test(String(catVal)) ? parseInt(catVal, 10) : 0;
    } else if (tid === 'guochan') {
        src = 'guochan';
        params.src = src;
    } else if (tid === 'video') {
        src = 'missav';
        params.src = src;
        if (cat) params.cat = cat;
    } else if (tid === 'shortv') {
        src = 'dongman';
        params.src = src;
        if (cat) params.cat = cat;
    } else {
        if (cat) params.cat = cat;
        if (extend.src) {
            src = extend.src;
            params.src = src;
        }
    }

    const cards = [];
    let hasMore = false;
    let pagecount = page;

    try {
        const res = await signedFetch('/api/module', { params, timeout: 10000 });
        const data = JSON.parse(res.content || '{}');
        const rawList = data.list || [];
        hasMore = Boolean(data.has_more);
        if (hasMore) pagecount = page + 1;

        const coverMod = ['duanju', 'hongtao', 'hbo'].includes(tid) ? src : tid;
        for (const item of rawList) {
            const itemId = toStr(item.id || item.code);
            if (!itemId) continue;

            const title = toStr(item.title || itemId).trim();
            const coverUrl = item.cover_n || item.cover || '';
            const pic = formatCover(coverMod, coverUrl);

            const rawRemark = toStr(item.remark || item.desc);
            const remarks = rawRemark ? `🦋 蝴蝶影视 · ${rawRemark.trim()}` : '🦋 蝴蝶影视';

            cards.push({
                vod_id: `${tid}@@${itemId}@@${src}`,
                vod_name: title,
                vod_pic: pic,
                vod_remarks: remarks
            });
        }
    } catch {}

    return {
        list: cards,
        page,
        pagecount,
        limit: cards.length,
        total: hasMore ? 9999 : (page * cards.length)
    };
}

async function detail(inReq) {
    const rawId = inReq.body?.id;
    const raw = Array.isArray(rawId) ? String(rawId[0] || '') : toStr(rawId);
    const parts = raw.split('@@');

    const mod = parts[0];
    const realId = parts[1] || raw;
    const src = parts[2] || '';

    const detailPath = `/api/detail/${mod}/${encodeURIComponent(realId)}`;
    const params = {};
    if (src) params.src = src;

    const vod = {
        vod_id: raw,
        vod_name: realId,
        vod_pic: '',
        vod_year: '',
        vod_area: '蜜桃',
        vod_remarks: '🦋 蝴蝶影视',
        vod_actor: '🦋 TG群: @tvshare23',
        vod_director: '🦋 蝴蝶影视',
        vod_content: '🦋 蝴蝶影视提醒：本影片仅供测试交流，请勿用于非法用途！',
        vod_play_from: '蜜桃专线',
        vod_play_url: ''
    };

    const playUrls = [];
    try {
        const res = await signedFetch(detailPath, { params, timeout: 10000 });
        const data = JSON.parse(res.content || '{}');
        const det = data.detail || {};

        if (det && Object.keys(det).length) {
            vod.vod_name = toStr(det.title || realId).trim();

            const coverMod = ['duanju', 'hongtao', 'hbo'].includes(mod) ? src : mod;
            vod.vod_pic = formatCover(coverMod, det.cover || '');
            if (det.date) vod.vod_year = String(det.date);

            const rawDesc = det.desc || '';
            vod.vod_content = `🦋 蝴蝶影视官方交流群: @tvshare23\n\n${rawDesc}`;

            const episodes = det.episodes || [];
            if (episodes.length) {
                for (const epItem of episodes) {
                    const epNo = toStr(epItem.ep || '1');
                    let rawName = toStr(epItem.name || `第${epNo}集`);
                    if (/^\d+$/.test(rawName)) {
                        rawName = `第${rawName}集`;
                    }
                    const epDisplay = epItem.lock ? `${rawName}[预告10s]` : rawName;
                    const playToken = `${mod}@@${realId}@@${epNo}@@${src}`;
                    playUrls.push(`${epDisplay}$${playToken}`);
                }
            } else {
                playUrls.push(`正片$${mod}@@${realId}@@1@@${src}`);
            }
        }
    } catch {
        playUrls.push(`正片$${mod}@@${realId}@@1@@${src}`);
    }

    vod.vod_play_url = playUrls.join('#');
    return { list: [vod] };
}

async function play(inReq) {
    const rawId = toStr(inReq.body?.id).trim();
    const parts = rawId.split('@@');
    const mod = parts[0];
    const realId = parts[1] || rawId;
    const ep = parts[2] || '1';
    const src = parts[3] || '';

    const playPath = `/api/play/${mod}/${encodeURIComponent(realId)}/${ep}`;
    const params = {};
    if (src) params.src = src;

    let finalUrl = '';
    try {
        const res = await signedFetch(playPath, { params, timeout: 10000 });
        const data = JSON.parse(res.content || '{}');
        const pl = data.play || {};
        const rawSrc = pl.src || '';
        const rawProxy = pl.src_proxy || '';

        let chosen = '';
        if (rawSrc.includes('preview-r10') && rawProxy) {
            chosen = rawProxy;
        } else {
            chosen = rawSrc || rawProxy;
        }

        if (chosen) {
            if (chosen.startsWith('/')) {
                finalUrl = `${SITE_URL}${chosen}`;
            } else {
                finalUrl = chosen;
            }
        }
    } catch {}

    if (finalUrl) {
        const lowerUrl = finalUrl.toLowerCase();
        if (!lowerUrl.includes('.m3u8') && !lowerUrl.includes('.mp4') && !lowerUrl.includes('.mpd')) {
            const sep = finalUrl.includes('?') ? '&' : '?';
            finalUrl = `${finalUrl}${sep}format=.m3u8`;
        }
    }

    let referer = 'https://honeypeach.cc/';
    if (finalUrl.includes('hembed.com') || finalUrl.includes('hanime')) {
        referer = 'https://hanime1.me/';
    }

    const headers = {
        'User-Agent': UA,
        'Referer': referer
    };

    return {
        parse: 0,
        jx: 0,
        url: finalUrl,
        header: headers
    };
}

async function search(inReq) {
    let pg = inReq.body?.page || 1;
    if (pg == 0) pg = 1;
    const page = /^\d+$/.test(String(pg)) ? parseInt(pg, 10) : 1;
    const key = toStr(inReq.body?.wd ?? inReq.body?.key);

    const searchMods = ['video', 'duanju', 'hongtao', 'hbo', 'shortv', 'guochan', 'caibian'];
    const cards = [];

    for (const mod of searchMods) {
        const params = { key: mod, kw: key, page };
        try {
            const res = await signedFetch('/api/search', { params, timeout: 8000 });
            const data = JSON.parse(res.content || '{}');
            const rawList = data.list || [];
            for (const item of rawList) {
                const itemId = toStr(item.id || item.code);
                if (!itemId) continue;

                const itemSrc = toStr(item.src || mod);
                const title = toStr(item.title || itemId).trim();
                const coverUrl = item.cover_n || item.cover || '';
                const pic = formatCover(['duanju', 'hongtao', 'hbo'].includes(mod) ? itemSrc : mod, coverUrl);

                const rawRemark = toStr(item.remark || item.desc);
                const remarks = rawRemark ? `🦋 蝴蝶影视 · ${rawRemark.trim()}` : '🦋 蝴蝶影视';

                cards.push({
                    vod_id: `${mod}@@${itemId}@@${itemSrc}`,
                    vod_name: title,
                    vod_pic: pic,
                    vod_remarks: remarks
                });
            }
        } catch {
            continue;
        }
    }

    return {
        list: cards,
        page,
        pagecount: cards.length >= 10 ? page + 1 : page,
        limit: cards.length,
        total: cards.length
    };
}

export default {
    meta: { key: 'mitao', name: '蝴蝶影视·暗夜蜜桃', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', init);
        fastify.post('/home', home);
        fastify.post('/category', category);
        fastify.post('/detail', detail);
        fastify.post('/play', play);
        fastify.post('/search', search);
    }
};
