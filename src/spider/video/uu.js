import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SPIDER_KEY = 'uushipin';
const SPIDER_NAME = '蝴蝶·Uu影视';

const API_DEFAULT = 'https://7l8.7l81uq.com:51000';
const SITE_DEFAULT = 'https://i68.i68q77.com:51888';
const CHANNEL_DEFAULT = 'tz';
const UA_DEFAULT =
  'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const PIC_KEY_STR = 'H0Z%7n#k$H8*M7xSE^N@8xXZPG*RZ&wY';
const DECRYPT_API_DEFAULT = 'https://2.h8.ccwu.cc/?url=';
const PIC_BUCKET = 'encryption-ts';

const BRAND_NAME = '蝴蝶影视';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';

export const GATEWAYS = [
  'https://i68.i68q77.com:51888',
  'https://14p.14pijq.com:51000',
  'https://t6y.t6ypaf.com:51000',
  'https://7l8.7l81uq.com:51000',
];

export const CDNS = [
  'https://jqsp.xn--xhq15jk0k96h.cn',
  'https://lmcsxdd.xn--xhq15jk0k96h.cn',
];

export const STATIC_CLASSES = [
  { type_id: 'last', type_name: '最新更新' },
  { type_id: 'hot', type_name: '热门' },
  { type_id: 'good', type_name: '精选' },
  { type_id: 'c360', type_name: '探花' },
  { type_id: 'c358', type_name: '麻豆' },
  { type_id: 'c357', type_name: '新闻' },
  { type_id: 'c356', type_name: '擦边短剧' },
  { type_id: 'c346', type_name: 'VR' },
  { type_id: 'c345', type_name: '女主播' },
  { type_id: 'c344', type_name: 'AV中字' },
  { type_id: 'c343', type_name: 'AV无码' },
  { type_id: 'c342', type_name: 'AI换脸' },
  { type_id: 'c341', type_name: '三级' },
  { type_id: 'c267', type_name: '动漫' },
  { type_id: 'c264', type_name: '欧美' },
  { type_id: 'c266', type_name: '传媒' },
  { type_id: 'c263', type_name: '日本AV' },
  { type_id: 'c347', type_name: '黑料' },
  { type_id: 'c262', type_name: '国产' },
  { type_id: 'l131', type_name: 'AV有码' },
  { type_id: 'l133', type_name: '自拍' },
  { type_id: 'l118', type_name: '丝袜' },
  { type_id: 'l153', type_name: '人妻' },
  { type_id: 'l158', type_name: '学生' },
  { type_id: 'l377', type_name: '偷拍' },
];

const CARD_STYLE = { type: 'rect', ratio: 1.78 };
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL_MS = 10 * 60 * 1000;

let activeGateway = SITE_DEFAULT;
let userGateway = GATEWAYS[0];
let cachedToken = '';
let tokenExp = 0;

export function resetSpiderState() {
  activeGateway = SITE_DEFAULT;
  userGateway = GATEWAYS[0];
  cachedToken = '';
  tokenExp = 0;
  PLAY_CACHE.clear();
}

export function quoteStrict(str) {
  return encodeURIComponent(String(str || '')).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function formatRemarks(brand = BRAND_NAME, meta = '') {
  const cleanMeta = String(meta || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return cleanMeta ? `${brand} | ${cleanMeta}` : brand;
}

export function cleanLabel(text) {
  return String(text || '')
    .trim()
    .replace(/[$#]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

export function cleanText(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#038;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

export function unxor(text, key) {
  if (!text || !key) return null;
  let s = String(text).trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (s.length % 4)) % 4;
  if (pad > 0) s += '='.repeat(pad);
  let buf;
  try {
    buf = Buffer.from(s, 'base64');
  } catch (_) {
    return null;
  }
  const kb = Buffer.from(String(key), 'utf8');
  if (!kb.length) return null;
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ kb[i % kb.length];
  }
  return out.toString('utf8');
}

export function fingerprint(ua = UA_DEFAULT, channel = CHANNEL_DEFAULT) {
  let h = 2166136261 >>> 0;
  const input = `${ua}${channel}`;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619) >>> 0;
  }
  return `fp-${h.toString(16).padStart(8, '0')}`;
}

function getCandidateGateways(preferred = activeGateway) {
  const ordered = [];
  const pushUnique = (gw) => {
    if (!gw) return;
    const clean = String(gw).replace(/\/+$/, '');
    if (clean && !ordered.includes(clean)) ordered.push(clean);
  };
  pushUnique(preferred);
  pushUnique(activeGateway);
  pushUnique(userGateway);
  for (const gw of GATEWAYS) pushUnique(gw);
  pushUnique(API_DEFAULT);
  return ordered;
}

function buildHeaders({ origin = activeGateway, referer, token = false, jsonBody = false } = {}) {
  const baseOrigin = String(origin || SITE_DEFAULT).replace(/\/+$/, '');
  const h = {
    'User-Agent': UA_DEFAULT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate',
    channel: CHANNEL_DEFAULT,
    Origin: baseOrigin,
    Referer: referer || `${baseOrigin}/`,
  };
  if (jsonBody) {
    h['Content-Type'] = 'application/json';
  }
  if (token && cachedToken) {
    h.Authorization = `Bearer ${cachedToken}`;
  }
  return h;
}

function decodeResponseBody(raw) {
  if (raw == null) return '';
  if (typeof raw === 'object' && !Buffer.isBuffer(raw) && !(raw instanceof Uint8Array)) {
    return raw;
  }
  let buf = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw)
      : Buffer.from(String(raw), 'utf8');

  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = zlib.gunzipSync(buf);
    } catch (_) {}
  } else if (buf.length >= 2 && buf[0] === 0x78 && (buf[1] === 0x9c || buf[1] === 0x01 || buf[1] === 0xda)) {
    try {
      buf = zlib.inflateSync(buf);
    } catch (_) {
      try {
        buf = zlib.inflateRawSync(buf);
      } catch (__) {}
    }
  }

  let text = buf.toString('utf8');
  if (text.includes('\ufffd')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if (!gbk.includes('\ufffd')) text = gbk;
    } catch (_) {}
  }
  return text;
}

