import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';
import http from 'node:http';
import https from 'node:https';

const SITE_DOMAINS = [
  'https://333.9959hsck.cc',
  'http://333.9959hsck.cc',
  'https://hsck.tv',
  'https://hsckzy888.com',
  'https://hsckzy.net',
  'https://hsckzy.vip',
  'https://hsckzy.com',
  'https://hsckzy.xyz',
  'https://hsckzy001.com',
  'https://hszyckapi.vip',
];

// 官方通告替换失效播放域名映射表
const STREAM_HOST_REPLACEMENTS = new Map([
  ['hsm3.fhu3hh.com', 'hsm3.hwzcfz.com'],
]);

const API_PATH = '/api.php/provide/vod/';
const PIC_PROXY_DEFAULT = 'https://wsrv.nl/?url=';
const PIC_SUFFIX_DEFAULT = '&output=jpg&w=400&q=80';
const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const LIVE_TYPES = [
  [7, '日本有码'],
  [8, '无码中文字幕'],
  [9, '有码中文字幕'],
  [10, '日本无码'],
  [15, '国产视频'],
  [21, '欧美高清'],
  [22, '动漫剧情'],
  [26, '骑兵破解'],
];

const state = {
  activeDomain: SITE_DOMAINS[0],
  customApi: '',
  domains: [...SITE_DOMAINS],
  ua: DEFAULT_UA,
  timeout: 15000,
  retry: 2,
  allTypes: 0,
  picMode: 'proxy', // 'proxy' | 'cdn' | 'src' | 'local'
  picProxy: PIC_PROXY_DEFAULT,
  picSuffix: PIC_SUFFIX_DEFAULT,
  proxyStream: 0, // 1: 默认强制走本地流式代理; 0: 标准直连 + 按需代理
  diag: '',
};

// 播放缓存、详情缓存与流解密上下文缓存（TTL 10 分钟）
const CACHE_TTL_MS = 10 * 60 * 1000;
const PLAY_CACHE = new Map();
const DETAIL_CACHE = new Map();
const STREAM_META_CACHE = new Map();

function setCache(map, key, val) {
  if (!key) return;
  map.set(String(key), { val, ts: Date.now() });
}

function getCache(map, key) {
  if (!key) return null;
  const entry = map.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    map.delete(String(key));
    return null;
  }
  return entry.val;
}

// ---------------- 参数归一化 ----------------
function unwrapParams(inReq) {
  const merged = {};
  const absorb = (src) => {
    if (!src) return;
    if (typeof src === 'string') {
      const s = src.trim();
      if (!s) return;
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          const parsed = JSON.parse(s);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(merged, parsed);
            return;
          }
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(s);
        for (const [k, v] of sp.entries()) merged[k] = v;
      } catch (_) {}
      return;
    }
    if (typeof src === 'object' && !Array.isArray(src)) {
      Object.assign(merged, src);
    }
  };
  absorb(inReq?.params);
  absorb(inReq?.query);
  absorb(inReq?.body);
  return merged;
}

function applyConfig(cfgRaw) {
  let cfg = {};
  if (cfgRaw) {
    if (typeof cfgRaw === 'string') {
      try {
        cfg = JSON.parse(cfgRaw);
      } catch (_) {
        cfg = {};
      }
    } else if (typeof cfgRaw === 'object') {
      cfg = cfgRaw;
    }
  }
  if (!cfg || typeof cfg !== 'object') cfg = {};

  if (cfg.ext && typeof cfg.ext === 'object') {
    cfg = { ...cfg, ...cfg.ext };
  } else if (typeof cfg.ext === 'string' && cfg.ext.trim().startsWith('{')) {
    try {
      cfg = { ...cfg, ...JSON.parse(cfg.ext) };
    } catch (_) {}
  }
  if (cfg.extend && typeof cfg.extend === 'object') {
    cfg = { ...cfg, ...cfg.extend };
  } else if (typeof cfg.extend === 'string' && cfg.extend.trim().startsWith('{')) {
    try {
      cfg = { ...cfg, ...JSON.parse(cfg.extend) };
    } catch (_) {}
  }

  const api = String(cfg.api || '').trim();
  if (api) {
    state.customApi = api.endsWith('/') ? api : `${api}/`;
    const base = state.customApi.split('/api.php')[0].replace(/\/+$/, '');
    if (base && /^https?:\/\//i.test(base)) {
      state.activeDomain = base;
      if (!state.domains.includes(base)) {
        state.domains.unshift(base);
      }
    }
  }
  if (cfg.site) {
    const site = String(cfg.site).trim().replace(/\/+$/, '');
    if (site && /^https?:\/\//i.test(site)) {
      state.activeDomain = site;
      if (!state.domains.includes(site)) {
        state.domains.unshift(site);
      }
    }
  }
  if (Array.isArray(cfg.domains) && cfg.domains.length > 0) {
    const cleanDomains = cfg.domains
      .map((d) => String(d || '').trim().replace(/\/+$/, ''))
      .filter((d) => /^https?:\/\//i.test(d));
    if (cleanDomains.length > 0) {
      state.domains = Array.from(new Set([...cleanDomains, ...SITE_DOMAINS]));
      state.activeDomain = state.domains[0];
    }
  }
  if (cfg.ua) state.ua = String(cfg.ua);
  if (cfg.timeout) {
    const t = Number(cfg.timeout);
    if (Number.isFinite(t) && t > 0) {
      state.timeout = t <= 120 ? t * 1000 : t;
    }
  }
  if (cfg.retry) {
    const r = Number(cfg.retry);
    if (Number.isFinite(r) && r >= 1) state.retry = Math.floor(r);
  }
  if (cfg.all_types !== undefined) {
    state.allTypes = Number(cfg.all_types) ? 1 : 0;
  }
  if (cfg.proxy_stream !== undefined || cfg.proxy !== undefined) {
    const p = cfg.proxy_stream !== undefined ? cfg.proxy_stream : cfg.proxy;
    state.proxyStream = p === 1 || p === '1' || p === true ? 1 : 0;
  }
  const mode = String(cfg.pic_mode || '').trim().toLowerCase();
  if (['proxy', 'cdn', 'src', 'local'].includes(mode)) {
    state.picMode = mode;
  }
  if ('pic_proxy' in cfg) {
    state.picProxy = String(cfg.pic_proxy || '');
  }
  if ('pic_suffix' in cfg) {
    state.picSuffix = String(cfg.pic_suffix || '');
  } else if (state.picProxy && !state.picProxy.includes('wsrv.nl')) {
    state.picSuffix = '';
  }
}

// ---------------- 域名池与网络层 ----------------
function getCandidateDomains() {
  const seen = new Set();
  const list = [];
  for (const d of [state.activeDomain, ...state.domains, ...SITE_DOMAINS]) {
    const clean = String(d || '').trim().replace(/\/+$/, '');
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      list.push(clean);
    }
  }
  return list;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h.includes('hsck') || h.includes('hszyck')) return true;
  for (const d of getCandidateDomains()) {
    try {
      if (new URL(d).hostname.toLowerCase() === h) return true;
    } catch (_) {}
  }
  return false;
}

function expandCandidateUrls(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return [];
  const domains = getCandidateDomains();
  if (raw.startsWith('/')) {
    return domains.map((d) => `${d}${raw}`);
  }
  try {
    const u = new URL(raw);
    if (isKnownSiteHost(u.hostname)) {
      const pathAndQuery = `${u.pathname}${u.search}`;
      const list = domains.map((d) => `${d}${pathAndQuery}`);
      if (!list.includes(raw)) list.unshift(raw);
      return Array.from(new Set(list));
    }
  } catch (_) {}
  return [raw];
}

function buildHeaders(targetUrl, customReferer = '', extraHeaders = {}) {
  let origin = state.activeDomain;
  try {
    origin = new URL(targetUrl).origin;
  } catch (_) {}
  let referer = customReferer || `${origin}/`;
  if (customReferer) {
    try {
      const refUrl = new URL(customReferer);
      const tgtUrl = new URL(targetUrl);
      if (isKnownSiteHost(refUrl.hostname) && isKnownSiteHost(tgtUrl.hostname)) {
        referer = `${tgtUrl.origin}${refUrl.pathname}${refUrl.search}`;
      }
    } catch (_) {}
  }
  const hdrs = {
    'User-Agent': state.ua,
    Accept: 'application/json, text/plain, */*',
    'Accept-Encoding': 'identity',
    Referer: referer,
    ...extraHeaders,
  };
  if (referer === null || referer === '') {
    delete hdrs.Referer;
  }
  return hdrs;
}

