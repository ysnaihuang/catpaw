import req from '../../util/req.js';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

// ================= 站点常量 =================
const GATEWAY_POOL = [
  'https://pl5kjl.jas49cht5sqrwet.xyz/fast-endecode/main/request',
  'https://pl5kjl.m93abv5upsv4s8f.xyz/fast-endecode/main/request',
  'https://api.y7hvaad8g.xyz/fast-endecode/main/request',
];
let activeGateway = GATEWAY_POOL[0];

// time % 10 -> AES-128-ECB key（固定使用 index 2，同时兼容动态索引响应解密）
const KEYS = {
  0: 'G7i3OPcfNhBnAYpc',
  1: '84UZNK33cSVylz6Y',
  2: 'jeSWRcTwHyAKwJDB',
  3: 'i1hvJx9vuRt5zEBS',
  4: '1Yy1KOa75R7cnmkg',
  6: 'T0RVp7KIPamrtQ33',
  8: 'ugvseZc5Kkj8ecmV',
  9: 'G7i3OPcfNhBnAYpc',
};
const REM = 2;
const ADS_CODE = 'DFH';

// 播放线路（vuex.app.allConfig.h5_play_line）
const PLAY_LINES = [
  ['国线1', 'https://rr.rxjhwl.com'],
  ['国线2', 'https://ww.wealwelloa.com'],
  ['国线3', 'https://cc.cloudworki.com'],
  ['国线4', 'https://gg.gmdalian.com'],
  ['海线1', 'https://allmusiclub.almusiclub.com'],
];

const PIC_BASE = 'https://qv1tx2.shoupingxz.com';

const UA =
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': UA,
  Referer: 'https://xx9.com/',
  Origin: 'https://xx9.com',
};

const CARD_STYLE = { type: 'rect', ratio: 1.78 };

// 专题分类（id -> title）
const THEMES = [
  ['27', '国产精选'],
  ['9', '主播剧情'],
  ['26', '业余素人'],
  ['47', '第一视角'],
  ['7', '欧美精选'],
  ['35', '日韩精选'],
  ['41', '粉嫩处女'],
  ['66', '偷窥偷拍监控'],
  ['50', '网爆偷拍泄密'],
  ['39', 'AV精选'],
  ['40', '职业探花'],
  ['55', '网红裸舞'],
  ['59', '抖音风合集'],
  ['36', '动漫精选'],
  ['67', '街拍街射'],
  ['42', '明星AI换脸'],
  ['15', '经典老片'],
  ['16', '成人综艺'],
  ['24', '恐怖科幻伦理'],
  ['19', '官方推荐'],
];

// ================= 状态与缓存 =================
let jwtTokenCache = null;
let jwtTokenTs = 0;
let accessTokenCache = null;
let accessTokenTs = 0;

// 详情页预解析播放缓存（vid -> { full, preview, ts }），TTL 10 分钟
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

// ================= 工具与加解密辅助 =================
function rnd(n = 32) {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += cs.charAt(Math.floor(Math.random() * cs.length));
  }
  return out;
}

function mktime() {
  const t = Date.now();
  return t - (t % 10) + REM;
}

function aesEncrypt(obj, keyStr = KEYS[REM]) {
  const raw = Buffer.from(
    typeof obj === 'string' ? obj : JSON.stringify(obj),
    'utf8'
  );
  const keyBuf = Buffer.from(keyStr, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-ecb', keyBuf, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(raw), cipher.final()]).toString('base64');
}

function aesDecrypt(b64, keyStr = KEYS[REM]) {
  const cleanB64 = String(b64 || '').trim();
  const keyBuf = Buffer.from(keyStr, 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuf, null);
  decipher.setAutoPadding(true);
  const out = Buffer.concat([
    decipher.update(Buffer.from(cleanB64, 'base64')),
    decipher.final(),
  ]);
  return out.toString('utf8');
}

function parseReqParams(inReq) {
  const merged = {};
  const sources = [inReq?.params, inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          continue;
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) {
          merged[k] = v;
        }
      } catch (_) {}
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function getCandidateGateways() {
  const list = [activeGateway, ...GATEWAY_POOL];
  return [...new Set(list.filter(Boolean))];
}

function decodeBodyBuffer(buf) {
  if (!Buffer.isBuffer(buf)) {
    return typeof buf === 'string' ? buf : JSON.stringify(buf ?? '');
  }
  let data = buf;
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = zlib.gunzipSync(data);
    } catch (_) {}
  }
  const utf8 = data.toString('utf8');
  if (utf8.includes('\ufffd')) {
    try {
      return new TextDecoder('gbk').decode(data);
    } catch (_) {}
  }
  return utf8;
}