function parseJsonSafe(payload) {
  if (!payload) return null;
  if (typeof payload === 'object' && !Buffer.isBuffer(payload) && !(payload instanceof Uint8Array)) {
    return payload;
  }
  const text = typeof payload === 'string' ? payload : decodeResponseBody(payload);
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

async function httpRequest(url, { method = 'GET', data = null, headers = {}, timeout = 5000, buffer = false } = {}) {
  const options = {
    method,
    headers,
    timeout,
  };
  if (data !== null && data !== undefined) {
    options.data = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  }
  if (buffer) {
    options.buffer = 2;
    options.responseType = 'arraybuffer';
  }
  const resp = await req(url, options);
  const rawBody = resp && typeof resp === 'object' && 'data' in resp ? resp.data : resp;
  if (buffer) {
    if (Buffer.isBuffer(rawBody)) return rawBody;
    if (rawBody instanceof ArrayBuffer) return Buffer.from(rawBody);
    if (rawBody instanceof Uint8Array) return Buffer.from(rawBody);
    if (typeof rawBody === 'string') return Buffer.from(rawBody, 'binary');
    return Buffer.alloc(0);
  }
  return decodeResponseBody(rawBody);
}

function unwrapApiEnvelope(j) {
  if (!j || typeof j !== 'object' || Number(j.code) !== 200) return null;
  let data = j.data;
  if (typeof data === 'string' && j.key) {
    const decrypted = unxor(data, j.key);
    if (decrypted) {
      const parsed = parseJsonSafe(decrypted);
      return parsed !== null ? parsed : decrypted;
    }
  }
  return data;
}

async function apiRequest(path, params = null, { token = false, preferredGateway = activeGateway } = {}) {
  let queryPath = String(path || '');
  if (params && typeof params === 'object' && Object.keys(params).length > 0) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) usp.append(k, String(v));
    }
    const qs = usp.toString();
    if (qs) queryPath += (queryPath.includes('?') ? '&' : '?') + qs;
  }

  const candidates = getCandidateGateways(preferredGateway);
  for (const gw of candidates) {
    const fullUrl = queryPath.startsWith('http') ? queryPath : `${gw}${queryPath.startsWith('/') ? '' : '/'}${queryPath}`;
    let origin = gw;
    try {
      origin = new URL(fullUrl).origin;
    } catch (_) {}
    try {
      const raw = await httpRequest(fullUrl, {
        method: 'GET',
        headers: buildHeaders({ origin, referer: `${origin}/`, token }),
        timeout: 5000,
      });
      const j = parseJsonSafe(raw);
      const data = unwrapApiEnvelope(j);
      if (data !== null && data !== undefined) {
        activeGateway = origin;
        return data;
      }
    } catch (_) {}
  }
  return null;
}

export async function login(force = false) {
  const nowSec = Date.now() / 1000;
  if (!force && cachedToken && nowSec < tokenExp) {
    return cachedToken;
  }

  const bodyStr = JSON.stringify({
    channel: CHANNEL_DEFAULT,
    fingerPrint: fingerprint(UA_DEFAULT, CHANNEL_DEFAULT),
  });

  const candidates = getCandidateGateways(userGateway);
  for (const gw of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const headers = {
          ...buildHeaders({ origin: gw, referer: `${gw}/`, jsonBody: true }),
          'Accept-Encoding': 'identity',
        };
        const raw = await httpRequest(`${gw}/api-user/v2/login/fingerprint`, {
          method: 'POST',
          data: bodyStr,
          headers,
          timeout: 4500,
        });
        const j = parseJsonSafe(raw);
        const data = unwrapApiEnvelope(j);
        const tok = data && typeof data === 'object' ? data.accessToken || data.token : '';
        if (tok) {
          cachedToken = String(tok);
          tokenExp = Date.now() / 1000 + 1400;
          userGateway = gw;
          activeGateway = gw;
          return cachedToken;
        }
      } catch (_) {}
    }
  }
  return '';
}