function decodeBuffer(buf, contentEncoding = '') {
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  const enc = String(contentEncoding || '').toLowerCase();
  if (enc.includes('gzip') || (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b)) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch (_) {}
  } else if (enc.includes('deflate')) {
    try {
      raw = zlib.inflateRawSync(raw);
    } catch (_) {
      try {
        raw = zlib.inflateSync(raw);
      } catch (__) {}
    }
  }
  const utf8 = raw.toString('utf8');
  if (!utf8.includes('\ufffd')) return utf8;
  try {
    const gbk = new TextDecoder('gbk').decode(raw);
    if (!gbk.includes('\ufffd') || gbk.split('\ufffd').length < utf8.split('\ufffd').length) {
      return gbk;
    }
  } catch (_) {}
  return utf8;
}

function nativeRequestBuffer(targetUrl, headers, timeoutMs, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err, val) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(val);
    };
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return done(e);
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers,
      timeout: timeoutMs,
      rejectUnauthorized: false,
    };
    const request = lib.request(options, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && maxRedirects > 0) {
        res.resume();
        try {
          const nextUrl = new URL(res.headers.location, targetUrl).href;
          const redirectHeaders = { ...headers };
          try {
            const nextOrigin = new URL(nextUrl).origin;
            if (redirectHeaders.Referer && isKnownSiteHost(new URL(nextUrl).hostname)) {
              redirectHeaders.Referer = `${nextOrigin}/`;
            }
          } catch (_) {}
          nativeRequestBuffer(nextUrl, redirectHeaders, timeoutMs, maxRedirects - 1).then(
            (r) => done(null, r),
            (e) => done(e)
          );
        } catch (e) {
          done(e);
        }
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        done(null, {
          status,
          headers: res.headers || {},
          buffer: Buffer.concat(chunks),
          finalUrl: targetUrl,
        });
      });
      res.on('error', (e) => done(e));
    });
    request.on('timeout', () => {
      request.destroy(new Error(`Request timeout (${timeoutMs}ms): ${targetUrl}`));
    });
    request.on('error', (e) => done(e));
    request.end();
  });
}

async function fetchRawOnce(targetUrl, customReferer = '', extraHeaders = {}) {
  const headers = buildHeaders(targetUrl, customReferer, extraHeaders);
  const isLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(targetUrl);

  // 本地回环地址或带 Range 请求头时优先使用原生 http/https 以保留完整状态码与响应头
  if (!isLocalhost && !extraHeaders.Range && !extraHeaders.range && typeof req === 'function') {
    try {
      const resp = await req(targetUrl, {
        method: 'GET',
        headers,
        timeout: state.timeout,
        buffer: 2,
      });
      if (resp) {
        const status = Number(resp.status || resp.statusCode || 200);
        const respHeaders = resp.headers || {};
        const data = resp.data !== undefined ? resp.data : resp.body !== undefined ? resp.body : resp;
        if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
          const buf = Buffer.from(data);
          return {
            status,
            headers: respHeaders,
            buffer: buf,
            text: decodeBuffer(buf, respHeaders['content-encoding']),
            finalUrl: resp.url || targetUrl,
          };
        }
        if (typeof data === 'string') {
          return {
            status,
            headers: respHeaders,
            buffer: Buffer.from(data, 'utf8'),
            text: data,
            finalUrl: resp.url || targetUrl,
          };
        }
        if (data && typeof data === 'object') {
          const text = JSON.stringify(data);
          return {
            status,
            headers: respHeaders,
            buffer: Buffer.from(text, 'utf8'),
            text,
            json: data,
            finalUrl: resp.url || targetUrl,
          };
        }
      }
    } catch (_) {
      // 回退到原生 http/https
    }
  }
  const nativeRes = await nativeRequestBuffer(targetUrl, headers, state.timeout);
  return {
    status: nativeRes.status,
    headers: nativeRes.headers,
    buffer: nativeRes.buffer,
    text: decodeBuffer(nativeRes.buffer, nativeRes.headers['content-encoding']),
    finalUrl: nativeRes.finalUrl,
  };
}

function isValidSiteHtml(html) {
  const s = String(html || '');
  if (s.length < 30) return false;
  return (
    s.includes('player_aaaa') ||
    s.includes('player_data') ||
    s.includes('player_config') ||
    s.includes('decryptDatas') ||
    s.includes('eval(function') ||
    s.includes('m3u8') ||
    s.includes('.mp4') ||
    s.includes('<video') ||
    s.includes('<iframe') ||
    s.includes('vod_play') ||
    s.includes('vodplay') ||
    s.includes('hsck') ||
    s.includes('黄色仓库') ||
    /<h1[\s>]/i.test(s)
  );
}

