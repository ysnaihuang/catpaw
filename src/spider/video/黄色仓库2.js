import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';
import http from 'node:http';
import https from 'node:https';

const SITE_DOMAINS = [
  'http://hsck5.69cctv.cc',
  'https://hsck5.69cctv.cc',
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

// 根据 http://hsck5.69cctv.cc 网页导航更新的 1~10 分类目录
const LIVE_TYPES = [
  [1, '国产新片'],
  [2, '国产旧篇'],
  [3, '无码中文字幕'],
  [4, '有码中文字幕'],
  [5, '日本无码'],
  [6, '日本有码'],
  [7, '骑兵破解'],
  [8, '国产视频'],
  [9, '欧美高清'],
  [10, '动漫剧情'],
];

// 分类名称同义词/繁简别名表（用于从网页导航栏与 API class 列表动态匹配真实链接和 ID）
const CATEGORY_ALIASES = new Map([
  [1, ['国产新片', '國產新片', '最新国产', '国产最新']],
  [2, ['国产旧篇', '国产旧片', '國產舊篇', '國產舊片', '经典国产']],
  [3, ['无码中文字幕', '无码中文', '無碼中文字幕', '無碼中文', '中文字幕无码']],
  [4, ['有码中文字幕', '有码中文', '有碼中文字幕', '有碼中文', '中文字幕有码']],
  [5, ['日本无码', '日本無碼', '无码视频', '步兵无码']],
  [6, ['日本有码', '日本有碼', '有码视频', '日本骑兵']],
  [7, ['骑兵破解', '騎兵破解', '破解视频', 'AI破解', '无码破解']],
  [8, ['国产视频', '國產視頻', '国产自拍', '国产精品']],
  [9, ['欧美高清', '歐美高清', '欧美视频', '欧美性爱']],
  [10, ['动漫剧情', '動漫劇情', '成人动漫', '里番动漫', '动漫视频']],
]);

// 当网页导航或采集站使用旧版分类 ID 体系 (如 7,8,9,10,15,21,22,26) 时的候选 ID 映射
const LEGACY_API_TYPE_MAP = new Map([
  [1, [27, 15, 1, 20]],
  [2, [28, 16, 15, 2]],
  [3, [8, 3, 13]],
  [4, [9, 4, 14]],
  [5, [10, 5, 11]],
  [6, [7, 6, 12]],
  [7, [26, 7, 25]],
  [8, [15, 8, 17]],
  [9, [21, 9, 18]],
  [10, [22, 10, 19]],
]);

// 当多个分类回退到同一个旧版采集站 type_id (例如 1:国产新片、2:国产旧篇、8:国产视频 均落到 15:国产视频) 时的页码偏移，避免内容相同
const SHARED_FALLBACK_PAGE_OFFSET = new Map([
  ['1:15', 0],  // 国产新片 -> 第 1 页起
  ['2:15', 10], // 国产旧篇 -> 第 11 页起
  ['8:15', 4],  // 国产视频 -> 第 5 页起
]);

const state = {
  activeDomain: SITE_DOMAINS[0],
  customApi: '',
  domains: [...SITE_DOMAINS],
  ua: DEFAULT_UA,
  timeout: 12000,
  retry: 2,
  allTypes: 0,
  picMode: 'proxy', // 'proxy' | 'cdn' | 'src' | 'local'
  picProxy: PIC_PROXY_DEFAULT,
  picSuffix: PIC_SUFFIX_DEFAULT,
  proxyStream: 0, // 1: 默认强制走本地流式代理; 0: 标准直连 + 按需代理
  diag: '',
};

// 缓存容器（TTL 10 分钟）
const CACHE_TTL_MS = 10 * 60 * 1000;
const PLAY_CACHE = new Map();
const DETAIL_CACHE = new Map();
const STREAM_META_CACHE = new Map();

// 网页端与 API 动态发现的分类真实路径、分页模板、首页分区缓存与全局置顶视频过滤集合
const DISCOVERED_CAT_PATHS = new Map(); // tid(string) -> '/vodtype/xx.html'
const DISCOVERED_PAGE_TEMPLATES = new Map(); // tid(string) -> '/vodtype/xx-{pg}.html'
const DISCOVERED_API_TYPES = new Map(); // tid(string) -> remote type_id
const REMOTE_VALID_API_TYPES = new Set(); // 远端 API class 中实际存在的 type_id 集合
const HOME_SECTION_CARDS = new Map(); // tid(string) -> cards[] (首页对应分类区块兜底)
const HOME_PINNED_VIDS = new Set(); // 首页/全局顶栏固定推荐视频 ID 集合
const CATEGORY_SIGNATURE_MAP = new Map(); // HTML 分类第 1 页签名
const API_CATEGORY_SIGNATURE_MAP = new Map(); // API 分类第 1 页签名
let navDiscoveryPromise = null;
let apiClassDiscoveryPromise = null;
let homeSignature = '';
let apiUnfilteredSignature = '';

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
  const assignClean = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null && v !== '') {
        merged[k] = v;
      }
    }
  };

  const absorb = (src, depth = 0) => {
    if (!src || depth > 3) return;
    if (Buffer.isBuffer(src) || src instanceof Uint8Array) {
      absorb(Buffer.from(src).toString('utf8'), depth + 1);
      return;
    }
    if (typeof src === 'string') {
      const s = src.trim();
      if (!s) return;
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          const parsed = JSON.parse(s);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            assignClean(parsed);
            if (parsed.params) absorb(parsed.params, depth + 1);
            if (parsed.query) absorb(parsed.query, depth + 1);
            if (parsed.body) absorb(parsed.body, depth + 1);
            if (parsed.data) absorb(parsed.data, depth + 1);
            return;
          }
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(s);
        for (const [k, v] of sp.entries()) {
          if (v !== undefined && v !== null && v !== '') {
            merged[k] = v;
          }
        }
      } catch (_) {}
      return;
    }
    if (typeof src === 'object' && !Array.isArray(src)) {
      assignClean(src);
      if (src.params && typeof src.params === 'object') absorb(src.params, depth + 1);
      if (src.query && typeof src.query === 'object') absorb(src.query, depth + 1);
      if (src.body && typeof src.body === 'object') absorb(src.body, depth + 1);
      if (src.data && typeof src.data === 'object') absorb(src.data, depth + 1);
    }
  };

  const rawUrl = String(inReq?.raw?.url || inReq?.url || '');
  const qIdx = rawUrl.indexOf('?');
  if (qIdx !== -1) {
    absorb(rawUrl.slice(qIdx + 1));
  }
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
  if (h.includes('hsck') || h.includes('hszyck') || h.includes('69cctv')) return true;
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
    Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
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

