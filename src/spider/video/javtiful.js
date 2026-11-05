import req from '../../util/req.js';
import crypto from 'crypto';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const SITE_NAME = 'Javtiful';
const SITE_DOMAINS = [
  'https://javtiful.com',
  'https://www.javtiful.com',
];
let activeDomain = SITE_DOMAINS[0];

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
let currentUa = DEFAULT_UA;
let currentLang = 'zh';
let lastReferer = '';

const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const TG_GROUP = 'https://t.me/tvshare23';

const CARD_STYLE_RECT = { type: 'rect', ratio: 1.78 };
const CARD_STYLE_SHORTS = { type: 'rect', ratio: 0.75 };
const CARD_STYLE_OVAL = { type: 'oval', ratio: 1.0 };

const BAD_PIC_TOKENS = ['placeholder', 'blank.gif', 'lazyload', '/logo'];
const BAD_VIDEO_TOKENS = [
  'preview.mp4',
  'preview_clip',
  'sample.mp4',
  'trailer.mp4',
  '/clips/',
  'placeholder',
  '55287.mp4',
  'top_banner',
  'native-ad',
  'stat.php',
];

// In-memory caches
const COOKIE_JAR = new Map();
const SHORTS_CURSOR_CACHE = new Map();
const PLAY_CACHE = new Map();
const STREAM_SESSIONS = new Map();
const PLAY_CACHE_TTL_MS = 10 * 60 * 1000;

let localProxyServer = null;
let localProxyPort = 0;

function md5Hex(input) {
  return crypto.createHash('md5').update(String(input ?? ''), 'utf8').digest('hex');
}

function getCache(key) {
  return SHORTS_CURSOR_CACHE.get(String(key)) || null;
}

function setCache(key, value) {
  SHORTS_CURSOR_CACHE.set(String(key), String(value ?? ''));
  return 'ok';
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL_MS) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return entry;
}

function setPlayCache(key, data) {
  if (!key || !data || !data.url) return;
  PLAY_CACHE.set(String(key), { ...data, ts: Date.now() });
}

function storeSetCookieHeaders(headers) {
  if (!headers || typeof headers !== 'object') return;
  const rawSetCookie =
    headers['set-cookie'] || headers['Set-Cookie'] || headers['SET-COOKIE'];
  if (!rawSetCookie) return;
  const list = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : String(rawSetCookie).split(/\r?\n|,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const item of list) {
    const firstPart = String(item || '').split(';')[0].trim();
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      if (k) COOKIE_JAR.set(k, v);
    }
  }
}

function getCookieHeader(customCookie = '') {
  const parts = [];
  for (const [k, v] of COOKIE_JAR.entries()) {
    parts.push(`${k}=${v}`);
  }
  if (customCookie) parts.push(customCookie);
  return parts.join('; ');
}

function getXsrfHeaderValue() {
  const raw = COOKIE_JAR.get('XSRF-TOKEN') || COOKIE_JAR.get('xsrf-token') || '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function htmlUnescape(text) {
  let s = String(text ?? '');
  if (!s.includes('&') && !s.includes('\\u') && !s.includes('\\x')) return s;
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
  return s;
}

function unescapeJsString(str) {
  let s = String(str ?? '');
  s = s
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  return htmlUnescape(s);
}

function cleanLabel(text) {
  let t = String(text ?? '');
  t = t.replace(/<\/?em>/gi, '');
  t = t.replace(/<[^>]+>/g, ' ');
  t = htmlUnescape(t);
  t = t.replace(/[\r\n\t$#]+/g, ' ');
  t = t.replace(/\s{2,}/g, ' ');
  return t.trim();
}

function cleanPic(url) {
  const u = htmlUnescape(String(url ?? '').trim().replace(/\\\//g, '/'));
  if (!u || /^(?:data|about|javascript):/i.test(u)) return '';
  const low = u.toLowerCase();
  for (const bad of BAD_PIC_TOKENS) {
    if (low.includes(bad)) return '';
  }
  return u;
}

function formatRemarks(brand = BRAND_DIRECTOR, meta = '') {
  const cleanMeta = String(meta ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return cleanMeta ? `${brand} | ${cleanMeta}` : brand;
}

function fixedInt(value, defaultVal = 1) {
  const n = parseInt(String(value ?? defaultVal).trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : defaultVal;
}

function absUrl(url, baseDomain = activeDomain) {
  const u = htmlUnescape(String(url ?? '').trim().replace(/\\\//g, '/'));
  if (!u || /^(?:about|javascript|data|mailto|tel):/i.test(u)) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (/^https?:\/\//i.test(u)) return u;
  let base = String(baseDomain || activeDomain).trim();
  try {
    base = new URL(base).origin;
  } catch {
    base = base.replace(/\/+$/, '');
  }
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

function buildLangPath(pathStr) {
  let p = String(pathStr ?? '').trim();
  if (!p.startsWith('/')) p = '/' + p;
  if (currentLang) {
    const langPrefix = `/${currentLang}`;
    if (p === langPrefix || p.startsWith(`${langPrefix}/`) || p.startsWith(`${langPrefix}?`)) {
      return p;
    }
    return `${langPrefix}${p}`;
  }
  return p;
}

function stripLangPrefix(pathStr) {
  let p = String(pathStr ?? '').trim();
  if (!p.startsWith('/')) p = '/' + p;
  const m = p.match(/^\/(?:zh|en|ja|ko|id|vi)(\/.*|\?.*|$)/i);
  if (m) {
    return m[1] ? (m[1].startsWith('/') ? m[1] : `/${m[1]}`) : '/';
  }
  return p;
}

function isKnownSiteHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!host) return false;
  if (host === 'javtiful.com' || host.endsWith('.javtiful.com')) {
    return true;
  }
  return SITE_DOMAINS.some((d) => {
    try {
      const dh = new URL(d).hostname.toLowerCase().replace(/^www\./, '');
      return dh === host || host.endsWith(`.${dh}`);
    } catch {
      return false;
    }
  });
}

function getCandidateDomains() {
  const seen = new Set();
  const list = [];
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    const clean = String(d || '').trim().replace(/\/+$/, '');
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      list.push(clean);
    }
  }
  return list;
}

function expandCandidateUrls(pathOrUrl, useLangPrefix = true) {
  const raw = htmlUnescape(
    String(pathOrUrl ?? '')
      .trim()
      .replace(/\\\//g, '/')
  );
  if (!raw) return [];
  const fullRaw = raw.startsWith('//') ? 'https:' + raw : raw;
  const domains = getCandidateDomains();

  let relPath = '';
  if (/^https?:\/\//i.test(fullRaw)) {
    try {
      const parsed = new URL(fullRaw);
      if (!isKnownSiteHost(parsed.hostname)) {
        return [fullRaw];
      }
      relPath = `${parsed.pathname}${parsed.search}`;
    } catch {
      return [fullRaw];
    }
  } else {
    relPath = fullRaw.startsWith('/') ? fullRaw : `/${fullRaw}`;
  }

  const pathVariants = [];
  const addVariant = (v) => {
    if (v && !pathVariants.includes(v)) pathVariants.push(v);
  };

  if (useLangPrefix) {
    addVariant(buildLangPath(stripLangPrefix(relPath)));
    addVariant(relPath);
    addVariant(stripLangPrefix(relPath));
  } else {
    addVariant(relPath);
    addVariant(stripLangPrefix(relPath));
    addVariant(buildLangPath(stripLangPrefix(relPath)));
  }

  const urls = [];
  const seen = new Set();
  for (const dom of domains) {
    for (const pv of pathVariants) {
      const cand = `${dom}${pv}`;
      if (!seen.has(cand)) {
        seen.add(cand);
        urls.push(cand);
      }
    }
  }
  return urls;
}

function syncRefererToOrigin(referer, targetUrl) {
  const fallbackOrigin = (() => {
    try {
      return new URL(targetUrl).origin;
    } catch {
      return activeDomain;
    }
  })();
  const ref = String(referer || lastReferer || `${fallbackOrigin}/`).trim();
  try {
    const refUrl = new URL(ref);
    const targetOrigin = new URL(targetUrl).origin;
    if (isKnownSiteHost(refUrl.hostname) && refUrl.origin !== targetOrigin) {
      return `${targetOrigin}${refUrl.pathname}${refUrl.search}`;
    }
    return ref;
  } catch {
    return `${fallbackOrigin}/`;
  }
}

function decodeResponseBuffer(buf, contentEncoding = '') {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) {
    if (typeof buf === 'object') {
      try {
        return JSON.stringify(buf);
      } catch {
        return String(buf);
      }
    }
    return String(buf);
  }
  let raw = Buffer.from(buf);
  const enc = String(contentEncoding || '').toLowerCase();
  if ((raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) || enc.includes('gzip')) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch {
      // ignore decompression failure
    }
  } else if (enc.includes('deflate')) {
    try {
      raw = zlib.inflateSync(raw);
    } catch {
      try {
        raw = zlib.inflateRawSync(raw);
      } catch {
        // ignore
      }
    }
  }
  let text = raw.toString('utf8');
  if (text.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      text = gbkDecoder.decode(raw);
    } catch {
      // keep utf8
    }
  }
  return text;
}

function isValidSiteResponse(text, url = '') {
  const s = String(text || '').trim();
  if (!s) return false;
  const low = s.toLowerCase();

  // Reject Cloudflare challenge, block, or domain parking pages
  if (
    (low.includes('just a moment...') ||
      low.includes('cf-browser-verification') ||
      low.includes('challenge-platform') ||
      low.includes('attention required! | cloudflare') ||
      low.includes('sedoparking') ||
      low.includes('buy this domain') ||
      low.includes('domain is for sale') ||
      low.includes('parked free')) &&
    !low.includes('video-card') &&
    !low.includes('watch-config') &&
    !low.includes('token_full')
  ) {
    return false;
  }

  if (s.startsWith('{') || s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === 'object') return true;
    } catch {
      // fall through
    }
  }

  if (
    low.includes('video-card') ||
    low.includes('watch-config') ||
    low.includes('token_full') ||
    low.includes('hlstoken') ||
    low.includes('get_cdn') ||
    low.includes('javtiful') ||
    low.includes('/video/') ||
    low.includes('/category/') ||
    low.includes('/channel/') ||
    low.includes('/actress/') ||
    low.includes('player_aaaa') ||
    low.includes('player_data') ||
    low.includes('player_config') ||
    low.includes('decryptdatas') ||
    low.includes('const datas') ||
    low.includes('<video') ||
    low.includes('<iframe') ||
    low.includes('.m3u8') ||
    low.includes('.mp4')
  ) {
    return true;
  }

  try {
    if (url) {
      const u = new URL(url);
      if (isKnownSiteHost(u.hostname)) {
        return false;
      }
    }
  } catch {
    // ignore
  }
  return s.length > 0;
}

function nativeHttpRequest(url, options = {}) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const method = (options.method || 'GET').toUpperCase();
      const headers = { ...(options.headers || {}) };
      const bodyBuf =
        options.data !== undefined && options.data !== null
          ? Buffer.isBuffer(options.data)
            ? options.data
            : Buffer.from(String(options.data), 'utf8')
          : null;
      if (bodyBuf && !headers['Content-Length'] && !headers['content-length']) {
        headers['Content-Length'] = String(bodyBuf.length);
      }

      const reqImpl = lib.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method,
          headers,
          timeout: options.timeout || 10000,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const rawBuf = Buffer.concat(chunks);
            storeSetCookieHeaders(res.headers || {});
            const enc = res.headers?.['content-encoding'] || '';
            const text = decodeResponseBuffer(rawBuf, enc);
            resolve({
              code: Number(res.statusCode || 0),
              text,
              rawBuf,
              err: '',
              final_url: url,
              headers: res.headers || {},
            });
          });
        }
      );
      reqImpl.on('timeout', () => {
        reqImpl.destroy(new Error('timeout'));
      });
      reqImpl.on('error', (err) => {
        resolve({
          code: -1,
          text: '',
          rawBuf: Buffer.alloc(0),
          err: String(err?.message || err),
          final_url: url,
          headers: {},
        });
      });
      if (bodyBuf) reqImpl.write(bodyBuf);
      reqImpl.end();
    } catch (err) {
      resolve({
        code: -1,
        text: '',
        rawBuf: Buffer.alloc(0),
        err: String(err?.message || err),
        final_url: url,
        headers: {},
      });
    }
  });
}