async function fetchTextWithFailover(urlOrPath, customReferer = '', checkHtmlFingerprint = false) {
  const candidates = expandCandidateUrls(urlOrPath);
  let lastErr = null;
  for (const candidate of candidates) {
    for (let i = 0; i < Math.max(1, state.retry); i++) {
      try {
        const res = await fetchRawOnce(candidate, customReferer);
        if (res.status >= 400) {
          throw new Error(`HTTP ${res.status}`);
        }
        if (checkHtmlFingerprint && !isValidSiteHtml(res.text)) {
          throw new Error('Invalid site fingerprint / parking page');
        }
        try {
          const u = new URL(candidate);
          if (isKnownSiteHost(u.hostname)) {
            state.activeDomain = u.origin;
          }
        } catch (_) {}
        return { text: res.text, finalUrl: res.finalUrl || candidate, headers: res.headers };
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error(`Fetch failed: ${urlOrPath}`);
}

async function callCmsApi(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') {
      qs.set(k, String(v));
    }
  }
  const queryString = qs.toString();
  const baseCandidates = state.customApi
    ? [state.customApi, ...getCandidateDomains().map((d) => `${d}${API_PATH}`)]
    : getCandidateDomains().map((d) => `${d}${API_PATH}`);

  let lastErr = null;
  for (const apiBase of Array.from(new Set(baseCandidates))) {
    const fullUrl = `${apiBase}?${queryString}`;
    for (let i = 0; i < Math.max(1, state.retry); i++) {
      try {
        const res = await fetchRawOnce(fullUrl);
        if (res.status >= 400) {
          state.diag = `HTTP ${res.status}`;
          throw new Error(`HTTP ${res.status}`);
        }
        let j = res.json;
        if (!j) {
          const txt = String(res.text || '').trim();
          try {
            j = JSON.parse(txt);
          } catch (_) {
            const head = txt.replace(/\s+/g, ' ').slice(0, 60);
            state.diag = `非JSON|${head}`;
            throw new Error(`接口返回非 JSON：${head}`);
          }
        }
        if (!j || typeof j !== 'object' || !Array.isArray(j.list)) {
          const head = JSON.stringify(j || '').slice(0, 60);
          state.diag = `结构异常|${head}`;
          throw new Error(`接口结构异常：${head}`);
        }
        try {
          const u = new URL(apiBase);
          state.activeDomain = u.origin;
        } catch (_) {}
        state.diag = '';
        return j;
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr || new Error('API request failed');
}

// ---------------- 文本与实体工具 ----------------
function cleanText(s) {
  let out = String(s ?? '');
  out = out
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
  return out.trim();
}

function htmlToText(s) {
  let out = String(s ?? '');
  out = out.replace(/\r/g, '\n');
  out = out.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<\/p>/gi, '\n');
  out = out.replace(/<[^>]+>/g, '');
  out = cleanText(out);
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function buildRemark(it) {
  const r = cleanText(it?.vod_remarks);
  if (r) return r;
  const t = cleanText(it?.vod_time);
  return t ? t.slice(0, 10) : cleanText(it?.type_name);
}

function rewriteCdnPic(it, pic) {
  const pu = String(it?.vod_play_url || '');
  let m = pu.match(/(https:\/\/[^/]+)\/video\/m3u8\/(.+?)\/index\.m3u8/i);
  if (!m) {
    m = pu.match(/(https:\/\/[^/]+)\/video\/m3u8\/(.+?)\//i);
  }
  if (!m) return '';
  const [, host, d] = m;
  if (pic.includes('/video/')) {
    const tail = pic.replace(/^https?:\/\/[^/]+/i, '');
    return `${host}${tail}`;
  }
  return `${host}/video/m3u8/${d}/vod.jpg`;
}

function resolvePicUrl(it, inReq = null) {
  const pic = cleanText(it?.vod_pic);
  if (!pic || !/^https?:\/\//i.test(pic)) return '';
  if (state.picMode === 'src') return pic;
  if (state.picMode === 'cdn') {
    return rewriteCdnPic(it, pic) || pic;
  }
  if (state.picMode === 'local' && inReq) {
    const prefix = getRoutePrefix(inReq);
    return `${prefix}/hsck1_pic?url=${encodeURIComponent(pic)}`;
  }
  if (state.picProxy) {
    return `${state.picProxy}${encodeURIComponent(pic)}${state.picSuffix}`;
  }
  return pic;
}

// ---------------- 播放解析与加密/包装剥离 ----------------
const AD_OR_DECOY_PATTERNS = [
  /preview\.mp4/i,
  /sample\.mp4/i,
  /trailer\.mp4/i,
  /top_banner/i,
  /native-ad/i,
  /stat\.php/i,
  /\/login\b/i,
];

function isDecoyMediaUrl(u) {
  const s = String(u || '');
  return AD_OR_DECOY_PATTERNS.some((re) => re.test(s));
}

function replaceDeprecatedStreamHost(urlStr) {
  const raw = String(urlStr || '').trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const lowerHost = parsed.hostname.toLowerCase();
    if (STREAM_HOST_REPLACEMENTS.has(lowerHost)) {
      parsed.hostname = STREAM_HOST_REPLACEMENTS.get(lowerHost);
      return parsed.href;
    }
  } catch (_) {}
  return raw;
}

function hasNestedStreamQueryParam(parsedUrl) {
  if (!parsedUrl || !parsedUrl.searchParams) return false;
  for (const key of ['url', 'v', 'vid', 'src']) {
    const val = parsedUrl.searchParams.get(key);
    if (val && (/^https?:\/\//i.test(val) || /^https?%3A/i.test(val) || /\.(m3u8|mp4)/i.test(val))) {
      return true;
    }
  }
  return false;
}

function isDirectMediaUrl(u) {
  const raw = String(u || '').trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  if (isDecoyMediaUrl(raw)) return false;
  try {
    const parsed = new URL(raw);
    // 若携带指向内层媒体地址的 ?url= / ?v= 参数（如 https://jx.bfhsck.com/m3u8/?url=...），属于解析包装页而非直链
    if (hasNestedStreamQueryParam(parsed)) {
      return false;
    }
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(m3u8|mp4|flv|mpd|ts|mkv|webm)$/i.test(pathname)) {
      return true;
    }
    if (/\.(html?|php|jsp|asp)$/i.test(pathname)) {
      return false;
    }
    if (/\/(m3u8|hls|stream)\//i.test(pathname) && !parsed.searchParams.has('url')) {
      return /\.(m3u8|mp4)/i.test(pathname);
    }
  } catch (_) {}
  return false;
}

function customUnescape(str) {
  let s = String(str || '');
  s = s.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return s;
}

function normalizeEscapedString(str) {
  let s = String(str || '');
  s = s.replace(/\\\//g, '/');
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  s = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return cleanText(s);
}

function decodeCmsPlayerUrl(rawUrl, encryptType = 0) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const enc = Number(encryptType || 0);
  if (enc === 1) {
    try {
      u = decodeURIComponent(u);
    } catch (_) {
      u = customUnescape(u);
    }
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      try {
        u = decodeURIComponent(b64Decoded);
      } catch (_) {
        u = customUnescape(b64Decoded);
      }
    } catch (_) {}
  }
  return replaceDeprecatedStreamHost(normalizeEscapedString(u));
}

function unwrapNestedUrlParam(urlStr, baseOrigin = state.activeDomain) {
  let cur = replaceDeprecatedStreamHost(normalizeEscapedString(urlStr));
  for (let pass = 0; pass < 3; pass++) {
    if (!cur) break;
    if (cur.startsWith('/')) {
      cur = `${baseOrigin}${cur}`;
    }
    cur = replaceDeprecatedStreamHost(cur);
    if (isDirectMediaUrl(cur)) return cur;
    try {
      const parsed = new URL(cur, baseOrigin);
      const nested =
        parsed.searchParams.get('url') ||
        parsed.searchParams.get('v') ||
        parsed.searchParams.get('vid') ||
        parsed.searchParams.get('src');
      if (nested) {
        let decoded = nested;
        for (let i = 0; i < 2; i++) {
          try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
          } catch (_) {
            decoded = customUnescape(decoded);
          }
        }
        cur = replaceDeprecatedStreamHost(normalizeEscapedString(decoded));
        continue;
      }
    } catch (_) {}
    break;
  }
  return replaceDeprecatedStreamHost(cur);
}

function sanitizePlayId(rawId) {
  let id = String(rawId || '').trim();
  if (!id) return '';
  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }
  const dollarIdx = id.indexOf('$');
  if (dollarIdx !== -1) {
    const prefix = id.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      id = id.slice(dollarIdx + 1).trim();
    }
  }
  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }
  return replaceDeprecatedStreamHost(id);
}

function buildPlayPairs(it) {
  const froms = String(it?.vod_play_from || '')
    .split('$$$')
    .map((x) => x.trim());
  const urls = String(it?.vod_play_url || '').split('$$$');
  const routeGroups = [];
  let firstDirectUrl = '';
  let firstAnyUrl = '';

  for (let i = 0; i < urls.length; i++) {
    const blk = String(urls[i] || '').trim();
    if (!blk) continue;
    const rawParts = blk
      .split('#')
      .map((x) => x.trim())
      .filter(Boolean);
    const multi = rawParts.length > 1;
    const eps = [];
    let groupHasDirect = false;

    for (let idx = 0; idx < rawParts.length; idx++) {
      const part = rawParts[idx];
      let pname = '';
      let purl = part;
      const dollarIdx = part.indexOf('$');
      if (dollarIdx !== -1) {
        pname = part.slice(0, dollarIdx);
        purl = part.slice(dollarIdx + 1);
      }
      purl = sanitizePlayId(purl);
      if (!purl) continue;

      const unwrapped = unwrapNestedUrlParam(purl, state.activeDomain);
      const effectiveUrl = isDirectMediaUrl(unwrapped) ? unwrapped : purl;

      if (!pname) {
        pname = multi ? `第${String(idx + 1).padStart(2, '0')}集` : buildRemark(it) || '正片';
      }
      if (!firstAnyUrl) firstAnyUrl = effectiveUrl;
      if (isDirectMediaUrl(effectiveUrl)) {
        groupHasDirect = true;
        if (!firstDirectUrl) firstDirectUrl = effectiveUrl;
      }
      eps.push(`${cleanText(pname)}$${effectiveUrl}`);
    }
    if (!eps.length) continue;
    const f = froms[i] ? froms[i] : `线路${routeGroups.length + 1}`;
    routeGroups.push({
      from: f,
      url: eps.join('#'),
      isDirect: groupHasDirect,
    });
  }

  // 优先将包含直链（如 ckm3u8 / m3u8）的播放线路排在前面，避免默认点击包装页失败
  routeGroups.sort((a, b) => Number(b.isDirect) - Number(a.isDirect));

  return {
    playFrom: routeGroups.map((g) => g.from).join('$$$'),
    playUrl: routeGroups.map((g) => g.url).join('$$$'),
    firstDirectUrl: firstDirectUrl || firstAnyUrl,
  };
}

