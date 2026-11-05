import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://thzy1.me',
  'https://thzy2.me',
  'https://thzy3.me',
];

let activeDomain = SITE_DOMAINS[0];
let customApiUrl = '';

const API_PATH = '/api.php/provide/vod/';
const RECT_178_STYLE = { type: 'rect', ratio: 1.78 };

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CLASSES_CACHE = [
  { type_id: '6', type_name: '国产精品' },
  { type_id: '7', type_name: '华语AV' },
  { type_id: '8', type_name: '黑料吃瓜' },
  { type_id: '22', type_name: '学生' },
  { type_id: '23', type_name: '乱伦' },
  { type_id: '24', type_name: '探花' },
  { type_id: '9', type_name: '欧美' },
  { type_id: '10', type_name: '禁漫' },
  { type_id: '25', type_name: '日本无码' },
  { type_id: '26', type_name: '日本有码' },
  { type_id: '27', type_name: '主播网红' },
  { type_id: '28', type_name: '日本素人' },
  { type_id: '29', type_name: 'AI短剧' },
];

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL_MS = 10 * 60 * 1000;

function setPlayCache(key, value) {
  if (!key || !value) return;
  const now = Date.now();
  if (PLAY_CACHE.size > 500) {
    for (const [k, v] of PLAY_CACHE.entries()) {
      if (now - v.ts > PLAY_CACHE_TTL_MS) PLAY_CACHE.delete(k);
    }
  }
  PLAY_CACHE.set(String(key), { value, ts: now });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL_MS) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return entry.value;
}

function getDomainPool() {
  const pool = [];
  if (customApiUrl) {
    try {
      const u = new URL(customApiUrl);
      pool.push(u.origin);
    } catch (_) {}
  }
  if (activeDomain && !pool.includes(activeDomain)) {
    pool.push(activeDomain);
  }
  for (const d of SITE_DOMAINS) {
    if (!pool.includes(d)) pool.push(d);
  }
  return pool;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  for (const d of getDomainPool()) {
    try {
      if (new URL(d).hostname.toLowerCase() === lower) return true;
    } catch (_) {}
  }
  return /^thzy\d*\./i.test(lower);
}

function expandCandidateUrls(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return [];
  const pool = getDomainPool();

  if (raw.startsWith('/')) {
    return pool.map((origin) => `${origin.replace(/\/+$/, '')}${raw}`);
  }

  try {
    const parsed = new URL(raw);
    if (isKnownSiteHost(parsed.hostname)) {
      const suffix = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      const candidates = [];
      for (const origin of pool) {
        const candidate = `${origin.replace(/\/+$/, '')}${suffix}`;
        if (!candidates.includes(candidate)) candidates.push(candidate);
      }
      if (!candidates.includes(raw)) candidates.push(raw);
      return candidates;
    }
  } catch (_) {
    if (!/^https?:\/\//i.test(raw)) {
      const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
      return pool.map((origin) => `${origin.replace(/\/+$/, '')}${cleanPath}`);
    }
  }

  return [raw];
}