function nativeHttpRequest(urlStr, { method = 'GET', headers = {}, body = null, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      reject(err);
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqHeaders = { ...headers };
    let bodyBuf = null;
    if (body !== null && body !== undefined) {
      bodyBuf = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      if (!reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
        reqHeaders['Content-Length'] = Buffer.byteLength(bodyBuf);
      }
    }
    const r = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        rejectUnauthorized: false,
        timeout,
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          const nextUrl = new URL(res.headers.location, urlStr).href;
          res.resume();
          nativeHttpRequest(nextUrl, { method, headers, body, timeout }).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 200,
            headers: res.headers || {},
            buffer: Buffer.concat(chunks),
          });
        });
      }
    );
    r.on('timeout', () => {
      r.destroy(new Error('Request timeout'));
    });
    r.on('error', reject);
    if (bodyBuf) r.write(bodyBuf);
    r.end();
  });
}

async function postJson(url, payload, headers) {
  try {
    let rsp;
    if (typeof req?.post === 'function') {
      rsp = await req.post(url, payload, { headers, timeout: 10000 });
    } else if (typeof req === 'function') {
      rsp = await req(url, {
        method: 'POST',
        data: payload,
        headers,
        timeout: 10000,
      });
    }
    if (rsp !== undefined && rsp !== null) {
      const raw = rsp.data !== undefined ? rsp.data : rsp.body !== undefined ? rsp.body : rsp;
      if (Buffer.isBuffer(raw)) {
        return decodeBodyBuffer(raw);
      }
      if (typeof raw === 'object') {
        return raw;
      }
      if (typeof raw === 'string' && raw.trim()) {
        return raw;
      }
    }
  } catch (_) {}

  const fallback = await nativeHttpRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    timeout: 10000,
  });
  return decodeBodyBuffer(fallback.buffer);
}

async function fetchBinary(url, headers) {
  try {
    let rsp;
    if (typeof req?.get === 'function') {
      rsp = await req.get(url, {
        headers,
        responseType: 'arraybuffer',
        timeout: 10000,
      });
    } else if (typeof req === 'function') {
      rsp = await req(url, {
        method: 'GET',
        headers,
        responseType: 'arraybuffer',
        timeout: 10000,
      });
    }
    const raw = rsp?.data !== undefined ? rsp.data : rsp?.body !== undefined ? rsp.body : rsp;
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof ArrayBuffer) return Buffer.from(raw);
    if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
    if (typeof raw === 'string' && raw.length > 0) return Buffer.from(raw, 'binary');
  } catch (_) {}

  const fallback = await nativeHttpRequest(url, {
    method: 'GET',
    headers,
    timeout: 10000,
  });
  return fallback.buffer;
}

// ================= 网关请求与鉴权 =================
function decryptGatewayData(j, defaultKey) {
  if (!j || typeof j !== 'object') return j;
  if (typeof j.data === 'string' && j.data && 'time' in j) {
    const candidateKeys = [defaultKey];
    const remKey = KEYS[Number(j.time) % 10];
    if (remKey && !candidateKeys.includes(remKey)) {
      candidateKeys.push(remKey);
    }
    for (const k of candidateKeys) {
      try {
        const plainText = aesDecrypt(j.data, k);
        return JSON.parse(plainText);
      } catch (_) {}
    }
  }
  return j;
}