function formatVodItem(it, inReq = null, includeDetailFields = false) {
  const vid = String(it?.vod_id ?? '').trim();
  const name = cleanText(it?.vod_name) || `视频 ${vid}`;
  const content = htmlToText(it?.vod_blurb) || htmlToText(it?.vod_content);
  const { playFrom, playUrl, firstDirectUrl } = buildPlayPairs(it);

  if (vid && firstDirectUrl && isDirectMediaUrl(firstDirectUrl)) {
    setCache(PLAY_CACHE, vid, firstDirectUrl);
  }
  if (vid && it && typeof it === 'object') {
    setCache(DETAIL_CACHE, vid, it);
  }

  const vod = {
    vod_id: vid,
    vod_name: name,
    vod_pic: resolvePicUrl(it, inReq),
    vod_remarks: buildRemark(it),
    vod_year: cleanText(it?.vod_year),
    vod_area: cleanText(it?.vod_area),
    type_name: cleanText(it?.type_name),
    vod_content: content,
  };

  if (includeDetailFields) {
    vod.vod_actor = cleanText(it?.vod_actor);
    vod.vod_director = cleanText(it?.vod_director);
    vod.vod_pubdate = cleanText(it?.vod_pubdate);
    vod.vod_play_from = playFrom || 'dplayer';
    vod.vod_play_url = playUrl || (firstDirectUrl ? `正片$${firstDirectUrl}` : '');
    if (!vod.vod_content) {
      const bits = [vod.type_name, cleanText(it?.vod_time)].filter(Boolean);
      vod.vod_content = bits.join(' / ');
    }
  }
  return vod;
}

function buildDiagCard(where) {
  const apiUrl = state.customApi || `${state.activeDomain}${API_PATH}`;
  return [
    {
      vod_id: 'diag',
      vod_name: `[诊断] ${where} | ${state.diag || '无数据'}`,
      vod_pic: '',
      vod_remarks: '接口异常',
      vod_content: `接口：${apiUrl}\n请检查域名是否更换（本站换域名频繁），可在配置里用 {"api": "http://新域名/api.php/provide/vod/"} 覆盖。`,
    },
  ];
}

async function loadClasses() {
  const cls = [{ type_id: 'new', type_name: '最新更新' }];
  let remote = [];
  try {
    const j = await callCmsApi({ ac: 'list', pg: 1 });
    if (Array.isArray(j.class)) remote = j.class;
  } catch (_) {
    remote = [];
  }
  const liveMap = new Map(LIVE_TYPES.map(([id, name]) => [Number(id), name]));
  if (state.allTypes && remote.length > 0) {
    for (const c of remote) {
      cls.push({
        type_id: String(c.type_id),
        type_name: cleanText(c.type_name),
      });
    }
    return cls;
  }
  if (remote.length > 0) {
    for (const c of remote) {
      const tid = Number(c.type_id || 0);
      if (liveMap.has(tid)) {
        cls.push({
          type_id: String(tid),
          type_name: cleanText(c.type_name) || liveMap.get(tid),
        });
      }
    }
    if (cls.length > 1) return cls;
    // 若新镜像站分类 ID 体系已变更，直接采用远端返回的真实分类
    for (const c of remote) {
      if (c && c.type_id !== undefined && cleanText(c.type_name)) {
        cls.push({
          type_id: String(c.type_id),
          type_name: cleanText(c.type_name),
        });
      }
    }
    if (cls.length > 1) return cls;
  }
  for (const [tid, name] of LIVE_TYPES) {
    cls.push({ type_id: String(tid), type_name: name });
  }
  return cls;
}

// 平衡大括号扫描器（防止 player_aaaa 内嵌 vod_data: {...} 截断）
function extractBalancedJsonObject(source, varName) {
  const s = String(source || '');
  const re = new RegExp(`(?:var|let|const|window\\.)?\\s*${varName}\\s*=\\s*\\{`, 'g');
  const results = [];
  let match;
  while ((match = re.exec(s)) !== null) {
    const startIdx = match.index + match[0].length - 1;
    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;
    for (let i = startIdx; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quoteChar) {
          inString = false;
        }
      } else {
        if (ch === '"' || ch === "'") {
          inString = true;
          quoteChar = ch;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            results.push(s.slice(startIdx, i + 1));
            break;
          }
        }
      }
    }
  }
  return results;
}

// Dean Edwards Packer 单遍词边界解包
function unpackDeanEdwards(html) {
  const s = String(html || '');
  const unpackedBlocks = [];
  const packerRe =
    /eval\(\s*function\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\5)[\s\S])*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = packerRe.exec(s)) !== null) {
    const payload = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const symtab = m[6].split('|');
    if (!radix || !count || !symtab.length) continue;

    const encodeBase = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) {
        return num < 36 ? num.toString(36) : chars[num];
      }
      return encodeBase(Math.floor(num / base), base) + encodeBase(num % base, base);
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      dict.set(key, symtab[i] || key);
    }
    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (token) =>
      dict.has(token) ? dict.get(token) : token
    );
    unpackedBlocks.push(unpacked);
  }
  return unpackedBlocks;
}

// 解析 decryptDatas("base64...", "key") 或分离变量模式并解密清单
function tryDecryptManifestBlocks(text, baseOrigin = state.activeDomain) {
  const s = String(text || '');
  if (!s.includes('decrypt')) return '';

  const pairs = [];
  const inlineRe = /decryptDatas?\s*\(\s*['"]([A-Za-z0-9+/=]{16,})['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = inlineRe.exec(s)) !== null) {
    pairs.push([m[1], m[2]]);
  }

  // 支持 const datas = "..."; decryptDatas(datas, "key") 分离变量声明
  const varCallRe = /decryptDatas?\s*\(\s*([a-zA-Z_$][\w$]*)\s*,\s*(?:['"]([^'"]+)['"]|([a-zA-Z_$][\w$]*))\s*\)/g;
  while ((m = varCallRe.exec(s)) !== null) {
    const dataVar = m[1];
    let keyVal = m[2] || '';
    const keyVar = m[3] || '';
    const dataMatch = s.match(new RegExp(`(?:var|let|const)?\\s*${dataVar}\\s*=\\s*['"]([A-Za-z0-9+/=]{16,})['"]`));
    if (!keyVal && keyVar) {
      const keyMatch = s.match(new RegExp(`(?:var|let|const)?\\s*${keyVar}\\s*=\\s*(?:CryptoJS\\.enc\\.Utf8\\.parse\\(\\s*)?['"]([^'"]+)['"]`));
      if (keyMatch) keyVal = keyMatch[1];
    }
    if (dataMatch && keyVal) {
      pairs.push([dataMatch[1], keyVal]);
    }
  }

  for (const [cipherB64, rawKey] of pairs) {
    try {
      const rawBuf = Buffer.from(cipherB64, 'base64');
      let plain = '';
      // 尝试 JSON 包装格式 {"encryptedData":"...","iv":"...","key":"..."}
      const asText = rawBuf.toString('utf8');
      if (asText.trim().startsWith('{')) {
        const env = JSON.parse(asText);
        if (env.media && (env.md5_id || env.slug)) {
          const mediaUrl = new URL(env.media, baseOrigin).href;
          const seed = `${env.user_id || ''}${env.slug || ''}${env.md5_id || ''}${rawKey || ''}`;
          const hashHex = crypto.createHash('md5').update(seed).digest('hex');
          setCache(STREAM_META_CACHE, mediaUrl, {
            mode: 'aes-ctr',
            key: Buffer.from(hashHex.slice(0, 16), 'utf8'),
            iv: Buffer.from(hashHex.slice(16, 32), 'utf8'),
          });
          return mediaUrl;
        }
        if (env.encryptedData && env.iv) {
          const kBuf = Buffer.alloc(16);
          Buffer.from(env.key || rawKey, 'utf8').copy(kBuf);
          const ivBuf = Buffer.from(env.iv, 'base64').subarray(0, 16);
          const decipher = crypto.createDecipheriv('aes-128-cbc', kBuf, ivBuf);
          plain = Buffer.concat([
            decipher.update(Buffer.from(env.encryptedData, 'base64')),
            decipher.final(),
          ]).toString('utf8');
        }
      }
      if (!plain) {
        const keyBytes = Buffer.alloc(16);
        Buffer.from(rawKey, 'utf8').copy(keyBytes);
        const ivBytes = Buffer.alloc(16);
        Buffer.from(rawKey, 'utf8').copy(ivBytes);
        const decipher = crypto.createDecipheriv('aes-128-cbc', keyBytes, ivBytes);
        plain = Buffer.concat([decipher.update(rawBuf), decipher.final()]).toString('utf8');
      }
      if (plain) {
        if (plain.trim().startsWith('{')) {
          try {
            const obj = JSON.parse(plain);
            if (obj.media) {
              const mediaUrl = new URL(obj.media, baseOrigin).href;
              const seed = `${obj.user_id || ''}${obj.slug || ''}${obj.md5_id || ''}${rawKey || ''}`;
              const hashHex = crypto.createHash('md5').update(seed).digest('hex');
              setCache(STREAM_META_CACHE, mediaUrl, {
                mode: 'aes-ctr',
                key: Buffer.from(hashHex.slice(0, 16), 'utf8'),
                iv: Buffer.from(hashHex.slice(16, 32), 'utf8'),
              });
              return mediaUrl;
            }
            const u = unwrapNestedUrlParam(obj.url || obj.playUrl || obj.videoUrl || '', baseOrigin);
            if (isDirectMediaUrl(u)) return u;
          } catch (_) {}
        }
        const extracted = unwrapNestedUrlParam(plain, baseOrigin);
        if (isDirectMediaUrl(extracted)) return extracted;
      }
    } catch (_) {}
  }
  return '';
}