async function ensureToken(force = false) {
  const nowSec = Date.now() / 1000;
  if (!force && cachedToken && nowSec < tokenExp) {
    return cachedToken;
  }
  return login(force);
}

export async function getPlayData(vid) {
  const cleanVid = String(vid || '').trim();
  if (!cleanVid || /^https?:\/\//i.test(cleanVid)) return {};

  const cached = PLAY_CACHE.get(cleanVid);
  if (cached && Date.now() - cached.ts < PLAY_CACHE_TTL_MS) {
    return cached.data;
  }

  await ensureToken(false);
  if (!cachedToken) {
    return {};
  }

  const usp = new URLSearchParams({ id: cleanVid, channel: CHANNEL_DEFAULT });
  const path = `/api/v2/home/user/video/play/url?${usp.toString()}`;

  for (let tokenTry = 0; tokenTry < 2; tokenTry++) {
    let tokenExpired = false;
    const candidates = getCandidateGateways(userGateway);
    for (const gw of candidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const headers = {
            ...buildHeaders({ origin: gw, referer: `${gw}/`, token: true }),
            'Accept-Encoding': 'identity',
          };
          const raw = await httpRequest(`${gw}${path}`, {
            method: 'GET',
            headers,
            timeout: 4500,
          });
          const j = parseJsonSafe(raw);
          if (j && (Number(j.code) === 401 || Number(j.code) === 403)) {
            tokenExpired = true;
            break;
          }
          const data = unwrapApiEnvelope(j);
          if (data && typeof data === 'object' && (data.p720Url || data.masterUrl || data.p480Url || data.url || data.playUrl)) {
            userGateway = gw;
            activeGateway = gw;
            PLAY_CACHE.set(cleanVid, { ts: Date.now(), data });
            return data;
          }
        } catch (_) {}
      }
      if (tokenExpired) break;
    }
    if (tokenTry === 0) {
      await ensureToken(true);
      if (!cachedToken) break;
    }
  }
  return {};
}

export function buildPicUrl(thumb) {
  const t = String(thumb || '').trim();
  if (!t) return '';
  let enc;
  if (/^https?:\/\//i.test(t)) {
    enc = t;
  } else {
    const rel = t.startsWith('/') ? t : `/${t}`;
    enc = `${CDNS[0]}/${PIC_BUCKET}${rel}`;
  }
  if (DECRYPT_API_DEFAULT) {
    return `${DECRYPT_API_DEFAULT}${quoteStrict(enc)}&key=${quoteStrict(PIC_KEY_STR)}`;
  }
  return enc;
}

export function toVodItem(it = {}) {
  const vid = String(it.id ?? it.vod_id ?? '').trim();
  const name = cleanText(it.title || it.vod_name) || `视频 ${vid}`;
  const tags = cleanText(it.labelTitles || it.classifyTitles || it.vod_remarks || '');
  const metaInfo = tags
    ? tags.replace(/,/g, ' · ').slice(0, 20)
    : cleanText(it.createdAt || '').slice(0, 10);
  const picUrl = buildPicUrl(it.thumb || it.vod_pic || '');
  return {
    vod_id: vid,
    vod_name: name,
    vod_pic: picUrl,
    vod_bg: picUrl,
    vod_background: picUrl,
    vod_banner: picUrl,
    vod_remarks: formatRemarks(BRAND_NAME, metaInfo),
    style: CARD_STYLE,
  };
}

