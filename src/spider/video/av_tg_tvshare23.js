import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://goodav17.com',
];

let activeDomain = SITE_DOMAINS[0];
const EMBED_HOST = 'https://ggjav.com';
const PORN87_HOST = 'https://porn87.com';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let runtimeConfig = {
  host: SITE_DOMAINS[0],
  ua: DEFAULT_UA,
  cookie: '',
  referer: `${SITE_DOMAINS[0]}/`,
  timeout: 15000,
  enableHlsProxy: false,
};

const FALLBACK_TYPES = [
  ['home', '首頁'],
  ['local', '本土自拍'],
  ['vr', 'VR'],
  ['人妻', '人妻'],
  ['素人', '素人'],
  ['巨乳', '巨乳'],
  ['無碼', '無碼'],
  ['中出', '中出'],
  ['OL', 'OL'],
  ['學生', '學生'],
  ['護士', '護士'],
  ['潮吹', '潮吹'],
  ['絲襪', '絲襪'],
  ['美腿', '美腿'],
  ['美尻', '美尻'],
  ['癡女', '癡女'],
  ['輕熟女', '輕熟女'],
  ['肛交', '肛交'],
  ['自慰', '自慰'],
  ['口爆', '口爆'],
  ['顏射', '顏射'],
  ['乳交', '乳交'],
  ['足交', '足交'],
];

// In-memory playback cache (TTL: 10 minutes)
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function setPlayCache(key, value) {
  if (!key || !value || !value.url) return;
  const now = Date.now();
  if (PLAY_CACHE.size > 500) {
    for (const [k, v] of PLAY_CACHE.entries()) {
      if (now - v.ts > PLAY_CACHE_TTL) PLAY_CACHE.delete(k);
    }
  }
  PLAY_CACHE.set(String(key), { ...value, ts: now });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return entry;
}

function unescapeHtml(str) {
  if (!str) return '';
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return String(str)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity) => {
      if (entity[0] === '#') {
        const isHex = entity[1] === 'x' || entity[1] === 'X';
        const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isNaN(code) ? full : String.fromCodePoint(code);
      }
      return Object.prototype.hasOwnProperty.call(named, entity) ? named[entity] : full;
    });
}

function cleanText(t) {
  return unescapeHtml(String(t || '')).replace(/\s+/g, ' ').trim();
}

function parsePageNum(pg) {
  const n = parseInt(pg, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function b64Decode(s) {
  if (!s) return '';
  let str = String(s).trim().replace(/ /g, '+');
  const pad = (4 - (str.length % 4)) % 4;
  str += '='.repeat(pad);
  try {
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch (_) {
    return '';
  }
}

function cleanDetailTitle(title) {
  let t = String(title || '');
  t = t.split(/\s*[-|]\s*正妹AV.*$/i)[0];
  t = t.replace(/\s*\|\s*[^|]+$/, '');
  return cleanText(t);
}

function extractNo(alt, name) {
  const combined = `${alt || ''} ${name || ''}`;
  const m = combined.match(/\b(fc2[-_ ]?ppv\s*\d+|[a-z]{2,6}-\d{2,6})\b/i);
  if (!m) return '';
  let v = m[1].toUpperCase();
  if (v.startsWith('FC2')) {
    const parts = v.split(/PPV/i);
    v = `FC2-PPV ${(parts[1] || '').replace(/^[-_ ]+/, '').trim()}`;
  }
  return v;
}

function unwrapParams(inReq) {
  const merged = {};
  const sources = [inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          continue;
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) merged[k] = v;
      } catch (_) {}
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function applyExtendConfig(ext) {
  if (!ext) return;
  let cfg = {};
  if (typeof ext === 'object') {
    cfg = { ...ext };
  } else if (typeof ext === 'string') {
    const trimmed = ext.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        cfg = JSON.parse(trimmed);
      } catch (_) {}
    } else if (/^https?:\/\//i.test(trimmed)) {
      cfg = { host: trimmed };
    }
  }
  const host = String(cfg.host || cfg.HOST || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(host)) {
    runtimeConfig.host = host;
    activeDomain = host;
    if (!SITE_DOMAINS.includes(host)) SITE_DOMAINS.unshift(host);
  }
  const ua = String(cfg.userAgent || cfg['User-Agent'] || cfg.ua || '').trim();
  if (ua) runtimeConfig.ua = ua;
  if (cfg.cookie !== undefined || cfg.Cookie !== undefined) {
    runtimeConfig.cookie = String(cfg.cookie || cfg.Cookie || '').trim();
  }
  const referer = String(cfg.referer || cfg.Referer || '').trim();
  runtimeConfig.referer = /^https?:\/\//i.test(referer)
    ? referer
    : `${activeDomain}/`;
  const timeout = parseInt(cfg.timeout, 10);
  if (Number.isFinite(timeout) && timeout >= 3) {
    runtimeConfig.timeout = timeout < 100 ? timeout * 1000 : timeout;
  }
  if (cfg.enableHlsProxy !== undefined || cfg.proxy !== undefined) {
    const flag = String(cfg.enableHlsProxy ?? cfg.proxy ?? '').toLowerCase();
    runtimeConfig.enableHlsProxy = ['1', 'true', 'yes', 'on'].includes(flag);
  }
}

function getAllKnownOrigins() {
  const pool = [activeDomain, runtimeConfig.host, ...SITE_DOMAINS].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const d of pool) {
    const clean = String(d).replace(/\/+$/, '');
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  for (const origin of getAllKnownOrigins()) {
    try {
      if (new URL(origin).hostname.toLowerCase() === h) return true;
    } catch (_) {}
  }
  return false;
}

function expandCandidateUrls(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return [];
  const origins = getAllKnownOrigins();
  if (raw.startsWith('/')) {
    return origins.map((o) => `${o}${raw}`);
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (isKnownSiteHost(u.hostname)) {
        const suffix = `${u.pathname}${u.search}${u.hash}`;
        const candidates = origins.map((o) => `${o}${suffix}`);
        if (!candidates.includes(raw)) candidates.unshift(raw);
        return [...new Set(candidates)];
      }
    } catch (_) {}
    return [raw];
  }
  return origins.map((o) => `${o}/${raw.replace(/^\/+/, '')}`);
}