function buildHeaders(targetUrl, extraHeaders = {}) {
  let origin = activeDomain;
  try {
    origin = new URL(targetUrl).origin;
  } catch (_) {}

  const headers = {
    'User-Agent': DEFAULT_UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${origin}/`,
    ...extraHeaders,
  };

  if (extraHeaders.Referer) {
    try {
      const refUrl = new URL(extraHeaders.Referer);
      const targetOrigin = new URL(targetUrl);
      if (isKnownSiteHost(refUrl.hostname) && isKnownSiteHost(targetOrigin.hostname)) {
        headers.Referer = `${targetOrigin.origin}${refUrl.pathname}${refUrl.search}`;
      }
    } catch (_) {}
  }

  return headers;
}

function decodeResponseBody(rawData) {
  if (rawData === null || rawData === undefined) return '';
  if (typeof rawData === 'string') return rawData;
  if (typeof rawData === 'object' && !Buffer.isBuffer(rawData) && !(rawData instanceof Uint8Array) && !(rawData instanceof ArrayBuffer)) {
    try {
      return JSON.stringify(rawData);
    } catch (_) {
      return String(rawData);
    }
  }

  let buf = Buffer.isBuffer(rawData)
    ? rawData
    : rawData instanceof ArrayBuffer
      ? Buffer.from(rawData)
      : Buffer.from(rawData);

  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = zlib.gunzipSync(buf);
    } catch (_) {}
  }

  const utf8Text = buf.toString('utf8');
  if (utf8Text.includes('\ufffd') || /charset\s*=\s*["']?(?:gbk|gb2312|gb18030)/i.test(utf8Text)) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(buf);
    } catch (_) {}
  }
  return utf8Text;
}

function looksLikeValidSiteHtml(html) {
  if (!html || typeof html !== 'string') return false;
  return (
    /player_aaaa|player_data|player_config|vod_play_url|\.m3u8|\.mp4|<video|<iframe|mac_url|api\.php\/provide\/vod/i.test(
      html
    ) || /class=["'][^"']*vod/i.test(html)
  );
}

async function fetchJsonWithFallback(urlOrPath, extraHeaders = {}) {
  const candidates = expandCandidateUrls(urlOrPath);
  for (const candidateUrl of candidates) {
    try {
      const headers = buildHeaders(candidateUrl, extraHeaders);
      const resp = await req.get(candidateUrl, {
        headers,
        timeout: 10000,
      });
      const rawData = resp && resp.data !== undefined ? resp.data : resp;
      if (rawData && typeof rawData === 'object' && !Buffer.isBuffer(rawData) && !(rawData instanceof Uint8Array)) {
        if (Array.isArray(rawData.list) || rawData.code !== undefined || rawData.page !== undefined) {
          try {
            activeDomain = new URL(candidateUrl).origin;
          } catch (_) {}
          return rawData;
        }
      }
      const text = decodeResponseBody(rawData).trim();
      if (!text) continue;
      const cleanedText = text.replace(/^\uFEFF/, '');
      const parsed = JSON.parse(cleanedText);
      if (parsed && typeof parsed === 'object' && (Array.isArray(parsed.list) || parsed.code !== undefined || parsed.page !== undefined)) {
        try {
          activeDomain = new URL(candidateUrl).origin;
        } catch (_) {}
        return parsed;
      }
    } catch (_) {
      // Try next candidate domain
    }
  }
  return {};
}

async function fetchTextWithFallback(urlOrPath, extraHeaders = {}) {
  const candidates = expandCandidateUrls(urlOrPath);
  let lastText = '';
  for (const candidateUrl of candidates) {
    try {
      const headers = buildHeaders(candidateUrl, extraHeaders);
      const resp = await req.get(candidateUrl, {
        headers,
        timeout: 10000,
      });
      const rawData = resp && resp.data !== undefined ? resp.data : resp;
      const text = decodeResponseBody(rawData);
      if (!text) continue;
      lastText = text;
      if (looksLikeValidSiteHtml(text) || text.trim().startsWith('{') || text.includes('#EXTM3U')) {
        try {
          const parsedOrigin = new URL(candidateUrl);
          if (isKnownSiteHost(parsedOrigin.hostname)) {
            activeDomain = parsedOrigin.origin;
          }
        } catch (_) {}
        return { text, finalUrl: candidateUrl };
      }
    } catch (_) {
      // Try next mirror domain
    }
  }
  return { text: lastText, finalUrl: candidates[0] || String(urlOrPath || '') };
}

function unwrapRequestParams(inReq) {
  if (!inReq) return {};
  const merged = {};

  const assignFrom = (src) => {
    if (!src) return;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          return;
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) {
          merged[k] = v;
        }
      } catch (_) {}
      return;
    }
    if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  };

  assignFrom(inReq.params);
  assignFrom(inReq.query);
  assignFrom(inReq.body);
  return merged;
}

function formatRemarks(rawRemarks) {
  const clean = String(rawRemarks || '').trim();
  if (!clean) return '蝴蝶影视';
  if (clean.startsWith('蝴蝶影视')) return clean;
  return `蝴蝶影视 | ${clean}`;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function unescapeSlashesAndUnicode(str) {
  if (!str) return '';
  let out = String(str).replace(/\\\//g, '/');
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  out = out.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return decodeHtmlEntities(out);
}

function unescapeCmsString(str) {
  if (!str) return '';
  let s = String(str).replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  try {
    s = decodeURIComponent(s);
  } catch (_) {
    s = s.replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
  return s;
}

function decodeCmsPlayerUrl(rawUrl, encryptType = 0) {
  if (!rawUrl) return '';
  let url = String(rawUrl).trim();
  const enc = Number(encryptType) || 0;

  if (enc === 2) {
    try {
      const decodedB64 = Buffer.from(url, 'base64').toString('utf8');
      url = unescapeCmsString(decodedB64);
    } catch (_) {}
  } else if (enc === 1) {
    url = unescapeCmsString(url);
  }

  url = unescapeSlashesAndUnicode(url);
  return url.trim();
}

function isDecoyOrAdUrl(url) {
  if (!url) return true;
  const lower = String(url).toLowerCase();
  return (
    /preview\.mp4|sample\.mp4|trailer\.mp4|top_banner|native-ad|stat\.php|loading\.mp4|ad\.mp4/i.test(
      lower
    ) ||
    lower.startsWith('javascript:') ||
    lower.startsWith('about:blank') ||
    lower.startsWith('data:')
  );
}

function isDirectMediaUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const clean = urlStr.trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  if (isDecoyOrAdUrl(clean)) return false;
  try {
    const parsed = new URL(clean);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(?:m3u8|mp4|flv|mpd|ts|mkv|mov|aac)(?:$|\?)/i.test(pathname)) {
      return true;
    }
    if (/(?:\/|=)(?:index|playlist|master|video|stream|hls)\.m3u8/i.test( pathname )) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function sanitizePlayId(rawInput) {
  if (!rawInput) return '';
  let str = String(rawInput).trim();

  if (str.includes('@@@')) {
    str = str.split('@@@')[0].trim();
  }

  if (str.includes('$')) {
    const dollarIdx = str.indexOf('$');
    const prefix = str.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      str = str.slice(dollarIdx + 1).trim();
    }
  }

  str = unescapeSlashesAndUnicode(str);
  return str.trim();
}

function unwrapNestedStreamUrl(rawUrl, baseUrl = activeDomain) {
  if (!rawUrl) return '';
  let current = sanitizePlayId(rawUrl);
  if (!current) return '';

  for (let pass = 0; pass < 2; pass++) {
    if (/^https?%3A%2F%2F/i.test(current) || /^%2F/i.test(current)) {
      current = unescapeCmsString(current).trim();
    }
  }

  if (current.startsWith('//')) {
    current = `https:${current}`;
  } else if (current.startsWith('/')) {
    const origin = (baseUrl || activeDomain).replace(/\/+$/, '');
    current = `${origin}${current}`;
  }

  if (isDirectMediaUrl(current)) {
    return current;
  }

  try {
    const parsed = new URL(current);
    const candidateParams = ['url', 'v', 'src', 'vid', 'play', 'm3u8', 'file'];
    for (const key of candidateParams) {
      let inner = parsed.searchParams.get(key);
      if (!inner) continue;
      inner = sanitizePlayId(inner);
      for (let i = 0; i < 2; i++) {
        const decoded = unescapeCmsString(inner);
        if (decoded === inner) break;
        inner = decoded;
      }
      inner = unescapeSlashesAndUnicode(inner).trim();
      if (inner.startsWith('//')) inner = `https:${inner}`;
      else if (inner.startsWith('/')) inner = `${parsed.origin}${inner}`;

      if (isDirectMediaUrl(inner)) {
        return inner;
      }
      if (/^https?:\/\//i.test(inner) && inner !== current) {
        const deep = unwrapNestedStreamUrl(inner, parsed.origin);
        if (isDirectMediaUrl(deep)) return deep;
      }
    }
  } catch (_) {}

  return current;
}

function extractBalancedJsonObject(source, varName) {
  if (!source || !varName) return null;
  const regex = new RegExp(`(?:var|let|const|window\\.)?\\s*${varName}\\s*=\\s*\\{`, 'g');
  let match;
  while ((match = regex.exec(source)) !== null) {
    const braceStart = source.indexOf('{', match.index);
    if (braceStart === -1) continue;

    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;

    for (let i = braceStart; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === quoteChar) {
          inString = false;
          quoteChar = '';
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
            const rawObj = source.slice(braceStart, i + 1);
            try {
              return JSON.parse(rawObj);
            } catch (_) {
              try {
                const relaxed = rawObj
                  .replace(/,\s*([}\]])/g, '$1')
                  .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
                return JSON.parse(relaxed);
              } catch (_e2) {}
            }
            break;
          }
        }
      }
    }
  }
  return null;
}

function unpackDeanEdwardsPacker(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const results = [];
  const packerRegex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let m;
  while ((m = packerRegex.exec(html)) !== null) {
    try {
      const payload = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
      const radix = parseInt(m[3], 10) || 36;
      const count = parseInt(m[4], 10) || 0;
      const symtab = m[6].split('|');

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
        const val = symtab[i];
        if (val !== undefined && val !== '') {
          dict.set(key, val);
        }
      }

      const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (token) =>
        dict.has(token) ? dict.get(token) : token
      );
      results.push(unpacked);
    } catch (_) {}
  }
  return results;
}

function extractPlayStreamFromHtml(html, pageUrl = activeDomain) {
  if (!html || typeof html !== 'string') return '';

  const candidateBlocks = [html, ...unpackDeanEdwardsPacker(html)];

  // Stage 1 & 2: Balanced-brace CMS player object scan (including unpacked blocks)
  const configNames = ['player_aaaa', 'player_data', 'player_config', 'cms_player'];
  for (const block of candidateBlocks) {
    for (const name of configNames) {
      const cfg = extractBalancedJsonObject(block, name);
      if (cfg && cfg.url) {
        const decoded = decodeCmsPlayerUrl(cfg.url, cfg.encrypt);
        const unwrapped = unwrapNestedStreamUrl(decoded, pageUrl);
        if (isDirectMediaUrl(unwrapped)) return unwrapped;
        if (/^https?:\/\//i.test(unwrapped) && !isDecoyOrAdUrl(unwrapped)) {
          return unwrapped;
        }
      }
    }
  }

  // Stage 3: High-priority variable & normalized regex scan
  for (const block of candidateBlocks) {
    const normalized = unescapeSlashesAndUnicode(block);

    const priorityVarRegex =
      /(?:["']?(?:url|playUrl|videoUrl|m3u8Url|hlsUrl|video_url|main_url)["']?\s*[:=]\s*["'])(https?:\/\/[^"'\\\s<>]+)["']/gi;
    let vm;
    while ((vm = priorityVarRegex.exec(normalized)) !== null) {
      const candidate = unwrapNestedStreamUrl(vm[1], pageUrl);
      if (isDirectMediaUrl(candidate)) return candidate;
    }

    const directMediaRegex =
      /https?:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+\.(?:m3u8|mp4)(?:\?[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]*)?/gi;
    let dm;
    while ((dm = directMediaRegex.exec(normalized)) !== null) {
      const candidate = unwrapNestedStreamUrl(dm[0], pageUrl);
      if (isDirectMediaUrl(candidate)) return candidate;
    }
  }

  return '';
}

function extractIframeUrls(html, baseUrl = activeDomain) {
  if (!html) return [];
  const urls = [];
  const iframeTagRegex = /<iframe\b[^>]*>/gi;
  const attrNames = ['data-litespeed-src', 'data-lazy-src', 'data-src', 'src'];

  let tagMatch;
  while ((tagMatch = iframeTagRegex.exec(html)) !== null) {
    const tag = tagMatch[0];
    for (const attr of attrNames) {
      const attrRegex = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
      const m = tag.match(attrRegex);
      if (m && m[1]) {
        const raw = decodeHtmlEntities(m[1]).trim();
        if (isDecoyOrAdUrl(raw)) continue;
        try {
          const resolved = new URL(raw, baseUrl).href;
          if (!urls.includes(resolved)) urls.push(resolved);
        } catch (_) {}
      }
    }
  }
  return urls;
}

function extractAlternativePlayRoutes(html, currentUrl) {
  if (!html) return [];
  const routes = [];
  const routeRegex = /href=["']([^"']*\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)["']/gi;
  let m;
  while ((m = routeRegex.exec(html)) !== null) {
    try {
      const resolved = new URL(decodeHtmlEntities(m[1]), currentUrl || activeDomain).href;
      if (resolved !== currentUrl && !routes.includes(resolved)) {
        routes.push(resolved);
      }
    } catch (_) {}
  }
  return routes;
}

async function resolveStreamFromUrlOrHtml(targetUrl, refererUrl = '') {
  const unwrappedInitial = unwrapNestedStreamUrl(targetUrl, refererUrl || activeDomain);
  if (isDirectMediaUrl(unwrappedInitial)) {
    return { streamUrl: unwrappedInitial, referer: refererUrl || activeDomain };
  }

  const cached = getPlayCache(targetUrl) || getPlayCache(unwrappedInitial);
  if (cached && isDirectMediaUrl(cached)) {
    return { streamUrl: cached, referer: refererUrl || activeDomain };
  }

  const { text: html, finalUrl } = await fetchTextWithFallback(
    unwrappedInitial,
    refererUrl ? { Referer: refererUrl } : {}
  );
  if (!html) {
    return { streamUrl: unwrappedInitial, referer: refererUrl || activeDomain };
  }

  if (html.includes('#EXTM3U')) {
    return { streamUrl: finalUrl, referer: refererUrl || activeDomain };
  }

  let extracted = extractPlayStreamFromHtml(html, finalUrl);
  if (extracted) {
    if ( isDirectMediaUrl(extracted) ) {
      setPlayCache(targetUrl, extracted);
      return { streamUrl: extracted, referer: finalUrl };
    }
    // Extracted URL might be a secondary player page or wrapper URL
    const secondUnwrap = unwrapNestedStreamUrl(extracted, finalUrl);
    if (isDirectMediaUrl(secondUnwrap)) {
      setPlayCache(targetUrl, secondUnwrap);
      return { streamUrl: secondUnwrap, referer: finalUrl };
    }
  }

  // Stage 4: Follow embedded iframes
  const iframes = extractIframeUrls(html, finalUrl);
  for (const iframeUrl of iframes) {
    const unwrappedIframe = unwrapNestedStreamUrl(iframeUrl, finalUrl);
    if (isDirectMediaUrl(unwrappedIframe)) {
      setPlayCache(targetUrl, unwrappedIframe);
      return { streamUrl: unwrappedIframe, referer: finalUrl };
    }
    const { text: iframeHtml, finalUrl: iframeFinalUrl } = await fetchTextWithFallback(
      unwrappedIframe,
      { Referer: finalUrl }
    );
    const iframeStream = extractPlayStreamFromHtml(iframeHtml, iframeFinalUrl);
    if (iframeStream && isDirectMediaUrl(iframeStream)) {
      setPlayCache(targetUrl, iframeStream);
      return { streamUrl: iframeStream, referer: iframeFinalUrl };
    }
  }

  // Stage 5: Alternative play route discovery
  const altRoutes = extractAlternativePlayRoutes(html, finalUrl);
  for (const altUrl of altRoutes.slice(0, 3)) {
    const { text: altHtml, finalUrl: altFinalUrl } = await fetchTextWithFallback(altUrl, {
      Referer: finalUrl,
    });
    const altStream = extractPlayStreamFromHtml(altHtml, altFinalUrl);
    if (altStream && isDirectMediaUrl(altStream)) {
      setPlayCache(targetUrl, altStream);
      return { streamUrl: altStream, referer: altFinalUrl };
    }
  }

  return { streamUrl: extracted || unwrappedInitial, referer: finalUrl };
}

function normalizePlayUrlGroup(rawGroup, vodId = '') {
  if (!rawGroup) return '';
  const episodes = String(rawGroup)
    .split('#')
    .map((s) => s.trim())
    .filter(Boolean);

  const normalizedEpisodes = episodes.map((ep, idx) => {
    let label = episodes.length === 1 ? '正片' : `第${idx + 1}集`;
    let rawUrl = ep;

    if (ep.includes('$')) {
      const dollarIdx = ep.indexOf('$');
      const prefix = ep.slice(0, dollarIdx).trim();
      const rest = ep.slice(dollarIdx + 1).trim();
      if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
        label = prefix || label;
        rawUrl = rest;
      }
    }

    const cleanUrl = unwrapNestedStreamUrl(rawUrl, activeDomain);
    if (vodId && idx === 0 && isDirectMediaUrl(cleanUrl)) {
      setPlayCache(vodId, cleanUrl);
    }
    if (isDirectMediaUrl(cleanUrl)) {
      setPlayCache(rawUrl, cleanUrl);
    }
    return `${label}$${cleanUrl || rawUrl}`;
  });

  return normalizedEpisodes.join('#');
}

function mapVideoCard(item) {
  return {
    vod_id: String(item.vod_id ?? ''),
    vod_name: String(item.vod_name ?? ''),
    vod_pic: String(item.vod_pic ?? ''),
    vod_remarks: formatRemarks(item.vod_remarks),
    style: RECT_178_STYLE,
  };
}

async function init(inReq) {
  const params = unwrapRequestParams(inReq);
  const ext = params.ext || params.extend || '';
  if (typeof ext === 'string' && /^https?:\/\//i.test(ext.trim())) {
    customApiUrl = ext.trim();
    try {
      activeDomain = new URL(customApiUrl).origin;
    } catch (_) {}
  }
  return {};
}

async function home(inReq) {
  let homeList = [];
  try {
    const firstTid = CLASSES_CACHE[0].type_id;
    const data = await fetchJsonWithFallback(`${API_PATH}?ac=detail&t=${firstTid}&pg=1`);
    const rawList = Array.isArray(data.list) ? data.list : [];
    homeList = rawList.map(mapVideoCard);
  } catch (_) {}

  return {
    class: CLASSES_CACHE,
    filters: {},
    list: homeList,
    style: RECT_178_STYLE,
  };
}

async function category(inReq) {
  const params = unwrapRequestParams(inReq);
  const tid = String(params.id ?? params.tid ?? params.type_id ?? CLASSES_CACHE[0].type_id);
  const rawPg = String(params.page ?? params.pg ?? '1');
  const pageNum = /^\d+$/.test(rawPg) ? Math.max(1, parseInt(rawPg, 10)) : 1;

  const data = await fetchJsonWithFallback(
    `${API_PATH}?ac=detail&t=${encodeURIComponent(tid)}&pg=${pageNum}`
  );

  const rawList = Array.isArray(data.list) ? data.list : [];
  const cards = rawList.map(mapVideoCard);
  const pagecount = Number.isFinite(Number(data.pagecount)) ? parseInt(data.pagecount, 10) : 1;
  const total = Number.isFinite(Number(data.total)) ? parseInt(data.total, 10) : cards.length;

  return {
    page: pageNum,
    pagecount,
    limit: cards.length,
    total,
    list: cards,
    style: RECT_178_STYLE,
  };
}

async function detail(inReq) {
  const params = unwrapRequestParams(inReq);
  const rawIds = params.id ?? params.ids ?? params.vod_id ?? params.url ?? '';
  const vodId = Array.isArray(rawIds) ? String(rawIds[0] ?? '') : String(rawIds ?? '').trim();
  if (!vodId) return { list: [] };

  let item = null;

  if (/^\d+$/.test(vodId) || (!vodId.startsWith('/') && !/^https?:\/\//i.test(vodId))) {
    const data = await fetchJsonWithFallback(
      `${API_PATH}?ac=detail&ids=${encodeURIComponent(vodId)}`
    );
    const rawList = Array.isArray(data.list) ? data.list : [];
    if (rawList.length > 0) {
      item = rawList[0];
    }
  }

  // Fallback for relative or full HTML detail/play paths
  if (!item && (vodId.startsWith('/') || /^https?:\/\//i.test(vodId))) {
    const { streamUrl } = await resolveStreamFromUrlOrHtml(vodId);
    if (streamUrl) {
      setPlayCache(vodId, streamUrl);
      item = {
        vod_id: vodId,
        vod_name: '桃花视频',
        vod_pic: '',
        type_name: '',
        vod_year: '',
        vod_area: '',
        vod_remarks: '',
        vod_blurb: '',
        vod_play_from: '蝴蝶专线',
        vod_play_url: `正片$${streamUrl}`,
      };
    }
  }

  if (!item) return { list: [] };

  const vodPlayFrom = String(item.vod_play_from || '').trim();
  const vodPlayUrl = String(item.vod_play_url || '').trim();

  const playFlags = [];
  const playUrls = [];

  if (vodPlayFrom && vodPlayUrl) {
    const fromList = vodPlayFrom.split('$$$');
    const urlList = vodPlayUrl.split('$$$');
    for (let idx = 0; idx < fromList.length; idx++) {
      const lineName = idx === 0 ? '蝴蝶专线' : `蝴蝶专线${idx + 1}`;
      playFlags.push(lineName);
      const currentGroup = idx < urlList.length ? urlList[idx] : '';
      playUrls.push(normalizePlayUrlGroup(currentGroup, String(item.vod_id || vodId)));
    }
  } else if (vodPlayUrl) {
    playFlags.push('蝴蝶专线');
    playUrls.push(normalizePlayUrlGroup(vodPlayUrl, String(item.vod_id || vodId)));
  }

  const finalPlayFrom = playFlags.length > 0 ? playFlags.join('$$$') : '蝴蝶专线';
  const finalPlayUrl = playUrls.length > 0 ? playUrls.join('$$$') : vodPlayUrl;

  const rawBlurb = String(item.vod_blurb || item.vod_content || '')
    .replace(/<[^>]+>/g, '')
    .trim();
  const formattedContent = `【蝴蝶影视】交流TG群: @tvshare23 | 严禁盗卖\n${rawBlurb}`;

  const detailObj = {
    vod_id: String(item.vod_id ?? vodId),
    vod_name: String(item.vod_name ?? ''),
    vod_pic: String(item.vod_pic ?? ''),
    type_name: String(item.type_name ?? ''),
    vod_year: String(item.vod_year ?? ''),
    vod_area: String(item.vod_area ?? ''),
    vod_remarks: formatRemarks(item.vod_remarks),
    vod_actor: '🦋 TG群: @tvshare23',
    vod_director: '🦋 蝴蝶影视',
    vod_content: formattedContent,
    vod_play_from: finalPlayFrom,
    vod_play_url: finalPlayUrl,
  };

  return { list: [detailObj] };
}

async function play(inReq) {
  const params = unwrapRequestParams(inReq);
  const rawId = params.id ?? params.url ?? params.playUrl ?? '';
  let cleanId = sanitizePlayId(rawId);

  const defaultHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: `${activeDomain}/`,
  };

  if (!cleanId) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: '',
      header: defaultHeaders,
      headers: defaultHeaders,
    };
  }

  // 1. Check cache
  const cachedStream = getPlayCache(cleanId) || getPlayCache(rawId);
  if (cachedStream && isDirectMediaUrl(cachedStream)) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: cachedStream,
      header: defaultHeaders,
      headers: defaultHeaders,
    };
  }

  // 2. Unwrap wrapper URL or direct stream
  const unwrapped = unwrapNestedStreamUrl(cleanId, activeDomain);
  if (isDirectMediaUrl(unwrapped)) {
    setPlayCache(cleanId, unwrapped);
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: unwrapped,
      header: defaultHeaders,
      headers: defaultHeaders,
    };
  }

  // 3. If numeric ID was passed to /play, look up via MacCMS detail API
  if (/^\d+$/.test(cleanId)) {
    const data = await fetchJsonWithFallback(`${API_PATH}?ac=detail&ids=${cleanId}`);
    const first = Array.isArray(data.list) && data.list[0] ? data.list[0] : null;
    if (first && first.vod_play_url) {
      const firstGroup = String(first.vod_play_url).split('$$$')[0] || '';
      const firstEp = firstGroup.split('#')[0] || '';
      const epUrl = unwrapNestedStreamUrl(sanitizePlayId(firstEp), activeDomain);
      if (isDirectMediaUrl(epUrl)) {
        setPlayCache(cleanId, epUrl);
        return {
          parse: 0,
          jx: 0,
          playUrl: '',
          url: epUrl,
          header: defaultHeaders,
          headers: defaultHeaders,
        };
      }
      cleanId = epUrl || cleanId;
    }
  }

  // 4. Multi-stage HTML / player page stream resolution
  const { streamUrl, referer } = await resolveStreamFromUrlOrHtml(cleanId, `${activeDomain}/`);
  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: referer || `${activeDomain}/`,
  };

  if (isDirectMediaUrl(streamUrl)) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: streamUrl,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  // Fallback for direct URLs without standard extension or sniffing
  const isHttp = /^https?:\/\//i.test(streamUrl);
  return {
    parse: isHttp ? 0 : 1,
    jx: 0,
    playUrl: '',
    url: streamUrl || cleanId,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function search(inReq) {
  const params = unwrapRequestParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const rawPg = String(params.page ?? params.pg ?? '1');
  const pageNum = /^\d+$/.test(rawPg) ? Math.max(1, parseInt(rawPg, 10)) : 1;

  if (!key) {
    return {
      page: pageNum,
      pagecount: 1,
      limit: 0,
      total: 0,
      list: [],
      style: RECT_178_STYLE,
    };
  }

  const encodedKey = encodeURIComponent(key);
  const data = await fetchJsonWithFallback(`${API_PATH}?ac=detail&wd=${encodedKey}&pg=${pageNum}`);

  const rawList = Array.isArray(data.list) ? data.list : [];
  const cards = rawList.map(mapVideoCard);
  const pagecount = Number.isFinite(Number(data.pagecount)) ? parseInt(data.pagecount, 10) : 1;
  const total = Number.isFinite(Number(data.total)) ? parseInt(data.total, 10) : cards.length;

  return {
    page: pageNum,
    pagecount,
    limit: cards.length,
    total,
    list: cards,
    style: RECT_178_STYLE,
  };
}

async function proxyPicHandler(query) {
  const rawUrl = String(query.url || '').trim();
  if (!rawUrl) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
  try {
    const headers = buildHeaders(rawUrl, {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    });
    const resp = await req.get(rawUrl, {
      headers,
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    const rawData = resp && resp.data !== undefined ? resp.data : resp;
    const buf = Buffer.isBuffer(rawData)
      ? rawData
      : rawData instanceof ArrayBuffer
        ? Buffer.from(rawData)
        : Buffer.from(String(rawData || ''));
    const contentType =
      (resp && resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) ||
      'image/jpeg';
    return { mime: contentType, data: buf };
  } catch (_) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'taohua',
    name: '桃花视频',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/taohua_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};