function resolveRelativeUrl(relOrAbs, baseUrl, fallbackSite = activeGateway) {
  const raw = String(relOrAbs || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  try {
    return new URL(raw, baseUrl || fallbackSite || SITE_DEFAULT).href;
  } catch (_) {
    const site = String(fallbackSite || SITE_DEFAULT).replace(/\/+$/, '');
    return raw.startsWith('/') ? `${site}${raw}` : `${site}/${raw}`;
  }
}

export async function rewriteM3u8Manifest(m3u8Url, siteOrigin = activeGateway) {
  const baseSite = String(siteOrigin || activeGateway || SITE_DEFAULT).replace(/\/+$/, '');
  try {
    let currentUrl = resolveRelativeUrl(m3u8Url, baseSite, baseSite);
    let rawM3u8 = await httpRequest(currentUrl, {
      method: 'GET',
      headers: {
        'User-Agent': UA_DEFAULT,
        Referer: `${baseSite}/`,
        Origin: baseSite,
      },
      timeout: 5000,
    });
    rawM3u8 = String(rawM3u8 || '');
    if (!rawM3u8.includes('#EXTM3U')) {
      return '';
    }

    // If master playlist (#EXT-X-STREAM-INF), follow first variant sub-playlist
    if (rawM3u8.includes('#EXT-X-STREAM-INF')) {
      const lines = rawM3u8.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('#EXT-X-STREAM-INF')) {
          for (let j = i + 1; j < lines.length; j++) {
            const subLine = lines[j].trim();
            if (!subLine || subLine.startsWith('#')) continue;
            const subUrl = resolveRelativeUrl(subLine, currentUrl, baseSite);
            const subRaw = await httpRequest(subUrl, {
              method: 'GET',
              headers: {
                'User-Agent': UA_DEFAULT,
                Referer: `${baseSite}/`,
                Origin: baseSite,
              },
              timeout: 5000,
            });
            if (String(subRaw || '').includes('#EXTM3U')) {
              currentUrl = subUrl;
              rawM3u8 = String(subRaw);
            }
            break;
          }
          break;
        }
      }
    }

    // Inline #EXT-X-KEY URI if present
    const keyRegex = /#EXT-X-KEY:([^\r\n]*?)URI=["']([^"']+)["']([^\r\n]*)/g;
    const keyMatches = [...rawM3u8.matchAll(keyRegex)];
    for (const match of keyMatches) {
      const fullLine = match[0];
      const prefixAttr = match[1] || '';
      const keyRelUri = match[2] || '';
      const suffixAttr = match[3] || '';
      if (!keyRelUri || keyRelUri.startsWith('data:')) continue;

      const candidateKeyUrls = [];
      if (keyRelUri.startsWith('/')) {
        candidateKeyUrls.push(`${baseSite}${keyRelUri}`);
      }
      const resolvedAgainstM3u8 = resolveRelativeUrl(keyRelUri, currentUrl, baseSite);
      if (resolvedAgainstM3u8 && !candidateKeyUrls.includes(resolvedAgainstM3u8)) {
        candidateKeyUrls.push(resolvedAgainstM3u8);
      }
      const resolvedAgainstSite = resolveRelativeUrl(keyRelUri, `${baseSite}/`, baseSite);
      if (resolvedAgainstSite && !candidateKeyUrls.includes(resolvedAgainstSite)) {
        candidateKeyUrls.push(resolvedAgainstSite);
      }

      let keyBuf = null;
      for (const kUrl of candidateKeyUrls) {
        try {
          const buf = await httpRequest(kUrl, {
            method: 'GET',
            headers: {
              'User-Agent': UA_DEFAULT,
              Referer: `${baseSite}/`,
              Origin: baseSite,
            },
            timeout: 4000,
            buffer: true,
          });
          if (buf && buf.length >= 16) {
            keyBuf = buf.subarray(0, 16);
            break;
          }
        } catch (_) {}
      }

      if (keyBuf && keyBuf.length >= 16) {
        const keyB64 = Buffer.from(keyBuf).toString('base64');
        const inlineKeyUri = `data:application/octet-stream;base64,${keyB64}`;
        const newKeyLine = `#EXT-X-KEY:${prefixAttr}URI="${inlineKeyUri}"${suffixAttr}`;
        rawM3u8 = rawM3u8.replace(fullLine, newKeyLine);
      }
    }

    // Rewrite relative #EXT-X-MAP and relative segment URLs to absolute URLs
    const rewrittenLines = rawM3u8.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#EXT-X-MAP:')) {
        return trimmed.replace(/URI=["']([^"']+)["']/i, (m, uri) => {
          if (/^(https?:|data:)/i.test(uri)) return m;
          return `URI="${resolveRelativeUrl(uri, currentUrl, baseSite)}"`;
        });
      }
      if (trimmed.startsWith('#')) return line;
      if (/^(https?:|data:)/i.test(trimmed)) return trimmed;
      return resolveRelativeUrl(trimmed, currentUrl, baseSite);
    });

    return rewrittenLines.join('\n');
  } catch (_) {
    return '';
  }
}

export async function buildInlineM3u8(m3u8Url, siteOrigin = activeGateway) {
  const rewritten = await rewriteM3u8Manifest(m3u8Url, siteOrigin);
  if (!rewritten || !rewritten.includes('#EXTM3U')) return '';
  const b64 = Buffer.from(rewritten, 'utf8').toString('base64');
  return `data:application/vnd.apple.mpegurl;base64,${b64}`;
}

function unwrapRequestParams(inReq = {}) {
  const merged = {};
  const absorb = (src) => {
    if (!src) return;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') Object.assign(merged, parsed);
          return;
        } catch (_) {}
      }
      try {
        const usp = new URLSearchParams(trimmed);
        for (const [k, v] of usp.entries()) merged[k] = v;
      } catch (_) {}
      return;
    }
    if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  };
  absorb(inReq.params);
  absorb(inReq.query);
  absorb(inReq.body);
  return merged;
}

function getProxyBase(inReq = {}) {
  const prefix = String(
    inReq.server?.prefix ||
      String(inReq.raw?.url || inReq.url || '')
        .split('?')[0]
        .replace(/\/(init|home|category|detail|play|search)\/?$/i, '') ||
      '',
  ).replace(/\/+$/, '');
  const host = inReq.headers?.host || inReq.hostname || '';
  const proto = inReq.headers?.['x-forwarded-proto'] || inReq.protocol || 'http';
  if (host) {
    return `${proto}://${host}${prefix}`;
  }
  return prefix;
}

const DECOY_MEDIA_PATTERNS = [
  /preview\.mp4/i,
  /sample\.mp4/i,
  /trailer\.mp4/i,
  /top_banner/i,
  /native-ad/i,
  /stat\.php/i,
];