function extractStreamFromTextBlock(block, baseOrigin = state.activeDomain) {
  const text = String(block || '');
  if (!text) return '';

  // Stage 1: CMS 播放器配置对象
  for (const varName of ['player_aaaa', 'player_data', 'player_config']) {
    const jsonBlocks = extractBalancedJsonObject(text, varName);
    for (const jb of jsonBlocks) {
      try {
        const obj = JSON.parse(jb);
        const decoded = decodeCmsPlayerUrl(obj.url, obj.encrypt);
        const unwrapped = unwrapNestedUrlParam(decoded, baseOrigin);
        if (isDirectMediaUrl(unwrapped)) return unwrapped;
      } catch (_) {
        const urlMatch = jb.match(/["']url["']\s*:\s*["']([^"']+)["']/);
        const encMatch = jb.match(/["']encrypt["']\s*:\s*(\d+)/);
        if (urlMatch) {
          const decoded = decodeCmsPlayerUrl(urlMatch[1], encMatch ? Number(encMatch[1]) : 0);
          const unwrapped = unwrapNestedUrlParam(decoded, baseOrigin);
          if (isDirectMediaUrl(unwrapped)) return unwrapped;
        }
      }
    }
  }

  // Stage 1.5: 加密播放清单 decryptDatas 解密
  const decryptedUrl = tryDecryptManifestBlocks(text, baseOrigin);
  if (decryptedUrl) return decryptedUrl;

  // Stage 2: 高优先级变量提取（优先高置信度变量，严格过滤 decoy 与非媒体路径）
  const normalized = normalizeEscapedString(text);
  const priorityVarRe =
    /\b(?:video_url|videoUrl|m3u8_url|hlsUrl|realPlayUrl|vipPlayUrl|playUrl|url)\s*[:=]\s*['"]([^'"]+)['"]/gi;
  let vm;
  while ((vm = priorityVarRe.exec(normalized)) !== null) {
    const rawCandidate = vm[1].trim();
    if (!rawCandidate || rawCandidate === 'none') continue;
    let candidate = unwrapNestedUrlParam(rawCandidate, baseOrigin);
    if (candidate.startsWith('/')) {
      candidate = `${baseOrigin}${candidate}`;
    }
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  // Stage 2.5: <video> 与 <source> 标签直链扫描
  const tagSrcRe = /<(?:video|source)\b[^>]*?\b(?:data-src|src)\s*=\s*['"]([^'"]+)['"]/gi;
  let tm;
  while ((tm = tagSrcRe.exec(normalized)) !== null) {
    let candidate = unwrapNestedUrlParam(tm[1], baseOrigin);
    if (candidate.startsWith('/')) {
      candidate = `${baseOrigin}${candidate}`;
    }
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  // Stage 3: 全文直接媒体正则扫描
  const directRe = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let dm;
  while ((dm = directRe.exec(normalized)) !== null) {
    const candidate = unwrapNestedUrlParam(dm[0], baseOrigin);
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  return '';
}

function extractIframeUrls(html, baseOrigin = state.activeDomain) {
  const s = String(html || '');
  const urls = [];
  const iframeRe = /<iframe\b[^>]*>/gi;
  let m;
  while ((m = iframeRe.exec(s)) !== null) {
    const tag = m[0];
    for (const attr of ['data-litespeed-src', 'data-lazy-src', 'data-src', 'src']) {
      const attrRe = new RegExp(`\\b${attr}\\s*=\\s*['"]([^'"]+)['"]`, 'i');
      const am = tag.match(attrRe);
      if (am && am[1]) {
        const raw = cleanText(am[1]).trim();
        if (!raw || /^(?:about:blank|javascript:|data:)/i.test(raw)) continue;
        try {
          const full = new URL(raw, baseOrigin).href;
          if (!urls.includes(full)) urls.push(full);
        } catch (_) {}
      }
    }
  }
  return urls;
}

function extractAlternatePlayRoutes(html, currentUrl) {
  const s = String(html || '');
  const routes = [];
  const re = /href\s*=\s*['"]([^'"]*(?:\/(?:vodplay|play|watch)\b|vod-play-id)[^'"]*)['"]/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const href = cleanText(m[1]);
    if (!href) continue;
    try {
      const full = new URL(href, currentUrl || state.activeDomain).href;
      if (full !== currentUrl && !routes.includes(full)) {
        routes.push(full);
      }
    } catch (_) {}
  }
  return routes;
}

async function resolveStreamFromPage(pageUrl, referer = '', depth = 0) {
  if (depth > 2) return '';
  const unwrappedInput = unwrapNestedUrlParam(pageUrl, state.activeDomain);
  if (isDirectMediaUrl(unwrappedInput)) return unwrappedInput;

  const { text: html, finalUrl } = await fetchTextWithFailover(pageUrl, referer, true);
  let origin = state.activeDomain;
  try {
    origin = new URL(finalUrl).origin;
  } catch (_) {}

  // Stage 1 & 3: 直接从 HTML 提取
  const direct = extractStreamFromTextBlock(html, origin);
  if (direct) return direct;

  // Stage 2: Packer 解包提取
  const unpackedList = unpackDeanEdwards(html);
  for (const block of unpackedList) {
    const fromPacker = extractStreamFromTextBlock(block, origin);
    if (fromPacker) return fromPacker;
  }

  // Stage 4: 追踪内嵌 iframe
  const iframes = extractIframeUrls(html, origin);
  for (const iframeUrl of iframes) {
    const unwrapped = unwrapNestedUrlParam(iframeUrl, origin);
    if (isDirectMediaUrl(unwrapped)) return unwrapped;
    try {
      const sub = await resolveStreamFromPage(iframeUrl, finalUrl, depth + 1);
      if (sub) return sub;
    } catch (_) {}
  }

  // Stage 5: 备用播放线路自动切换
  if (depth === 0) {
    const altRoutes = extractAlternatePlayRoutes(html, finalUrl).slice(0, 3);
    for (const altUrl of altRoutes) {
      try {
        const sub = await resolveStreamFromPage(altUrl, finalUrl, depth + 1);
        if (sub) return sub;
      } catch (_) {}
    }
  }

  return '';
}

function getRoutePrefix(inReq) {
  if (inReq?.server?.prefix) {
    return String(inReq.server.prefix).replace(/\/+$/, '');
  }
  const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
  return rawUrl.replace(
    /\/(init|home|homeVod|category|detail|play|search|hsck1_pic|proxy(?:\.m3u8|\.ts|\.mp4)?)\/?$/i,
    ''
  );
}

// ---------------- 本地流式代理（HLS 清单重写 / TS 伪装分片 / AES-KEY / MP4 Range） ----------------
let localProxyServer = null;
let localProxyPort = 0;

function decryptAesCtrRange(buffer, keyBuf, ivBuf, byteOffset = 0) {
  const blockIndex = Math.floor(byteOffset / 16);
  const byteOffsetInBlock = byteOffset % 16;

  const counter = Buffer.from(ivBuf);
  let carry = blockIndex;
  for (let i = 15; i >= 0 && carry > 0; i--) {
    const sum = counter[i] + (carry & 0xff);
    counter[i] = sum & 0xff;
    carry = Math.floor(carry / 256) + (sum >> 8);
  }

  const decipher = crypto.createDecipheriv('aes-128-ctr', keyBuf, counter);
  const paddedInput =
    byteOffsetInBlock > 0 ? Buffer.concat([Buffer.alloc(byteOffsetInBlock), buffer]) : buffer;
  const decrypted = Buffer.concat([decipher.update(paddedInput), decipher.final()]);
  return byteOffsetInBlock > 0 ? decrypted.subarray(byteOffsetInBlock) : decrypted;
}

function rewriteM3u8Manifest(manifestText, baseManifestUrl, proxyBaseUrl, customReferer = '') {
  const lines = String(manifestText || '').split(/\r?\n/);
  const refParam = customReferer ? `&ref=${encodeURIComponent(customReferer)}` : '';

  const buildProxiedUrl = (rawUri, forceType = '') => {
    const cleanUri = String(rawUri || '').trim();
    if (!cleanUri) return cleanUri;
    let absUrl = cleanUri;
    try {
      absUrl = new URL(cleanUri, baseManifestUrl).href;
    } catch (_) {}
    absUrl = replaceDeprecatedStreamHost(absUrl);

    let typeHint = forceType;
    if (!typeHint) {
      try {
        const pathname = new URL(absUrl).pathname.toLowerCase();
        if (pathname.endsWith('.m3u8')) {
          typeHint = 'm3u8';
        } else if (pathname.endsWith('.mp4') || pathname.endsWith('.m4s')) {
          typeHint = 'mp4';
        } else {
          typeHint = 'ts';
        }
      } catch (_) {
        typeHint = 'ts';
      }
    }

    const endpoint =
      typeHint === 'm3u8'
        ? '/proxy.m3u8'
        : typeHint === 'mp4'
          ? '/proxy.mp4'
          : typeHint === 'key'
            ? '/proxy'
            : '/proxy.ts';
    return `${proxyBaseUrl}${endpoint}?url=${encodeURIComponent(absUrl)}&type=${typeHint}${refParam}`;
  };

  let expectSubPlaylist = false;
  const outLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      if (/^#EXT-X-STREAM-INF/i.test(trimmed)) {
        expectSubPlaylist = true;
      }
      if (/URI\s*=\s*"([^"]+)"/i.test(trimmed)) {
        const isKey = /^#EXT-X-(?:SESSION-)?KEY/i.test(trimmed);
        const isMap = /^#EXT-X-MAP/i.test(trimmed);
        const isMedia = /^#EXT-X-MEDIA/i.test(trimmed);
        const hint = isKey ? 'key' : isMap ? 'mp4' : isMedia ? 'm3u8' : 'ts';
        return line.replace(/URI\s*=\s*"([^"]+)"/gi, (_, uri) => `URI="${buildProxiedUrl(uri, hint)}"`);
      }
      return line;
    }

    const isM3u8Line =
      expectSubPlaylist || /\.m3u8(?:\?|$)/i.test(trimmed);
    expectSubPlaylist = false;
    return buildProxiedUrl(trimmed, isM3u8Line ? 'm3u8' : 'ts');
  });

  return outLines.join('\n');
}

async function fetchStreamWithRefererFallback(targetUrl, customReferer = '', extraHeaders = {}) {
  const refererCandidates = [];
  if (customReferer) refererCandidates.push(customReferer);
  refererCandidates.push(`${state.activeDomain}/`);
  try {
    refererCandidates.push(`${new URL(targetUrl).origin}/`);
  } catch (_) {}
  refererCandidates.push('');

  let lastRes = null;
  let lastErr = null;
  for (const ref of Array.from(new Set(refererCandidates))) {
    try {
      const res = await fetchRawOnce(targetUrl, ref, extraHeaders);
      lastRes = res;
      if (res.status < 400) {
        return res;
      }
      if (res.status !== 403 && res.status !== 401) {
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastRes) return lastRes;
  throw lastErr || new Error(`Stream fetch failed: ${targetUrl}`);
}

async function handleStreamProxy(query = {}, reqHeaders = {}, proxyBaseUrl = '') {
  const rawTarget = String(query.url || '').trim();
  if (!rawTarget) {
    return {
      status: 400,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: Buffer.from('Missing url parameter', 'utf8'),
    };
  }

  const targetUrl = unwrapNestedUrlParam(rawTarget, state.activeDomain);
  const customReferer = String(query.ref || '').trim();
  const typeHint = String(query.type || '').trim().toLowerCase();
  const rangeHeader = String(reqHeaders.range || reqHeaders.Range || '').trim();

  const extraHeaders = {};
  if (rangeHeader && typeHint !== 'm3u8' && typeHint !== 'key') {
    extraHeaders.Range = rangeHeader;
  }

  try {
    const upstream = await fetchStreamWithRefererFallback(targetUrl, customReferer, extraHeaders);
    const upstreamCt = String(upstream.headers?.['content-type'] || '').toLowerCase();
    const firstChars = upstream.buffer.subarray(0, 16).toString('utf8').trim();

    let isM3u8 =
      typeHint === 'm3u8' ||
      upstreamCt.includes('mpegurl') ||
      firstChars.startsWith('#EXTM3U');
    if (!isM3u8 && !typeHint) {
      try {
        if (new URL(targetUrl).pathname.toLowerCase().endsWith('.m3u8')) {
          isM3u8 = true;
        }
      } catch (_) {}
    }

    if (isM3u8) {
      const manifestText = upstream.text || upstream.buffer.toString('utf8');
      const rewritten = rewriteM3u8Manifest(
        manifestText,
        upstream.finalUrl || targetUrl,
        proxyBaseUrl,
        customReferer
      );
      const bodyBuf = Buffer.from(rewritten, 'utf8');
      return {
        status: 200,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'content-length': String(bodyBuf.length),
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
        },
        body: bodyBuf,
      };
    }

    let outBuffer = upstream.buffer;
    let outStatus = upstream.status || 200;
    const outHeaders = {
      'access-control-allow-origin': '*',
      'accept-ranges': 'bytes',
    };

    if (upstream.headers?.['content-range']) {
      outHeaders['content-range'] = upstream.headers['content-range'];
    }

    // 若上游未处理 Range 但客户端请求了 Range（例如本地缓冲或回源 200），在代理层按 Range 切片返回 206
    let byteStart = 0;
    if (rangeHeader && outStatus === 200) {
      const rm = rangeHeader.match(/bytes=(\d+)-(\d*)/i);
      if (rm) {
        const total = outBuffer.length;
        byteStart = parseInt(rm[1], 10);
        const byteEnd = rm[2] ? Math.min(parseInt(rm[2], 10), total - 1) : total - 1;
        if (byteStart < total && byteStart <= byteEnd) {
          outBuffer = outBuffer.subarray(byteStart, byteEnd + 1);
          outStatus = 206;
          outHeaders['content-range'] = `bytes ${byteStart}-${byteEnd}/${total}`;
        }
      }
    } else if (outHeaders['content-range']) {
      const cm = String(outHeaders['content-range']).match(/bytes\s+(\d+)-/i);
      if (cm) byteStart = parseInt(cm[1], 10);
    }

    // 检查是否需要 AES-CTR 实时解密
    const streamMeta = getCache(STREAM_META_CACHE, targetUrl);
    if (streamMeta && streamMeta.mode === 'aes-ctr' && streamMeta.key && streamMeta.iv) {
      outBuffer = decryptAesCtrRange(outBuffer, streamMeta.key, streamMeta.iv, byteStart);
    }

    // 确定准确的 MIME 类型（确保伪装成 .jpg/.png 的 HLS 分片返回 video/mp2t）
    let mime = 'application/octet-stream';
    if (typeHint === 'ts') {
      mime = 'video/mp2t';
    } else if (typeHint === 'key') {
      mime = 'application/octet-stream';
    } else if (typeHint === 'mp4') {
      mime = 'video/mp4';
    } else {
      try {
        const p = new URL(targetUrl).pathname.toLowerCase();
        if (p.endsWith('.ts')) mime = 'video/mp2t';
        else if (p.endsWith('.mp4') || p.endsWith('.m4s')) mime = 'video/mp4';
        else if (upstreamCt && !upstreamCt.startsWith('image/')) {
          mime = upstreamCt.split(';')[0];
        }
      } catch (_) {}
    }

    outHeaders['content-type'] = mime;
    outHeaders['content-length'] = String(outBuffer.length);

    return {
      status: outStatus,
      headers: outHeaders,
      body: outBuffer,
    };
  } catch (e) {
    const msg = Buffer.from(`Proxy error: ${e?.message || e}`, 'utf8');
    return {
      status: 502,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(msg.length),
        'access-control-allow-origin': '*',
      },
      body: msg,
    };
  }
}

async function ensureLocalProxyServer() {
  if (localProxyServer && localProxyPort > 0) {
    return `http://127.0.0.1:${localProxyPort}`;
  }
  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (reqIncoming, resOutgoing) => {
      try {
        const u = new URL(reqIncoming.url || '/', `http://${reqIncoming.headers.host || '127.0.0.1'}`);
        if (reqIncoming.method === 'OPTIONS') {
          resOutgoing.writeHead(204, {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET, HEAD, OPTIONS',
            'access-control-allow-headers': '*',
          });
          resOutgoing.end();
          return;
        }
        const query = Object.fromEntries(u.searchParams.entries());
        if (u.pathname.endsWith('/hsck1_pic')) {
          const picRes = await proxyPicHandler(query);
          resOutgoing.writeHead(200, {
            'content-type': picRes.mime,
            'content-length': String(picRes.data.length),
            'access-control-allow-origin': '*',
          });
          resOutgoing.end(picRes.data);
          return;
        }
        const prefix = u.pathname.replace(/\/proxy(?:\.m3u8|\.ts|\.mp4)?\/?$/i, '');
        const base = `http://${reqIncoming.headers.host || `127.0.0.1:${localProxyPort}`}${prefix}`;
        const result = await handleStreamProxy(query, reqIncoming.headers || {}, base);
        resOutgoing.writeHead(result.status, result.headers);
        resOutgoing.end(result.body);
      } catch (err) {
        resOutgoing.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        resOutgoing.end(String(err?.message || err));
      }
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      localProxyPort = typeof addr === 'object' && addr ? addr.port : 0;
      localProxyServer = srv;
      if (typeof srv.unref === 'function') {
        srv.unref();
      }
      resolve(`http://127.0.0.1:${localProxyPort}`);
    });
  });
}