async function callGateway(
  uri,
  method,
  { params = null, body = null, useJwt = true, useAccess = false, _retry = true } = {}
) {
  const key = KEYS[REM];
  const t = mktime();
  const plain = { method, uri };
  if (body !== null && body !== undefined) {
    plain.body = body;
  } else {
    plain.params = params !== null && params !== undefined ? params : {};
  }

  const payload = {
    data: aesEncrypt(plain, key),
    time: t,
  };

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': UA,
    Origin: 'https://xx9.com',
    Referer: 'https://xx9.com/',
  };

  if (useJwt) {
    const jwt = await getJwtToken();
    if (jwt) headers.jwtToken = jwt;
  }
  if (useAccess) {
    const acc = await getAccessToken();
    if (acc) headers.accessToken = acc;
  }

  let parsed = null;
  for (const gw of getCandidateGateways()) {
    try {
      const rawResp = await postJson(gw, payload, headers);
      if (!rawResp) continue;
      const obj = typeof rawResp === 'string' ? JSON.parse(rawResp) : rawResp;
      if (obj && typeof obj === 'object') {
        activeGateway = gw;
        parsed = obj;
        break;
      }
    } catch (_) {
      continue;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return {};
  }

  const decoded = decryptGatewayData(parsed, key);

  // accessToken 为空(1032) / 过期(1019) -> 刷新后重试一次
  if (useAccess && _retry && decoded && typeof decoded === 'object') {
    const code = String(decoded.code || '');
    if (code === '1032' || code === '1019') {
      accessTokenCache = null;
      accessTokenTs = 0;
      return callGateway(uri, method, {
        params,
        body,
        useJwt,
        useAccess,
        _retry: false,
      });
    }
  }

  return decoded;
}

async function getJwtToken() {
  const now = Date.now();
  if (jwtTokenCache && now - jwtTokenTs < 3600 * 1000) {
    return jwtTokenCache;
  }
  try {
    const r = await callGateway('app/jwt-token', 1, {
      params: { adsCode: ADS_CODE },
      useJwt: false,
      useAccess: false,
    });
    const jwt =
      r && typeof r === 'object'
        ? typeof r.result === 'string'
          ? r.result
          : r.result?.jwtToken || r.data?.result || null
        : null;
    if (jwt) {
      jwtTokenCache = jwt;
      jwtTokenTs = now;
    }
  } catch (_) {}
  return jwtTokenCache;
}

async function getAccessToken() {
  const now = Date.now();
  if (accessTokenCache && now - accessTokenTs < 1800 * 1000) {
    return accessTokenCache;
  }
  try {
    const body = {
      osType: 'h5',
      sign: rnd(32),
      machineCode: 'chrome',
      version: 'xx9.com',
    };
    const r = await callGateway('user/register/free', 2, {
      body,
      useJwt: true,
      useAccess: false,
    });
    const res = r && typeof r === 'object' ? r.result || r.data : null;
    const acc =
      res && typeof res === 'object'
        ? res.accessToken || res.token || null
        : typeof res === 'string'
        ? res
        : null;
    if (acc) {
      accessTokenCache = acc;
      accessTokenTs = now;
    }
  } catch (_) {}
  return accessTokenCache;
}

// ================= 图片代理与卡片格式化 =================
function absPic(p) {
  if (!p) return '';
  const s = String(p).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return PIC_BASE + (s.startsWith('/') ? s : `/${s}`);
}

function getRoutePrefix(inReq) {
  if (inReq?.server?.prefix) {
    return String(inReq.server.prefix).replace(/\/+$/, '');
  }
  const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
  if (!rawUrl) return '';
  return rawUrl.replace(/\/(init|home|category|detail|play|search|proxy|xx9_pic)\/?$/i, '');
}