function isCfChallenge(text) {
  const low = String(text || '').toLowerCase();
  return (
    low.includes('cf-challenge') ||
    low.includes('__cf_chl') ||
    low.includes('just a moment') ||
    (low.includes('cloudflare') && low.includes('captcha'))
  );
}

function hasValidSiteContent(text) {
  if (!text || isCfChallenge(text)) return false;
  return (
    /class=['"]movie['"]/i.test(text) ||
    /id=['"]m_image['"]/i.test(text) ||
    /video[_-]frame/i.test(text) ||
    /max_page\s*=\s*\d+/i.test(text) ||
    /<video\b/i.test(text) ||
    /<iframe\b/i.test(text) ||
    /player_aaaa|player_data/i.test(text) ||
    /\.m3u8|\.mp4/i.test(text) ||
    /\/(?:html|local_html|type)\//i.test(text)
  );
}

function decodeResponseBuffer(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch (_) {}
  }
  let text = raw.toString('utf-8');
  if (text.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      const gbkText = gbkDecoder.decode(raw);
      if (!gbkText.includes('\ufffd')) text = gbkText;
    } catch (_) {}
  }
  return text;
}

async function rawHttpRequest(url, options = {}) {
  const headers = {
    'User-Agent': runtimeConfig.ua || DEFAULT_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    ...(options.headers || {}),
  };
  if (runtimeConfig.cookie && !headers.Cookie) {
    headers.Cookie = runtimeConfig.cookie;
  }
  const method = (options.method || 'GET').toUpperCase();
  const reqOpts = {
    method,
    headers,
    timeout: options.timeout || runtimeConfig.timeout || 15000,
  };
  if (options.buffer) reqOpts.buffer = options.buffer;
  if (options.data !== undefined) reqOpts.data = options.data;

  const resp = await req(url, reqOpts);
  if (!resp) return { status: 0, text: '', buffer: Buffer.alloc(0), headers: {} };

  const status = resp.status ?? resp.statusCode ?? 200;
  let bodyBuf = null;
  if (Buffer.isBuffer(resp.data)) {
    bodyBuf = resp.data;
  } else if (resp.data instanceof Uint8Array) {
    bodyBuf = Buffer.from(resp.data);
  } else if (typeof resp.data === 'string') {
    bodyBuf = Buffer.from(resp.data, 'utf-8');
  } else if (resp.data !== undefined && resp.data !== null) {
    bodyBuf = Buffer.from(JSON.stringify(resp.data), 'utf-8');
  } else if (typeof resp === 'string') {
    bodyBuf = Buffer.from(resp, 'utf-8');
  } else {
    bodyBuf = Buffer.alloc(0);
  }

  const text = options.binaryOnly ? '' : decodeResponseBuffer(bodyBuf);
  return {
    status,
    text,
    buffer: bodyBuf,
    headers: resp.headers || {},
  };
}