function isDecoyMediaUrl(url) {
  const u = String(url || '').trim();
  if (!u) return true;
  return DECOY_MEDIA_PATTERNS.some((re) => re.test(u));
}

export function isDirectMediaUrl(url) {
  const u = String(url || '').trim();
  if (!u || isDecoyMediaUrl(u)) return false;
  if (u.startsWith('data:application/vnd.apple.mpegurl')) return true;
  try {
    const parsed = new URL(u, SITE_DEFAULT);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith('.m3u8') || pathname.endsWith('.mp4')) return true;
    if (pathname.includes('/video/play/m3u8') || pathname.includes('_play')) return true;
  } catch (_) {}
  return /\.(m3u8|mp4)(\?|$)/i.test(u);
}

export function unwrapNestedMediaUrl(inputUrl, baseOrigin = activeGateway) {
  let u = String(inputUrl || '').trim();
  if (!u || isDecoyMediaUrl(u)) return '';
  u = u.replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/').replace(/&amp;/gi, '&');
  try {
    const parsed = new URL(u, baseOrigin || SITE_DEFAULT);
    for (const key of ['url', 'v', 'src', 'play', 'm3u8']) {
      const inner = parsed.searchParams.get(key);
      if (inner) {
        let decoded = inner;
        for (let i = 0; i < 2; i++) {
          try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) break;
            decoded = next;
          } catch (_) {
            break;
          }
        }
        if (!isDecoyMediaUrl(decoded) && isDirectMediaUrl(decoded)) {
          return resolveRelativeUrl(decoded, baseOrigin, baseOrigin);
        }
      }
    }
    if (!isDecoyMediaUrl(parsed.href) && isDirectMediaUrl(parsed.href)) {
      return parsed.href;
    }
  } catch (_) {}
  return '';
}

function extractBalancedObject(str, startIdx) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let objStart = -1;

  for (let i = startIdx; i < str.length; i++) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        return str.slice(objStart, i + 1);
      }
    }
  }
  return '';
}

function decodePercentEscaped(str) {
  const withUnicode = String(str || '').replace(/%u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  try {
    return decodeURIComponent(withUnicode);
  } catch (_) {
    try {
      return unescape(withUnicode);
    } catch (__) {
      return withUnicode;
    }
  }
}

function decodeCmsPlayerUrl(rawUrl, encrypt = 0) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const encMode = Number(encrypt || 0);
  if (encMode === 2) {
    try {
      u = Buffer.from(u, 'base64').toString('utf8');
    } catch (_) {}
    u = decodePercentEscaped(u);
  } else if (encMode === 1) {
    u = decodePercentEscaped(u);
  }
  return u
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002[fF]/g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
}

function unpackDeanEdwards(html) {
  const unpacked = [];
  const regex = /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10) || 36;
    const symtab = m[6].split('|');
    const encodeToken = (c) => {
      const prefix = c < radix ? '' : encodeToken(Math.floor(c / radix));
      const rem = c % radix;
      return prefix + (rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36));
    };
    const dict = new Map();
    for (let i = 0; i < symtab.length; i++) {
      if (symtab[i]) dict.set(encodeToken(i), symtab[i]);
    }
    const decoded = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) => dict.get(word) || word);
    unpacked.push(decoded);
  }
  return unpacked.join('\n');
}