function buildPicUrl(p, inReq) {
  const u = absPic(p);
  if (!u) return '';
  if (typeof inReq?.getProxyUrl === 'function') {
    try {
      const base = inReq.getProxyUrl();
      if (base) {
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}url=${encodeURIComponent(u)}&type=img`;
      }
    } catch (_) {}
  }
  const prefix = getRoutePrefix(inReq);
  const host = inReq?.headers?.['x-forwarded-host'] || inReq?.headers?.host || '';
  const proto = inReq?.headers?.['x-forwarded-proto'] || inReq?.protocol || 'http';
  if (host) {
    return `${proto}://${host}${prefix}/xx9_pic?url=${encodeURIComponent(u)}&type=img`;
  }
  if (prefix) {
    return `${prefix}/xx9_pic?url=${encodeURIComponent(u)}&type=img`;
  }
  return `/xx9_pic?url=${encodeURIComponent(u)}&type=img`;
}

function formatDuration(dur) {
  const n = Number(dur);
  if (!Number.isFinite(n) || n <= 0) return '';
  const totalSec = Math.floor(n);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toVodListItem(it, inReq) {
  if (!it || typeof it !== 'object') return null;
  const vid = it.id ?? it.vodId;
  if (vid === undefined || vid === null || vid === '') return null;
  const title = String(it.title || it.vodName || '');
  const pic = buildPicUrl(it.vodPic || it.gif || '', inReq);
  let remark = formatDuration(it.vodDuration);
  if (!remark && Array.isArray(it.tags) && it.tags.length > 0) {
    remark = it.tags.slice(0, 3).join(' ');
  }
  return {
    vod_id: String(vid),
    vod_name: title,
    vod_pic: pic,
    vod_remarks: remark,
    style: CARD_STYLE,
  };
}

async function searchVod(params) {
  const r = await callGateway('cms/vod/search', 2, { params });
  const data = r && typeof r === 'object' ? r.data ?? r.result : null;
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === 'object') {
    items = data.list || data.records || [];
  }
  const total = Number((r && r.total) ?? (data && data.total) ?? 0) || 0;
  return { items: Array.isArray(items) ? items : [], total };
}

function detectImgMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  const head6 = buf.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF89a' || head6 === 'GIF87a') {
    return 'image/gif';
  }
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function proxyPicHandler(query = {}) {
  let url = query.url || '';
  if (url) {
    try {
      url = decodeURIComponent(url);
    } catch (_) {}
  }
  if (!url) {
    return { status: 404, mime: 'text/plain', data: Buffer.alloc(0) };
  }
  try {
    const raw = await fetchBinary(url, {
      'User-Agent': UA,
      Referer: 'https://xx9.com/',
    });
    if (!raw || raw.length === 0) {
      return { status: 404, mime: 'text/plain', data: Buffer.alloc(0) };
    }
    // 若已经是明文图片则直接返回
    const directMime = detectImgMime(raw);
    if (directMime) {
      return { status: 200, mime: directMime, data: raw };
    }
    // 首字节为 XOR key，其余字节 ^ key 解密
    if (raw.length > 1) {
      const key = raw[0];
      const out = Buffer.allocUnsafe(raw.length - 1);
      for (let i = 1; i < raw.length; i += 1) {
        out[i - 1] = raw[i] ^ key;
      }
      const xorMime = detectImgMime(out);
      if (xorMime) {
        return { status: 200, mime: xorMime, data: out };
      }
    }
    return { status: 200, mime: 'image/jpeg', data: raw };
  } catch (_) {
    return { status: 404, mime: 'text/plain', data: Buffer.alloc(0) };
  }
}

// ================= 核心接口实现 =================
async function init() {
  jwtTokenCache = null;
  jwtTokenTs = 0;
  accessTokenCache = null;
  accessTokenTs = 0;
  return {};
}

async function home(inReq) {
  const classes = THEMES.map(([type_id, type_name]) => ({
    type_id,
    type_name,
  }));
  const sortFilter = {
    key: 'sort',
    name: '排序',
    value: [
      { n: '最新', v: '1' },
      { n: '最热', v: '2' },
    ],
  };
  const filters = {};
  for (const [tid] of THEMES) {
    filters[tid] = [sortFilter];
  }

  let list = [];
  try {
    const { items } = await searchVod({
      themeIds: THEMES[0][0],
      page: 1,
      pageSize: 30,
      explore: false,
      sortType: 1,
    });
    list = items.map((it) => toVodListItem(it, inReq)).filter(Boolean);
  } catch (_) {
    list = [];
  }

  return {
    class: classes,
    filters,
    list,
    style: CARD_STYLE,
  };
}