async function fetchUrl(url, options = {}) {
  if (!url) {
    return { code: 0, text: '', err: '', final_url: '', headers: {} };
  }
  const {
    data = null,
    formObj = null,
    referer = '',
    headersCustom = null,
    method = data !== null && data !== undefined ? 'POST' : 'GET',
    timeout = 10000,
  } = options;

  const ref = syncRefererToOrigin(referer, url);
  const headers = {
    'User-Agent': currentUa,
    Referer: ref,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7',
    'Accept-Encoding': 'gzip, deflate',
    Connection: 'close',
  };
  const cookieHeader = getCookieHeader();
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  const xsrfVal = getXsrfHeaderValue();
  if (xsrfVal && !headers['X-XSRF-TOKEN']) {
    headers['X-XSRF-TOKEN'] = xsrfVal;
  }
  if (headersCustom && typeof headersCustom === 'object') {
    Object.assign(headers, headersCustom);
  }
  // Ensure Referer/Origin match target url host if known site host
  if (headers.Referer) {
    headers.Referer = syncRefererToOrigin(headers.Referer, url);
  }
  if (headers.Origin) {
    try {
      const origUrl = new URL(headers.Origin);
      const targetOrigin = new URL(url).origin;
      if (isKnownSiteHost(origUrl.hostname) && origUrl.origin !== targetOrigin) {
        headers.Origin = targetOrigin;
      }
    } catch {
      // ignore
    }
  }

  let reqData = undefined;
  let plainFormObj = formObj;
  if (data !== null && data !== undefined) {
    if (typeof data === 'object' && !Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
      plainFormObj = data;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(data)) {
        params.append(k, String(v ?? ''));
      }
      reqData = params.toString();
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      }
      if (!headers['X-Requested-With']) {
        headers['X-Requested-With'] = 'XMLHttpRequest';
      }
    } else {
      reqData = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
      if (!plainFormObj && typeof reqData === 'string' && reqData.includes('=')) {
        try {
          const sp = new URLSearchParams(reqData);
          const obj = {};
          for (const [k, v] of sp.entries()) obj[k] = v;
          if (Object.keys(obj).length > 0) plainFormObj = obj;
        } catch {
          // ignore
        }
      }
    }
  }

  const normalizeResp = (resp) => {
    const code = Number(
      resp?.status ?? resp?.statusCode ?? (resp?.data !== undefined || resp?.body !== undefined ? 200 : 0)
    );
    const respHeaders = resp?.headers || {};
    storeSetCookieHeaders(respHeaders);
    const finalUrl = resp?.url || resp?.finalUrl || resp?.responseUrl || url;
    const enc = respHeaders['content-encoding'] || respHeaders['Content-Encoding'] || '';
    const rawPayload =
      resp?.data !== undefined ? resp.data : resp?.body !== undefined ? resp.body : resp;
    const text = decodeResponseBuffer(rawPayload, enc);
    return { code, text, err: '', final_url: finalUrl, headers: respHeaders };
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (method.toUpperCase() === 'POST') {
        let lastPostRes = null;

        // Strategy 1: Standard req(url, { method: 'POST', headers, data: reqData, body: reqData })
        if (typeof req === 'function') {
          try {
            const r1 = await req(url, {
              method: 'POST',
              headers,
              timeout,
              data: reqData,
              body: reqData,
            });
            const n1 = normalizeResp(r1);
            lastPostRes = n1;
            if (n1.code === 419) return n1;
            if (n1.code >= 200 && n1.code < 300 && n1.text && n1.text.trim() !== '0') {
              lastReferer = n1.final_url || url;
              return n1;
            }
          } catch (e1) {
            if (e1?.response?.headers) storeSetCookieHeaders(e1.response.headers);
            if (Number(e1?.response?.status || e1?.status) === 419) {
              return { code: 419, text: '', err: '419', final_url: url, headers: e1?.response?.headers || {} };
            }
          }
        }

        // Strategy 2: CatVodOpen postType: 'form' with plain object data
        if (plainFormObj && typeof req === 'function') {
          try {
            const r2 = await req(url, {
              method: 'POST',
              headers,
              timeout,
              data: plainFormObj,
              postType: 'form',
            });
            const n2 = normalizeResp(r2);
            lastPostRes = n2;
            if (n2.code === 419) return n2;
            if (n2.code >= 200 && n2.code < 300 && n2.text && n2.text.trim() !== '0') {
              lastReferer = n2.final_url || url;
              return n2;
            }
          } catch (e2) {
            if (e2?.response?.headers) storeSetCookieHeaders(e2.response.headers);
          }
        }

        // Strategy 3: req.post(url, data, { headers, timeout })
        if (typeof req?.post === 'function') {
          try {
            const r3 = await req.post(url, reqData, { headers, timeout });
            const n3 = normalizeResp(r3);
            lastPostRes = n3;
            if (n3.code >= 200 && n3.code < 300 && n3.text && n3.text.trim() !== '0') {
              lastReferer = n3.final_url || url;
              return n3;
            }
          } catch {
            // ignore
          }
        }

        if (lastPostRes && lastPostRes.code > 0) {
          return lastPostRes;
        }
      } else {
        const reqOpts = { method: 'GET', headers, timeout };
        const resp =
          typeof req === 'function'
            ? await req(url, reqOpts)
            : typeof req?.get === 'function'
            ? await req.get(url, reqOpts)
            : null;
        if (resp) {
          const norm = normalizeResp(resp);
          if ((norm.code === 451 || norm.code === 403 || norm.code === 429) && attempt === 0) {
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }
          if (norm.code >= 200 && norm.code < 300) {
            lastReferer = norm.final_url || url;
            try {
              const parsed = new URL(norm.final_url || url);
              if (
                isKnownSiteHost(parsed.hostname) &&
                isValidSiteResponse(norm.text, norm.final_url || url)
              ) {
                activeDomain = parsed.origin;
              }
            } catch {
              // ignore
            }
          }
          return norm;
        }
      }
    } catch (err) {
      const status = Number(err?.response?.status || err?.status || -1);
      if (err?.response?.headers) {
        storeSetCookieHeaders(err.response.headers);
      }
      if ((status === 451 || status === 403 || status === 429 || status === -1) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      const errBody = err?.response?.data ? decodeResponseBuffer(err.response.data) : '';
      return {
        code: status,
        text: errBody,
        err: String(err?.message || err),
        final_url: url,
        headers: err?.response?.headers || {},
      };
    }
  }

  return { code: -1, text: '', err: 'timeout', final_url: url, headers: {} };
}

async function fetchSite(pathOrUrl, options = {}) {
  if (!pathOrUrl) {
    return { code: 0, text: '', err: '', final_url: '', headers: {} };
  }
  const { useLangPrefix = true, ...restOpts } = options;
  const candidates = expandCandidateUrls(pathOrUrl, useLangPrefix);
  let lastRes = { code: -1, text: '', err: 'no candidates', final_url: '', headers: {} };

  for (const candidateUrl of candidates) {
    const res = await fetchUrl(candidateUrl, restOpts);
    lastRes = res;
    if (res.code >= 200 && res.code < 300 && isValidSiteResponse(res.text, candidateUrl)) {
      try {
        const parsed = new URL(res.final_url || candidateUrl);
        if (isKnownSiteHost(parsed.hostname)) {
          activeDomain = parsed.origin;
        }
      } catch {
        // ignore
      }
      return res;
    }
    if (res.code === 419) {
      return res;
    }
  }
  return lastRes;
}

const FASTIFY_INTERNAL_KEYS = new Set([
  'query',
  'body',
  'params',
  'raw',
  'server',
  'headers',
  'log',
  'context',
  'routeOptions',
  'routerPath',
  'routerMethod',
  'is404',
  'hostname',
  'ip',
  'ips',
  'protocol',
  'method',
  'originalUrl',
  'socket',
  'connection',
]);

function unwrapRequestParams(inReq, extraArgs = [], mode = '') {
  const merged = {};

  // Support positional arguments when spider methods are invoked directly
  if (typeof inReq === 'string' || typeof inReq === 'number') {
    const val = String(inReq).trim();
    if (mode === 'init') {
      merged.extend = val;
    } else if (mode === 'category') {
      merged.id = val;
      merged.tid = val;
      if (extraArgs[0] !== undefined) merged.page = extraArgs[0];
      if (extraArgs[1] !== undefined) merged.filter = extraArgs[1];
      if (extraArgs[2] && typeof extraArgs[2] === 'object') merged.extend = extraArgs[2];
    } else if (mode === 'detail') {
      merged.id = val;
    } else if (mode === 'play') {
      if (extraArgs.length >= 1 && extraArgs[0] !== undefined && typeof extraArgs[0] === 'string') {
        merged.flag = val;
        merged.id = extraArgs[0];
      } else {
        merged.id = val;
      }
    } else if (mode === 'search') {
      merged.wd = val;
      if (extraArgs[0] !== undefined && (typeof extraArgs[0] === 'number' || /^\d+$/.test(String(extraArgs[0])))) {
        merged.page = extraArgs[0];
      } else if (extraArgs[1] !== undefined) {
        merged.page = extraArgs[1];
      }
    } else {
      merged.id = val;
    }
    return merged;
  }

  if (Array.isArray(inReq)) {
    merged.ids = inReq;
    if (inReq.length > 0) merged.id = inReq[0];
    return merged;
  }

  if (!inReq || typeof inReq !== 'object') {
    return merged;
  }

  const isFastifyWrapper =
    'body' in inReq ||
    'query' in inReq ||
    'params' in inReq ||
    'raw' in inReq ||
    'server' in inReq ||
    'headers' in inReq;

  const absorbSource = (src, isRootReq = false) => {
    if (!src) return;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(merged, parsed);
            return;
          }
        } catch {
          // fall through to URLSearchParams
        }
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) {
          merged[k] = v;
        }
      } catch {
        // ignore
      }
      return;
    }
    if (typeof src === 'object' && !Array.isArray(src)) {
      for (const [k, v] of Object.entries(src)) {
        if (v === undefined) continue;
        if (isRootReq) {
          if (FASTIFY_INTERNAL_KEYS.has(k)) continue;
          // Ignore Fastify's built-in request id (e.g. "req-1") and route url ("/spider/.../play")
          if (isFastifyWrapper && k === 'id' && /^req-\d+$/i.test(String(v))) continue;
          if (
            isFastifyWrapper &&
            k === 'url' &&
            /^\/(?:spider|api)\//i.test(String(v)) &&
            (src.body || src.query || src.params)
          ) {
            continue;
          }
        }
        merged[k] = v;
      }
    }
  };

  // Merge root object first (for direct test calls like { id: '...' }),
  // then params, query, and body so explicit payload fields always win over wrapper properties.
  absorbSource(inReq, true);
  absorbSource(inReq.params, false);
  absorbSource(inReq.query, false);
  absorbSource(inReq.body, false);

  if (typeof merged.extend === 'string' && merged.extend.trim()) {
    const extStr = merged.extend.trim();
    if (extStr.startsWith('{')) {
      try {
        merged.extend = JSON.parse(extStr);
      } catch {
        try {
          merged.extend = JSON.parse(Buffer.from(extStr, 'base64').toString('utf8'));
        } catch {
          // keep as string
        }
      }
    } else {
      try {
        const decoded = Buffer.from(extStr, 'base64').toString('utf8');
        if (decoded.trim().startsWith('{')) {
          merged.extend = JSON.parse(decoded);
        }
      } catch {
        // keep as string
      }
    }
  }
  return merged;
}