async function fetchHtml(urlOrPath, customHeaders = {}) {
  const candidates = expandCandidateUrls(urlOrPath);
  let lastText = '';
  for (const candidate of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(candidate).origin;
    } catch (_) {}
    const headers = {
      Referer: `${origin}/`,
      ...customHeaders,
    };
    try {
      const resp = await rawHttpRequest(candidate, { headers });
      if (resp.status >= 200 && resp.status < 400 && resp.text) {
        lastText = resp.text;
        if (!isCfChallenge(resp.text)) {
          if (isKnownSiteHost(new URL(candidate).hostname) && hasValidSiteContent(resp.text)) {
            activeDomain = origin;
          }
          return resp.text;
        }
      }
    } catch (_) {}
  }
  return lastText;
}

function normalizeAssetUrl(u, baseOrigin = activeDomain) {
  const raw = cleanText(u);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  const base = String(baseOrigin || activeDomain || SITE_DOMAINS[0]).replace(/\/+$/, '');
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}

function parseMovies(html, host = activeDomain) {
  const out = [];
  const seen = new Set();
  if (!html) return out;

  // Strip HTML comments first because local_html pages duplicate <img> inside comments
  const cleanedHtml = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const parts = cleanedHtml.split(/<div\s+class=['"]movie['"][^>]*>/i).slice(1);

  for (const part of parts) {
    const hrefMatch = part.match(/\/(?:html|local_html)\/(\d+)\//i);
    if (!hrefMatch) continue;
    const vid = hrefMatch[1];
    const isLocal = /\/local_html\//i.test(part);
    const fullVid = isLocal ? `local_${vid}` : vid;
    if (seen.has(fullVid)) continue;
    seen.add(fullVid);

    let pic = '';
    const largeMatch = part.match(/large_image=['"]([^'"]+)['"]/i);
    if (largeMatch && largeMatch[1]) {
      pic = largeMatch[1];
    } else {
      const imgMatch =
        part.match(/<img[^>]*\bdata-original=['"]([^'"]+)['"]/i) ||
        part.match(/<img[^>]*\bdata-src=['"]([^'"]+)['"]/i) ||
        part.match(/<img[^>]*\bsrc=['"]([^'"]+)['"]/i);
      if (imgMatch && imgMatch[1]) pic = imgMatch[1];
    }
    pic = normalizeAssetUrl(pic, host);

    let name = '';
    const titleRegex = /\/(?:html|local_html)\/\d+\/['"][^>]*>([^<]*)<\/a>/gi;
    let tm;
    while ((tm = titleRegex.exec(part)) !== null) {
      const t = cleanText(tm[1]);
      if (t) name = t;
    }
    if (!name) {
      const anyAnchorRegex = /<a\b[^>]*>([^<]+)<\/a>/gi;
      let am;
      while ((am = anyAnchorRegex.exec(part)) !== null) {
        const t = cleanText(am[1]);
        if (t) name = t;
      }
    }

    let alt = '';
    const altMatch = part.match(/\balt=['"]([^'"]*)['"]/i);
    if (altMatch) alt = altMatch[1];

    const remarks = isLocal ? '本土自拍' : extractNo(alt, name);
    out.push({
      vod_id: fullVid,
      vod_name: name || alt || fullVid,
      vod_pic: pic,
      vod_remarks: remarks,
    });
  }

  return out;
}

function getMaxPage(html) {
  const m = String(html || '').match(/max_page\s*=\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

// ── Multi-Stage Stream Extraction Helpers ──

function isDecoyOrPreviewUrl(u) {
  if (!u) return true;
  const low = String(u).toLowerCase();
  return (
    low.includes('preview.mp4') ||
    low.includes('sample.mp4') ||
    low.includes('trailer.mp4') ||
    low.includes('top_banner') ||
    low.includes('native-ad') ||
    low.includes('stat.php') ||
    low.endsWith('/none') ||
    low.endsWith('/null')
  );
}

function isDirectMediaUrl(u) {
  if (!u || typeof u !== 'string') return false;
  const trimmed = u.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (isDecoyOrPreviewUrl(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.toLowerCase();
    return /\.(m3u8|mp4|flv|mpd|ts|mkv|webm)$/i.test(pathname);
  } catch (_) {
    return /\.(m3u8|mp4)(?:[?#]|$)/i.test(trimmed);
  }
}

function normalizeEscapedText(str) {
  if (!str) return '';
  return unescapeHtml(
    String(str)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\\//g, '/')
  );
}

function jsUnescape(str) {
  if (!str) return '';
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeCmsPlayerUrl(rawUrl, encryptType = 0) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const enc = parseInt(encryptType, 10) || 0;
  if (enc === 1) {
    try {
      u = decodeURIComponent(u);
    } catch (_) {
      u = jsUnescape(u);
    }
  } else if (enc === 2) {
    const b64 = b64Decode(u);
    if (b64) {
      try {
        u = decodeURIComponent(b64);
      } catch (_) {
        u = jsUnescape(b64);
      }
    }
  } else {
    u = normalizeEscapedText(u);
  }
  return u.trim();
}

function extractBalancedJson(text, varPattern) {
  const regex = new RegExp(`${varPattern}\\s*=\\s*\\{`, 'g');
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const startIdx = text.indexOf('{', match.index);
    if (startIdx === -1) continue;
    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (inString) {
        if (ch === quoteChar) inString = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        quoteChar = ch;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          results.push(text.slice(startIdx, i + 1));
          break;
        }
      }
    }
  }
  return results;
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const unpacked = [];
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    let payload = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const radix = parseInt(m[3], 10) || 36;
    const count = parseInt(m[4], 10) || 0;
    const symtab = m[6].split('|');

    const encodeBase = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num === 0) return '0';
      let res = '';
      let n = num;
      while (n > 0) {
        res = chars[n % base] + res;
        n = Math.floor(n / base);
      }
      return res;
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = i < radix ? encodeBase(i, radix) : encodeBase(Math.floor(i / radix), radix) + encodeBase(i % radix, radix);
      dict.set(key, symtab[i] || key);
    }

    const decoded = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpacked.push(decoded);
  }
  return unpacked;
}

function unwrapNestedUrlParam(rawUrl, baseOrigin = '') {
  if (!rawUrl) return '';
  let candidate = normalizeEscapedText(rawUrl).trim();
  if (candidate.startsWith('//')) candidate = `https:${candidate}`;
  else if (candidate.startsWith('/') && baseOrigin) {
    candidate = `${baseOrigin.replace(/\/+$/, '')}${candidate}`;
  }
  if (!/^https?:\/\//i.test(candidate)) return '';

  try {
    const u = new URL(candidate);
    // Check if it is goodav17/ggjav ?u=Base64 wrapper
    const uParam = u.searchParams.get('u');
    if (uParam) {
      let decodedU = uParam;
      try {
        decodedU = decodeURIComponent(uParam);
      } catch (_) {}
      const b64 = b64Decode(decodedU);
      if (b64 && /^https?:\/\//i.test(b64)) {
        const finalM3u8 = b64.toLowerCase().endsWith('.m3u8')
          ? b64
          : `${b64.replace(/\/+$/, '')}/index.m3u8`;
        return finalM3u8.replace(/ /g, '%20');
      }
    }

    if (isDirectMediaUrl(candidate)) {
      return candidate.replace(/ /g, '%20');
    }

    for (const key of ['url', 'v', 'src', 'file', 'm3u8']) {
      const inner = u.searchParams.get(key);
      if (!inner) continue;
      let dec = inner;
      for (let pass = 0; pass < 2; pass++) {
        try {
          const next = decodeURIComponent(dec);
          if (next === dec) break;
          dec = next;
        } catch (_) {
          dec = jsUnescape(dec);
        }
      }
      dec = normalizeEscapedText(dec).trim();
      if (isDirectMediaUrl(dec)) {
        return dec.replace(/ /g, '%20');
      }
    }
  } catch (_) {}
  return '';
}

function extractStreamFromEmbedHtml(html, embedUrl = '') {
  if (!html) return '';
  let baseOrigin = PORN87_HOST;
  try {
    if (embedUrl) baseOrigin = new URL(embedUrl).origin;
  } catch (_) {}

  const blocks = [html, ...unpackDeanEdwards(html)];

  for (const block of blocks) {
    // 1. Primary check matching Python spider: <video ... src="..."> or <source ... src="...">
    const videoRegex = /<(?:video|source)\b[^>]*\bsrc=['"]([^'"]+)['"]/gi;
    let vm;
    while ((vm = videoRegex.exec(block)) !== null) {
      const rawSrc = normalizeEscapedText(vm[1]).trim();
      if (!rawSrc || isDecoyOrPreviewUrl(rawSrc)) continue;
      const fullSrc = normalizeAssetUrl(rawSrc, baseOrigin).replace(/ /g, '%20');
      if (/^https?:\/\//i.test(fullSrc)) return fullSrc;
    }

    // 2. CMS player config objects (player_aaaa / player_data / player_config)
    const jsonBlocks = extractBalancedJson(block, '(?:player_aaaa|player_data|player_config)');
    for (const jb of jsonBlocks) {
      try {
        const parsed = JSON.parse(jb);
        const decoded = decodeCmsPlayerUrl(parsed.url, parsed.encrypt);
        const unwrapped = unwrapNestedUrlParam(decoded, baseOrigin) || decoded;
        if (isDirectMediaUrl(unwrapped)) return unwrapped.replace(/ /g, '%20');
      } catch (_) {}
    }

    // 3. Direct m3u8 / mp4 regex scan on normalized text
    const norm = normalizeEscapedText(block);
    const mediaRegex = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
    let mm;
    while ((mm = mediaRegex.exec(norm)) !== null) {
      const candidate = mm[0].replace(/ /g, '%20');
      if (isDirectMediaUrl(candidate)) return candidate;
    }
  }

  return '';
}

function inferRefererForStream(streamUrl, fallbackReferer = `${EMBED_HOST}/`) {
  const u = String(streamUrl || '').toLowerCase();
  if (u.includes('porn87.com')) return `${PORN87_HOST}/`;
  return fallbackReferer || `${EMBED_HOST}/`;
}

function extractIframeEmbedsFromDetailHtml(html) {
  const embeds = [];
  if (!html) return embeds;
  const iframeRegex = /<iframe\b([^>]*)>/gi;
  let m;
  while ((m = iframeRegex.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (!/video[_-]frame/i.test(attrs)) continue;
    const srcMatch =
      attrs.match(/\bsrc=['"]([^'"]+)['"]/i) ||
      attrs.match(/\bdata-src=['"]([^'"]+)['"]/i);
    if (srcMatch && srcMatch[1]) {
      embeds.push(unescapeHtml(srcMatch[1]).trim());
    }
  }
  return embeds;
}

async function resolveEmbedToStream(embedUrl, parentUrl = '') {
  const raw = unescapeHtml(String(embedUrl || '').trim());
  if (!raw) return null;

  // Case 1: JAV embed URL carrying ?u=<Base64>
  const mu = raw.match(/[?&]u=([^&\s'"]+)/i);
  if (mu && mu[1]) {
    let uParam = mu[1];
    try {
      uParam = decodeURIComponent(uParam);
    } catch (_) {}
    const du = b64Decode(uParam);
    if (du) {
      let pu = du.toLowerCase().endsWith('.m3u8')
        ? du
        : `${du.replace(/\/+$/, '')}/index.m3u8`;
      pu = pu.replace(/ /g, '%20');
      return {
        url: pu,
        referer: `${EMBED_HOST}/`,
      };
    }
  }

  // Case 2: Local video (e.g. porn87) or secondary embed page
  let fullEmbed = raw;
  if (raw.startsWith('//')) fullEmbed = `https:${raw}`;
  else if (raw.startsWith('/')) fullEmbed = `${activeDomain}${raw}`;

  let embedOrigin = PORN87_HOST;
  try {
    embedOrigin = new URL(fullEmbed).origin;
  } catch (_) {}

  const ehtml = await fetchHtml(fullEmbed, {
    Referer: parentUrl || `${activeDomain}/`,
  });
  const streamUrl = extractStreamFromEmbedHtml(ehtml, fullEmbed);
  if (streamUrl) {
    return {
      url: streamUrl.replace(/ /g, '%20'),
      referer: inferRefererForStream(streamUrl, `${embedOrigin}/`),
    };
  }

  return null;
}

async function resolveStreamsFromDetailHtml(html, detailUrl = '') {
  const streams = [];
  const seen = new Set();
  const embeds = extractIframeEmbedsFromDetailHtml(html);

  for (const embed of embeds) {
    const resolved = await resolveEmbedToStream(embed, detailUrl);
    if (resolved && resolved.url && !seen.has(resolved.url)) {
      seen.add(resolved.url);
      streams.push(resolved);
    }
  }

  // Fallback: if page directly embeds <video> or player config without iframe#video_frame
  if (streams.length === 0) {
    const direct = extractStreamFromEmbedHtml(html, detailUrl || activeDomain);
    if (direct && !seen.has(direct)) {
      seen.add(direct);
      streams.push({
        url: direct,
        referer: inferRefererForStream(direct, `${EMBED_HOST}/`),
      });
    }
  }

  return streams;
}

function cleanM3u8Manifest(rawM3u8, baseUrl, proxyRouteBase = '') {
  const lines = String(rawM3u8 || '').split(/\r?\n/);
  const out = [];
  for (const ln of lines) {
    const line = ln.trim();
    if (!line || line.startsWith('#')) {
      out.push(ln);
      continue;
    }
    let absUrl = '';
    if (/^https?:\/\//i.test(line)) {
      absUrl = line.replace(/ /g, '%20');
    } else {
      try {
        absUrl = new URL(line.replace(/ /g, '%20'), baseUrl).href.replace(/ /g, '%20');
      } catch (_) {
        absUrl = line.replace(/ /g, '%20');
      }
    }
    const pathPart = absUrl.split('?')[0].toLowerCase();
    if (pathPart.endsWith('.m3u8') && proxyRouteBase) {
      out.push(`${proxyRouteBase}?url=${encodeURIComponent(absUrl)}`);
    } else {
      out.push(absUrl);
    }
  }
  return out.join('\n');
}

function sanitizeEpisodeId(rawId) {
  let id = String(rawId || '').trim();
  if (!id) return '';
  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }
  if (id.includes('$')) {
    const dollarIdx = id.indexOf('$');
    const prefix = id.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      id = id.slice(dollarIdx + 1).trim();
    }
  }
  return id;
}

function buildDetailPathFromVid(vid) {
  const s = String(vid || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('/')) return s;
  if (s.startsWith('local_')) {
    return `/local_html/${s.slice(6)}/`;
  }
  return `/html/${s}/`;
}

// ── Route Handlers ──

async function init(inReq) {
  const params = unwrapParams(inReq);
  applyExtendConfig(params.ext ?? params.extend ?? params);
  return {};
}

async function home(inReq) {
  const params = unwrapParams(inReq);
  if (params.ext || params.extend) applyExtendConfig(params.ext || params.extend);

  const html = await fetchHtml('/1/');
  const types = [];
  const seen = new Set();

  const addType = (tid, tname) => {
    const id = String(tid || '').trim();
    const name = cleanText(tname);
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    types.push({ type_id: id, type_name: name });
  };

  if (html) {
    const typeRegex = /href=["'][^"']*\/type\/([^"'/]+)\/1\/["']\s*>([^<]+)</gi;
    let m;
    const dynamicTypes = [];
    while ((m = typeRegex.exec(html)) !== null) {
      let tid = m[1];
      try {
        tid = decodeURIComponent(tid);
      } catch (_) {}
      const tname = cleanText(m[2]);
      if (tid && tname) dynamicTypes.push([tid, tname]);
    }
    if (dynamicTypes.length > 0) {
      // Ensure top-level navigation tabs from FALLBACK_TYPES (首頁 / 本土自拍 / VR) are available
      addType('home', '首頁');
      addType('local', '本土自拍');
      addType('vr', 'VR');
      for (const [tid, tname] of dynamicTypes) {
        addType(tid, tname);
      }
    }
  }

  if (types.length === 0) {
    for (const [tid, tname] of FALLBACK_TYPES) {
      addType(tid, tname);
    }
  }

  const list = html ? parseMovies(html, activeDomain) : [];
  return {
    class: types,
    filters: {},
    list,
    style: { type: 'rect', ratio: 1.48 },
  };
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const tid = String(params.id ?? params.tid ?? params.type_id ?? 'home').trim();
  const pg = parsePageNum(params.page ?? params.pg ?? 1);

  let pathOrUrl = '';
  if (/^https?:\/\//i.test(tid)) {
    pathOrUrl = tid;
  } else if (tid === 'home' || tid === '首頁' || !tid) {
    pathOrUrl = `/${pg}/`;
  } else if (tid === 'local' || tid === '本土' || tid === '本土自拍') {
    pathOrUrl = `/local/${pg}/`;
  } else if (tid.startsWith('local_')) {
    let sub = tid.slice(6);
    try {
      sub = decodeURIComponent(sub);
    } catch (_) {}
    pathOrUrl = `/local_type/${encodeURIComponent(sub)}/${pg}/`;
  } else if (tid.toLowerCase() === 'vr') {
    pathOrUrl = `/vr/${pg}/`;
  } else {
    let cleanTid = tid;
    try {
      cleanTid = decodeURIComponent(tid);
    } catch (_) {}
    pathOrUrl = `/type/${encodeURIComponent(cleanTid)}/${pg}/`;
  }

  const html = await fetchHtml(pathOrUrl);
  const list = parseMovies(html, activeDomain);
  const maxp = getMaxPage(html);
  const pagecount = maxp > 0 ? maxp : list.length > 0 ? pg + 1 : pg;

  return {
    list,
    page: pg,
    pagecount,
    limit: 24,
    total: list.length,
  };
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  const rawIdInput = params.id ?? params.ids ?? params.url ?? '';
  const rawIds = Array.isArray(rawIdInput) ? rawIdInput : [rawIdInput];
  const vid = String(rawIds[0] || '').trim();
  if (!vid) return { list: [] };

  const detailPath = buildDetailPathFromVid(vid);
  const html = await fetchHtml(detailPath);
  if (!html) return { list: [] };

  let name = '';
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    name = cleanDetailTitle(titleMatch[1]);
  }

  let pic = '';
  const mImgMatch = html.match(/<div\s+id=['"]m_image['"][^>]*>[\s\S]*?<img[^>]*\bsrc=['"]([^'"]+)['"]/i);
  if (mImgMatch && mImgMatch[1]) {
    pic = mImgMatch[1];
  } else {
    const ogMatch = html.match(/property=['"]og:image['"][^>]*content=['"]([^'"]+)['"]/i);
    if (ogMatch && ogMatch[1]) pic = ogMatch[1];
  }
  pic = normalizeAssetUrl(pic, activeDomain);

  let remarks = '';
  const desigMatch = html.match(/<div\s+id=['"]m_designation['"][^>]*>[\s\S]*?<font[^>]*>\s*([^<]+)/i);
  if (desigMatch && desigMatch[1]) {
    remarks = cleanText(desigMatch[1]);
  } else if (vid.startsWith('local_')) {
    remarks = '本土自拍';
  } else {
    remarks = extractNo('', name);
  }

  const detailFullUrl = detailPath.startsWith('http')
    ? detailPath
    : `${activeDomain}${detailPath}`;
  const streams = await resolveStreamsFromDetailHtml(html, detailFullUrl);

  let playUrlStr = '';
  if (streams.length > 0) {
    setPlayCache(vid, streams[0]);
    const eps = streams.map((item, idx) => {
      setPlayCache(item.url, item);
      const label = streams.length > 1 ? `播放${idx + 1}` : '播放';
      return `${label}$${item.url}`;
    });
    playUrlStr = eps.join('#');
  }

  return {
    list: [
      {
        vod_id: vid,
        vod_name: name || vid,
        vod_pic: pic,
        vod_remarks: remarks,
        vod_play_from: '正妹AV',
        vod_play_url: playUrlStr,
      },
    ],
  };
}

function getFastifyRoutePrefix(inReq) {
  if (inReq?.server?.prefix) {
    return String(inReq.server.prefix).replace(/\/+$/, '');
  }
  const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
  return rawUrl.replace(/\/play\/?$/i, '').replace(/\/+$/, '');
}

function buildFastifyProxyUrl(inReq, routeName, queryObj = {}) {
  const host = inReq?.headers?.host || inReq?.hostname || '127.0.0.1';
  const proto = inReq?.protocol || 'http';
  const prefix = getFastifyRoutePrefix(inReq);
  const qs = new URLSearchParams(queryObj).toString();
  return `${proto}://${host}${prefix}/${routeName}${qs ? `?${qs}` : ''}`;
}

async function play(inReq) {
  const params = unwrapParams(inReq);
  let u = sanitizeEpisodeId(params.id ?? params.url ?? '');
  const wantProxy =
    params.proxy === '1' ||
    params.proxy === true ||
    params.proxy === 1 ||
    runtimeConfig.enableHlsProxy;

  if (!u) {
    return { parse: 1, jx: 0, url: '', header: {}, headers: {} };
  }

  // Handle legacy TVBox proxy://do=m3u8&url=... URLs
  if (u.startsWith('proxy://')) {
    try {
      const qs = u.replace(/^proxy:\/\/\/?/i, '');
      const sp = new URLSearchParams(qs);
      const innerUrl = sp.get('url');
      if (innerUrl) {
        u = decodeURIComponent(innerUrl).replace(/ /g, '%20');
      }
    } catch (_) {}
  }

  let resolvedUrl = '';
  let referer = `${EMBED_HOST}/`;

  // 1. Check PLAY_CACHE first
  const cached = getPlayCache(u);
  if (cached && cached.url) {
    resolvedUrl = cached.url;
    referer = cached.referer || inferRefererForStream(resolvedUrl);
  }

  // 2. Check if u is an embed wrapper (?u=Base64 or nested ?url=...)
  if (!resolvedUrl && /^https?:\/\//i.test(u)) {
    const unwrapped = unwrapNestedUrlParam(u);
    if (unwrapped) {
      resolvedUrl = unwrapped;
      referer = inferRefererForStream(resolvedUrl);
    } else if (isDirectMediaUrl(u)) {
      resolvedUrl = u.replace(/ /g, '%20');
      referer = inferRefererForStream(resolvedUrl);
    } else if (u.includes('ggjav.com') || u.includes('porn87.com')) {
      const embedRes = await resolveEmbedToStream(u);
      if (embedRes && embedRes.url) {
        resolvedUrl = embedRes.url;
        referer = embedRes.referer;
        setPlayCache(u, embedRes);
      }
    }
  }

  // 3. If u is a detail page ID or detail page URL, fetch & resolve
  if (!resolvedUrl) {
    const detailPath = buildDetailPathFromVid(u);
    const html = await fetchHtml(detailPath);
    if (html) {
      const detailFullUrl = detailPath.startsWith('http')
        ? detailPath
        : `${activeDomain}${detailPath}`;
      const streams = await resolveStreamsFromDetailHtml(html, detailFullUrl);
      if (streams.length > 0) {
        resolvedUrl = streams[0].url;
        referer = streams[0].referer;
        setPlayCache(u, streams[0]);
      } else {
        const embedStream = extractStreamFromEmbedHtml(html, detailFullUrl);
        if (embedStream) {
          resolvedUrl = embedStream;
          referer = inferRefererForStream(embedStream);
        }
      }
    }
  }

  if (resolvedUrl) {
    resolvedUrl = resolvedUrl.replace(/ /g, '%20');
    const playHeaders = {
      Referer: referer,
      'User-Agent': runtimeConfig.ua || DEFAULT_UA,
    };

    if (wantProxy && /\.m3u8(?:[?#]|$)/i.test(resolvedUrl) && inReq?.headers?.host) {
      const proxyUrl = buildFastifyProxyUrl(inReq, 'goodav17_m3u8', {
        url: resolvedUrl,
        referer,
      });
      return {
        parse: 0,
        jx: 0,
        url: proxyUrl,
        header: playHeaders,
        headers: playHeaders,
      };
    }

    return {
      parse: 0,
      jx: 0,
      url: resolvedUrl,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  // Fallback to sniffing if direct stream could not be extracted
  const fallbackUrl = /^https?:\/\//i.test(u)
    ? u
    : `${activeDomain}${buildDetailPathFromVid(u)}`;
  const fallbackHeaders = {
    Referer: `${activeDomain}/`,
    'User-Agent': runtimeConfig.ua || DEFAULT_UA,
  };
  return {
    parse: 1,
    jx: 0,
    url: fallbackUrl,
    header: fallbackHeaders,
    headers: fallbackHeaders,
  };
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pg = parsePageNum(params.page ?? params.pg ?? 1);
  if (!key) {
    return { list: [], page: 1, pagecount: 1, limit: 24, total: 0 };
  }

  const path = `/search/${encodeURIComponent(key)}/${pg}/`;
  const html = await fetchHtml(path);
  const list = parseMovies(html, activeDomain);
  const maxp = getMaxPage(html);
  const pagecount = maxp > 0 ? maxp : list.length > 0 ? pg + 1 : pg;

  return {
    list,
    page: pg,
    pagecount,
    limit: 24,
    total: list.length,
  };
}

async function proxyM3u8Handler(query = {}, inReq = null) {
  let rawUrl = String(query.url || '').trim();
  try {
    rawUrl = decodeURIComponent(rawUrl);
  } catch (_) {}
  rawUrl = rawUrl.replace(/ /g, '%20');

  if (!/^https?:\/\//i.test(rawUrl)) {
    return { status: 404, mime: 'text/plain', data: '' };
  }

  const referer = String(query.referer || inferRefererForStream(rawUrl, `${EMBED_HOST}/`)).trim();
  try {
    const resp = await rawHttpRequest(rawUrl, {
      headers: {
        Referer: referer,
        'User-Agent': runtimeConfig.ua || DEFAULT_UA,
      },
    });
    if (resp.status < 200 || resp.status >= 400 || !resp.text) {
      return { status: 404, mime: 'text/plain', data: '' };
    }
    const routeBase = inReq?.headers?.host
      ? buildFastifyProxyUrl(inReq, 'goodav17_m3u8', {})
      : '';
    const cleaned = cleanM3u8Manifest(resp.text, rawUrl, routeBase);
    return {
      status: 200,
      mime: 'application/vnd.apple.mpegurl',
      data: cleaned,
    };
  } catch (_) {
    return { status: 404, mime: 'text/plain', data: '' };
  }
}

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

async function proxyPicHandler(query = {}) {
  const url = String(query.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { status: 404, mime: 'text/plain', data: Buffer.alloc(0) };
  }
  try {
    const resp = await rawHttpRequest(url, {
      binaryOnly: true,
      buffer: 2,
      headers: {
        Referer: `${activeDomain}/`,
        'User-Agent': runtimeConfig.ua || DEFAULT_UA,
      },
    });
    if (resp.status >= 200 && resp.status < 400 && resp.buffer.length > 0) {
      const contentType =
        resp.headers['content-type'] || resp.headers['Content-Type'] || 'image/jpeg';
      return { status: 200, mime: contentType, data: resp.buffer };
    }
  } catch (_) {}
  return { status: 200, mime: 'image/gif', data: TRANSPARENT_GIF };
}

export default {
  meta: {
    key: 'goodav17',
    name: '正妹AV',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/goodav17_m3u8', async (request, reply) => {
      const res = await proxyM3u8Handler(request.query || {}, request);
      return reply.code(res.status).type(res.mime).send(res.data);
    });
    fastify.get('/goodav17_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.code(res.status).type(res.mime).send(res.data);
    });
  },
  init,
  home,
  category,
  detail,
  play,
  search,
  proxyM3u8Handler,
  proxyPicHandler,
};