async function category(inReq) {
  const params = parseReqParams(inReq);
  const tid = String(params.id ?? params.tid ?? THEMES[0][0]);
  const pgNum = parseInt(params.page ?? params.pg ?? '1', 10);
  const page = Number.isFinite(pgNum) && pgNum > 0 ? pgNum : 1;

  let extend = params.extend ?? params.ext ?? params.filters ?? {};
  if (typeof extend === 'string' && extend.trim()) {
    try {
      extend = JSON.parse(extend);
    } catch (_) {
      try {
        extend = JSON.parse(Buffer.from(extend, 'base64').toString('utf8'));
      } catch (__) {
        extend = {};
      }
    }
  }

  let sortType = 1;
  const rawSort = extend?.sort ?? params.sort;
  if (rawSort !== undefined && rawSort !== null && rawSort !== '') {
    const parsedSort = parseInt(String(rawSort), 10);
    if (Number.isFinite(parsedSort) && parsedSort > 0) {
      sortType = parsedSort;
    }
  }

  const pageSize = 30;
  const { items, total } = await searchVod({
    themeIds: tid,
    page,
    pageSize,
    explore: false,
    sortType,
  });

  const list = items.map((it) => toVodListItem(it, inReq)).filter(Boolean);
  const pagecount = total > 0 ? Math.ceil(total / pageSize) : 9999;

  return {
    list,
    page,
    pagecount,
    limit: pageSize,
    total: total > 0 ? total : list.length,
    style: CARD_STYLE,
  };
}

async function fetchVodDetail(vid) {
  const r = await callGateway(`cms/vod/detail/${vid}`, 1, {
    params: { needCdnAuth: true },
    useAccess: true,
  });
  const res = r && typeof r === 'object' ? r.result ?? r.data : null;
  const vod =
    res && typeof res === 'object'
      ? res.vod && typeof res.vod === 'object'
        ? res.vod
        : res
      : null;

  if (vod && typeof vod === 'object' && Object.keys(vod).length > 0) {
    const full = Array.isArray(vod.vodFullPlayUrl) ? vod.vodFullPlayUrl : [];
    const preview = vod.preview || '';
    if (full.length > 0 || preview) {
      PLAY_CACHE.set(String(vid), {
        full,
        preview,
        ts: Date.now(),
      });
    }
    return vod;
  }
  return null;
}

async function detail(inReq) {
  const params = parseReqParams(inReq);
  const rawId = params.id ?? params.ids ?? params.vod_id ?? '';
  const vid = Array.isArray(rawId) ? String(rawId[0] ?? '') : String(rawId || '');
  if (!vid) {
    return { list: [] };
  }

  const vod = await fetchVodDetail(vid);
  if (!vod) {
    return { list: [] };
  }

  const title = String(vod.title || vod.vodName || '');
  const pic = buildPicUrl(vod.vodPic || '', inReq);
  const intro = String(vod.vodIntro || '');
  const tagStr = Array.isArray(vod.tags) ? vod.tags.join(',') : String(vod.tags || '');
  const durStr = formatDuration(vod.vodDuration);
  const remark = durStr ? `时长 ${durStr}` : '';

  const full = Array.isArray(vod.vodFullPlayUrl) ? vod.vodFullPlayUrl : [];
  const nParts = full.length > 0 ? full.length : 1;

  const froms = [];
  const urls = [];
  for (const [lineName] of PLAY_LINES) {
    const eps = [];
    if (nParts <= 1) {
      eps.push(`正片$${vid}|0`);
    } else {
      for (let i = 0; i < nParts; i += 1) {
        eps.push(`P${i + 1}$${vid}|${i}`);
      }
    }
    froms.push(lineName);
    urls.push(eps.join('#'));
  }

  return {
    list: [
      {
        vod_id: String(vid),
        vod_name: title,
        vod_pic: pic,
        vod_remarks: remark,
        vod_content: intro || tagStr,
        vod_tag: tagStr,
        vod_play_from: froms.join('$$$'),
        vod_play_url: urls.join('$$$'),
      },
    ],
  };
}