function isDirectMediaUrl(url) {
  const raw = unescapeJsString(String(url ?? '').trim())
    .split('@@@')[0]
    .trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  const low = raw.toLowerCase();
  for (const bad of BAD_VIDEO_TOKENS) {
    if (low.includes(bad)) return false;
  }
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(m3u8|mp4|flv|mkv|ts|mpd|webm)$/i.test(pathname)) {
      return true;
    }
    const search = parsed.search.toLowerCase();
    if (
      (pathname.includes('/hls/') ||
        pathname.includes('/stream/') ||
        pathname.includes('/video/playback') ||
        pathname.includes('/media/') ||
        pathname.includes('/cdn/')) &&
      (low.includes('.m3u8') ||
        low.includes('.mp4') ||
        search.includes('token=') ||
        search.includes('expires=') ||
        search.includes('sig='))
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function getSortFilters() {
  return [
    { n: '最新', v: '' },
    { n: '今日新增', v: 'added_today' },
    { n: '本周新增', v: 'added_week' },
    { n: '本月新增', v: 'added_month' },
    { n: '今日热门', v: 'popular_today' },
    { n: '本周热门', v: 'popular_week' },
    { n: '本月热门', v: 'popular_month' },
    { n: '最多点赞', v: 'most_liked' },
    { n: '最多观看', v: 'most_viewed' },
  ];
}

function extractAttrUrlFromTag(
  tagHtml,
  attrOrder = ['data-front-lazy-src', 'data-litespeed-src', 'data-lazy-src', 'data-src', 'data-original', 'src'],
  forIframe = false
) {
  const s = String(tagHtml || '');
  if (!s) return '';
  for (const attr of attrOrder) {
    const re = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
    let m;
    while ((m = re.exec(s)) !== null) {
      const rawVal = htmlUnescape(m[1].trim().replace(/\\\//g, '/'));
      if (!rawVal) continue;
      const low = rawVal.toLowerCase();
      if (
        low === '#' ||
        low.includes('about:blank') ||
        low.startsWith('about:') ||
        low.startsWith('javascript:') ||
        low.startsWith('data:')
      ) {
        continue;
      }
      if (forIframe) {
        if (/\.(?:js|css|jpg|jpeg|png|gif|webp|svg|ico|woff2?)(?:\?|$)/i.test(low)) {
          continue;
        }
        return rawVal;
      }
      const cleaned = cleanPic(rawVal);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

function extractBlockPic(block) {
  const s = String(block || '');
  const imgTagRe = /<img\b[^>]*>/gi;
  let m;
  while ((m = imgTagRe.exec(s)) !== null) {
    const cand = extractAttrUrlFromTag(m[0]);
    if (cand) return absUrl(cand);
  }
  const direct = extractAttrUrlFromTag(s);
  if (direct) return absUrl(direct);

  const bgMatch = s.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)/i);
  if (bgMatch && bgMatch[1]) {
    const cand = cleanPic(htmlUnescape(bgMatch[1]));
    if (cand) return absUrl(cand);
  }
  return '';
}

function extractBlockNote(block) {
  const s = String(block || '');
  const parts = [];
  const detailsMatch = s.match(/class=["'][^"']*video-card__details[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (detailsMatch && detailsMatch[1]) {
    const inner = detailsMatch[1];
    const strongMatch = inner.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (strongMatch && strongMatch[1]) {
      const st = cleanLabel(strongMatch[1]);
      if (st) parts.push(st);
    }
    const tail = cleanLabel(inner.replace(/<strong>[\s\S]*?<\/strong>/gi, ' '));
    if (tail) parts.push(tail);
  }
  const durMatch = s.match(/\b(\d{2}:\d{2}:\d{2}|\d{2}:\d{2})\b/);
  if (durMatch && durMatch[1] && !parts.some((p) => p.includes(durMatch[1]))) {
    parts.push(durMatch[1]);
  }
  const typeMatch = s.match(/class=["'][^"']*video-card__type[^"']*["'][^>]*>([^<]{1,24})</i);
  if (typeMatch && typeMatch[1]) {
    const t = cleanLabel(typeMatch[1]);
    if (t && !parts.includes(t)) parts.push(t);
  }
  return parts.filter(Boolean).join(' · ').slice(0, 40);
}

function parseVideoCards(html) {
  const cards = [];
  if (!html) return cards;
  const seen = new Set();

  const articleBlocks = [];
  const articleRe = /<article\s+class=["'][^"']*video-card[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRe.exec(html)) !== null) {
    articleBlocks.push(match[1]);
  }

  if (articleBlocks.length === 0) {
    const divRe = /<div\s+class=["'][^"']*(?:video-card|col\b[^"']*card)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    while ((match = divRe.exec(html)) !== null) {
      articleBlocks.push(match[1]);
    }
  }

  for (const block of articleBlocks) {
    if (/bg-danger|Partner thumbnail|Free AI Porn/i.test(block)) continue;
    const hm = block.match(/href=["']([^"']*?\/(?:[a-z]{2}\/)?video\/(\d+)(?:\/([^"'#]*))?)["']/i);
    if (!hm) continue;
    const vid = hm[2];
    if (seen.has(vid)) continue;

    const href = htmlUnescape(hm[1]);
    let title = '';
    const tm = block.match(/video-card__title[^>]*title=["']([^"']+)["']/i);
    if (tm && tm[1]) {
      title = cleanLabel(htmlUnescape(tm[1]));
    } else {
      const mTitle = block.match(/class=["'][^"']*(?:video-card__title|video-link)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
      if (mTitle && mTitle[1]) {
        title = cleanLabel(mTitle[1]);
      }
    }
    if (!title) {
      const titleAttr = block.match(/\btitle=["']([^"']+)["']/i);
      if (titleAttr && titleAttr[1]) {
        title = cleanLabel(titleAttr[1]);
      }
    }
    if (!title) {
      const altMatch = block.match(/alt=["']([^"']*)["']/i);
      if (altMatch && altMatch[1]) {
        title = cleanLabel(altMatch[1].replace(/^Thumbnail for\s*/i, ''));
      }
    }
    if (!title) continue;

    seen.add(vid);
    const pic = extractBlockPic(block);
    const note = extractBlockNote(block);

    cards.push({
      vod_id: absUrl(href),
      vod_name: title,
      vod_pic: pic,
      vod_remarks: formatRemarks(BRAND_DIRECTOR, note),
      style: CARD_STYLE_RECT,
    });
  }

  // Split-anchor fallback if no article cards matched (merges attributes across multiple <a> tags sharing the same video ID)
  if (cards.length === 0) {
    const byVid = new Map();
    const anchorRe = /<a\b([^>]*href=["']([^"']*?\/(?:[a-z]{2}\/)?video\/(\d+)(?:\/([^"'#]*))?)["'][^>]*)>([\s\S]*?)<\/a>/gi;
    while ((match = anchorRe.exec(html)) !== null) {
      const openAttrs = match[1] || '';
      const rawHref = htmlUnescape(match[2]);
      const vid = match[3];
      const inner = match[5] || '';
      const entry = byVid.get(vid) || { href: rawHref, title: '', pic: '' };
      if (!entry.pic) {
        const p = extractBlockPic(inner) || extractBlockPic(openAttrs);
        if (p) entry.pic = p;
      }
      if (!entry.title) {
        const attrTitle = openAttrs.match(/\btitle=["']([^"']+)["']/i);
        const altMatch = inner.match(/\balt=["']([^"']+)["']/i);
        const textTitle = cleanLabel(inner);
        const candTitle = attrTitle?.[1]
          ? cleanLabel(attrTitle[1])
          : textTitle || (altMatch?.[1] ? cleanLabel(altMatch[1].replace(/^Thumbnail for\s*/i, '')) : '');
        if (candTitle) entry.title = candTitle;
      }
      byVid.set(vid, entry);
    }
    for (const [, entry] of byVid.entries()) {
      if (!entry.title) continue;
      cards.push({
        vod_id: absUrl(entry.href),
        vod_name: entry.title,
        vod_pic: entry.pic,
        vod_remarks: formatRemarks(BRAND_DIRECTOR, ''),
        style: CARD_STYLE_RECT,
      });
    }
  }

  return cards;
}

function titleCaseSlug(slug) {
  try {
    return decodeURIComponent(String(slug || ''))
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return String(slug || '').replace(/-/g, ' ');
  }
}

function parseWaterfallCards(html, tagType) {
  const items = [];
  if (!html) return items;
  const seen = new Set();

  if (tagType === 'category' || tagType === 'channel') {
    const re = new RegExp(
      `<a[^>]+href=["']([^"']*?\\/${tagType}\\/([^"'#]+))["'][^>]*>([\\s\\S]*?)<\\/a>`,
      'gi'
    );
    let m;
    while ((m = re.exec(html)) !== null) {
      const cleanHref = htmlUnescape(m[1]);
      if (seen.has(cleanHref)) continue;
      seen.add(cleanHref);
      const slug = m[2];
      const inner = m[3];
      const pic = extractBlockPic(inner);
      const cntMatch = inner.match(/([\d,]+\s*Videos?)/i);
      const cnt = cntMatch ? cntMatch[1].trim() : '';
      const nameMatch = inner.match(
        /<div[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
      );
      const name = nameMatch ? cleanLabel(nameMatch[1]) : titleCaseSlug(slug);

      items.push({
        vod_id: `waterfall@@${tagType}@@${encodeURIComponent(cleanHref)}`,
        vod_name: name,
        vod_pic: pic,
        vod_remarks: formatRemarks(BRAND_DIRECTOR, cnt),
        vod_tag: 'folder',
        style: CARD_STYLE_RECT,
      });
    }
  } else if (tagType === 'actress') {
    const re = /<a[^>]+href=["']([^"']*?\/actress\/([^"'#]+))["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const cleanHref = htmlUnescape(m[1]);
      if (seen.has(cleanHref)) continue;
      seen.add(cleanHref);
      const slug = m[2];
      const inner = m[3];
      const pic = extractBlockPic(inner);
      const cntMatch = inner.match(/([\d,]+\s*Videos?)/i);
      const cnt = cntMatch ? cntMatch[1].trim() : '';
      const nameMatch = inner.match(
        /<div[^>]*class=["'][^"']*name[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
      );
      const name = nameMatch ? cleanLabel(nameMatch[1]) : titleCaseSlug(slug);

      items.push({
        vod_id: `waterfall@@actress@@${encodeURIComponent(cleanHref)}`,
        vod_name: name,
        vod_pic: pic,
        vod_remarks: formatRemarks(BRAND_DIRECTOR, cnt),
        vod_tag: 'folder',
        style: CARD_STYLE_OVAL,
      });
    }
  }

  return items;
}

function computePageCount(html, page, count) {
  const s = String(html || '');
  const nums = [];
  const re = /[?&]page=(\d+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n <= 20000) {
      nums.push(n);
    }
  }
  if (nums.length > 0) {
    return Math.max(...nums);
  }
  return count >= 20 ? page + 1 : page;
}

async function fetchShortsBatch(cursor = '') {
  let targetPath = '/shorts/feed';
  if (cursor) {
    targetPath += `?cursor=${encodeURIComponent(cursor)}`;
  }
  const headersCustom = {
    'User-Agent': currentUa,
    Referer: `${activeDomain}/shorts`,
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    Connection: 'close',
  };
  const res = await fetchSite(targetPath, {
    useLangPrefix: false,
    headersCustom,
    referer: `${activeDomain}/shorts`,
  });
  let data = {};
  try {
    data = JSON.parse(res.text || '{}');
  } catch {
    data = {};
  }
  const items = Array.isArray(data.items) ? data.items : [];
  const nextCursor = String(data.cursor || '').trim();
  return { items, nextCursor };
}

function parseJsonLd(html) {
  if (!html) return {};
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && data['@type'] === 'VideoObject') {
      return data;
    }
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object' && item['@type'] === 'VideoObject') {
          return item;
        }
      }
    }
  }
  return {};
}

function formatIsoDuration(iso) {
  const m = String(iso || '')
    .trim()
    .match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!m) return '';
  const h = parseInt(m[1] || '0', 10);
  const mi = parseInt(m[2] || '0', 10);
  const s = parseInt(m[3] || '0', 10);
  const pad2 = (n) => String(n).padStart(2, '0');
  if (h > 0) {
    return `${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
  }
  return `${pad2(mi)}:${pad2(s)}`;
}

// Balanced-brace scanner for JSON objects assigned to JS variables or inside scripts
function extractBalancedJsonObject(text, varPattern) {
  const s = String(text || '');
  const m = varPattern.exec(s);
  if (!m) return null;
  const startSearch = m.index + m[0].length;
  const openIdx = s.indexOf('{', startSearch);
  if (openIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const rawObj = s.slice(openIdx, i + 1);
        try {
          return JSON.parse(rawObj);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseWatchConfig(html) {
  if (!html) return {};
  const s = String(html);
  const m = s.match(/<script[^>]*\bid=["']?watch-config["']?[^>]*>([\s\S]*?)<\/script>/i);
  if (m && m[1]) {
    try {
      const cfg = JSON.parse(m[1].trim());
      if (cfg && typeof cfg === 'object') return cfg;
    } catch {
      // fall through
    }
  }
  for (const pat of [
    /(?:var|let|const|window\.)?\s*__WATCH_CONFIG__\s*=/i,
    /(?:var|let|const|window\.)?\s*watchConfig\s*=/i,
  ]) {
    const obj = extractBalancedJsonObject(s, pat);
    if (obj && typeof obj === 'object') return obj;
  }
  return {};
}

function extractPageCsrfAndVideoTokens(html, fallbackVid = '') {
  const s = String(html || '');
  let token = '';
  let csrf = '';
  let vid = String(fallbackVid || '').trim();

  // Extract video_id from DOM attributes if not already known
  if (!vid) {
    const vidMatches = [
      s.match(/data-video-id=["'](\d+)["']/i),
      s.match(/\bvideo_id\s*[:=]\s*["']?(\d+)["']?/i),
      s.match(/\/(?:[a-z]{2}\/)?(?:video|embed)\/(\d+)/i),
    ];
    for (const vm of vidMatches) {
      if (vm && vm[1]) {
        vid = vm[1];
        break;
      }
    }
  }

  // Extract Javtiful #token_full / #hlstoken / data-token for /ajax/get_cdn
  const tokenPatterns = [
    /<[^>]*\bid=["']?token_full["']?[^>]*\bvalue=["']([^"']+)["']/i,
    /<[^>]*\bvalue=["']([^"']+)["'][^>]*\bid=["']?token_full["']?/i,
    /<[^>]*\bid=["']?token_full["']?[^>]*\bdata-value=["']([^"']+)["']/i,
    /<[^>]*\bid=["']?hlstoken["']?[^>]*\bdata-(?:token|value)=["']([^"']+)["']/i,
    /<[^>]*\bdata-(?:token|value)=["']([^"']+)["'][^>]*\bid=["']?hlstoken["']?/i,
    /<section[^>]*\bid=["']?video-player["']?[^>]*\bdata-token=["']([^"']+)["']/i,
    /\bdata-csrf-token=["']([^"']+)["']/i,
    /\btoken_full\s*[:=]\s*["']([^"']+)["']/i,
    /\bhlstoken\s*[:=]\s*["']([^"']+)["']/i,
  ];
  for (const pat of tokenPatterns) {
    const m = s.match(pat);
    if (m && m[1] && m[1].trim()) {
      token = htmlUnescape(m[1].trim());
      break;
    }
  }

  // Extract meta csrf-token
  const csrfPatterns = [
    /<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i,
    /\bcsrfToken\s*[:=]\s*["']([^"']+)["']/i,
    /\b_token\s*[:=]\s*["']([^"']+)["']/i,
  ];
  for (const pat of csrfPatterns) {
    const m = s.match(pat);
    if (m && m[1] && m[1].trim()) {
      csrf = htmlUnescape(m[1].trim());
      break;
    }
  }

  if (!token && csrf) token = csrf;
  return { vid, token, csrf };
}

function customUnescapePercent(str) {
  return String(str ?? '')
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function decodeCmsPlayerUrl(rawUrl, encrypt = 0) {
  let u = String(rawUrl ?? '').trim();
  if (!u) return '';
  const encMode = Number(encrypt || 0);
  if (encMode === 1) {
    try {
      u = decodeURIComponent(u);
    } catch {
      u = customUnescapePercent(u);
    }
  } else if (encMode === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      try {
        u = decodeURIComponent(b64Decoded);
      } catch {
        u = customUnescapePercent(b64Decoded);
      }
    } catch {
      u = customUnescapePercent(u);
    }
  }
  return unescapeJsString(u).trim();
}

function unpackDeanEdwards(html) {
  const s = String(html || '');
  const results = [];
  const re =
    /eval\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const symtab = m[6].split('|');
    if (!radix || !count || symtab.length === 0) continue;

    const encodeToken = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) return chars[num] || num.toString(base);
      return encodeToken(Math.floor(num / base), base) + (chars[num % base] || (num % base).toString(base));
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeToken(i, radix);
      dict.set(key, symtab[i] || key);
    }
    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (tok) =>
      dict.has(tok) ? dict.get(tok) : tok
    );
    results.push(unpacked);
  }
  return results;
}

// AES-CTR & AES-CBC Decryption for encrypted manifests & byte-range streams
function addCounter(ivBuf, blockOffset) {
  const counter = Buffer.from(ivBuf);
  let carry = BigInt(blockOffset);
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 0xffn);
    counter[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}

function aesCtrDecrypt(keyBuf, ivBuf, dataBuf, byteOffset = 0) {
  const keyLen = keyBuf.length;
  const algo =
    keyLen === 16 ? 'aes-128-ctr' : keyLen === 24 ? 'aes-192-ctr' : 'aes-256-ctr';
  const blockOffset = Math.floor(byteOffset / 16);
  const byteSkip = byteOffset % 16;
  const counterIv = addCounter(ivBuf, blockOffset);
  const decipher = crypto.createDecipheriv(algo, keyBuf, counterIv);
  decipher.setAutoPadding(false);
  const paddedInput =
    byteSkip > 0 ? Buffer.concat([Buffer.alloc(byteSkip), dataBuf]) : dataBuf;
  const out = Buffer.concat([decipher.update(paddedInput), decipher.final()]);
  return byteSkip > 0 ? out.subarray(byteSkip) : out;
}

function decryptDatas(html) {
  const s = String(html || '');
  if (!s) return null;

  // Extract datas base64 string (either inline decryptDatas("b64", "key") or const datas = "b64")
  let b64Payload = '';
  let explicitKeySeed = '';

  const inlineCall = s.match(
    /decryptDatas\(\s*["']([A-Za-z0-9+/=_-]{24,})["']\s*(?:,\s*["']([^"']+)["'])?\s*\)/
  );
  if (inlineCall) {
    b64Payload = inlineCall[1];
    explicitKeySeed = inlineCall[2] || '';
  } else {
    const varMatch =
      s.match(/(?:const|let|var|window\.)\s*datas\s*=\s*["']([A-Za-z0-9+/=_-]{24,})["']/) ||
      s.match(/\bdatas\s*=\s*["']([A-Za-z0-9+/=_-]{24,})["']/);
    if (varMatch) {
      b64Payload = varMatch[1];
    }
    const callWithKey = s.match(/decryptDatas\(\s*datas\s*,\s*["']([^"']+)["']\s*\)/);
    if (callWithKey && callWithKey[1]) {
      explicitKeySeed = callWithKey[1];
    }
  }

  if (!b64Payload) return null;

  const rawBuf = Buffer.from(b64Payload, 'base64');

  // Case 1: Outer Base64 is JSON envelope ({ user_id, slug, md5_id, media } or { encryptedData, iv, key })
  for (const encoding of ['utf8', 'latin1']) {
    try {
      const txt = rawBuf.toString(encoding).trim();
      if (!txt.startsWith('{')) continue;
      const obj = JSON.parse(txt);
      if (!obj || typeof obj !== 'object') continue;

      if (obj.encryptedData) {
        const seed = explicitKeySeed || obj.key || '';
        const fullKeyHex = md5Hex(seed);
        const keyCandidates = [
          Buffer.from(fullKeyHex, 'utf8'),
          Buffer.from(fullKeyHex.slice(0, 16), 'utf8'),
        ];
        if (seed && (seed.length === 16 || seed.length === 24 || seed.length === 32)) {
          keyCandidates.unshift(Buffer.from(seed, 'utf8'));
        }
        const cipherBuf = Buffer.from(obj.encryptedData, 'base64');
        for (const kBuf of keyCandidates) {
          const ivBuf = obj.iv
            ? Buffer.from(String(obj.iv), 'utf8').subarray(0, 16)
            : kBuf.subarray(0, 16);
          if (ivBuf.length < 16) continue;
          try {
            const plain = aesCtrDecrypt(kBuf, ivBuf, cipherBuf).toString('utf8').trim();
            if (plain.startsWith('{') || plain.startsWith('[')) {
              return JSON.parse(plain);
            }
          } catch {
            // try next key
          }
        }
      }

      if (obj.media && (obj.user_id !== undefined || obj.slug !== undefined || obj.md5_id !== undefined)) {
        if (Array.isArray(obj.media) || typeof obj.media === 'object') {
          return obj;
        }
        const keySeed = `${obj.user_id ?? ''}:${obj.slug ?? ''}:${obj.md5_id ?? ''}`;
        const md5Str = md5Hex(keySeed);
        const keyCandidates = [
          Buffer.from(md5Str, 'utf8'),
          Buffer.from(md5Str.slice(0, 16), 'utf8'),
        ];
        const cipherCandidates = [Buffer.from(String(obj.media), 'latin1')];
        if (/^[A-Za-z0-9+/=]+$/.test(String(obj.media))) {
          cipherCandidates.push(Buffer.from(String(obj.media), 'base64'));
        }
        for (const cBuf of cipherCandidates) {
          for (const kBuf of keyCandidates) {
            try {
              const ivBuf = kBuf.subarray(0, 16);
              const decStr = aesCtrDecrypt(kBuf, ivBuf, cBuf).toString('utf8').trim();
              if (decStr.startsWith('{') || decStr.startsWith('[')) {
                return { ...obj, ...JSON.parse(decStr) };
              }
            } catch {
              // continue
            }
          }
        }
      }
    } catch {
      // continue
    }
  }

  // Case 2: Single-argument decryptDatas(datas) with inline CryptoJS AES-CBC key & iv
  const utf8Parses = [...s.matchAll(/Utf8\.parse\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  if (utf8Parses.length >= 2) {
    const keyStr = utf8Parses[0];
    const ivStr = utf8Parses[1];
    const kBuf = Buffer.from(keyStr, 'utf8');
    const iBuf = Buffer.from(ivStr, 'utf8').subarray(0, 16);
    if ((kBuf.length === 16 || kBuf.length === 24 || kBuf.length === 32) && iBuf.length === 16) {
      try {
        const algo =
          kBuf.length === 16 ? 'aes-128-cbc' : kBuf.length === 24 ? 'aes-192-cbc' : 'aes-256-cbc';
        const decipher = crypto.createDecipheriv(algo, kBuf, iBuf);
        const plain = Buffer.concat([decipher.update(rawBuf), decipher.final()])
          .toString('utf8')
          .trim();
        if (plain.startsWith('{') || plain.startsWith('[')) {
          return JSON.parse(plain);
        }
      } catch {
        // ignore
      }
    }
  }

  return null;
}

function unwrapNestedPlayerUrl(candidateUrl, baseUrl = activeDomain) {
  let u = unescapeJsString(String(candidateUrl ?? '').trim()).split('@@@')[0].trim();
  if (!u) return '';
  for (let pass = 0; pass < 2; pass++) {
    if (/^https?%3A%2F%2F/i.test(u) || /^%2F/i.test(u)) {
      try {
        u = decodeURIComponent(u);
      } catch {
        u = customUnescapePercent(u);
      }
    }
  }
  u = absUrl(u, baseUrl);
  if (!u) return '';

  try {
    const parsed = new URL(u);
    const pathname = parsed.pathname.toLowerCase();
    // Only treat as direct before checking query params if the pathname itself has a media extension
    if (/\.(m3u8|mp4|flv|mkv|ts|mpd|webm)$/i.test(pathname) && isDirectMediaUrl(u)) {
      return u;
    }
    for (const paramName of ['url', 'v', 'src', 'file', 'm3u8', 'play', 'source', 'vid']) {
      const val = parsed.searchParams.get(paramName);
      if (!val) continue;
      let inner = val.trim();
      for (let i = 0; i < 2; i++) {
        try {
          const dec = decodeURIComponent(inner);
          if (dec === inner) break;
          inner = dec;
        } catch {
          inner = customUnescapePercent(inner);
        }
      }
      if (/^(?:aHR0cHM6Ly|aHR0cDov)[A-Za-z0-9+/=_-]+$/.test(inner)) {
        try {
          const b64 = Buffer.from(inner, 'base64').toString('utf8').trim();
          if (/^https?:\/\//i.test(b64)) inner = b64;
        } catch {
          // ignore
        }
      }
      inner = unescapeJsString(inner).trim();
      const resolvedInner = absUrl(inner, parsed.origin);
      if (isDirectMediaUrl(resolvedInner)) {
        return resolvedInner;
      }
    }
  } catch {
    // ignore
  }
  return isDirectMediaUrl(u) ? u : '';
}

function extractStreamInfoFromHtml(html, pageUrl = activeDomain) {
  if (!html) return null;
  const blocksToScan = [String(html), ...unpackDeanEdwards(html)];

  for (const block of blocksToScan) {
    // 1. Check watch-config direct sources if embedded
    const cfg = parseWatchConfig(block);
    const directSources = cfg?.sources || cfg?.playback?.sources || cfg?.video?.sources;
    if (Array.isArray(directSources) && directSources.length > 0) {
      const sorted = [...directSources].sort(
        (a, b) => (parseInt(b?.size || b?.label || 0, 10) || 0) - (parseInt(a?.size || a?.label || 0, 10) || 0)
      );
      for (const s of sorted) {
        const cand = unescapeJsString(s?.src || s?.file || s?.url || '').trim();
        const resolved = unwrapNestedPlayerUrl(cand, pageUrl) || absUrl(cand, pageUrl);
        if (resolved && isDirectMediaUrl(resolved)) {
          return { url: resolved, referer: pageUrl };
        }
      }
    }

    // 2. Check decryptDatas encrypted manifest (AES-CTR / AES-CBC)
    const decrypted = decryptDatas(block);
    if (decrypted && typeof decrypted === 'object') {
      const hlsUrl =
        decrypted?.hls?.url ||
        decrypted?.hls?.src ||
        (typeof decrypted?.hls === 'string' ? decrypted.hls : '');
      if (hlsUrl) {
        const fullHls = absUrl(unescapeJsString(hlsUrl), pageUrl);
        if (isDirectMediaUrl(fullHls)) {
          return { url: fullHls, referer: pageUrl };
        }
      }
      if (Array.isArray(decrypted.media) && decrypted.media.length > 0) {
        const item = decrypted.media[0];
        const fileUrl = absUrl(unescapeJsString(item.file || item.url || ''), pageUrl);
        if (fileUrl) {
          const fileName = (() => {
            try {
              const p = new URL(fileUrl).pathname;
              return p.slice(p.lastIndexOf('/') + 1);
            } catch {
              return 'video.mp4';
            }
          })();
          const secretStr = `${decrypted.user_id ?? ''}${decrypted.slug ?? ''}${decrypted.md5_id ?? ''}${fileName}`;
          const shaHex = crypto.createHash('sha256').update(secretStr, 'utf8').digest('hex');
          return {
            url: fileUrl,
            referer: pageUrl,
            encryptedMp4: true,
            keyHex: Buffer.from(shaHex.slice(0, 32), 'utf8').toString('hex'),
            ivHex: Buffer.from(shaHex.slice(0, 16), 'utf8').toString('hex'),
            encLen: Number(item.encrypted_byte || 65536),
            totalSize: Number(item.size || 0),
          };
        }
      }
      const mp4Sources = decrypted?.mp4?.sources || decrypted?.sources;
      if (Array.isArray(mp4Sources) && mp4Sources.length > 0) {
        const active = mp4Sources.find((x) => x && (x.status === 1 || x.url || x.src)) || mp4Sources[0];
        if (active) {
          const base = String(active.url || active.src || '').replace(/\/+$/, '');
          const pathPart = String(active.path || '');
          const combined = pathPart
            ? `${base}/${pathPart.replace(/^\/+/, '')}`
            : base;
          const fullMp4 = absUrl(unescapeJsString(combined), pageUrl);
          const keySeedName = pathPart
            ? pathPart.replace(/^\/+/, '').split('?')[0]
            : (() => {
                try {
                  const p = new URL(fullMp4).pathname;
                  return p.slice(p.lastIndexOf('/') + 1);
                } catch {
                  return '';
                }
              })();
          if (fullMp4 && keySeedName && active.path) {
            const kBuf = Buffer.from(md5Hex(keySeedName), 'utf8');
            const iBuf = kBuf.subarray(0, 16);
            return {
              url: fullMp4,
              referer: pageUrl,
              encryptedMp4: true,
              keySeedName,
              keyHex: kBuf.toString('hex'),
              ivHex: iBuf.toString('hex'),
              encLen: Number(active.encrypted_byte || 65536),
              totalSize: Number(active.size || 0),
            };
          }
          if (fullMp4 && isDirectMediaUrl(fullMp4)) {
            return { url: fullMp4, referer: pageUrl };
          }
        }
      }
    }

    // 3. Check CMS player objects (player_aaaa, player_data, player_config)
    for (const varRe of [
      /(?:var|let|const|window\.)?\s*player_aaaa\s*=/i,
      /(?:var|let|const|window\.)?\s*player_data\s*=/i,
      /(?:var|let|const|window\.)?\s*player_config\s*=/i,
    ]) {
      const obj = extractBalancedJsonObject(block, varRe);
      if (obj && obj.url) {
        const decoded = decodeCmsPlayerUrl(obj.url, obj.encrypt);
        const unwrapped = unwrapNestedPlayerUrl(decoded, pageUrl) || absUrl(decoded, pageUrl);
        if (isDirectMediaUrl(unwrapped)) {
          return { url: unwrapped, referer: pageUrl };
        }
      }
    }

    // 4. Priority named player variables (m3u8_url, hls_url, stream_url, playUrl, videoUrl)
    const normalized = unescapeJsString(block);
    const priorityVarRe =
      /\b(?:m3u8_url|hls_url|stream_url|video_url|play_url|playUrl|videoUrl|normalPlayUrl)\s*[:=]\s*["']([^"']+)["']/gi;
    let pm;
    while ((pm = priorityVarRe.exec(normalized)) !== null) {
      const rawVal = pm[1].trim();
      if (!rawVal || rawVal === 'none' || rawVal.startsWith('/login')) continue;
      const unwrapped = unwrapNestedPlayerUrl(rawVal, pageUrl) || absUrl(rawVal, pageUrl);
      if (unwrapped && isDirectMediaUrl(unwrapped)) {
        return { url: unwrapped, referer: pageUrl };
      }
    }

    // 5. Scan <video> and <source> tags (excluding preview/trailer clips)
    const videoSourceRe = /<(?:video|source)\b[^>]*\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    while ((pm = videoSourceRe.exec(normalized)) !== null) {
      const cand = absUrl(pm[1].trim(), pageUrl);
      if (cand && isDirectMediaUrl(cand)) {
        return { url: cand, referer: pageUrl };
      }
    }

    // 6. General direct .m3u8 / .mp4 scan (excluding BAD_VIDEO_TOKENS and decoy variables)
    const mediaRegex = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
    let m;
    while ((m = mediaRegex.exec(normalized)) !== null) {
      const cand = m[0].replace(/[),;]+$/, '');
      if (isDirectMediaUrl(cand)) {
        return { url: cand, referer: pageUrl };
      }
    }
  }
  return null;
}

function extractStreamFromHtmlFallback(html, pageUrl = activeDomain) {
  const info = extractStreamInfoFromHtml(html, pageUrl);
  return info?.url || '';
}

function buildStreamHeaders(streamUrl, referer = '') {
  const header = {
    'User-Agent': currentUa,
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Connection: 'keep-alive',
  };
  if (referer) {
    header.Referer = referer;
  }
  const m = String(streamUrl || '').match(/^(https?:\/\/[^/]+)/i);
  if (m && m[1]) {
    header.Origin = m[1];
  }
  return header;
}

function parseSourcesFromAjaxJson(data, baseUrl = activeDomain) {
  if (!data || typeof data !== 'object') return [];
  const results = [];

  if (Array.isArray(data.sources) && data.sources.length > 0) {
    for (const s of data.sources) {
      const rawSrc = unescapeJsString(String(s?.src || s?.file || s?.url || '')).trim();
      if (rawSrc) {
        results.push({
          src: absUrl(rawSrc, baseUrl),
          size: parseInt(String(s?.size || s?.label || 1080), 10) || 1080,
        });
      }
    }
  }

  // Classic Javtiful /ajax/get_cdn response format: { playlists: "https://...", playlist_active: "https://..." }
  const playlistCandidates = [];
  if (typeof data.playlist_active === 'string' && data.playlist_active.trim()) {
    playlistCandidates.push(data.playlist_active.trim());
  }
  if (typeof data.playlists === 'string' && data.playlists.trim()) {
    playlistCandidates.push(data.playlists.trim());
  } else if (Array.isArray(data.playlists)) {
    for (const item of data.playlists) {
      if (typeof item === 'string' && item.trim()) {
        playlistCandidates.push(item.trim());
      } else if (item && typeof item === 'object') {
        const u = item.src || item.file || item.url || '';
        if (u) playlistCandidates.push(String(u).trim());
      }
    }
  }
  for (const field of ['url', 'file', 'src', 'stream', 'hls', 'mp4']) {
    if (typeof data[field] === 'string' && data[field].trim()) {
      playlistCandidates.push(data[field].trim());
    }
  }

  for (const rawUrl of playlistCandidates) {
    const clean = absUrl(unescapeJsString(rawUrl), baseUrl);
    if (clean && !results.some((r) => r.src === clean)) {
      results.push({ src: clean, size: 1080 });
    }
  }

  results.sort((a, b) => (b.size || 0) - (a.size || 0));
  return results;
}

async function resolveJavtifulPlayback(vid, referer = '', initialHtml = '') {
  if (vid) {
    const cached = getPlayCache(vid);
    if (cached && cached.url) {
      return {
        sources: [{ src: cached.url, size: 1080 }],
        finalUrl: cached.referer || referer || activeDomain,
        streamInfo: cached,
      };
    }
  }

  const pageSnapshots = [];
  if (initialHtml) {
    pageSnapshots.push({
      html: initialHtml,
      finalUrl: referer || `${activeDomain}/video/${vid}`,
    });
  }

  // Try /embed/<vid> with language prefix first, then without prefix
  if (vid) {
    const resLang = await fetchSite(`/embed/${vid}`, { useLangPrefix: true, referer });
    if (resLang.text) {
      pageSnapshots.push({
        html: resLang.text,
        finalUrl: resLang.final_url || `${activeDomain}/${currentLang}/embed/${vid}`,
      });
    }

    const hasWatchCfg = pageSnapshots.some((snap) => {
      const c = parseWatchConfig(snap.html);
      return (c?.playback?.endpoint && c?.playback?.ticket) || Array.isArray(c?.sources);
    });

    if (!hasWatchCfg) {
      const resNoLang = await fetchSite(`/embed/${vid}`, { useLangPrefix: false, referer });
      if (resNoLang.text) {
        pageSnapshots.push({
          html: resNoLang.text,
          finalUrl: resNoLang.final_url || `${activeDomain}/embed/${vid}`,
        });
      }
    }
  }

  // If referer is a video detail page (or non-embed URL) and not yet fetched, fetch it too
  if (referer && !initialHtml && (!vid || !referer.endsWith(`/embed/${vid}`))) {
    const refRes = await fetchSite(referer, { useLangPrefix: false, referer });
    if (refRes.text) {
      pageSnapshots.push({
        html: refRes.text,
        finalUrl: refRes.final_url || referer,
      });
    }
  }

  const defaultEmbedUrl =
    pageSnapshots[0]?.finalUrl || (vid ? `${activeDomain}/embed/${vid}` : referer || activeDomain);

  // Stage 1: Check watch-config playback.endpoint + playback.ticket across snapshots
  for (const snap of pageSnapshots) {
    const cfg = parseWatchConfig(snap.html);
    const directSources = parseSourcesFromAjaxJson(
      { sources: cfg?.sources || cfg?.playback?.sources },
      snap.finalUrl
    );
    if (directSources.length > 0) {
      const bestSrc = directSources[0].src;
      const info = { url: bestSrc, referer: snap.finalUrl };
      if (vid) setPlayCache(vid, info);
      return { sources: directSources, finalUrl: snap.finalUrl, streamInfo: info };
    }

    const playback = cfg?.playback || {};
    const endpoint = String(playback.endpoint || cfg?.endpoint || '').trim();
    let ticket = String(playback.ticket || cfg?.ticket || '').trim();
    const { csrf } = extractPageCsrfAndVideoTokens(snap.html, vid);

    if (endpoint && ticket) {
      const origin = (() => {
        try {
          return new URL(snap.finalUrl).origin;
        } catch {
          return activeDomain;
        }
      })();
      const postUrl = /^https?:\/\//i.test(endpoint)
        ? endpoint
        : `${origin}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

      const headersCustom = {
        'User-Agent': currentUa,
        Accept: 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: snap.finalUrl,
        Origin: new URL(postUrl).origin,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Connection: 'close',
      };
      if (csrf) {
        headersCustom['X-CSRF-TOKEN'] = csrf;
      }

      for (let step = 0; step < 2; step++) {
        const formPayload = csrf ? { ticket, _token: csrf } : { ticket };
        const bodyStr = new URLSearchParams(formPayload).toString();
        const postRes = await fetchUrl(postUrl, {
          data: bodyStr,
          formObj: formPayload,
          referer: snap.finalUrl,
          headersCustom,
          method: 'POST',
          timeout: 12000,
        });

        if (postRes.code === 419 && step === 0 && vid) {
          const again = await fetchSite(`/embed/${vid}`, { useLangPrefix: true, referer: snap.finalUrl });
          const pb2 = parseWatchConfig(again.text || '')?.playback || {};
          if (pb2.ticket) {
            ticket = String(pb2.ticket);
            headersCustom.Referer = again.final_url || headersCustom.Referer;
            continue;
          }
          break;
        }

        let data = {};
        try {
          data = JSON.parse(postRes.text || '{}');
        } catch {
          break;
        }

        const sources = parseSourcesFromAjaxJson(data, snap.finalUrl);
        if (sources.length > 0) {
          const bestSrc = sources[0].src;
          const info = { url: bestSrc, referer: snap.finalUrl };
          if (vid) setPlayCache(vid, info);
          return { sources, finalUrl: snap.finalUrl, streamInfo: info };
        }

        if (data.renewTicket) {
          ticket = String(data.renewTicket);
          continue;
        }
        break;
      }
    }
  }

  // Stage 2: Classic Javtiful POST /ajax/get_cdn (with video_id, pid_c, token from #token_full / #hlstoken)
  for (const snap of pageSnapshots) {
    const { vid: extractedVid, token, csrf } = extractPageCsrfAndVideoTokens(snap.html, vid);
    const effectiveVid = extractedVid || vid;
    if (effectiveVid && token) {
      const origin = (() => {
        try {
          return new URL(snap.finalUrl).origin;
        } catch {
          return activeDomain;
        }
      })();
      const cdnEndpoints = [`${origin}/ajax/get_cdn`, `${origin}/${currentLang}/ajax/get_cdn`];
      for (const cdnUrl of cdnEndpoints) {
        const headersCustom = {
          'User-Agent': currentUa,
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: snap.finalUrl,
          Origin: origin,
        };
        if (csrf) headersCustom['X-CSRF-TOKEN'] = csrf;
        const formPayload = { video_id: String(effectiveVid), pid_c: '', token };
        const bodyStr = new URLSearchParams(formPayload).toString();
        const postRes = await fetchUrl(cdnUrl, {
          data: bodyStr,
          formObj: formPayload,
          referer: snap.finalUrl,
          headersCustom,
          method: 'POST',
          timeout: 12000,
        });
        let data = {};
        try {
          data = JSON.parse(postRes.text || '{}');
        } catch {
          continue;
        }
        const sources = parseSourcesFromAjaxJson(data, snap.finalUrl);
        if (sources.length > 0) {
          const info = { url: sources[0].src, referer: snap.finalUrl };
          if (effectiveVid) setPlayCache(effectiveVid, info);
          return { sources, finalUrl: snap.finalUrl, streamInfo: info };
        }
      }
    }
  }

  // Stage 3: Fallback HTML / Packer / CMS / decryptDatas / iframe extraction across snapshots
  for (const snap of pageSnapshots) {
    const streamInfo = extractStreamInfoFromHtml(snap.html, snap.finalUrl);
    if (streamInfo && streamInfo.url) {
      if (vid) setPlayCache(vid, streamInfo);
      return {
        sources: [{ src: streamInfo.url, size: 720 }],
        finalUrl: snap.finalUrl,
        streamInfo,
      };
    }

    // Check embedded iframes inside snapshot
    const iframeTagRe = /<iframe\b[^>]*>/gi;
    let im;
    while ((im = iframeTagRe.exec(snap.html)) !== null) {
      const rawIframeSrc = extractAttrUrlFromTag(im[0], undefined, true);
      if (!rawIframeSrc) continue;
      const iframeUrl = absUrl(rawIframeSrc, snap.finalUrl);
      if (!iframeUrl || iframeUrl === snap.finalUrl) continue;
      const unwrappedIframe = unwrapNestedPlayerUrl(iframeUrl, snap.finalUrl);
      if (unwrappedIframe && isDirectMediaUrl(unwrappedIframe)) {
        const info = { url: unwrappedIframe, referer: snap.finalUrl };
        if (vid) setPlayCache(vid, info);
        return {
          sources: [{ src: unwrappedIframe, size: 720 }],
          finalUrl: snap.finalUrl,
          streamInfo: info,
        };
      }
      const iframeRes = await fetchUrl(iframeUrl, { referer: snap.finalUrl });
      if (iframeRes.text) {
        const iframeInfo = extractStreamInfoFromHtml(
          iframeRes.text,
          iframeRes.final_url || iframeUrl
        );
        if (iframeInfo && iframeInfo.url) {
          if (vid) setPlayCache(vid, iframeInfo);
          return {
            sources: [{ src: iframeInfo.url, size: 720 }],
            finalUrl: iframeRes.final_url || iframeUrl,
            streamInfo: iframeInfo,
          };
        }
      }
    }
  }

  return { sources: [], finalUrl: defaultEmbedUrl, streamInfo: null };
}

function rewriteM3u8Manifest(manifestText, manifestUrl, proxyBasePath, referer = '') {
  const lines = String(manifestText || '').split(/\r?\n/);
  const out = [];

  const buildProxyUrl = (targetUrl, isSegment = false) => {
    const resolved = absUrl(targetUrl, manifestUrl);
    if (!resolved) return targetUrl;
    const qs = new URLSearchParams();
    qs.set('u', resolved);
    if (referer) qs.set('r', referer);
    if (isSegment) qs.set('type', 'ts');
    return `${proxyBasePath}?${qs.toString()}`;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith('#')) {
      const rewrittenTag = line.replace(/URI=["']([^"']+)["']/gi, (_, uri) => {
        return `URI="${buildProxyUrl(uri, false)}"`;
      });
      out.push(rewrittenTag);
      continue;
    }
    const isSubManifest = /\.m3u8(?:\?|$)/i.test(trimmed);
    out.push(buildProxyUrl(trimmed, !isSubManifest));
  }
  return out.join('\n');
}

async function handleStreamProxyRequest(query = {}, reqHeaders = {}, method = 'GET') {
  const sid = String(query.sid || '').trim();
  const session = sid ? STREAM_SESSIONS.get(sid) : null;
  const targetUrl = String(query.u || query.url || session?.url || '').trim();
  const referer = String(query.r || query.ref || session?.referer || `${activeDomain}/`).trim();
  const forceType = String(query.type || '').toLowerCase();

  if (!targetUrl) {
    return { status: 400, headers: { 'Content-Type': 'text/plain' }, body: Buffer.from('Missing url') };
  }

  const keySeedName = String(query.k || session?.keySeedName || '').trim();
  let keyBuf = null;
  let ivBuf = null;
  if (session?.keyHex && session?.ivHex) {
    keyBuf = Buffer.from(session.keyHex, 'hex');
    ivBuf = Buffer.from(session.ivHex, 'hex');
  } else if (keySeedName) {
    keyBuf = Buffer.from(md5Hex(keySeedName), 'utf8');
    ivBuf = keyBuf.subarray(0, 16);
  }
  const encBoundary = Number(query.eb || session?.encLen || (keyBuf ? 65536 : 0));
  const knownTotalSize = Number(query.s || session?.totalSize || 0);

  // Check if HLS manifest request
  const isM3u8 =
    forceType === 'm3u8' ||
    (/\.m3u8(?:\?|$)/i.test(targetUrl) && forceType !== 'ts');
  if (isM3u8) {
    const res = await fetchUrl(targetUrl, { referer });
    const proxyPath = '/javtiful_fd';
    const rewritten = rewriteM3u8Manifest(res.text || '', res.final_url || targetUrl, proxyPath, referer);
    const bodyBuf = Buffer.from(rewritten, 'utf8');
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': String(bodyBuf.length),
        'Access-Control-Allow-Origin': '*',
      },
      body: method.toUpperCase() === 'HEAD' ? Buffer.alloc(0) : bodyBuf,
    };
  }

  const clientRange = reqHeaders.range || reqHeaders.Range || '';
  const upHeaders = buildStreamHeaders(targetUrl, referer);
  if (clientRange) {
    upHeaders.Range = clientRange;
  }

  // Fetch from upstream via reqMock / util/req.js first, falling back to nativeHttpRequest
  let upStatus = 200;
  let upRespHeaders = {};
  let rawBytes = Buffer.alloc(0);

  try {
    const r = await req(targetUrl, {
      method: 'GET',
      headers: upHeaders,
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    upStatus = Number(r?.status || r?.statusCode || 200);
    upRespHeaders = r?.headers || {};
    const payload = r?.data !== undefined ? r.data : r?.body !== undefined ? r.body : Buffer.alloc(0);
    rawBytes = Buffer.isBuffer(payload)
      ? payload
      : payload instanceof ArrayBuffer
      ? Buffer.from(payload)
      : ArrayBuffer.isView(payload)
      ? Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
      : Buffer.from(String(payload || ''), 'binary');
  } catch {
    const nat = await nativeHttpRequest(targetUrl, {
      method: 'GET',
      headers: upHeaders,
      timeout: 15000,
    });
    upStatus = nat.code > 0 ? nat.code : 502;
    upRespHeaders = nat.headers || {};
    rawBytes = nat.rawBuf || Buffer.alloc(0);
  }

  let startByte = 0;
  let endByte = rawBytes.length > 0 ? rawBytes.length - 1 : 0;
  let totalBytes = knownTotalSize || rawBytes.length;

  const crHeader = upRespHeaders['content-range'] || upRespHeaders['Content-Range'] || '';
  const crMatch = String(crHeader).match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  if (crMatch) {
    startByte = parseInt(crMatch[1], 10);
    endByte = parseInt(crMatch[2], 10);
    if (crMatch[3] !== '*') {
      totalBytes = parseInt(crMatch[3], 10);
    }
  } else if (clientRange) {
    const rm = String(clientRange).match(/bytes=(\d*)-(\d*)/i);
    if (rm) {
      if (rm[1] === '' && rm[2]) {
        const suffix = parseInt(rm[2], 10);
        startByte = Math.max(0, totalBytes - suffix);
        endByte = totalBytes - 1;
      } else {
        startByte = parseInt(rm[1] || '0', 10) || 0;
        endByte = rm[2] ? parseInt(rm[2], 10) : totalBytes - 1;
      }
      if (rawBytes.length > endByte - startByte + 1 && upStatus === 200) {
        rawBytes = rawBytes.subarray(startByte, endByte + 1);
      }
      upStatus = 206;
    }
  }

  // Perform on-the-fly AES-CTR byte-range decryption if keyBuf is active and slice overlaps [0, encBoundary)
  let outputBytes = rawBytes;
  if (keyBuf && ivBuf && encBoundary > 0 && rawBytes.length > 0 && startByte < encBoundary) {
    const encEndOffset = Math.min(rawBytes.length, encBoundary - startByte);
    const encPart = rawBytes.subarray(0, encEndOffset);
    const decPart = aesCtrDecrypt(keyBuf, ivBuf, encPart, startByte);
    outputBytes =
      encEndOffset < rawBytes.length
        ? Buffer.concat([decPart, rawBytes.subarray(encEndOffset)])
        : decPart;
  }

  const contentType =
    forceType === 'ts'
      ? 'video/mp2t'
      : upRespHeaders['content-type'] || upRespHeaders['Content-Type'] || 'video/mp4';

  const outHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(outputBytes.length),
    'Access-Control-Allow-Origin': '*',
  };

  if (clientRange && upStatus === 206) {
    const finalEnd = startByte + outputBytes.length - 1;
    const finalTotal = Math.max(totalBytes, finalEnd + 1);
    outHeaders['Content-Range'] = `bytes ${startByte}-${finalEnd}/${finalTotal}`;
    return {
      status: 206,
      headers: outHeaders,
      body: method.toUpperCase() === 'HEAD' ? Buffer.alloc(0) : outputBytes,
    };
  }

  // Omit Content-Range on 200 OK per RFC 9110
  return {
    status: 200,
    headers: outHeaders,
    body: method.toUpperCase() === 'HEAD' ? Buffer.alloc(0) : outputBytes,
  };
}

async function ensureLocalProxyServer() {
  if (localProxyServer && localProxyPort > 0) {
    return localProxyPort;
  }
  return new Promise((resolve) => {
    const srv = http.createServer(async (reqIn, resOut) => {
      try {
        const u = new URL(reqIn.url || '/', `http://${reqIn.headers.host || '127.0.0.1'}`);
        const q = Object.fromEntries(u.searchParams.entries());
        if (u.pathname.endsWith('.m3u8')) q.type = 'm3u8';
        const result = await handleStreamProxyRequest(q, reqIn.headers || {}, reqIn.method || 'GET');
        resOut.writeHead(result.status, result.headers);
        resOut.end(result.body);
      } catch (e) {
        resOut.writeHead(500, { 'Content-Type': 'text/plain' });
        resOut.end(String(e?.message || e));
      }
    });
    srv.unref();
    srv.listen(0, '127.0.0.1', () => {
      localProxyServer = srv;
      localProxyPort = srv.address().port;
      resolve(localProxyPort);
    });
  });
}

async function closeLocalProxy() {
  if (localProxyServer) {
    const srv = localProxyServer;
    localProxyServer = null;
    localProxyPort = 0;
    await new Promise((r) => srv.close(() => r()));
  }
}

async function buildProxyStreamUrl(inReq, streamInfo) {
  const sid = crypto
    .createHash('md5')
    .update(`${streamInfo.url}|${streamInfo.keyHex || ''}|${streamInfo.ivHex || ''}`)
    .digest('hex')
    .slice(0, 16);
  STREAM_SESSIONS.set(sid, { ...streamInfo, ts: Date.now() });

  const reqHost = String(
    inReq?.headers?.['x-forwarded-host'] ||
      inReq?.headers?.host ||
      inReq?.raw?.headers?.host ||
      ''
  ).trim();
  const isRemoteHost =
    reqHost &&
    !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(reqHost);

  const isM3u8 = /\.m3u8(?:\?|$)/i.test(streamInfo.url);
  const qs = new URLSearchParams();
  qs.set('sid', sid);
  qs.set('u', streamInfo.url);
  if (streamInfo.referer) qs.set('r', streamInfo.referer);
  if (streamInfo.keySeedName) qs.set('k', streamInfo.keySeedName);
  if (streamInfo.totalSize) qs.set('s', String(streamInfo.totalSize));
  if (streamInfo.encLen) qs.set('eb', String(streamInfo.encLen));

  if (isRemoteHost) {
    const proto = String(inReq?.headers?.['x-forwarded-proto'] || inReq?.protocol || 'http')
      .split(',')[0]
      .trim();
    const rawPrefix =
      inReq?.server?.prefix ||
      String(inReq?.raw?.url || inReq?.url || '')
        .split('?')[0]
        .replace(/\/play\/?$/i, '');
    const cleanPrefix = String(rawPrefix || '').replace(/\/+$/, '');
    const routeSuffix = isM3u8 ? '/proxy.m3u8' : '/javtiful_fd';
    return `${proto}://${reqHost}${cleanPrefix}${routeSuffix}?${qs.toString()}`;
  }

  const port = await ensureLocalProxyServer();
  const extPath = isM3u8 ? '/proxy.m3u8' : '/javtiful_fd';
  return `http://127.0.0.1:${port}${extPath}?${qs.toString()}`;
}

async function init(inReq, ...extraArgs) {
  const params = unwrapRequestParams(inReq, extraArgs, 'init');
  const ext =
    params.extend && typeof params.extend === 'object'
      ? params.extend
      : params;
  const ua = String(ext?.ua || '').trim();
  if (ua) currentUa = ua;

  const customHosts = ext?.hosts || ext?.domains;
  if (Array.isArray(customHosts)) {
    for (let i = customHosts.length - 1; i >= 0; i--) {
      const h = String(customHosts[i] || '').trim().replace(/\/+$/, '');
      if (/^https?:\/\//i.test(h) && !SITE_DOMAINS.includes(h)) {
        SITE_DOMAINS.unshift(h);
      }
    }
    if (SITE_DOMAINS.length > 0) activeDomain = SITE_DOMAINS[0];
  }

  const site = String(ext?.site || ext?.url || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(site)) {
    activeDomain = site;
    if (!SITE_DOMAINS.includes(site)) {
      SITE_DOMAINS.unshift(site);
    }
  }
  return {};
}

async function home(inReq, ...extraArgs) {
  const params = unwrapRequestParams(inReq, extraArgs, 'home');
  const classes = [
    { type_name: '沉浸短视', type_id: 'shorts' },
    { type_name: '为你推荐', type_id: 'for_you' },
    { type_name: '综合视频', type_id: 'videos' },
    { type_name: '精选有码', type_id: 'censored' },
    { type_name: '高清无码', type_id: 'uncensored' },
    { type_name: '智能减码', type_id: 'mosaic_removed' },
    { type_name: '本周热门', type_id: 'popular_week' },
    { type_name: '最多观看', type_id: 'most_viewed' },
    { type_name: '最多点赞', type_id: 'most_liked' },
    { type_name: '题材分类', type_id: 'categories' },
    { type_name: '片商频道', type_id: 'channels' },
    { type_name: '热门女优', type_id: 'actresses' },
  ];

  const filters = {};
  const includeFilter = params.filter !== false && params.filter !== 'false' && params.filter !== 0;
  if (includeFilter) {
    const sortOpts = getSortFilters();
    const filterItem = [{ key: 'sort', name: '排序方式', init: '', value: sortOpts }];
    const sortableIds = new Set([
      'for_you',
      'videos',
      'censored',
      'uncensored',
      'mosaic_removed',
      'popular_week',
      'most_viewed',
      'most_liked',
    ]);
    for (const c of classes) {
      if (sortableIds.has(c.type_id)) {
        filters[c.type_id] = filterItem;
      }
    }
  }

  let list = [];
  try {
    const res = await fetchSite('/main');
    list = parseVideoCards(res.text || '').slice(0, 24);
  } catch {
    list = [];
  }

  return {
    class: classes,
    filters,
    list,
    style: CARD_STYLE_RECT,
  };
}

async function homeVod() {
  const res = await fetchSite('/main');
  const cards = parseVideoCards(res.text || '');
  return { list: cards.slice(0, 24) };
}

async function category(inReq, ...extraArgs) {
  const params = unwrapRequestParams(inReq, extraArgs, 'category');
  const tid = String(params.id ?? params.tid ?? params.type_id ?? 'censored').trim();
  const page = fixedInt(params.page ?? params.pg, 1);
  const extend =
    params.extend && typeof params.extend === 'object'
      ? params.extend
      : params.filters && typeof params.filters === 'object'
      ? params.filters
      : {};
  const sort = String(extend.sort ?? params.sort ?? '').trim();

  if (tid.startsWith('waterfall@@')) {
    const parts = tid.split('@@');
    const rawHref = decodeURIComponent(parts[2] || '');
    let target = rawHref;
    const qp = [];
    if (page > 1) qp.push(`page=${page}`);
    if (sort) qp.push(`sort=${encodeURIComponent(sort)}`);
    if (qp.length > 0) {
      target += (target.includes('?') ? '&' : '?') + qp.join('&');
    }
    const res = await fetchSite(target, {
      useLangPrefix: !/^https?:\/\//i.test(target) && !target.startsWith(`/${currentLang}/`),
    });
    const html = res.text || '';
    const cards = parseVideoCards(html);
    const pagecount = computePageCount(html, page, cards.length);
    return {
      list: cards,
      page,
      pagecount,
      limit: 24,
      total: pagecount * 24,
    };
  }

  const slug = tid.replace(/^\/+|\/+$/g, '');

  if (slug === 'shorts') {
    const curCursor = getCache(`jav_shorts_cur_${page}`) || '';
    const allItems = [];
    const seenUids = new Set();
    let cursorStep = curCursor;

    for (let step = 0; step < 2; step++) {
      const { items: batchItems, nextCursor } = await fetchShortsBatch(cursorStep);
      if (!batchItems || batchItems.length === 0) break;
      for (const it of batchItems) {
        const uid = it?.uid;
        if (uid && !seenUids.has(uid)) {
          seenUids.add(uid);
          allItems.push(it);
        } else if (!uid) {
          allItems.push(it);
        }
      }
      cursorStep = nextCursor;
      if (!cursorStep) break;
    }

    if (cursorStep) {
      setCache(`jav_shorts_cur_${page + 1}`, cursorStep);
    }

    const shortCards = allItems.map((it, i) => {
      const uid = it?.uid || `sh_${page}_${i}`;
      const caption = cleanLabel(it?.caption || `Shorts ${i + 1}`);
      const poster = it?.poster || '';
      const media = it?.media || '';
      const vodId = `short_feed@@${page}@@${i}@@${encodeURIComponent(media || uid)}`;
      return {
        vod_id: vodId,
        vod_name: caption,
        vod_pic: poster,
        vod_remarks: formatRemarks(BRAND_DIRECTOR, '短视频'),
        style: CARD_STYLE_SHORTS,
      };
    });

    const hasMore = Boolean(cursorStep) || allItems.length >= 4;
    const calcPagecount = hasMore ? page + 1 : page;
    const stdLimit = shortCards.length > 0 ? shortCards.length : 16;
    const calcTotal = calcPagecount * stdLimit;

    return {
      list: shortCards,
      page,
      pagecount: calcPagecount,
      limit: stdLimit,
      total: calcTotal,
    };
  }

  if (slug === 'for_you') {
    let target = page === 1 ? '/foryou' : `/foryou?page=${page}`;
    if (sort) {
      target += (target.includes('?') ? '&' : '?') + `sort=${encodeURIComponent(sort)}`;
    }
    const res = await fetchSite(target);
    const html = res.text || '';
    const cards = parseVideoCards(html);
    const pagecount = computePageCount(html, page, cards.length);
    return {
      list: cards,
      page,
      pagecount,
      limit: 24,
      total: pagecount * 24,
    };
  }

  if (slug === 'categories' || slug === 'channels' || slug === 'actresses') {
    const tagMap = {
      categories: 'category',
      channels: 'channel',
      actresses: 'actress',
    };
    const target = page === 1 ? `/${slug}` : `/${slug}?page=${page}`;
    const res = await fetchSite(target);
    const html = res.text || '';
    const folders = parseWaterfallCards(html, tagMap[slug]);
    const pagecount = computePageCount(html, page, folders.length);
    return {
      list: folders,
      page,
      pagecount,
      limit: 24,
      total: pagecount * 24,
    };
  }

  const baseMap = {
    videos: '/videos',
    censored: '/censored',
    uncensored: '/uncensored',
    mosaic_removed: '/reducing-mosaic',
    popular_week: '/videos?sort=popular_week',
    most_viewed: '/videos?sort=most_viewed',
    most_liked: '/videos?sort=most_liked',
  };
  const pathPart = baseMap[slug] || '/censored';
  const queryParams = [];
  if (page > 1) queryParams.push(`page=${page}`);
  if (sort) queryParams.push(`sort=${encodeURIComponent(sort)}`);

  const target =
    queryParams.length > 0
      ? `${pathPart}${pathPart.includes('?') ? '&' : '?'}${queryParams.join('&')}`
      : pathPart;

  const res = await fetchSite(target);
  const html = res.text || '';
  const cards = parseVideoCards(html);
  const pagecount = computePageCount(html, page, cards.length);
  return {
    list: cards,
    page,
    pagecount,
    limit: 24,
    total: pagecount * 24,
  };
}

async function detail(inReq, ...extraArgs) {
  const params = unwrapRequestParams(inReq, extraArgs, 'detail');
  const rawInput = params.id ?? params.ids ?? params.vod_id ?? params.url ?? '';
  const rawId = String(Array.isArray(rawInput) ? rawInput[0] : rawInput).trim();

  if (rawId.startsWith('waterfall@@')) {
    const parts = rawId.split('@@');
    const targetHref = decodeURIComponent(parts[2] || '');
    const res = await fetchSite(targetHref, {
      useLangPrefix: !/^https?:\/\//i.test(targetHref) && !targetHref.startsWith(`/${currentLang}/`),
    });
    const html = res.text || '';
    const cards = parseVideoCards(html);
    const cleanSegments = targetHref.replace(/^\/+|\/+$/g, '').split('/');
    const folderTitle = titleCaseSlug(cleanSegments[cleanSegments.length - 1] || 'Folder');

    const episodes = cards.map((c, i) => {
      const cName = String(c.vod_name || '')
        .replace(/[$#]/g, '')
        .slice(0, 20);
      const idxStr = String(i + 1).padStart(2, '0');
      return `${idxStr}·${cName}$${c.vod_id}`;
    });

    return {
      list: [
        {
          vod_id: rawId,
          vod_name: folderTitle,
          vod_pic: cards[0]?.vod_pic || '',
          vod_actor: BRAND_ACTOR,
          vod_director: BRAND_DIRECTOR,
          vod_remarks: formatRemarks(BRAND_DIRECTOR, `共${cards.length}部`),
          vod_content: `🦋 蝴蝶影视专线直连 | 官方交流群: @tvshare23`,
          vod_play_from: '蝴蝶专线',
          vod_play_url: episodes.length > 0 ? episodes.join('#') : '暂无正片$http://127.0.0.1',
        },
      ],
    };
  }

  if (rawId.startsWith('short_feed@@')) {
    const parts = rawId.split('@@');
    const startPage = fixedInt(parts[1], 1);
    const startOffset = Math.max(0, parseInt(parts[2] || '0', 10) || 0);
    const fallbackMedia = decodeURIComponent(parts[3] || '');

    const episodes = [];
    const seenMedia = new Set();

    const cursorForRun = getCache(`jav_shorts_cur_${startPage}`) || '';
    const { items: curItems, nextCursor: nxtC } = await fetchShortsBatch(cursorForRun);
    if (startOffset < curItems.length) {
      for (const it of curItems.slice(startOffset)) {
        const mUrl = String(it?.media || '').trim();
        if (mUrl && !seenMedia.has(mUrl)) {
          seenMedia.add(mUrl);
          episodes.push(`$${mUrl}`);
        }
      }
    }

    let cursorStep = nxtC;
    for (let step = 0; step < 5; step++) {
      if (!cursorStep) break;
      const { items: nxtItems, nextCursor: nxtStepC } = await fetchShortsBatch(cursorStep);
      if (!nxtItems || nxtItems.length === 0) break;
      for (const it of nxtItems) {
        const mUrl = String(it?.media || '').trim();
        if (mUrl && !seenMedia.has(mUrl)) {
          seenMedia.add(mUrl);
          episodes.push(`$${mUrl}`);
        }
      }
      cursorStep = nxtStepC;
      if (episodes.length >= 160) break;
    }

    if (episodes.length === 0 && /^https?:\/\//i.test(fallbackMedia)) {
      episodes.push(`$${fallbackMedia}`);
    }

    const activeItem =
      curItems && startOffset < curItems.length ? curItems[startOffset] : null;
    const firstPic = activeItem?.poster || '';
    const firstTitle = activeItem?.caption
      ? cleanLabel(activeItem.caption)
      : 'Shorts 沉浸连刷';

    return {
      list: [
        {
          vod_id: rawId,
          vod_name: firstTitle,
          vod_pic: firstPic,
          vod_actor: BRAND_ACTOR,
          vod_director: BRAND_DIRECTOR,
          vod_remarks: formatRemarks(BRAND_DIRECTOR, '沉浸连刷'),
          vod_content: '🦋 蝴蝶影视短视频沉浸连刷模式 | 官方交流群: @tvshare23',
          vod_play_from: '蝴蝶专线',
          vod_play_url: episodes.join('#'),
        },
      ],
    };
  }

  const res = await fetchSite(rawId, {
    useLangPrefix: !/^https?:\/\//i.test(rawId) && !rawId.startsWith(`/${currentLang}/`),
  });
  const html = res.text || '';
  const finalPageUrl = res.final_url || absUrl(rawId);

  let title = '';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    title = cleanLabel(h1Match[1]);
  }
  if (!title) {
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      title = cleanLabel(titleMatch[1].split(/\s*\|\s*/)[0]);
    }
  }

  let poster = '';
  for (const pat of [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ]) {
    const m = html.match(pat);
    if (m && m[1]) {
      poster = absUrl(htmlUnescape(m[1]), finalPageUrl);
      break;
    }
  }
  if (!poster) {
    poster = extractBlockPic(html);
  }

  const actors = [];
  const actressRe = /href=["'][^"']*?\/actress\/([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = actressRe.exec(html)) !== null) {
    const name = cleanLabel(m[2]);
    if (name && name.length <= 24 && !actors.includes(name)) {
      actors.push(name);
    }
  }
  const actor = actors.slice(0, 4).join(' / ');

  let channel = '';
  const channelMatch = html.match(/href=["'][^"']*?\/channel\/([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (channelMatch && channelMatch[2]) {
    channel = cleanLabel(channelMatch[2]);
  }

  const cates = [];
  const cateRe = /href=["'][^"']*?\/category\/([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = cateRe.exec(html)) !== null) {
    const name = cleanLabel(m[2]);
    if (name && name.length <= 20 && !cates.includes(name)) {
      cates.push(name);
    }
  }

  const ld = parseJsonLd(html);
  if (!poster && ld.thumbnailUrl) {
    const thumb = Array.isArray(ld.thumbnailUrl) ? ld.thumbnailUrl[0] : ld.thumbnailUrl;
    if (thumb) poster = absUrl(htmlUnescape(String(thumb)), finalPageUrl);
  }
  if (ld.name && !title) {
    title = cleanLabel(ld.name);
  }
  if (!title) {
    title = 'Javtiful Video';
  }

  let duration = formatIsoDuration(ld.duration || '');
  if (!duration) {
    const durMatch = html.match(/<strong>\d{2,3}<\/strong>\s*(\d{2}:\d{2}:\d{2})/);
    if (durMatch && durMatch[1]) {
      duration = durMatch[1];
    }
  }

  const { vid: domVid } = extractPageCsrfAndVideoTokens(html, '');
  let vid = domVid;
  if (!vid) {
    const vidMatch =
      finalPageUrl.match(/\/(?:[a-z]{2}\/)?(?:video|embed)\/(\d+)/i) ||
      rawId.match(/\/(?:[a-z]{2}\/)?(?:video|embed)\/(\d+)/i);
    if (vidMatch && vidMatch[1]) {
      vid = vidMatch[1];
    }
  }

  let playPage = finalPageUrl;
  const embed = String(ld.embedUrl || '').trim();
  if (embed) {
    playPage = absUrl(embed, finalPageUrl);
  } else if (vid) {
    playPage = `${activeDomain}/embed/${vid}`;
  } else {
    const iframeTagMatch = html.match(/<iframe\b[^>]*>/i);
    if (iframeTagMatch) {
      const iframeSrc = extractAttrUrlFromTag(iframeTagMatch[0], undefined, true);
      if (iframeSrc) {
        playPage = absUrl(iframeSrc, finalPageUrl);
      }
    }
  }

  // Pre-warm PLAY_CACHE using full multi-stage resolution (including inline watch-config, /ajax/get_cdn, or inline streams)
  if (vid) {
    const inlineInfo = extractStreamInfoFromHtml(html, finalPageUrl);
    if (inlineInfo && inlineInfo.url) {
      setPlayCache(vid, inlineInfo);
    } else {
      const { token } = extractPageCsrfAndVideoTokens(html, vid);
      const cfg = parseWatchConfig(html);
      if (token || cfg?.playback?.endpoint || cfg?.sources) {
        try {
          await resolveJavtifulPlayback(vid, finalPageUrl, html);
        } catch {
          // ignore pre-warm error and resolve on /play
        }
      }
    }
  } else {
    const inlineInfo = extractStreamInfoFromHtml(html, finalPageUrl);
    if (inlineInfo && inlineInfo.url) {
      setPlayCache(playPage, inlineInfo);
    }
  }

  const playToken =
    playPage !== finalPageUrl ? `${playPage}@@@${finalPageUrl}` : playPage;
  const episodes = [`正片$${playToken}`];
  const recCards = parseVideoCards(html);
  let recIdx = 1;
  for (const rc of recCards) {
    const rUrl = absUrl(rc.vod_id, finalPageUrl);
    if (rUrl !== finalPageUrl) {
      const cleanName = String(rc.vod_name || '')
        .replace(/[$#]/g, '')
        .slice(0, 20);
      const idxStr = String(recIdx).padStart(2, '0');
      episodes.push(`${idxStr}·${cleanName}$${rUrl}`);
      recIdx++;
    }
    if (recIdx > 24) break;
  }

  const remarks = [duration, cates[0] || ''].filter(Boolean);

  return {
    list: [
      {
        vod_id: rawId,
        vod_name: title,
        vod_pic: poster,
        vod_bg: poster,
        vod_background: poster,
        vod_banner: poster,
        vod_actor: actor || BRAND_ACTOR,
        vod_director: channel || BRAND_DIRECTOR,
        vod_remarks: formatRemarks(BRAND_DIRECTOR, remarks.join(' · ')),
        vod_content: `🦋 蝴蝶影视专线直连 | ${title} | 官方交流群: @tvshare23`,
        vod_play_from: '蝴蝶专线',
        vod_play_url: episodes.join('#'),
      },
    ],
  };
}

function sanitizePlayId(rawId) {
  let s = String(rawId ?? '').trim();
  if (!s) return '';
  // Strip custom metadata suffixes
  if (s.includes('@@@')) {
    s = s.split('@@@')[0].trim();
  }
  // Strip leading episode label before '$' (e.g., "正片$https://...", "01·Title$/video/...", "$https://...")
  const dollarIdx = s.indexOf('$');
  if (dollarIdx !== -1) {
    const prefix = s.slice(0, dollarIdx).trim();
    const rest = s.slice(dollarIdx + 1).trim();
    if (rest && (!prefix || (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')))) {
      s = rest;
    }
  }
  return s.trim();
}

function extractPlayMetaReferer(rawId) {
  const s = String(rawId ?? '').trim();
  if (!s.includes('@@@')) return '';
  const suffix = s.split('@@@')[1]?.trim() || '';
  if (/^https?:\/\//i.test(suffix) || suffix.startsWith('/')) {
    return absUrl(suffix);
  }
  return '';
}

async function formatPlayResponse(inReq, params, streamInfo, fallbackRef = '') {
  const fullStream = absUrl(streamInfo.url, streamInfo.referer || fallbackRef || activeDomain);
  const effectiveRef = streamInfo.referer || fallbackRef || `${activeDomain}/`;
  const hdr = buildStreamHeaders(fullStream, effectiveRef);
  const wantProxy =
    Boolean(streamInfo.encryptedMp4) ||
    params.proxy === '1' ||
    params.proxy === 1 ||
    params.proxy === true ||
    params.proxy === 'true';

  if (wantProxy) {
    const proxyUrl = await buildProxyStreamUrl(inReq, {
      ...streamInfo,
      url: fullStream,
      referer: effectiveRef,
    });
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: proxyUrl,
      header: hdr,
      headers: hdr,
    };
  }

  return {
    parse: 0,
    jx: 0,
    playUrl: '',
    url: fullStream,
    header: hdr,
    headers: hdr,
  };
}

async function play(inReq, ...extraArgs) {
  const params = unwrapRequestParams(inReq, extraArgs, 'play');
  const rawInput = String(params.id ?? params.url ?? params.playUrl ?? '').trim();
  const metaReferer = extractPlayMetaReferer(rawInput);
  const raw = sanitizePlayId(rawInput);
  const page = absUrl(raw);

  // 1. Direct video format check (e.g., Shorts feed direct .mp4/.m3u8 URLs)
  if (isDirectMediaUrl(raw) || isDirectMediaUrl(page)) {
    const directUrl = isDirectMediaUrl(raw) ? raw : page;
    return formatPlayResponse(
      inReq,
      params,
      { url: directUrl, referer: metaReferer || `${activeDomain}/shorts` },
      `${activeDomain}/shorts`
    );
  }

  // 2. Unwrap wrapper URLs (?url=https%3A%2F%2F...m3u8)
  const unwrapped = unwrapNestedPlayerUrl(page);
  if (unwrapped && isDirectMediaUrl(unwrapped)) {
    return formatPlayResponse(inReq, params, { url: unwrapped, referer: page }, page);
  }

  // 3. Extract Javtiful video ID
  let vid = '';
  const m =
    page.match(/\/(?:[a-z]{2}\/)?video\/(\d+)/i) ||
    page.match(/\/(?:[a-z]{2}\/)?embed\/(\d+)/i) ||
    metaReferer.match(/\/(?:[a-z]{2}\/)?video\/(\d+)/i) ||
    page.match(/\b(\d{4,10})\b/);
  if (m && m[1]) {
    vid = m[1];
  }

  if (vid) {
    const { sources, finalUrl, streamInfo } = await resolveJavtifulPlayback(
      vid,
      metaReferer || page
    );
    if (streamInfo && streamInfo.url) {
      return formatPlayResponse(inReq, params, streamInfo, finalUrl || page);
    }
    if (sources && sources.length > 0) {
      for (const item of sources) {
        const stream = unescapeJsString(String(item?.src || item?.file || item?.url || '')).trim();
        if (stream) {
          const fullStream = absUrl(stream, finalUrl || page);
          return formatPlayResponse(
            inReq,
            params,
            { url: fullStream, referer: finalUrl || page },
            finalUrl || page
          );
        }
      }
    }
  }

  // 4. Multi-stage HTML, decryptDatas, CMS & iframe inspection fallback if page is a non-standard URL
  const cachedByPage = getPlayCache(page);
  if (cachedByPage && cachedByPage.url) {
    return formatPlayResponse(inReq, params, cachedByPage, page);
  }

  const pageRes = await fetchSite(page, {
    useLangPrefix: false,
    referer: metaReferer || activeDomain + '/',
  });
  if (pageRes.text) {
    const resolvedPageUrl = pageRes.final_url || page;
    // Check if the fetched page has a Javtiful video_id or token that wasn't in the URL
    const { vid: domVid, token: domToken } = extractPageCsrfAndVideoTokens(pageRes.text, vid);
    const cfg = parseWatchConfig(pageRes.text);
    if (domVid || domToken || cfg?.playback?.endpoint) {
      const pbRes = await resolveJavtifulPlayback(
        domVid || vid,
        resolvedPageUrl,
        pageRes.text
      );
      if (pbRes.streamInfo && pbRes.streamInfo.url) {
        return formatPlayResponse(inReq, params, pbRes.streamInfo, pbRes.finalUrl || resolvedPageUrl);
      }
    }

    const extractedInfo = extractStreamInfoFromHtml(pageRes.text, resolvedPageUrl);
    if (extractedInfo && extractedInfo.url) {
      return formatPlayResponse(inReq, params, extractedInfo, resolvedPageUrl);
    }

    const iframeTagRe = /<iframe\b[^>]*>/gi;
    let im;
    while ((im = iframeTagRe.exec(pageRes.text)) !== null) {
      const iframeRaw = extractAttrUrlFromTag(im[0], undefined, true);
      if (!iframeRaw) continue;
      const iframeUrl = absUrl(iframeRaw, resolvedPageUrl);
      const iframeUnwrapped = unwrapNestedPlayerUrl(iframeUrl, resolvedPageUrl);
      if (iframeUnwrapped && isDirectMediaUrl(iframeUnwrapped)) {
        return formatPlayResponse(
          inReq,
          params,
          { url: iframeUnwrapped, referer: resolvedPageUrl },
          resolvedPageUrl
        );
      }
      const iframeRes = await fetchUrl(iframeUrl, { referer: resolvedPageUrl });
      if (iframeRes.text) {
        const iframeStreamInfo = extractStreamInfoFromHtml(
          iframeRes.text,
          iframeRes.final_url || iframeUrl
        );
        if (iframeStreamInfo && iframeStreamInfo.url) {
          return formatPlayResponse(
            inReq,
            params,
            iframeStreamInfo,
            iframeRes.final_url || iframeUrl
          );
        }
      }
    }
  }

  // 5. Fallback to client sniffing
  const fallbackUrl = vid ? `${activeDomain}/embed/${vid}` : page;
  const fallbackHeader = {
    'User-Agent': currentUa,
    Referer: metaReferer || page,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  return {
    parse: 1,
    jx: 0,
    playUrl: '',
    url: fallbackUrl,
    header: fallbackHeader,
    headers: fallbackHeader,
  };
}

async function search(inReq, ...extraArgs) {
  const params = unwrapRequestParams(inReq, extraArgs, 'search');
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const page = fixedInt(params.page ?? params.pg, 1);
  if (!key) {
    return { list: [], page: 1, pagecount: 1, limit: 24, total: 0 };
  }
  const kw = encodeURIComponent(key);
  let pathStr = `/search?q=${kw}`;
  if (page > 1) {
    pathStr += `&page=${page}`;
  }
  const res = await fetchSite(pathStr);
  const html = res.text || '';
  const cards = parseVideoCards(html);
  const pagecount = computePageCount(html, page, cards.length);
  return {
    list: cards,
    page,
    pagecount,
    limit: 24,
    total: pagecount * 24,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = String(query.url || query.pic || '').trim();
  if (!picUrl) {
    return { mime: 'text/plain; charset=utf-8', data: 'Missing url' };
  }
  try {
    const resp = await req(picUrl, {
      method: 'GET',
      headers: {
        'User-Agent': currentUa,
        Referer: `${activeDomain}/`,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      timeout: 10000,
    });
    const mime =
      resp?.headers?.['content-type'] ||
      resp?.headers?.['Content-Type'] ||
      'image/jpeg';
    return { mime, data: resp?.data ?? resp?.body ?? '' };
  } catch {
    return { mime: 'text/plain; charset=utf-8', data: '' };
  }
}

const _testing = {
  md5Hex,
  addCounter,
  aesCtrDecrypt,
  decryptDatas,
  sanitizePlayId,
  isDirectMediaUrl,
  unwrapNestedPlayerUrl,
  unwrapRequestParams,
  rewriteM3u8Manifest,
  extractBalancedJsonObject,
  extractStreamInfoFromHtml,
};

export {
  init,
  home,
  homeVod,
  category,
  detail,
  play,
  search,
  closeLocalProxy,
  _testing,
};

export default {
  meta: {
    key: 'javtiful',
    name: SITE_NAME,
    type: 3,
  },
  init,
  home,
  homeVod,
  category,
  detail,
  play,
  search,
  closeLocalProxy,
  _testing,
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/homeVod', homeVod);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/javtiful_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
    const streamRouteHandler = async (request, reply) => {
      const res = await handleStreamProxyRequest(
        request.query || {},
        request.headers || {},
        request.method || 'GET'
      );
      if (reply && typeof reply.code === 'function') {
        reply.code(res.status);
      }
      if (reply && typeof reply.headers === 'function') {
        reply.headers(res.headers);
      } else if (reply && typeof reply.header === 'function') {
        for (const [k, v] of Object.entries(res.headers)) {
          reply.header(k, v);
        }
      }
      return reply && typeof reply.send === 'function' ? reply.send(res.body) : res.body;
    };
    fastify.get('/javtiful_fd', streamRouteHandler);
    fastify.get('/javtiful_fd.mp4', streamRouteHandler);
    fastify.get('/proxy', streamRouteHandler);
    fastify.get('/proxy.mp4', streamRouteHandler);
    fastify.get('/proxy.m3u8', streamRouteHandler);
  },
};