function detectJsRedirectUrl(html, currentUrl) {
  const s = String(html || '');
  if (s.length > 4000 || s.includes('stui-vodlist') || s.includes('player_aaaa')) return '';
  let parsedCur;
  try {
    parsedCur = new URL(currentUrl);
  } catch (_) {
    return '';
  }

  const strUMatch = s.match(/strU\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
  if (strUMatch && strUMatch[1]) {
    const base = strUMatch[1].replace(/\/+$/, '');
    return `${base}${parsedCur.pathname}${parsedCur.search}`;
  }
  const locMatch = s.match(/(?:window\.|self\.|top\.)?location(?:\.href)?\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
  if (locMatch && locMatch[1]) {
    return locMatch[1];
  }
  const metaMatch = s.match(/<meta\b[^>]*http-equiv=['"]?refresh['"]?[^>]*content=['"][^'"]*url=([^'">\s]+)/i);
  if (metaMatch && metaMatch[1]) {
    try {
      return new URL(metaMatch[1], currentUrl).href;
    } catch (_) {}
  }
  return '';
}

async function fetchRawOnce(targetUrl, customReferer = '', extraHeaders = {}, redirectDepth = 0) {
  const headers = buildHeaders(targetUrl, customReferer, extraHeaders);
  const isLocalhost = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(targetUrl);

  let result = null;
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
          result = {
            status,
            headers: respHeaders,
            buffer: buf,
            text: decodeBuffer(buf, respHeaders['content-encoding']),
            finalUrl: resp.url || targetUrl,
          };
        } else if (typeof data === 'string') {
          result = {
            status,
            headers: respHeaders,
            buffer: Buffer.from(data, 'utf8'),
            text: data,
            finalUrl: resp.url || targetUrl,
          };
        } else if (data && typeof data === 'object') {
          const text = JSON.stringify(data);
          result = {
            status,
            headers: respHeaders,
            buffer: Buffer.from(text, 'utf8'),
            text,
            json: data,
            finalUrl: resp.url || targetUrl,
          };
        }
      }
    } catch (_) {}
  }

  if (!result) {
    const nativeRes = await nativeRequestBuffer(targetUrl, headers, state.timeout);
    result = {
      status: nativeRes.status,
      headers: nativeRes.headers,
      buffer: nativeRes.buffer,
      text: decodeBuffer(nativeRes.buffer, nativeRes.headers['content-encoding']),
      finalUrl: nativeRes.finalUrl,
    };
  }

  if (redirectDepth < 2 && result.text && result.status < 400) {
    const jsNext = detectJsRedirectUrl(result.text, result.finalUrl || targetUrl);
    if (jsNext && jsNext !== targetUrl) {
      try {
        const nextOrigin = new URL(jsNext).origin;
        if (!state.domains.includes(nextOrigin)) {
          state.domains.unshift(nextOrigin);
        }
        state.activeDomain = nextOrigin;
      } catch (_) {}
      return await fetchRawOnce(jsNext, customReferer, extraHeaders, redirectDepth + 1);
    }
  }

  return result;
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
    s.includes('stui-vodlist') ||
    s.includes('myui-vodlist') ||
    s.includes('module-items') ||
    s.includes('vodlist__thumb') ||
    s.includes('data-original') ||
    s.includes('/vodplay/') ||
    s.includes('/voddetail/') ||
    s.includes('/vodtype/') ||
    s.includes('m3u8') ||
    s.includes('.mp4') ||
    s.includes('<video') ||
    s.includes('<iframe') ||
    s.includes('vod_play') ||
    s.includes('vodplay') ||
    s.includes('hsck') ||
    s.includes('69cctv') ||
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
          const u = new URL(res.finalUrl || candidate);
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

function normalizeCategoryLabel(s) {
  return htmlToText(s).replace(/[\s·•|/\-_()（）\[\]【】\d:：>》🔥✨]+/g, '').trim();
}

function matchCategoryTidByName(rawName) {
  const norm = normalizeCategoryLabel(rawName);
  if (!norm || norm.length > 16) return null;
  for (const [tid, aliases] of CATEGORY_ALIASES.entries()) {
    for (const alias of aliases) {
      if (norm === alias) return tid;
    }
  }
  const pairs = [];
  for (const [tid, aliases] of CATEGORY_ALIASES.entries()) {
    for (const alias of aliases) {
      pairs.push([tid, alias]);
    }
  }
  pairs.sort((a, b) => b[1].length - a[1].length);
  for (const [tid, alias] of pairs) {
    if (norm.includes(alias)) return tid;
  }
  return null;
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
  let pic = cleanText(it?.vod_pic);
  if (!pic) return '';
  if (pic.startsWith('//')) {
    pic = `http:${pic}`;
  } else if (pic.startsWith('/')) {
    pic = `${state.activeDomain}${pic}`;
  }
  if (!/^https?:\/\//i.test(pic)) return '';
  if (state.picMode === 'src') return pic;
  if (state.picMode === 'cdn') {
    return rewriteCdnPic(it, pic) || pic;
  }
  if (state.picMode === 'local' && inReq) {
    const prefix = getRoutePrefix(inReq);
    return `${prefix}/hsck_pic?url=${encodeURIComponent(pic)}`;
  }
  if (state.picProxy) {
    return `${state.picProxy}${encodeURIComponent(pic)}${state.picSuffix}`;
  }
  return pic;
}

// ---------------- 网页 HTML 解析与动态导航/面板感知引擎 ----------------
function isPlaceholderImage(u) {
  const s = String(u || '').trim().toLowerCase();
  if (!s) return true;
  return (
    s.startsWith('data:image/') ||
    s.includes('load.gif') ||
    s.includes('loading.gif') ||
    s.includes('blank.gif') ||
    s.includes('none.png') ||
    s.includes('default.png') ||
    s.includes('lazyload.gif')
  );
}

function extractImageFromFragment(fragment, baseOrigin = state.activeDomain) {
  const s = String(fragment || '');
  const attrNames = ['data-original', 'data-src', 'data-lazy-src', 'data-echo', 'src'];
  for (const attr of attrNames) {
    const re = new RegExp(`\\b${attr}\\s*=\\s*['"]([^'"]+)['"]`, 'gi');
    let m;
    while ((m = re.exec(s)) !== null) {
      const candidate = cleanText(m[1]);
      if (!isPlaceholderImage(candidate)) {
        try {
          return new URL(candidate, baseOrigin).href;
        } catch (_) {
          return candidate;
        }
      }
    }
  }
  const bgMatch = s.match(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  if (bgMatch && !isPlaceholderImage(bgMatch[1])) {
    try {
      return new URL(cleanText(bgMatch[1]), baseOrigin).href;
    } catch (_) {
      return cleanText(bgMatch[1]);
    }
  }
  return '';
}

function isVideoPagePath(href) {
  const s = String(href || '').trim();
  if (!s || /^(?:javascript:|mailto:|tel:|#)/i.test(s)) return false;
  let pathname = s;
  try {
    const u = new URL(s, state.activeDomain);
    if (!isKnownSiteHost(u.hostname)) return false;
    pathname = `${u.pathname}${u.search}`;
  } catch (_) {}

  if (
    /\/(?:vodtype|vodshow|vodsearch|type|category|list|channel|tag|label|user|rss|gbook|map|topic|art|actor)\b/i.test(
      pathname
    )
  ) {
    return false;
  }
  if (/[?&](?:m=vod-(?:type|show|search)|type=|cat=|tid=)/i.test(pathname)) {
    return false;
  }
  return (
    /\/vodplay\/[^?#]+/i.test(pathname) ||
    /\/voddetail\/[^?#]+/i.test(pathname) ||
    /\/(?:index\.php\/)?vod\/(?:play|detail)\//i.test(pathname) ||
    /\?m=vod-(?:play|detail)-id-/i.test(pathname) ||
    /\/(?:video|play|watch|view|player|v|vod|movie|archives)\/[A-Za-z0-9_/-]+(?:\.html|\/)?$/i.test(
      pathname
    )
  );
}

// 识别带缩略图特征的视频卡片锚点（兼容自定义路由格式的站点）
function isThumbnailCardAnchor(attrs, innerHtml, href) {
  const s = String(href || '').trim();
  if (!s || s === '/' || /^(?:javascript:|mailto:|tel:|#)/i.test(s)) return false;
  if (/\/(?:vodtype|vodshow|vodsearch|type|category|list)\b/i.test(s)) return false;
  try {
    const u = new URL(s, state.activeDomain);
    if (!isKnownSiteHost(u.hostname)) return false;
  } catch (_) {}
  const combined = `${attrs || ''} ${innerHtml || ''}`;
  return (
    /vodlist__thumb|myui-vodlist__thumb|module-item-pic|lazyload/i.test(attrs || '') ||
    /\bdata-original\s*=\s*['"][^'"]+['"]/i.test(combined)
  );
}

function isValidCategoryNavHref(href, baseOrigin = state.activeDomain) {
  const s = String(href || '').trim();
  if (!s || /^(?:javascript:|mailto:|tel:|#)/i.test(s)) return false;
  if (isVideoPagePath(s)) return false;
  if (/\/vodsearch\b|[?&](?:wd|keyword)=/i.test(s)) return false;
  try {
    const u = new URL(s, baseOrigin);
    if (!isKnownSiteHost(u.hostname)) return false;
    const pathAndQuery = `${u.pathname}${u.search}`;
    if (pathAndQuery === '/' || pathAndQuery === '/index.html' || pathAndQuery === '/index.php') {
      return false;
    }
    return pathAndQuery;
  } catch (_) {
    if (s.startsWith('/') && s !== '/') return s;
    return false;
  }
}

// 从首页或分类页 HTML 导航栏与面板头部动态发现 1~10 分类的真实 URL 路径
function discoverCategoryLinksFromHtml(html, baseOrigin = state.activeDomain) {
  const s = String(html || '');
  if (!s) return;

  const anchorRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(s)) !== null) {
    const attrs = m[1] || '';
    const text = htmlToText(m[2]);
    if (!text || text.length > 16) continue;
    const matchedTid = matchCategoryTidByName(text);
    if (matchedTid === null || DISCOVERED_CAT_PATHS.has(String(matchedTid))) continue;

    const hrefMatch =
      attrs.match(/\b(?:href|data-href|data-url)\s*=\s*['"]([^'"]+)['"]/i) ||
      attrs.match(/\bhref\s*=\s*([^\s>'"]+)/i);
    if (hrefMatch && hrefMatch[1]) {
      const validPath = isValidCategoryNavHref(cleanText(hrefMatch[1]), baseOrigin);
      if (validPath) {
        DISCOVERED_CAT_PATHS.set(String(matchedTid), validPath);
      }
    }
  }

  const headBlockRe =
    /<div\b[^>]*class=['"][^'"]*(?:stui-pannel__head|stui-pannel_hd|myui-panel__head|module-heading|title)[^'"]*['"][^>]*>([\s\S]{0,800}?)<\/div>/gi;
  let hm;
  while ((hm = headBlockRe.exec(s)) !== null) {
    const block = hm[1];
    const titleMatch = block.match(/<h[1-5]\b[^>]*>([\s\S]*?)<\/h[1-5]>/i);
    const titleText = titleMatch ? htmlToText(titleMatch[1]) : htmlToText(block);
    const matchedTid = matchCategoryTidByName(titleText);
    if (matchedTid !== null && !DISCOVERED_CAT_PATHS.has(String(matchedTid))) {
      const linkMatch =
        block.match(/<a\b[^>]*?\bhref\s*=\s*['"]([^'"]+)['"]/i) ||
        block.match(/<a\b[^>]*?\bhref\s*=\s*([^\s>'"]+)/i);
      if (linkMatch) {
        const validPath = isValidCategoryNavHref(cleanText(linkMatch[1]), baseOrigin);
        if (validPath) {
          DISCOVERED_CAT_PATHS.set(String(matchedTid), validPath);
        }
      }
    }
  }
}

// 从分类第 1 页的分页条 (<ul class="stui-page">) 提取第 2 页链接并生成真实分页模板
function discoverPaginationTemplateFromHtml(html, tid, baseOrigin = state.activeDomain) {
  const key = String(tid);
  if (DISCOVERED_PAGE_TEMPLATES.has(key)) return;
  const s = String(html || '');
  const pageBlockMatch = s.match(
    /<ul\b[^>]*class=['"][^'"]*(?:stui-page|myui-page|page)[^'"]*['"][^>]*>([\s\S]*?)<\/ul>/i
  );
  const scope = pageBlockMatch ? pageBlockMatch[1] : s;
  const anchorRe = /<a\b[^>]*?\bhref\s*=\s*['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(scope)) !== null) {
    const rawHref = cleanText(m[1]);
    const text = htmlToText(m[2]).trim();
    if (text === '2' || text === '下一页' || text === '下页') {
      const validPath = isValidCategoryNavHref(rawHref, baseOrigin);
      if (!validPath) continue;
      const tpl = validPath
        .replace(/(-|_|\/)2(\.html?)$/i, '$1{pg}$2')
        .replace(/(\/page\/)2(\.html?|\/|$)/i, '$1{pg}$2')
        .replace(/([?&](?:page|pg|p)=)2\b/i, '$1{pg}');
      if (tpl.includes('{pg}')) {
        DISCOVERED_PAGE_TEMPLATES.set(key, tpl);
        return;
      }
    }
  }
}

function normalizeVideoIdPath(href, baseOrigin = state.activeDomain) {
  const s = String(href || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s, baseOrigin);
    if (isKnownSiteHost(u.hostname)) {
      return `${u.pathname}${u.search}`;
    }
    return u.href;
  } catch (_) {
    return s;
  }
}

function parseHtmlVideoCards(html, baseOrigin = state.activeDomain, inReq = null, typeName = '') {
  const s = String(html || '');
  if (!s) return [];

  const cardMap = new Map();
  const anchorRe = /<a\b([^>]*?\bhref\s*=\s*['"]([^'"]+)['"][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = anchorRe.exec(s)) !== null) {
    const attrs = m[1] || '';
    const rawHref = cleanText(m[2]);
    const innerHtml = m[3] || '';

    if (!isVideoPagePath(rawHref) && !isThumbnailCardAnchor(attrs, innerHtml, rawHref)) continue;
    const vid = normalizeVideoIdPath(rawHref, baseOrigin);
    if (!vid) continue;

    const ctxStart = Math.max(0, m.index - 220);
    const ctxEnd = Math.min(s.length, m.index + m[0].length + 380);
    const contextSnippet = s.slice(ctxStart, ctxEnd);

    const existing = cardMap.get(vid) || {
      vod_id: vid,
      vod_name: '',
      vod_pic: '',
      vod_remarks: '',
      type_name: typeName,
    };

    if (!existing.vod_name) {
      const titleAttr = attrs.match(/\btitle\s*=\s*['"]([^'"]+)['"]/i);
      if (titleAttr && cleanText(titleAttr[1])) {
        existing.vod_name = cleanText(titleAttr[1]);
      }
    }
    if (!existing.vod_name) {
      const altAttr = innerHtml.match(/\balt\s*=\s*['"]([^'"]+)['"]/i);
      if (altAttr && cleanText(altAttr[1])) {
        existing.vod_name = cleanText(altAttr[1]);
      }
    }
    const anchorPlain = htmlToText(innerHtml.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, ''));
    if (
      anchorPlain &&
      anchorPlain.length >= 2 &&
      !/^(?:播放|立即播放|详情|查看|点击播放|更多|HD|\d{1,2}:\d{2}(?::\d{2})?)$/i.test(anchorPlain)
    ) {
      if (!existing.vod_name || existing.vod_name.length < anchorPlain.length) {
        existing.vod_name = anchorPlain;
      }
    }

    if (!existing.vod_pic) {
      const img =
        extractImageFromFragment(`${attrs}>${innerHtml}`, baseOrigin) ||
        extractImageFromFragment(contextSnippet, baseOrigin);
      if (img) existing.vod_pic = img;
    }

    if (!existing.vod_remarks) {
      const remMatch =
        innerHtml.match(
          /<span\b[^>]*class=['"][^'"]*(?:pic-text|pic-tag|remarks|vod-remarks)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i
        ) ||
        contextSnippet.match(
          /<span\b[^>]*class=['"][^'"]*(?:pic-text|pic-tag|remarks|vod-remarks)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/i
        ) ||
        contextSnippet.match(
          /<p\b[^>]*class=['"][^'"]*(?:sub|text-muted|time)[^'"]*['"][^>]*>([\s\S]*?)<\/p>/i
        );
      if (remMatch) {
        const remText = htmlToText(remMatch[1]);
        if (remText) existing.vod_remarks = remText.slice(0, 24);
      }
    }

    cardMap.set(vid, existing);
  }

  const list = [];
  for (const item of cardMap.values()) {
    if (!item.vod_name && !item.vod_pic) continue;
    const formatted = formatVodItem(
      {
        vod_id: item.vod_id,
        vod_name: item.vod_name || `视频 ${item.vod_id}`,
        vod_pic: item.vod_pic,
        vod_remarks: item.vod_remarks || 'HD',
        type_name: item.type_name,
      },
      inReq,
      false
    );
    list.push(formatted);
  }
  return list;
}

// 结合 <ul class="stui-vodlist"> 与标题 (<h1~h5> / pannel__head) 将 HTML 切分为独立视频区块
// 彻底解决每个分类页顶部都有相同的“精品推荐/热播推荐/置顶”模块导致各目录视频一模一样的问题
function extractVideoSectionsFromHtml(html, baseOrigin = state.activeDomain, inReq = null, typeName = '') {
  const s = String(html || '');
  if (!s) return [];

  // 方式 A：优先按 <ul class="...vodlist..."> 列表容器切分
  const ulSections = [];
  const listRe =
    /<ul\b[^>]*class=['"][^'"]*(?:stui-vodlist|myui-vodlist|fed-list-info|vodlist)[^'"]*['"][^>]*>([\s\S]*?)<\/ul>/gi;
  let m;
  while ((m = listRe.exec(s)) !== null) {
    const beforeSlice = s.slice(Math.max(0, m.index - 800), m.index);
    const afterSlice = s.slice(m.index + m[0].length, Math.min(s.length, m.index + m[0].length + 650));

    const headingMatches = [
      ...beforeSlice.matchAll(
        /<(?:h[1-5]|div|span)\b[^>]*class=['"][^'"]*\btitle\b[^'"]*['"][^>]*>([\s\S]*?)<\/(?:h[1-5]|div|span)>|<h[1-5]\b[^>]*>([\s\S]*?)<\/h[1-5]>/gi
      ),
    ];
    let lastHeading = '';
    if (headingMatches.length > 0) {
      const last = headingMatches[headingMatches.length - 1];
      lastHeading = htmlToText(last[1] || last[2] || '');
    }

    const hasPagination =
      /class=['"][^'"]*(?:stui-page|myui-page|page_info|mac_pages)[^'"]*['"]/i.test(afterSlice) ||
      /下一页|尾页/i.test(afterSlice);

    const cards = parseHtmlVideoCards(m[0], baseOrigin, inReq, typeName);
    if (cards.length > 0) {
      ulSections.push({
        heading: lastHeading,
        matchedTid: matchCategoryTidByName(lastHeading),
        isRecommendBlock: /精品推荐|热门推荐|热播推荐|站长推荐|置顶|猜你喜欢|相关推荐|热播|热门|最新视频/i.test(
          lastHeading
        ),
        hasPagination,
        cards,
      });
    }
  }
  if (ulSections.length > 1) {
    return ulSections;
  }

  // 方式 B：按页面中的分区标题 (<h1~h5> 或 pannel__head) 切分
  const headingMarkers = [];
  const headRe =
    /<div\b[^>]*class=['"][^'"]*(?:stui-pannel__head|stui-pannel_hd|myui-panel__head|module-heading)[^'"]*['"][^>]*>([\s\S]{0,600}?)<\/div>|<h[1-3]\b[^>]*>([\s\S]{1,80}?)<\/h[1-3]>/gi;
  let hm;
  while ((hm = headRe.exec(s)) !== null) {
    const rawH = hm[1] || hm[2] || '';
    const hText = htmlToText(rawH);
    const tidMatch = matchCategoryTidByName(hText);
    const isRec = /精品推荐|热门推荐|热播推荐|站长推荐|置顶|猜你喜欢|相关推荐|热播|热门/i.test(hText);
    if (tidMatch !== null || isRec) {
      headingMarkers.push({
        index: hm.index,
        endIndex: hm.index + hm[0].length,
        heading: hText,
        matchedTid: tidMatch,
        isRecommendBlock: isRec,
      });
    }
  }

  if (headingMarkers.length > 0) {
    const markerSections = [];
    if (headingMarkers[0].index > 100) {
      const preCards = parseHtmlVideoCards(s.slice(0, headingMarkers[0].index), baseOrigin, inReq, '');
      if (preCards.length > 0) {
        markerSections.push({
          heading: '__pre_heading__',
          matchedTid: null,
          isRecommendBlock: true,
          hasPagination: false,
          cards: preCards,
        });
      }
    }
    for (let i = 0; i < headingMarkers.length; i++) {
      const cur = headingMarkers[i];
      const nextStart = i + 1 < headingMarkers.length ? headingMarkers[i + 1].index : s.length;
      const chunk = s.slice(cur.endIndex, nextStart);
      const cards = parseHtmlVideoCards(chunk, baseOrigin, inReq, typeName);
      if (cards.length > 0) {
        const hasPagination =
          /class=['"][^'"]*(?:stui-page|myui-page|page_info|mac_pages)[^'"]*['"]/i.test(chunk) ||
          /下一页|尾页/i.test(chunk);
        markerSections.push({
          heading: cur.heading,
          matchedTid: cur.matchedTid,
          isRecommendBlock: cur.isRecommendBlock,
          hasPagination,
          cards,
        });
      }
    }
    if (markerSections.length > 0) {
      return markerSections;
    }
  }

  return ulSections;
}

function getListSignature(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list
    .slice(0, 6)
    .map((x) => x.vod_id ?? x)
    .join('|');
}

// 智能提取指定分类的视频卡片：优先匹配当前分类标题面板 / 分页主面板，并剔除全局顶栏固定推荐视频
function parseCategoryHtmlVideoCards(
  html,
  baseOrigin = state.activeDomain,
  inReq = null,
  tid = '1',
  typeName = ''
) {
  discoverCategoryLinksFromHtml(html, baseOrigin);
  const numTid = Number(tid);
  const sections = extractVideoSectionsFromHtml(html, baseOrigin, inReq, typeName);

  for (const sec of sections) {
    if (sec.matchedTid !== null && !sec.isRecommendBlock && sec.cards.length > 0) {
      if (!HOME_SECTION_CARDS.has(String(sec.matchedTid))) {
        HOME_SECTION_CARDS.set(String(sec.matchedTid), sec.cards);
      }
    }
    if (sec.isRecommendBlock) {
      for (const c of sec.cards) HOME_PINNED_VIDS.add(c.vod_id);
    }
  }

  if (sections.length > 1) {
    if (Number.isFinite(numTid) && numTid >= 1 && numTid <= 10) {
      const exactSec = sections.find((sec) => sec.matchedTid === numTid && !sec.isRecommendBlock);
      if (exactSec && exactSec.cards.length > 0) {
        return exactSec.cards;
      }
    }

    if (tid !== 'new' && tid !== '0') {
      const pagedSec = sections.find((sec) => sec.hasPagination && !sec.isRecommendBlock);
      if (pagedSec && pagedSec.cards.length > 0) {
        for (const sec of sections) {
          if (sec === pagedSec) break;
          for (const c of sec.cards) HOME_PINNED_VIDS.add(c.vod_id);
        }
        return pagedSec.cards;
      }

      const nonPinnedSecs = sections.filter((sec) => {
        if (sec.isRecommendBlock) return false;
        if (HOME_PINNED_VIDS.size > 0) {
          const overlap = sec.cards.filter((c) => HOME_PINNED_VIDS.has(c.vod_id)).length;
          if (overlap >= Math.ceil(sec.cards.length * 0.7)) return false;
        }
        return true;
      });
      if (nonPinnedSecs.length > 0) {
        return nonPinnedSecs.flatMap((sec) => sec.cards);
      }

      return sections[sections.length - 1].cards;
    }
  }

  if (sections.length === 1 && Number.isFinite(numTid) && sections[0].matchedTid === numTid) {
    return sections[0].cards;
  }

  const allCards =
    sections.length === 1 ? sections[0].cards : parseHtmlVideoCards(html, baseOrigin, inReq, typeName);
  if (tid !== 'new' && tid !== '0' && HOME_PINNED_VIDS.size > 0 && allCards.length > HOME_PINNED_VIDS.size) {
    const filtered = allCards.filter((c) => !HOME_PINNED_VIDS.has(c.vod_id));
    if (filtered.length >= 2) {
      return filtered;
    }
  }
  return allCards;
}

function parseHtmlPagination(html, currentPage = 1, itemCount = 0) {
  const s = String(html || '');
  let maxPage = currentPage;

  const patterns = [
    /\/vodtype\/\d+-(\d+)\.html/gi,
    /\/vodshow\/\d+--------(\d+)---\.html/gi,
    /\/type\/\d+-(\d+)\.html/gi,
    /\/list\/\d+-(\d+)\.html/gi,
    /\/page\/(\d+)\.html/gi,
    /pg-(\d+)\.html/gi,
    /[?&](?:page|pg|p)=(\d+)/gi,
    /共\s*(\d+)\s*页/gi,
    /\b\d+\s*\/\s*(\d+)\s*页?/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(s)) !== null) {
      const num = parseInt(m[1], 10);
      if (Number.isFinite(num) && num > maxPage && num < 100000) {
        maxPage = num;
      }
    }
  }

  if (maxPage === currentPage && (s.includes('下一页') || s.includes('下页') || itemCount >= 16)) {
    maxPage = currentPage + 1;
  }
  return maxPage;
}

function expandPaginatedPathsFromNavHref(navHref, pg = 1, tid = '') {
  if (!navHref) return [];
  if (pg <= 1) return [navHref];

  const results = [];
  const tpl = DISCOVERED_PAGE_TEMPLATES.get(String(tid));
  if (tpl) {
    results.push(tpl.replace(/\{pg\}/g, String(pg)));
  }

  if (/\.html?$/i.test(navHref)) {
    if (/-\d+\.html?$/i.test(navHref)) {
      results.push(navHref.replace(/-\d+(\.html?)$/i, `-${pg}$1`));
    } else {
      results.push(navHref.replace(/(\.html?)$/i, `-${pg}$1`));
      results.push(navHref.replace(/(\.html?)$/i, `_${pg}$1`));
      results.push(navHref.replace(/(\.html?)$/i, `/page/${pg}$1`));
    }
  }
  if (/\/id\/\d+/i.test(navHref)) {
    results.push(navHref.replace(/(\/id\/\d+)(?:\.html?|\/)?$/i, `$1/page/${pg}.html`));
  }
  if (navHref.endsWith('/')) {
    results.push(`${navHref}${pg}.html`);
    results.push(`${navHref}${pg}/`);
    results.push(`${navHref}page/${pg}.html`);
  }
  const sep = navHref.includes('?') ? '&' : '?';
  results.push(`${navHref}${sep}page=${pg}`);
  results.push(`${navHref}${sep}pg=${pg}`);

  return Array.from(new Set(results));
}

function buildCategoryHtmlPaths(tid, pg = 1) {
  const cleanTid = String(tid || '1').trim();
  if (cleanTid === 'new' || cleanTid === '0') {
    if (pg <= 1) return ['/'];
    const nav1 = DISCOVERED_CAT_PATHS.get('1') || '/vodtype/1.html';
    return expandPaginatedPathsFromNavHref(nav1, pg, '1');
  }

  const paths = [];
  // 1. 最高优先级：从首页导航栏动态提取到的该分类真实链接
  const discoveredNav = DISCOVERED_CAT_PATHS.get(cleanTid);
  if (discoveredNav) {
    paths.push(...expandPaginatedPathsFromNavHref(discoveredNav, pg, cleanTid));
  }

  // 2. 标准候选路径（绝不使用 `/?m=vod-type-id-...` 这种会退化为请求根路径 `/` 的伪 URL）
  const numTid = Number(cleanTid);
  const candidateIds = [cleanTid];
  if (!discoveredNav && LEGACY_API_TYPE_MAP.has(numTid)) {
    for (const altId of LEGACY_API_TYPE_MAP.get(numTid)) {
      if (String(altId) !== cleanTid) candidateIds.push(String(altId));
    }
  }

  for (const cid of candidateIds) {
    if (pg <= 1) {
      paths.push(
        `/vodtype/${cid}.html`,
        `/vodtype/${cid}-1.html`,
        `/index.php/vod/type/id/${cid}.html`,
        `/vod/type/id/${cid}.html`,
        `/type/${cid}.html`,
        `/list/${cid}.html`,
        `/vodshow/${cid}-----------.html`
      );
    } else {
      paths.push(
        `/vodtype/${cid}-${pg}.html`,
        `/index.php/vod/type/id/${cid}/page/${pg}.html`,
        `/vod/type/id/${cid}/page/${pg}.html`,
        `/type/${cid}-${pg}.html`,
        `/list/${cid}-${pg}.html`,
        `/vodshow/${cid}--------${pg}---.html`
      );
    }
  }

  return Array.from(new Set(paths));
}

async function ensureNavMapLoaded(inReq = null) {
  if (DISCOVERED_CAT_PATHS.size > 0) return;
  if (navDiscoveryPromise) {
    await navDiscoveryPromise;
    return;
  }
  navDiscoveryPromise = (async () => {
    try {
      const { text: html, finalUrl } = await fetchTextWithFailover('/', '', true);
      let origin = state.activeDomain;
      try {
        origin = new URL(finalUrl).origin;
      } catch (_) {}
      discoverCategoryLinksFromHtml(html, origin);
      const sections = extractVideoSectionsFromHtml(html, origin, inReq, '');
      for (const sec of sections) {
        if (sec.matchedTid !== null && !sec.isRecommendBlock && sec.cards.length > 0) {
          HOME_SECTION_CARDS.set(String(sec.matchedTid), sec.cards);
        }
        if (sec.isRecommendBlock) {
          for (const c of sec.cards) HOME_PINNED_VIDS.add(c.vod_id);
        }
      }
      const allHomeCards = parseHtmlVideoCards(html, origin, inReq, '');
      if (allHomeCards.length > 0) {
        homeSignature = getListSignature(allHomeCards);
      }
    } catch (_) {
    } finally {
      navDiscoveryPromise = null;
    }
  })();
  await navDiscoveryPromise;
}

function buildSearchHtmlPaths(wd, pg = 1) {
  const enc = encodeURIComponent(wd);
  if (pg <= 1) {
    return [
      `/vodsearch/-------------.html?wd=${enc}`,
      `/vodsearch/${enc}----------1---.html`,
      `/index.php/vod/search.html?wd=${enc}`,
      `/vod/search.html?wd=${enc}`,
    ];
  }
  return [
    `/vodsearch/${enc}----------${pg}---.html`,
    `/vodsearch/-------------.html?wd=${enc}&page=${pg}`,
    `/index.php/vod/search/page/${pg}/wd/${enc}.html`,
    `/vod/search/page/${pg}/wd/${enc}.html`,
  ];
}

async function fetchCategoryViaHtml(tid, pg = 1, inReq = null) {
  const cleanTid = String(tid || '1').trim();
  if (cleanTid !== 'new' && cleanTid !== '0') {
    await ensureNavMapLoaded(inReq);
  }

  const typeEntry = LIVE_TYPES.find(([id]) => String(id) === cleanTid);
  const typeName = typeEntry ? typeEntry[1] : '';
  const paths = buildCategoryHtmlPaths(cleanTid, pg);
  let lastErr = null;

  for (const path of paths) {
    try {
      const { text: html, finalUrl } = await fetchTextWithFailover(path, '', true);
      let origin = state.activeDomain;
      try {
        origin = new URL(finalUrl).origin;
      } catch (_) {}

      if (pg === 1 && cleanTid !== 'new' && cleanTid !== '0') {
        discoverPaginationTemplateFromHtml(html, cleanTid, origin);
      }

      const list = parseCategoryHtmlVideoCards(html, origin, inReq, cleanTid, typeName);
      if (list.length > 0) {
        const pagecount = parseHtmlPagination(html, pg, list.length);
        const resultObj = {
          page: pg,
          pagecount,
          limit: list.length,
          total: pagecount * list.length,
          list,
        };

        if (cleanTid === 'new' || cleanTid === '0') {
          if (!homeSignature) homeSignature = getListSignature(list);
          return resultObj;
        }

        const sig = getListSignature(list);
        let isDuplicateOfOtherCat = false;
        if (pg === 1 && sig) {
          for (const [otherTid, otherSig] of CATEGORY_SIGNATURE_MAP.entries()) {
            if (otherTid !== cleanTid && otherSig === sig) {
              isDuplicateOfOtherCat = true;
              break;
            }
          }
          if (cleanTid !== '1' && homeSignature && sig === homeSignature) {
            isDuplicateOfOtherCat = true;
          }
        }

        if (!isDuplicateOfOtherCat) {
          if (pg === 1 && sig) {
            CATEGORY_SIGNATURE_MAP.set(cleanTid, sig);
          }
          return resultObj;
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (pg === 1 && HOME_SECTION_CARDS.has(cleanTid)) {
    const secCards = HOME_SECTION_CARDS.get(cleanTid);
    if (secCards && secCards.length > 0) {
      return {
        page: 1,
        pagecount: 1,
        limit: secCards.length,
        total: secCards.length,
        list: secCards,
      };
    }
  }

  throw lastErr || new Error(`HTML category fetch empty or duplicate for tid=${cleanTid}`);
}

async function fetchSearchViaHtml(wd, pg = 1, inReq = null) {
  const paths = buildSearchHtmlPaths(wd, pg);
  let lastErr = null;
  for (const path of paths) {
    try {
      const { text: html, finalUrl } = await fetchTextWithFailover(path, '', true);
      let origin = state.activeDomain;
      try {
        origin = new URL(finalUrl).origin;
      } catch (_) {}
      const list = parseCategoryHtmlVideoCards(html, origin, inReq, 'new', '');
      if (list.length > 0) {
        const pagecount = parseHtmlPagination(html, pg, list.length);
        return {
          page: pg,
          pagecount,
          limit: list.length,
          total: pagecount * list.length,
          list,
        };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`HTML search fetch empty for wd=${wd}`);
}

// ---------------- CMS API 采集接口层（支持动态分类探测、页码偏移去重与签名校验） ----------------
async function probeApiClassList(apiBase) {
  if (DISCOVERED_API_TYPES.size > 0) return;
  if (apiClassDiscoveryPromise) {
    await apiClassDiscoveryPromise;
    return;
  }
  apiClassDiscoveryPromise = (async () => {
    try {
      const res = await fetchRawOnce(`${apiBase}?ac=list&pg=1`);
      if (res.status < 400) {
        const j = res.json || JSON.parse(String(res.text || '').trim());
        if (j && Array.isArray(j.class)) {
          for (const c of j.class) {
            if (c.type_id !== undefined) {
              REMOTE_VALID_API_TYPES.add(Number(c.type_id));
            }
            const matchedTid = matchCategoryTidByName(c.type_name);
            if (matchedTid !== null && c.type_id !== undefined) {
              DISCOVERED_API_TYPES.set(String(matchedTid), Number(c.type_id));
            }
          }
        }
      }
    } catch (_) {
    } finally {
      apiClassDiscoveryPromise = null;
    }
  })();
  await apiClassDiscoveryPromise;
}

async function callCmsApi(params) {
  const buildQueryString = (overrideType = null, overridePg = null) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') {
        qs.set(k, String(v));
      }
    }
    if (overrideType !== null && overrideType !== undefined) {
      qs.set('t', String(overrideType));
    }
    if (overridePg !== null && overridePg !== undefined) {
      qs.set('pg', String(overridePg));
    }
    return qs.toString();
  };

  const baseCandidates = state.customApi
    ? [state.customApi, ...getCandidateDomains().map((d) => `${d}${API_PATH}`)]
    : getCandidateDomains().map((d) => `${d}${API_PATH}`);

  let lastErr = null;
  for (const apiBase of Array.from(new Set(baseCandidates))) {
    const reqType = params?.t !== undefined ? Number(params.t) : null;
    const reqPg = params?.pg !== undefined ? Number(params.pg) : 1;

    if (reqType !== null && Number.isFinite(reqType) && DISCOVERED_API_TYPES.size === 0) {
      await probeApiClassList(apiBase);
    }

    let typeCandidates = [reqType];
    if (reqType !== null && Number.isFinite(reqType)) {
      const list = [];
      if (DISCOVERED_API_TYPES.has(String(reqType))) {
        list.push(DISCOVERED_API_TYPES.get(String(reqType)));
      }
      if (REMOTE_VALID_API_TYPES.has(reqType)) {
        list.push(reqType);
      }
      if (LEGACY_API_TYPE_MAP.has(reqType)) {
        for (const altId of LEGACY_API_TYPE_MAP.get(reqType)) {
          if (REMOTE_VALID_API_TYPES.size === 0 || REMOTE_VALID_API_TYPES.has(altId)) {
            list.push(altId);
          }
        }
        list.push(...LEGACY_API_TYPE_MAP.get(reqType));
      }
      list.push(reqType);
      typeCandidates = Array.from(new Set(list));
    }

    for (const candidateType of typeCandidates) {
      const offsetKey = `${reqType}:${candidateType}`;
      const pageOffset =
        reqType !== null && SHARED_FALLBACK_PAGE_OFFSET.has(offsetKey)
          ? SHARED_FALLBACK_PAGE_OFFSET.get(offsetKey)
          : 0;
      const effectivePg = reqPg + pageOffset;
      const queryString = buildQueryString(candidateType, effectivePg);
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

          if (Array.isArray(j.class) && j.class.length > 0) {
            for (const c of j.class) {
              if (c.type_id !== undefined) REMOTE_VALID_API_TYPES.add(Number(c.type_id));
              const matchedTid = matchCategoryTidByName(c.type_name);
              if (matchedTid !== null && c.type_id !== undefined) {
                DISCOVERED_API_TYPES.set(String(matchedTid), Number(c.type_id));
              }
            }
          }

          if (reqType !== null && j.list.length === 0 && typeCandidates.length > 1) {
            break;
          }

          const sig = getListSignature(j.list);
          if (reqType === null && reqPg === 1 && sig) {
            apiUnfilteredSignature = sig;
          }

          // 若指定了分类 t，校验返回的列表是否与其他分类或未过滤首页完全重复（防止服务端忽略无效 t）
          if (reqType !== null && reqPg === 1 && sig && typeCandidates.length > 1) {
            let isDup = false;
            for (const [otherTid, otherSig] of API_CATEGORY_SIGNATURE_MAP.entries()) {
              if (otherTid !== String(reqType) && otherSig === sig) {
                isDup = true;
                break;
              }
            }
            if (reqType !== 1 && apiUnfilteredSignature && sig === apiUnfilteredSignature) {
              isDup = true;
            }
            if (isDup && candidateType !== typeCandidates[typeCandidates.length - 1]) {
              break;
            }
          }

          if (reqType !== null && reqPg === 1 && sig) {
            API_CATEGORY_SIGNATURE_MAP.set(String(reqType), sig);
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
  }
  throw lastErr || new Error('API request failed');
}

function parseDetailMetadataFromHtml(html, fallbackVod = null, baseOrigin = state.activeDomain) {
  const s = String(html || '');
  let vodName = cleanText(fallbackVod?.vod_name || '');
  let vodPic = cleanText(fallbackVod?.vod_pic || '');
  let vodRemarks = cleanText(fallbackVod?.vod_remarks || 'HD');
  let typeName = cleanText(fallbackVod?.type_name || '');
  let vodContent = cleanText(fallbackVod?.vod_content || '');

  const playerBlocks = extractBalancedJsonObject(s, 'player_aaaa');
  for (const pb of playerBlocks) {
    try {
      const obj = JSON.parse(pb);
      if (obj?.vod_data) {
        if (!vodName && obj.vod_data.vod_name) vodName = cleanText(obj.vod_data.vod_name);
        if (!vodPic && obj.vod_data.vod_pic) vodPic = cleanText(obj.vod_data.vod_pic);
        if (!typeName && obj.vod_data.vod_class) typeName = cleanText(obj.vod_data.vod_class);
      }
    } catch (_) {}
  }

  if (!vodName || /^视频\s+/.test(vodName)) {
    const h1Match =
      s.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
      s.match(/<h[23]\b[^>]*class=['"][^'"]*title[^'"]*['"][^>]*>([\s\S]*?)<\/h[23]>/i);
    if (h1Match) {
      const t = htmlToText(h1Match[1]);
      if (t) vodName = t;
    }
  }
  if (!vodName || /^视频\s+/.test(vodName)) {
    const ogTitle = s.match(/<meta\b[^>]*property=['"]og:title['"][^>]*content=['"]([^'"]+)['"]/i);
    if (ogTitle && cleanText(ogTitle[1])) {
      vodName = cleanText(ogTitle[1]);
    }
  }
  if (!vodName || /^视频\s+/.test(vodName)) {
    const titleTag = s.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleTag) {
      const rawTitle = htmlToText(titleTag[1])
        .replace(/\s*[-_|]\s*(?:黄色仓库|hsck|在线观看|高清).*$/i, '')
        .trim();
      if (rawTitle) vodName = rawTitle;
    }
  }

  if (!vodPic) {
    const ogImg = s.match(/<meta\b[^>]*property=['"]og:image['"][^>]*content=['"]([^'"]+)['"]/i);
    if (ogImg && !isPlaceholderImage(ogImg[1])) {
      try {
        vodPic = new URL(cleanText(ogImg[1]), baseOrigin).href;
      } catch (_) {
        vodPic = cleanText(ogImg[1]);
      }
    }
  }

  return {
    vod_name: vodName,
    vod_pic: vodPic,
    vod_remarks: vodRemarks || 'HD',
    type_name: typeName,
    vod_content: vodContent,
  };
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
  const apiUrl = state.customApi || `${state.activeDomain}`;
  return [
    {
      vod_id: 'diag',
      vod_name: `[诊断] ${where} | ${state.diag || '无数据'}`,
      vod_pic: '',
      vod_remarks: '站点异常',
      vod_content: `当前站点：${apiUrl}\n请检查域名是否更换（本站换域名频繁），可在配置里用 {"site": "http://hsck5.69cctv.cc"} 覆盖。`,
    },
  ];
}

async function loadClasses() {
  if (state.allTypes) {
    try {
      const j = await callCmsApi({ ac: 'list', pg: 1 });
      if (Array.isArray(j.class) && j.class.length > 0) {
        return j.class.map((c) => ({
          type_id: String(c.type_id),
          type_name: cleanText(c.type_name),
        }));
      }
    } catch (_) {}
  }
  return LIVE_TYPES.map(([tid, name]) => ({
    type_id: String(tid),
    type_name: name,
  }));
}

// 平衡大括号扫描器
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

  const varCallRe = /decryptDatas?\s*\(\s*([a-zA-Z_$][\w$]*)\s*,\s*(?:['"]([^'"]+)['"]|([a-zA-Z_$][\w$]*))\s*\)/g;
  while ((m = varCallRe.exec(s)) !== null) {
    const dataVar = m[1];
    let keyVal = m[2] || '';
    const keyVar = m[3] || '';
    const dataMatch = s.match(new RegExp(`(?:var|let|const)?\\s*${dataVar}\\s*=\\s*['"]([A-Za-z0-9+/=]{16,})['"]`));
    if (!keyVal && keyVar) {
      const keyMatch = s.match(
        new RegExp(`(?:var|let|const)?\\s*${keyVar}\\s*=\\s*(?:CryptoJS\\.enc\\.Utf8\\.parse\\(\\s*)?['"]([^'"]+)['"]`)
      );
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

  // Stage 1.5: decryptDatas 解密
  const decryptedUrl = tryDecryptManifestBlocks(text, baseOrigin);
  if (decryptedUrl) return decryptedUrl;

  // Stage 1.8: atob / Base64.decode
  const b64CallRe = /(?:atob|Base64\.decode)\s*\(\s*['"]([A-Za-z0-9+/=]{16,})['"]\s*\)/g;
  let bm;
  while ((bm = b64CallRe.exec(text)) !== null) {
    try {
      const decoded = Buffer.from(bm[1], 'base64').toString('utf8');
      const unwrapped = unwrapNestedUrlParam(decoded, baseOrigin);
      if (isDirectMediaUrl(unwrapped)) return unwrapped;
    } catch (_) {}
  }

  // Stage 2: 高优先级变量提取
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

async function resolveStreamFromHtml(html, finalUrl, depth = 0) {
  let origin = state.activeDomain;
  try {
    origin = new URL(finalUrl).origin;
  } catch (_) {}

  const direct = extractStreamFromTextBlock(html, origin);
  if (direct) return direct;

  const unpackedList = unpackDeanEdwards(html);
  for (const block of unpackedList) {
    const fromPacker = extractStreamFromTextBlock(block, origin);
    if (fromPacker) return fromPacker;
  }

  if (depth > 2) return '';

  const iframes = extractIframeUrls(html, origin);
  for (const iframeUrl of iframes) {
    const unwrapped = unwrapNestedUrlParam(iframeUrl, origin);
    if (isDirectMediaUrl(unwrapped)) return unwrapped;
    try {
      const sub = await resolveStreamFromPage(iframeUrl, finalUrl, depth + 1);
      if (sub) return sub;
    } catch (_) {}
  }

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

async function resolveStreamFromPage(pageUrl, referer = '', depth = 0) {
  if (depth > 2) return '';
  const unwrappedInput = unwrapNestedUrlParam(pageUrl, state.activeDomain);
  if (isDirectMediaUrl(unwrappedInput)) return unwrappedInput;

  const { text: html, finalUrl } = await fetchTextWithFailover(pageUrl, referer, true);
  return await resolveStreamFromHtml(html, finalUrl, depth);
}

function getRoutePrefix(inReq) {
  if (inReq?.server?.prefix) {
    return String(inReq.server.prefix).replace(/\/+$/, '');
  }
  const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
  return rawUrl.replace(
    /\/(init|home|homeVod|category|detail|play|search|hsck_pic|proxy(?:\.m3u8|\.ts|\.mp4)?)\/?$/i,
    ''
  );
}

// ---------------- 本地流式代理（HLS 清单重写 / TS 伪装分片剥离 / AES-KEY / MP4 Range） ----------------
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

// 剥离伪装成图片 (.jpg / .png / .gif / .bmp) 的 TS 分片头部杂质，对齐 0x47 MPEG-TS 同步字节
function normalizeTsSegmentBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 376) return buf;
  if (buf[0] === 0x47 && buf[188] === 0x47) return buf;
  const limit = Math.min(buf.length - 376, 8192);
  for (let i = 1; i <= limit; i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47) {
      return buf.subarray(i);
    }
  }
  return buf;
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

    const isM3u8Line = expectSubPlaylist || /\.m3u8(?:\?|$)/i.test(trimmed);
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

    const streamMeta = getCache(STREAM_META_CACHE, targetUrl);
    if (streamMeta && streamMeta.mode === 'aes-ctr' && streamMeta.key && streamMeta.iv) {
      outBuffer = decryptAesCtrRange(outBuffer, streamMeta.key, streamMeta.iv, byteStart);
    }

    let mime = 'application/octet-stream';
    if (typeHint === 'ts') {
      outBuffer = normalizeTsSegmentBuffer(outBuffer);
      mime = 'video/mp2t';
    } else if (typeHint === 'key') {
      mime = 'application/octet-stream';
    } else if (typeHint === 'mp4') {
      mime = 'video/mp4';
    } else {
      try {
        const p = new URL(targetUrl).pathname.toLowerCase();
        if (p.endsWith('.ts')) {
          outBuffer = normalizeTsSegmentBuffer(outBuffer);
          mime = 'video/mp2t';
        } else if (p.endsWith('.mp4') || p.endsWith('.m4s')) {
          mime = 'video/mp4';
        } else if (upstreamCt && !upstreamCt.startsWith('image/')) {
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
        if (u.pathname.endsWith('/hsck_pic')) {
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
    const htmlRes = await fetchCategoryViaHtml('new', 1, inReq);
    if (htmlRes.list && htmlRes.list.length > 0) {
      res.list = htmlRes.list;
      return res;
    }
  } catch (_) {}

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
    const htmlRes = await fetchCategoryViaHtml('new', 1, inReq);
    if (htmlRes.list && htmlRes.list.length > 0) {
      return { list: htmlRes.list };
    }
  } catch (_) {}

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
  const rawTid =
    params.id ??
    params.tid ??
    params.type_id ??
    params.cid ??
    params.cateId ??
    params.category ??
    params.t ??
    '1';
  const tid = String(rawTid).trim() || '1';
  let pg = parseInt(params.page ?? params.pg ?? params.p ?? '1', 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;

  const out = {
    page: pg,
    pagecount: pg,
    limit: 20,
    total: 0,
    list: [],
    style: { type: 'rect', ratio: 1.78 },
  };

  // 1. 优先从网页端抓取对应分类列表（基于导航栏真实路径映射 + 置顶推荐块剥离）
  try {
    const htmlCat = await fetchCategoryViaHtml(tid, pg, inReq);
    if (htmlCat.list && htmlCat.list.length > 0) {
      out.list = htmlCat.list;
      out.pagecount = htmlCat.pagecount;
      out.limit = htmlCat.limit;
      out.total = htmlCat.total;
      return out;
    }
  } catch (_) {}

  // 2. 回退到 MacCMS 采集接口 (/api.php/provide/vod/)
  const apiParams = { ac: 'detail', pg };
  if (tid !== 'new' && tid !== '0' && tid !== '') {
    apiParams.t = tid;
  }

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

  const cachedVod = getCache(DETAIL_CACHE, vid);

  if ((vid.startsWith('/') || /^https?:\/\//i.test(vid)) && !/^\d+$/.test(vid)) {
    const unwrappedVid = unwrapNestedUrlParam(vid, state.activeDomain);
    if (isDirectMediaUrl(unwrappedVid)) {
      setCache(PLAY_CACHE, vid, unwrappedVid);
      setCache(PLAY_CACHE, unwrappedVid, unwrappedVid);
      return {
        list: [
          {
            vod_id: vid,
            vod_name: cachedVod?.vod_name || '直接播放',
            vod_pic: resolvePicUrl(cachedVod, inReq),
            vod_remarks: cachedVod?.vod_remarks || 'HD',
            vod_play_from: 'ckm3u8',
            vod_play_url: `正片$${unwrappedVid}`,
          },
        ],
      };
    }
    try {
      const { text: html, finalUrl } = await fetchTextWithFailover(vid, '', true);
      let origin = state.activeDomain;
      try {
        origin = new URL(finalUrl).origin;
      } catch (_) {}
      const meta = parseDetailMetadataFromHtml(html, cachedVod, origin);
      const streamUrl = await resolveStreamFromHtml(html, finalUrl, 0);
      if (streamUrl && isDirectMediaUrl(streamUrl)) {
        setCache(PLAY_CACHE, vid, streamUrl);
        setCache(PLAY_CACHE, streamUrl, streamUrl);
      }
      const resolvedTarget = streamUrl || vid;
      const vodObj = {
        vod_id: vid,
        vod_name: meta.vod_name || cachedVod?.vod_name || `视频 ${vid}`,
        vod_pic: resolvePicUrl({ vod_pic: meta.vod_pic || cachedVod?.vod_pic }, inReq),
        vod_remarks: meta.vod_remarks || cachedVod?.vod_remarks || 'HD',
        type_name: meta.type_name || cachedVod?.type_name || '',
        vod_content: meta.vod_content || meta.vod_name || '',
        vod_play_from: 'ckm3u8',
        vod_play_url: `正片$${resolvedTarget}`,
      };
      setCache(DETAIL_CACHE, vid, vodObj);
      return { list: [vodObj] };
    } catch (_) {
      if (cachedVod) {
        return {
          list: [
            {
              ...formatVodItem(cachedVod, inReq, true),
              vod_play_from: 'ckm3u8',
              vod_play_url: `正片$${vid}`,
            },
          ],
        };
      }
      return { list: buildDiagCard(`详情${vid}`) };
    }
  }

  try {
    const j = await callCmsApi({ ac: 'detail', ids: vid });
    const lst = Array.isArray(j.list) ? j.list : [];
    if (lst.length > 0) {
      const v = formatVodItem(lst[0], inReq, true);
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
    }
  } catch (_) {}

  for (const htmlPath of [`/vodplay/${vid}-1-1.html`, `/voddetail/${vid}.html`]) {
    try {
      const { text: html, finalUrl } = await fetchTextWithFailover(htmlPath, '', true);
      let origin = state.activeDomain;
      try {
        origin = new URL(finalUrl).origin;
      } catch (_) {}
      const meta = parseDetailMetadataFromHtml(html, cachedVod, origin);
      const streamUrl = await resolveStreamFromHtml(html, finalUrl, 0);
      if (streamUrl && isDirectMediaUrl(streamUrl)) {
        setCache(PLAY_CACHE, vid, streamUrl);
        setCache(PLAY_CACHE, htmlPath, streamUrl);
        setCache(PLAY_CACHE, streamUrl, streamUrl);
      }
      return {
        list: [
          {
            vod_id: vid,
            vod_name: meta.vod_name || `视频 ${vid}`,
            vod_pic: resolvePicUrl({ vod_pic: meta.vod_pic }, inReq),
            vod_remarks: meta.vod_remarks || 'HD',
            type_name: meta.type_name || '',
            vod_content: meta.vod_content || meta.vod_name || '',
            vod_play_from: 'ckm3u8',
            vod_play_url: `正片$${streamUrl || htmlPath}`,
          },
        ],
      };
    } catch (_) {}
  }

  if (cachedVod) {
    return { list: [formatVodItem(cachedVod, inReq, true)] };
  }
  return { list: buildDiagCard(`详情${vid}`) };
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
    const htmlSearch = await fetchSearchViaHtml(wd, pg, inReq);
    if (htmlSearch.list && htmlSearch.list.length > 0) {
      return htmlSearch;
    }
  } catch (_) {}

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
    const refParam = hdr.Referer ? `&ref=${encodeURIComponent(hdr.Referer)}` : '';
    const proxiedUrl = `${proxyBase}${proxyEndpoint}?url=${encodeURIComponent(normalizedStream)}&type=${typeParam}${refParam}`;

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

  const cachedStream = getCache(PLAY_CACHE, id) || getCache(PLAY_CACHE, rawId);
  if (cachedStream && isDirectMediaUrl(cachedStream)) {
    return await makeDirectResponse(cachedStream);
  }

  const unwrapped = unwrapNestedUrlParam(id, state.activeDomain);
  if (isDirectMediaUrl(unwrapped)) {
    setCache(PLAY_CACHE, id, unwrapped);
    return await makeDirectResponse(unwrapped);
  }

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

    try {
      const resolved = await resolveStreamFromPage(`/vodplay/${id}-1-1.html`);
      if (resolved && isDirectMediaUrl(resolved)) {
        setCache(PLAY_CACHE, id, resolved);
        return await makeDirectResponse(resolved);
      }
    } catch (_) {}
  }

  if (id.startsWith('/') || /^https?:\/\//i.test(id)) {
    try {
      const resolved = await resolveStreamFromPage(id);
      if (resolved && isDirectMediaUrl(resolved)) {
        setCache(PLAY_CACHE, id, resolved);
        return await makeDirectResponse(resolved);
      }
    } catch (_) {}
  }

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

// 本地图片代理
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
    key: 'hsck',
    name: '黄色仓库2',
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
    fastify.get('/hsck_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
    fastify.get('/proxy', fastifyStreamProxyHandler);
    fastify.get('/proxy.m3u8', fastifyStreamProxyHandler);
    fastify.get('/proxy.ts', fastifyStreamProxyHandler);
    fastify.get('/proxy.mp4', fastifyStreamProxyHandler);
  },
};