async function resolveProxyBaseUrl(inReq) {
  const prefix = getRoutePrefix(inReq);
  const host = String(inReq?.headers?.host || '').trim();
  if (host) {
    const proto = String(inReq?.headers?.['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
    return `${proto}://${host}${prefix}`;
  }
  const localOrigin = await ensureLocalProxyServer();
  return `${localOrigin}${prefix}`;
}

// ---------------- Fastify 路由处理函数 ----------------
async function init(inReq) {
  const params = unwrapParams(inReq);
  applyConfig(params);
  return {};
}

async function home(inReq) {
  const params = unwrapParams(inReq);
  const wantFilter = Boolean(params.filter);
  const classes = await loadClasses();
  const res = {
    class: classes,
    filters: {},
    list: [],
    style: { type: 'rect', ratio: 1.78 },
  };
  if (wantFilter) {
    for (const c of classes) {
      res.filters[c.type_id] = [];
    }
  }
  try {
    const j = await callCmsApi({ ac: 'detail', pg: 1 });
    res.list = (j.list || []).map((it) => formatVodItem(it, inReq, false));
  } catch (_) {
    res.list = buildDiagCard('首页');
  }
  return res;
}

async function homeVod(inReq) {
  try {
    const j = await callCmsApi({ ac: 'detail', pg: 1 });
    return {
      list: (j.list || []).map((it) => formatVodItem(it, inReq, false)),
    };
  } catch (_) {
    return { list: buildDiagCard('推荐') };
  }
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const tid = String(params.id ?? params.tid ?? 'new').trim() || 'new';
  let pg = parseInt(params.page ?? params.pg ?? '1', 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;

  const apiParams = { ac: 'detail', pg };
  if (tid !== 'new' && tid !== '0' && tid !== '') {
    apiParams.t = tid;
  }

  const out = {
    page: pg,
    pagecount: pg,
    limit: 20,
    total: 0,
    list: [],
    style: { type: 'rect', ratio: 1.78 },
  };

  try {
    const j = await callCmsApi(apiParams);
    const lst = Array.isArray(j.list) ? j.list : [];
    out.list = lst.map((it) => formatVodItem(it, inReq, false));
    out.pagecount = Number(j.pagecount) || pg;
    out.total = Number(j.total) || out.list.length;
    if (out.list.length === 0 && pg === 1) {
      out.list = buildDiagCard(`分类${tid}`);
    }
  } catch (_) {
    out.list = buildDiagCard(`分类${tid}`);
  }
  return out;
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  let rawId = params.id ?? params.ids ?? params.url ?? '';
  if (Array.isArray(rawId)) rawId = rawId[0] ?? '';
  const vid = String(rawId || '').trim();
  if (!vid || vid === 'diag') {
    return { list: [] };
  }

  // 若传入的是网页路径或完整网页 URL（非纯数字 ID 且非直接流地址）
  if ((vid.startsWith('/') || /^https?:\/\//i.test(vid)) && !/^\d+$/.test(vid)) {
    const unwrappedVid = unwrapNestedUrlParam(vid, state.activeDomain);
    if (isDirectMediaUrl(unwrappedVid)) {
      setCache(PLAY_CACHE, vid, unwrappedVid);
      setCache(PLAY_CACHE, unwrappedVid, unwrappedVid);
      return {
        list: [
          {
            vod_id: vid,
            vod_name: '直接播放',
            vod_pic: '',
            vod_remarks: 'HD',
            vod_play_from: 'dplayer',
            vod_play_url: `正片$${unwrappedVid}`,
          },
        ],
      };
    }
    try {
      const streamUrl = await resolveStreamFromPage(vid);
      if (streamUrl) {
        setCache(PLAY_CACHE, vid, streamUrl);
        setCache(PLAY_CACHE, streamUrl, streamUrl);
      }
      return {
        list: [
          {
            vod_id: vid,
            vod_name: `视频 ${vid}`,
            vod_pic: '',
            vod_remarks: 'HD',
            vod_play_from: 'dplayer',
            vod_play_url: `正片$${streamUrl || vid}`,
          },
        ],
      };
    } catch (_) {
      return { list: buildDiagCard(`详情${vid}`) };
    }
  }

  try {
    const j = await callCmsApi({ ac: 'detail', ids: vid });
    const lst = Array.isArray(j.list) ? j.list : [];
    if (!lst.length) {
      const cached = getCache(DETAIL_CACHE, vid);
      if (cached) {
        return { list: [formatVodItem(cached, inReq, true)] };
      }
      return { list: buildDiagCard(`详情${vid}`) };
    }
    const v = formatVodItem(lst[0], inReq, true);
    // 预热 PLAY_CACHE：同时以 vod_id 与剧集 URL 作为 key 缓存，确保 /play 无论传哪种 ID 均直接命中
    const firstEp = String(v.vod_play_url || '')
      .split('$$$')[0]
      .split('#')[0];
    const epUrl = sanitizePlayId(firstEp);
    if (epUrl) {
      const unwrapped = unwrapNestedUrlParam(epUrl, state.activeDomain);
      if (isDirectMediaUrl(unwrapped)) {
        setCache(PLAY_CACHE, vid, unwrapped);
        setCache(PLAY_CACHE, epUrl, unwrapped);
        setCache(PLAY_CACHE, firstEp, unwrapped);
      } else if (epUrl.startsWith('/') || /^https?:\/\//i.test(epUrl)) {
        try {
          const resolved = await resolveStreamFromPage(epUrl);
          if (resolved) {
            setCache(PLAY_CACHE, vid, resolved);
            setCache(PLAY_CACHE, epUrl, resolved);
            setCache(PLAY_CACHE, firstEp, resolved);
          }
        } catch (_) {}
      }
    }
    return { list: [v] };
  } catch (_) {
    const cached = getCache(DETAIL_CACHE, vid);
    if (cached) {
      return { list: [formatVodItem(cached, inReq, true)] };
    }
    return { list: buildDiagCard(`详情${vid}`) };
  }
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const wd = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  let pg = parseInt(params.page ?? params.pg ?? '1', 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;
  if (!wd) {
    return { page: pg, pagecount: 0, limit: 20, total: 0, list: [] };
  }
  try {
    const j = await callCmsApi({ ac: 'detail', wd, pg });
    const lst = (j.list || []).map((it) => formatVodItem(it, inReq, false));
    if (!lst.length) {
      return {
        page: pg,
        pagecount: pg,
        limit: 20,
        total: 0,
        list: buildDiagCard(`搜索「${wd}」无结果`),
      };
    }
    return {
      page: pg,
      pagecount: Number(j.pagecount) || pg,
      limit: 20,
      total: Number(j.total) || lst.length,
      list: lst,
    };
  } catch (_) {
    return {
      page: pg,
      pagecount: pg,
      limit: 20,
      total: 0,
      list: buildDiagCard(`搜索「${wd}」`),
    };
  }
}

async function play(inReq) {
  const params = unwrapParams(inReq);
  const rawId = params.id ?? params.url ?? '';
  const id = sanitizePlayId(rawId);
  const hdr = {
    'User-Agent': state.ua,
    Referer: `${state.activeDomain}/`,
  };

  const makeDirectResponse = async (streamUrl) => {
    const normalizedStream = replaceDeprecatedStreamHost(streamUrl);
    const streamMeta = getCache(STREAM_META_CACHE, normalizedStream);
    const needDecryptProxy = Boolean(streamMeta && streamMeta.mode === 'aes-ctr');
    const wantProxy =
      needDecryptProxy ||
      state.proxyStream === 1 ||
      params.proxy === '1' ||
      params.proxy === true ||
      params.proxy === 1;

    const proxyBase = await resolveProxyBaseUrl(inReq);
    let isMp4 = false;
    try {
      isMp4 = /\.(mp4|m4s)$/i.test(new URL(normalizedStream).pathname);
    } catch (_) {}
    const proxyEndpoint = isMp4 ? '/proxy.mp4' : '/proxy.m3u8';
    const typeParam = isMp4 ? 'mp4' : 'm3u8';
    const proxiedUrl = `${proxyBase}${proxyEndpoint}?url=${encodeURIComponent(normalizedStream)}&type=${typeParam}`;

    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: wantProxy ? proxiedUrl : normalizedStream,
      proxyUrl: proxiedUrl,
      header: hdr,
      headers: hdr,
    };
  };

  // 1. 命中 PLAY_CACHE
  const cachedStream = getCache(PLAY_CACHE, id) || getCache(PLAY_CACHE, rawId);
  if (cachedStream && isDirectMediaUrl(cachedStream)) {
    return await makeDirectResponse(cachedStream);
  }

  // 2. 剥离嵌套 ?url= 参数后检查是否为直接流 (.m3u8 / .mp4)
  const unwrapped = unwrapNestedUrlParam(id, state.activeDomain);
  if (isDirectMediaUrl(unwrapped)) {
    setCache(PLAY_CACHE, id, unwrapped);
    return await makeDirectResponse(unwrapped);
  }

  // 3. 若传入的是纯数字 vod_id，调采集详情接口拿流地址（支持直链提取与包装播放页深度解析）
  if (/^\d+$/.test(id)) {
    try {
      let it = getCache(DETAIL_CACHE, id);
      if (!it) {
        const j = await callCmsApi({ ac: 'detail', ids: id });
        it = (j.list || [])[0];
      }
      if (it) {
        const { playUrl, firstDirectUrl } = buildPlayPairs(it);
        const target = unwrapNestedUrlParam(firstDirectUrl, state.activeDomain);
        if (isDirectMediaUrl(target)) {
          setCache(PLAY_CACHE, id, target);
          return await makeDirectResponse(target);
        }
        // 若详情中保存的是播放页路径，遍历候选播放页解析真实媒体流
        const candidateEps = String(playUrl || '')
          .split('$$$')
          .flatMap((grp) => grp.split('#'))
          .map((ep) => sanitizePlayId(ep))
          .filter(Boolean);
        if (firstDirectUrl && !candidateEps.includes(firstDirectUrl)) {
          candidateEps.unshift(sanitizePlayId(firstDirectUrl));
        }
        for (const ep of candidateEps.slice(0, 3)) {
          const epUnwrapped = unwrapNestedUrlParam(ep, state.activeDomain);
          if (isDirectMediaUrl(epUnwrapped)) {
            setCache(PLAY_CACHE, id, epUnwrapped);
            return await makeDirectResponse(epUnwrapped);
          }
          if (ep.startsWith('/') || /^https?:\/\//i.test(ep)) {
            try {
              const resolved = await resolveStreamFromPage(ep);
              if (resolved && isDirectMediaUrl(resolved)) {
                setCache(PLAY_CACHE, id, resolved);
                setCache(PLAY_CACHE, ep, resolved);
                return await makeDirectResponse(resolved);
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  // 4. 若传入的是网页播放页路径或 URL，走多阶段解析
  if (id.startsWith('/') || /^https?:\/\//i.test(id)) {
    try {
      const resolved = await resolveStreamFromPage(id);
      if (resolved && isDirectMediaUrl(resolved)) {
        setCache(PLAY_CACHE, id, resolved);
        return await makeDirectResponse(resolved);
      }
    } catch (_) {}
  }

  // 5. 兜底交给客户端外置嗅探
  const fallbackUrl = id.startsWith('/') ? `${state.activeDomain}${id}` : id;
  return {
    parse: 1,
    jx: 1,
    playUrl: '',
    url: fallbackUrl,
    header: hdr,
    headers: hdr,
  };
}

// 本地图片代理（绕过 23.225.11.173:8443 或 tNN.cdn2020.com 自签证书限制）
async function proxyPicHandler(query = {}) {
  const target = String(query.url || '').trim();
  if (!target || !/^https?:\/\//i.test(target)) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
  try {
    const res = await fetchRawOnce(target);
    const ct = String(res.headers?.['content-type'] || '').toLowerCase();
    const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/jpeg';
    return { mime, data: res.buffer };
  } catch (_) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

async function fastifyStreamProxyHandler(request, reply) {
  const query = unwrapParams(request);
  const proxyBase = await resolveProxyBaseUrl(request);
  const result = await handleStreamProxy(query, request?.headers || {}, proxyBase);
  if (typeof reply?.code === 'function') {
    reply.code(result.status);
  } else if (typeof reply?.status === 'function') {
    reply.status(result.status);
  }
  if (typeof reply?.headers === 'function') {
    reply.headers(result.headers);
  } else if (typeof reply?.header === 'function') {
    for (const [k, v] of Object.entries(result.headers)) {
      reply.header(k, v);
    }
  }
  if (typeof reply?.type === 'function' && result.headers['content-type']) {
    reply.type(result.headers['content-type']);
  }
  if (typeof reply?.send === 'function') {
    return reply.send(result.body);
  }
  return result;
}

export default {
  meta: {
    key: 'hsck1',
    name: '黄色仓库1',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/homeVod', homeVod);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/hsck1_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
    fastify.get('/proxy', fastifyStreamProxyHandler);
    fastify.get('/proxy.m3u8', fastifyStreamProxyHandler);
    fastify.get('/proxy.ts', fastifyStreamProxyHandler);
    fastify.get('/proxy.mp4', fastifyStreamProxyHandler);
  },
};