export function extractPlayStreamFromHtml(html, baseOrigin = activeGateway) {
  const rawHtml = String(html || '');
  if (!rawHtml) return '';

  const combined = `${rawHtml}\n${unpackDeanEdwards(rawHtml)}`;

  // Stage 1: Balanced-brace CMS player configs (player_aaaa, player_data, player_config)
  const cmsVarRegex = /\b(?:player_aaaa|player_data|player_config)\s*=\s*/g;
  let match;
  while ((match = cmsVarRegex.exec(combined)) !== null) {
    const objText = extractBalancedObject(combined, match.index + match[0].length);
    const parsed = parseJsonSafe(objText);
    if (parsed && parsed.url) {
      const decoded = decodeCmsPlayerUrl(parsed.url, parsed.encrypt);
      const unwrapped = unwrapNestedMediaUrl(decoded, baseOrigin) || decoded;
      if (isDirectMediaUrl(unwrapped)) {
        return resolveRelativeUrl(unwrapped, baseOrigin, baseOrigin);
      }
    }
  }

  // Stage 2: DPlayer data-config attributes
  const dpRegex = /data-config=(["'])([\s\S]*?)\1/gi;
  while ((match = dpRegex.exec(combined)) !== null) {
    const cfg = parseJsonSafe(cleanText(match[2]));
    const vUrl = cfg?.video?.url || cfg?.url;
    if (vUrl) {
      const unwrapped = unwrapNestedMediaUrl(vUrl, baseOrigin) || cleanText(vUrl).replace(/\\\//g, '/');
      if (isDirectMediaUrl(unwrapped)) {
        return resolveRelativeUrl(unwrapped, baseOrigin, baseOrigin);
      }
    }
  }

  // Stage 3: Unescaped direct .m3u8 / .mp4 URLs
  const normalized = combined
    .replace(/\\\//g, '/')
    .replace(/\\u002[fF]/g, '/')
    .replace(/&amp;/gi, '&');
  const directRegex = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  while ((match = directRegex.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(match[0], baseOrigin) || match[0];
    if (isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  // Stage 4: Wrapper iframe URLs with ?url=...
  const iframeRegex = /<iframe[^>]+?(?:data-litespeed-src|data-lazy-src|data-src|src)=["']([^"']+)["']/gi;
  while ((match = iframeRegex.exec(combined)) !== null) {
    const src = cleanText(match[1]);
    if (!src || /^(?:about:blank|javascript:|data:)/i.test(src)) continue;
    const unwrapped = unwrapNestedMediaUrl(src, baseOrigin);
    if (unwrapped && isDirectMediaUrl(unwrapped)) {
      return unwrapped;
    }
  }

  return '';
}

function stripEpisodePrefix(rawId) {
  let s = String(rawId || '').trim();
  const dollarIdx = s.indexOf('$');
  if (dollarIdx > 0) {
    const prefix = s.slice(0, dollarIdx);
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      s = s.slice(dollarIdx + 1).trim();
    }
  }
  return s;
}

async function init() {
  return {};
}

async function home(inReq) {
  const firstPage = await category({
    ...inReq,
    body: { id: 'last', page: 1 },
  });
  return {
    class: STATIC_CLASSES,
    filters: {},
    list: Array.isArray(firstPage?.list) ? firstPage.list : [],
    style: CARD_STYLE,
  };
}

async function category(inReq) {
  const params = unwrapRequestParams(inReq);
  const pg = Math.max(1, parseInt(params.page || params.pg || '1', 10) || 1);
  const tid = String(params.id ?? params.tid ?? 'last').trim() || 'last';
  const limit = 20;

  const queryParams = {
    page: pg,
    limit,
    videoType: 'long',
  };

  if (['last', 'hot', 'good', 'collect'].includes(tid)) {
    queryParams.type = tid;
  } else if (/^c\d+$/.test(tid)) {
    queryParams.type = 'cate';
    queryParams.typeId = tid.slice(1);
  } else if (/^l\d+$/.test(tid)) {
    queryParams.type = 'label';
    queryParams.typeId = tid.slice(1);
  } else {
    queryParams.type = 'last';
  }

  try {
    let d = (await apiRequest('/api/v2/home/public/video/list', queryParams)) || {};
    let lst = Array.isArray(d.list) ? d.list : [];

    if (lst.length === 0 && queryParams.type === 'cate') {
      const altParams = { ...queryParams, type: 'label' };
      const dAlt = (await apiRequest('/api/v2/home/public/video/list', altParams)) || {};
      if (Array.isArray(dAlt.list) && dAlt.list.length > 0) {
        d = dAlt;
        lst = dAlt.list;
      }
    }

    const total = parseInt(d.total || '0', 10) || lst.length;
    const pagecount = total > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;

    return {
      page: pg,
      pagecount,
      limit,
      total,
      list: lst.map((it) => toVodItem(it)),
      style: CARD_STYLE,
    };
  } catch (_) {
    return {
      page: pg,
      pagecount: 1,
      limit,
      total: 0,
      list: [],
      style: CARD_STYLE,
    };
  }
}

async function detail(inReq) {
  const params = unwrapRequestParams(inReq);
  const rawIds = params.ids ?? params.id ?? params.url ?? '';
  const vid = String(Array.isArray(rawIds) ? rawIds[0] : rawIds).trim();
  if (!vid) return { list: [] };

  try {
    const rawDetail = (await apiRequest('/api/v2/home/public/video/long/detail', { id: vid })) || {};
    if (!rawDetail || typeof rawDetail !== 'object' || (!rawDetail.id && !rawDetail.title)) {
      return { list: [] };
    }

    const v = toVodItem({ ...rawDetail, id: rawDetail.id ?? vid });
    const title = v.vod_name;
    const desc = cleanText(rawDetail.content || title);
    const rawActor = cleanText(rawDetail.actor || '');

    v.vod_actor = rawActor ? `${rawActor} | ${BRAND_ACTOR}` : BRAND_ACTOR;
    v.vod_director = BRAND_DIRECTOR;
    v.vod_content = desc
      ? `🦋 蝴蝶影视专线直连 | ${desc} | 官方交流群: @tvshare23`
      : '🦋 蝴蝶影视专线加速播放 | 官方TG交流群：@tvshare23 | 4K高清原生极速画质';

    const episodes = [`正片$${vid}@@720p@@@${quoteStrict(title)}`];
    const seenIds = new Set([String(vid)]);

    const nextObj = rawDetail.next;
    if (nextObj && typeof nextObj === 'object' && nextObj.id) {
      const nId = String(nextObj.id);
      const nTitle = cleanText(nextObj.title || '下一部');
      if (!seenIds.has(nId)) {
        seenIds.add(nId);
        episodes.push(`下一部·${cleanLabel(nTitle)}$${nId}@@720p@@@${quoteStrict(nTitle)}`);
      }
    }

    const prevObj = rawDetail.prev;
    if (prevObj && typeof prevObj === 'object' && prevObj.id) {
      const pId = String(prevObj.id);
      const pTitle = cleanText(prevObj.title || '上一部');
      if (!seenIds.has(pId)) {
        seenIds.add(pId);
        episodes.push(`上一部·${cleanLabel(pTitle)}$${pId}@@720p@@@${quoteStrict(pTitle)}`);
      }
    }

    const classifyRaw = String(rawDetail.classify || '').trim();
    if (classifyRaw) {
      const cIds = classifyRaw
        .split(',')
        .map((x) => x.trim())
        .filter((x) => /^\d+$/.test(x));
      if (cIds.length > 0) {
        const firstCid = cIds[0];
        const relData =
          (await apiRequest('/api/v2/home/public/video/list', {
            page: 1,
            limit: 12,
            videoType: 'long',
            type: 'cate',
            typeId: firstCid,
          })) || {};
        const relItems = Array.isArray(relData.list) ? relData.list : [];
        let relIdx = 1;
        for (const rIt of relItems) {
          const rId = String(rIt?.id || '').trim();
          if (!rId || seenIds.has(rId)) continue;
          seenIds.add(rId);
          const rTitle = cleanText(rIt.title || '');
          const cleanT = cleanLabel(rTitle);
          const idxStr = String(relIdx).padStart(2, '0');
          episodes.push(`${idxStr}·${cleanT}$${rId}@@720p@@@${quoteStrict(rTitle)}`);
          relIdx++;
          if (relIdx > 10) break;
        }
      }
    }

    v.vod_remarks = formatRemarks(BRAND_NAME, `全${episodes.length}部连播`);
    v.vod_play_from = '蝴蝶专线';
    v.vod_play_url = episodes.join('#');

    // Pre-warm play cache for main video ID
    try {
      await getPlayData(vid);
    } catch (_) {}

    return { list: [v] };
  } catch (_) {
    return { list: [] };
  }
}

async function search(inReq) {
  const params = unwrapRequestParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pg = Math.max(1, parseInt(params.page || params.pg || '1', 10) || 1);
  if (!key) {
    return { page: pg, pagecount: 1, limit: 20, total: 0, list: [] };
  }

  try {
    const d =
      (await apiRequest('/api/v2/home/public/video/search', {
        page: pg,
        limit: 20,
        keyword: key,
        videoType: 'long',
      })) || {};
    const lst = Array.isArray(d.list) ? d.list : [];
    const total = parseInt(d.total || '0', 10) || lst.length;
    const limit = 20;
    const pagecount = total > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
    return {
      page: pg,
      pagecount,
      limit,
      total,
      list: lst.map((it) => toVodItem(it)),
      style: CARD_STYLE,
    };
  } catch (_) {
    return { page: pg, pagecount: 1, limit: 20, total: 0, list: [] };
  }
}

async function play(inReq) {
  const params = unwrapRequestParams(inReq);
  const rawInput = stripEpisodePrefix(params.id ?? params.url ?? '');
  let target = rawInput;
  let descTitle = '';

  if (target.includes('@@@')) {
    const parts = target.split('@@@');
    target = parts[0].trim();
    const rawTitle = parts.slice(1).join('@@@');
    try {
      descTitle = decodeURIComponent(rawTitle);
    } catch (_) {
      descTitle = rawTitle;
    }
  }

  let vid = target;
  let variant = '720p';
  if (target.includes('@@')) {
    const [vIdPart, varPart] = target.split('@@');
    vid = vIdPart.trim();
    variant = (varPart || '720p').trim();
  }

  const baseHeaders = {
    'User-Agent': UA_DEFAULT,
    Referer: `${activeGateway}/`,
    Origin: activeGateway,
  };

  // Direct URL or wrapper URL passed directly to /play
  if (/^https?:\/\//i.test(vid)) {
    const unwrapped = unwrapNestedMediaUrl(vid, activeGateway);
    if (unwrapped && isDirectMediaUrl(unwrapped)) {
      const res = {
        parse: 0,
        jx: 0,
        playUrl: '',
        url: unwrapped,
        header: baseHeaders,
        headers: baseHeaders,
      };
      if (descTitle) res.desc = descTitle;
      return res;
    }
    try {
      const html = await httpRequest(vid, { method: 'GET', headers: baseHeaders, timeout: 5000 });
      const extracted = extractPlayStreamFromHtml(html, activeGateway);
      if (extracted) {
        const res = {
          parse: 0,
          jx: 0,
          playUrl: '',
          url: extracted,
          header: baseHeaders,
          headers: baseHeaders,
        };
        if (descTitle) res.desc = descTitle;
        return res;
      }
    } catch (_) {}
  }

  // Standard UU视频 API playback resolution
  try {
    const d = await getPlayData(vid);
    const keyMap = { '720p': 'p720Url', '480p': 'p480Url' };
    const preferredKey = keyMap[variant] || 'masterUrl';
    const rawUrl = String(
      d[preferredKey] || d.p720Url || d.masterUrl || d.p480Url || d.url || d.playUrl || '',
    ).trim();

    if (rawUrl) {
      const siteOrigin = String(userGateway || activeGateway || SITE_DEFAULT).replace(/\/+$/, '');
      let realM3u8Url = rawUrl.startsWith('/')
        ? `${siteOrigin}${rawUrl}`
        : resolveRelativeUrl(rawUrl, siteOrigin, siteOrigin);

      if (realM3u8Url.includes('cdnId=2')) {
        realM3u8Url = realM3u8Url.replace('cdnId=2', 'cdnId=1');
      }

      const playHeaders = {
        'User-Agent': UA_DEFAULT,
        Referer: `${siteOrigin}/`,
        Origin: siteOrigin,
      };

      const wantInline = params.inline === '1' || params.inline === true || params.format === 'data';
      const wantProxy = params.proxy === '1' || params.proxy === true;
      const inlineDataUri = await buildInlineM3u8(realM3u8Url, siteOrigin);
      const proxyBase = getProxyBase(inReq);
      const proxyM3u8Url = proxyBase
        ? `${proxyBase}/${SPIDER_KEY}_m3u8?url=${encodeURIComponent(realM3u8Url)}&site=${encodeURIComponent(siteOrigin)}`
        : '';

      let finalUrl = realM3u8Url;
      if (wantInline && inlineDataUri) {
        finalUrl = inlineDataUri;
      } else if (wantProxy && proxyM3u8Url) {
        finalUrl = proxyM3u8Url;
      }

      const res = {
        parse: 0,
        jx: 0,
        playUrl: '',
        url: finalUrl,
        header: playHeaders,
        headers: playHeaders,
      };
      if (inlineDataUri) res.inlineUrl = inlineDataUri;
      if (proxyM3u8Url) res.proxyUrl = proxyM3u8Url;
      if (descTitle) res.desc = descTitle;
      return res;
    }
  } catch (_) {}

  const siteOrigin = String(activeGateway || SITE_DEFAULT).replace(/\/+$/, '');
  const embedUrl = `${siteOrigin}/video/player/embed?id=${encodeURIComponent(vid)}`;
  const fallbackHeaders = {
    'User-Agent': UA_DEFAULT,
    Referer: `${siteOrigin}/`,
  };
  const res = {
    parse: 1,
    jx: 0,
    playUrl: '',
    url: embedUrl,
    header: fallbackHeaders,
    headers: fallbackHeaders,
  };
  if (descTitle) res.desc = descTitle;
  return res;
}

function detectImageMime(buf) {
  if (!buf || buf.length < 4) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  return '';
}

export async function proxyPicHandler(query = {}) {
  const rawUrl = String(query.url || '').trim();
  const keyStr = String(query.key || PIC_KEY_STR);
  if (!rawUrl) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
  try {
    const buf = await httpRequest(rawUrl, {
      method: 'GET',
      headers: {
        'User-Agent': UA_DEFAULT,
        Referer: `${activeGateway}/`,
      },
      timeout: 5000,
      buffer: true,
    });
    const directMime = detectImageMime(buf);
    if (directMime) {
      return { mime: directMime, data: buf };
    }

    // Try XOR decryption with keyStr
    const keyBuf = Buffer.from(keyStr, 'utf8');
    if (keyBuf.length > 0 && buf.length > 0) {
      const xored = Buffer.allocUnsafe(buf.length);
      for (let i = 0; i < buf.length; i++) {
        xored[i] = buf[i] ^ keyBuf[i % keyBuf.length];
      }
      const xorMime = detectImageMime(xored);
      if (xorMime) {
        return { mime: xorMime, data: xored };
      }
    }

    // Try AES-128-ECB / AES-128-CBC with first 16 bytes of keyStr
    if (keyBuf.length >= 16 && buf.length >= 16) {
      const k16 = keyBuf.subarray(0, 16);
      for (const mode of ['aes-128-ecb', 'aes-128-cbc']) {
        try {
          const iv = mode === 'aes-128-cbc' ? k16 : null;
          const decipher = crypto.createDecipheriv(mode, k16, iv);
          const dec = Buffer.concat([decipher.update(buf), decipher.final()]);
          const aesMime = detectImageMime(dec);
          if (aesMime) {
            return { mime: aesMime, data: dec };
          }
        } catch (_) {}
      }
    }

    return { mime: 'image/jpeg', data: buf };
  } catch (_) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export async function proxyM3u8Handler(query = {}) {
  const rawUrl = String(query.url || '').trim();
  const siteOrigin = String(query.site || activeGateway || SITE_DEFAULT).trim();
  if (!rawUrl) {
    return { mime: 'application/vnd.apple.mpegurl', data: '' };
  }
  const rewritten = await rewriteM3u8Manifest(rawUrl, siteOrigin);
  return {
    mime: 'application/vnd.apple.mpegurl',
    data: rewritten || '',
  };
}

export default {
  meta: {
    key: SPIDER_KEY,
    name: SPIDER_NAME,
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get(`/${SPIDER_KEY}_pic`, async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
    fastify.get(`/${SPIDER_KEY}_m3u8`, async (request, reply) => {
      const res = await proxyM3u8Handler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};