async function search(inReq) {
  const params = parseReqParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pgNum = parseInt(params.page ?? params.pg ?? '1', 10);
  const page = Number.isFinite(pgNum) && pgNum > 0 ? pgNum : 1;
  if (!key) {
    return { list: [], page, pagecount: 0, limit: 30, total: 0 };
  }

  const { items, total } = await searchVod({
    title: key,
    page,
    pageSize: 30,
    explore: false,
    sortType: 1,
  });

  const list = items.map((it) => toVodListItem(it, inReq)).filter(Boolean);
  return {
    list,
    page,
    pagecount: total > 0 ? Math.ceil(total / 30) : list.length > 0 ? 1 : 0,
    limit: 30,
    total: total > 0 ? total : list.length,
    style: CARD_STYLE,
  };
}

function sanitizePlayId(rawId) {
  let idStr = String(rawId || '').trim();
  if (!idStr) return '';
  if (idStr.includes('@@@')) {
    idStr = idStr.split('@@@')[0].trim();
  }
  if (idStr.includes('$')) {
    const dollarIdx = idStr.indexOf('$');
    const prefix = idStr.slice(0, dollarIdx);
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      idStr = idStr.slice(dollarIdx + 1).trim();
    }
  }
  return idStr;
}

function resolveLineDomain(flag) {
  const cleanFlag = String(flag || '').trim();
  for (const [name, dom] of PLAY_LINES) {
    if (name === cleanFlag) return dom;
  }
  return PLAY_LINES[0][1];
}

function joinDomainAndAddr(domain, addr) {
  const cleanAddr = String(addr || '').trim();
  if (!cleanAddr) return '';
  if (/^https?:\/\//i.test(cleanAddr)) return cleanAddr;
  const cleanDom = String(domain || '').replace(/\/+$/, '');
  return `${cleanDom}${cleanAddr.startsWith('/') ? cleanAddr : `/${cleanAddr}`}`;
}

async function play(inReq) {
  const params = parseReqParams(inReq);
  const flag = params.flag ?? params.from ?? '';
  const rawId = sanitizePlayId(params.id ?? params.url ?? '');

  const playHeaders = { ...DEFAULT_HEADERS };

  if (/^https?:\/\//i.test(rawId)) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: rawId,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  let vid = rawId;
  let idx = 0;
  if (rawId.includes('|')) {
    const [vPart, idxPart] = rawId.split('|', 2);
    vid = vPart.trim();
    const parsedIdx = parseInt(idxPart, 10);
    if (Number.isFinite(parsedIdx) && parsedIdx >= 0) {
      idx = parsedIdx;
    }
  }

  const domain = resolveLineDomain(flag);
  let playUrl = '';

  if (vid) {
    let full = null;
    let preview = '';

    const cached = PLAY_CACHE.get(String(vid));
    if (cached && Date.now() - cached.ts < PLAY_CACHE_TTL) {
      full = cached.full;
      preview = cached.preview;
    } else {
      try {
        const vod = await fetchVodDetail(vid);
        if (vod) {
          full = Array.isArray(vod.vodFullPlayUrl) ? vod.vodFullPlayUrl : [];
          preview = vod.preview || '';
        }
      } catch (_) {}
    }

    let addr = '';
    if (Array.isArray(full) && full.length > 0) {
      const targetIdx = idx >= full.length ? 0 : idx;
      const entry = full[targetIdx];
      addr = typeof entry === 'string' ? entry : entry?.addr || entry?.url || '';
    }
    if (!addr && preview) {
      addr = preview;
    }
    if (addr) {
      playUrl = joinDomainAndAddr(domain, addr);
    }
  }

  return {
    parse: 0,
    jx: 0,
    playUrl: '',
    url: playUrl,
    header: playHeaders,
    headers: playHeaders,
  };
}

export default {
  meta: {
    key: 'xx9',
    name: 'xx9',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/xx9_pic', async (request, reply) => {
      const res = await proxyPicHandler(request?.query || {});
      if (reply && typeof reply.code === 'function') {
        reply.code(res.status);
      }
      return reply.type(res.mime).send(res.data);
    });
    fastify.get('/proxy', async (request, reply) => {
      const res = await proxyPicHandler(request?.query || {});
      if (reply && typeof reply.code === 'function') {
        reply.code(res.status);
      }
      return reply.type(res.mime).send(res.data);
    });
  },
};