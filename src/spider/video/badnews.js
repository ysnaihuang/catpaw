import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://bad.news',
  'https://www.bad.news',
];

let activeDomain = SITE_DOMAINS[0];

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const CATEGORIES = [
  { type_id: 'porn_hot', type_name: '热门视频' },
  { type_id: 'porn_new', type_name: '最新发布' },
  { type_id: 'porn_score', type_name: '高分精选' },
  { type_id: 'porn_better', type_name: '特别推荐' },
  { type_id: 'long_porn', type_name: '长篇巨作' },
  { type_id: 'dm_all', type_name: '动漫全集' },
  { type_id: 'dm_3d', type_name: '三维动画' },
  { type_id: 'dm_tongren', type_name: '同人原创' },
  { type_id: 'dm_cosplay', type_name: '角色扮演' },
];

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function setPlayCache(key, value) {
  if (!key || !value) return;
  PLAY_CACHE.set(String(key), { value, ts: Date.now() });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return entry.value;
}

function getDomainPool() {
  return Array.from(new Set([activeDomain, ...SITE_DOMAINS]));
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'bad.news' || h.endsWith('.bad.news')) return true;
  return SITE_DOMAINS.some((d) => {
    try {
      return new URL(d).hostname.toLowerCase() === h;
    } catch {
      return false;
    }
  });
}

function expandCandidateUrls(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return getDomainPool().map((d) => `${d}/`);

  if (raw.startsWith('/')) {
    return getDomainPool().map((d) => `${d.replace(/\/+$/, '')}${raw}`);
  }

  try {
    const u = new URL(raw);
    if (isKnownSiteHost(u.hostname)) {
      const suffix = `${u.pathname}${u.search}${u.hash}`;
      return getDomainPool().map((d) => `${d.replace(/\/+$/, '')}${suffix}`);
    }
    return [raw];
  } catch {
    return getDomainPool().map((d) => `${d.replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`);
  }
}

function normalizeUrl(url, base = activeDomain) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  const cleanBase = String(base || activeDomain).replace(/\/+$/, '');
  if (raw.startsWith('/')) return `${cleanBase}${raw}`;
  return `${cleanBase}/${raw}`;
}

function buildHeaders(targetUrl, extraHeaders = {}) {
  let origin = activeDomain;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    origin = activeDomain;
  }
  const headers = {
    'User-Agent': DEFAULT_UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${origin}/`,
    ...extraHeaders,
  };
  if (extraHeaders && extraHeaders.Referer) {
    try {
      const refUrl = new URL(extraHeaders.Referer);
      if (isKnownSiteHost(refUrl.hostname)) {
        headers.Referer = `${origin}${refUrl.pathname}${refUrl.search}`;
      }
    } catch {
      // keep provided Referer
    }
  }
  return headers;
}

function buildPlayHeaders(streamUrl, refererBase = activeDomain) {
  const refOrigin = String(refererBase || activeDomain).replace(/\/+$/, '');
  const isTwimg = /twimg\.com/i.test(String(streamUrl || ''));
  const h = {
    'User-Agent': DEFAULT_UA,
    Referer: isTwimg ? 'https://x.com/' : `${refOrigin}/`,
  };
  return h;
}

function decodeBufferToText(buf) {
  if (typeof buf === 'string') return buf;
  if (!buf) return '';
  let bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = zlib.gunzipSync(bytes);
    } catch {
      // ignore gunzip error
    }
  }
  const utf8Text = bytes.toString('utf-8');
  if (utf8Text.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(bytes);
    } catch {
      return utf8Text;
    }
  }
  return utf8Text;
}

function hasValidSiteFingerprint(html) {
  if (!html || typeof html !== 'string') return false;
  return (
    /<article\b/i.test(html) ||
    /class=['"][^'"]*(?:link|topic|title|ct-time)/i.test(html) ||
    /data-tid=/i.test(html) ||
    /data-source=/i.test(html) ||
    /\/dm\/play\/id-/i.test(html) ||
    /\/t\/\d+/i.test(html) ||
    /<video\b/i.test(html) ||
    /<iframe\b/i.test(html) ||
    /player_aaaa|player_data|player_config/i.test(html) ||
    /\.(?:m3u8|mp4)\b/i.test(html) ||
    /<title>/i.test(html)
  );
}

async function fetchHtml(urlOrPath, options = {}) {
  const candidates = expandCandidateUrls(urlOrPath);
  let lastError = null;

  for (const targetUrl of candidates) {
    try {
      const headers = buildHeaders(targetUrl, options.headers || {});
      const resp = await req.get(targetUrl, {
        headers,
        timeout: options.timeout || 15000,
      });
      const status = resp?.status ?? resp?.statusCode ?? 200;
      const rawData = resp?.data ?? resp?.body ?? resp ?? '';
      const body = decodeBufferToText(rawData);

      if (status >= 200 && status < 400 && body && hasValidSiteFingerprint(body)) {
        try {
          const u = new URL(targetUrl);
          if (isKnownSiteHost(u.hostname)) {
            activeDomain = u.origin;
          }
        } catch {
          // ignore
        }
        return {
          ok: true,
          status,
          url: targetUrl,
          body,
        };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return {
    ok: false,
    status: 0,
    url: candidates[0] || String(urlOrPath || ''),
    body: '',
    error: lastError ? String(lastError.message || lastError) : 'Fetch failed',
  };
}

function unescapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function stripTags(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]+>/g, '');
}

function unwrapRequestParams(inReq) {
  const merged = {};
  const sources = [inReq?.query, inReq?.body, inReq?.params];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          continue;
        } catch {
          // fallback to URLSearchParams
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
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function buildCategoryPath(tid, page) {
  const pg = Number.isFinite(Number(page)) && Number(page) > 0 ? Math.floor(Number(page)) : 1;
  let isDm = false;
  let path = '/';

  switch (String(tid || 'porn_hot')) {
    case 'porn_hot':
      path = pg === 1 ? '/tag/porn/sort-hot' : `/tag/porn/sort-hot/page-${pg}`;
      break;
    case 'porn_new':
      path = pg === 1 ? '/tag/porn/sort-new' : `/tag/porn/sort-new/page-${pg}`;
      break;
    case 'porn_score':
      path = pg === 1 ? '/tag/porn/sort-score' : `/tag/porn/sort-score/page-${pg}`;
      break;
    case 'porn_better':
      path = pg === 1 ? '/tag/porn/sort-better' : `/tag/porn/sort-better/page-${pg}`;
      break;
    case 'long_porn':
      path = pg === 1 ? '/tag/long-porn' : `/tag/long-porn/page-${pg}`;
      break;
    case 'dm_all':
      isDm = true;
      path = pg === 1 ? '/dm' : `/dm/page-${pg}`;
      break;
    case 'dm_3d':
      isDm = true;
      path = pg === 1 ? '/dm/type/q-3D' : `/dm/type/q-3D/page-${pg}`;
      break;
    case 'dm_tongren': {
      isDm = true;
      const qVal = encodeURIComponent('同人');
      path = pg === 1 ? `/dm/type/q-${qVal}` : `/dm/type/q-${qVal}/page-${pg}`;
      break;
    }
    case 'dm_cosplay':
      isDm = true;
      path = pg === 1 ? '/dm/type/q-Cosplay' : `/dm/type/q-Cosplay/page-${pg}`;
      break;
    default:
      path = pg === 1 ? '/' : `/page-${pg}`;
      break;
  }

  return { path, isDm, page: pg };
}

function parseDmCards(rawHtml, baseOrigin = activeDomain) {
  const vodList = [];
  if (!rawHtml) return vodList;

  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(rawHtml)) !== null) {
    const art = match[1];
    const idMatch = art.match(/href=['"][^'"]*\/dm\/play\/id-(\d+)['"]/i);
    if (!idMatch) continue;
    const rawId = idMatch[1];
    const vodId = `dm_${rawId}`;

    let title = '';
    const titleAttrMatch = art.match(/<a[^>]+class=['"][^'"]*title[^'"]*['"][^>]*title=['"]([^'"]+)['"]/i);
    if (titleAttrMatch) {
      title = titleAttrMatch[1].trim();
    } else {
      const titleTextMatch = art.match(/<a[^>]+class=['"][^'"]*title[^'"]*['"][^>]*>([\s\S]*?)<\/a>/i);
      if (titleTextMatch) {
        title = stripTags(titleTextMatch[1]).trim();
      }
    }
    if (!title) {
      title = `动漫 ${rawId}`;
    }
    title = unescapeHtml(title);

    let pic = '';
    const echoMatch = art.match(/data-echo=['"]([^'"]+)['"]/i);
    if (echoMatch) {
      pic = echoMatch[1].trim();
    } else {
      const srcMatch = art.match(/<img[^>]+src=['"]([^'"]+)['"]/i);
      if (srcMatch) {
        const candidate = srcMatch[1].trim();
        if (!candidate.includes('lightbox-blank') && !candidate.includes('default')) {
          pic = candidate;
        }
      }
    }
    if (pic.startsWith('/')) {
      pic = `${baseOrigin.replace(/\/+$/, '')}${pic}`;
    }

    vodList.push({
      vod_id: vodId,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: '蝴蝶影视',
      style: CARD_STYLE,
    });
  }

  return vodList;
}

function parseStandardCards(rawHtml, baseOrigin = activeDomain) {
  const vodList = [];
  if (!rawHtml) return vodList;

  let blocks = rawHtml.split(/<div class=['"](?:link|topic)\s+/i);
  if (blocks.length <= 1) {
    blocks = rawHtml.split(/<div class=['"][^'"]*link[^'"]*['"]/i);
  }

  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.includes('【热点】') || b.includes('招聘') || b.includes('/tag/灌水')) {
      continue;
    }

    let vodId = '';
    const tidMatch = b.match(/data-tid=['"](\d+)['"]/i);
    if (tidMatch) {
      vodId = tidMatch[1];
    } else {
      const idMatch = b.match(/href=['"][^'"]*\/t\/(\d+)['"]/i);
      if (idMatch) {
        vodId = idMatch[1];
      }
    }

    if (!vodId) continue;

    let title = '';
    const titleMatch = b.match(/<h3 class=['"]title['"]>[\s\S]*?<a[^>]+class=['"]title['"][^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch) {
      title = unescapeHtml(stripTags(titleMatch[1]).trim());
    }
    if (!title) {
      const altRegex = new RegExp(`<a[^>]+href=['"][^'"]*\\/t\\/${vodId}['"][^>]*>([\\s\\S]*?)<\\/a>`, 'i');
      const altMatch = b.match(altRegex);
      if (altMatch) {
        title = unescapeHtml(stripTags(altMatch[1]).trim());
      }
    }
    if (!title) {
      title = `视频 ${vodId}`;
    }

    let pic = '';
    const posterMatch = b.match(/poster=['"]([^'"]+)['"]/i);
    if (posterMatch) {
      pic = posterMatch[1].trim();
    }
    if (!pic) {
      const echoMatch = b.match(/data-echo=['"]([^'"]+)['"]/i);
      if (echoMatch) {
        pic = echoMatch[1].trim();
      }
    }
    if (!pic) {
      const srcMatch = b.match(/<img[^>]+src=['"]([^'"]+)['"]/i);
      if (srcMatch) {
        const candidate = srcMatch[1].trim();
        if (!candidate.includes('blank.gif') && !candidate.includes('default_avatar')) {
          pic = candidate;
        }
      }
    }
    if (pic.startsWith('/')) {
      pic = `${baseOrigin.replace(/\/+$/, '')}${pic}`;
    }

    let remarks = '蝴蝶影视';
    const timeMatch = b.match(/<div class=['"]ct-time['"]>\s*<span>([^<]+)<\/span>/i);
    if (timeMatch && timeMatch[1].trim()) {
      remarks = `蝴蝶影视 | ${timeMatch[1].trim()}`;
    }

    // Also opportunistically cache direct data-source if present on listing card
    const sourceMatch = b.match(/data-source=['"]([^'"]+)['"]/i);
    if (sourceMatch && sourceMatch[1].trim()) {
      const candidateStream = normalizeStreamCandidate(sourceMatch[1].trim(), baseOrigin);
      if (isDirectMediaUrl(candidateStream)) {
        setPlayCache(vodId, candidateStream);
      }
    }

    vodList.push({
      vod_id: vodId,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: remarks,
      style: CARD_STYLE,
    });
  }

  return vodList;
}

function extractBalancedJsonObject(text, varNames = ['player_aaaa', 'player_data', 'player_config']) {
  if (!text) return null;
  for (const name of varNames) {
    const regex = new RegExp(`\\b${name}\\s*=\\s*\\{`, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
      const startIdx = match.index + match[0].length - 1;
      let depth = 0;
      let inString = false;
      let quoteChar = '';
      let escaped = false;

      for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
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
            const rawJson = text.slice(startIdx, i + 1);
            try {
              return JSON.parse(rawJson);
            } catch {
              try {
                const normalized = rawJson.replace(/,\s*([}\]])/g, '$1');
                return JSON.parse(normalized);
              } catch {
                break;
              }
            }
          }
        }
      }
    }
  }
  return null;
}

function customUnescape(str) {
  if (!str) return '';
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeCmsPlayerUrl(rawUrl, encrypt = 0) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let decoded = rawUrl.trim();
  const encMode = Number(encrypt) || 0;

  if (encMode === 1) {
    decoded = customUnescape(decoded);
  } else if (encMode === 2) {
    try {
      const b64Decoded = Buffer.from(decoded, 'base64').toString('utf-8');
      try {
        decoded = decodeURIComponent(b64Decoded);
      } catch {
        decoded = customUnescape(b64Decoded);
      }
    } catch {
      decoded = customUnescape(decoded);
    }
  }

  decoded = decoded
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  decoded = unescapeHtml(decoded);

  return decoded.trim();
}

function unpackDeanEdwards(html) {
  if (!html) return [];
  const results = [];
  const packerRegex =
    /eval\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let match;
  while ((match = packerRegex.exec(html)) !== null) {
    const payload = match[2];
    const radix = parseInt(match[3], 10);
    const count = parseInt(match[4], 10);
    const symtab = match[6].split('|');
    if (!radix || !count) continue;

    const encodeBase = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) {
        return num < 36 ? num.toString(36) : chars[num];
      }
      return encodeBase(Math.floor(num / base), base) + (num % base < 36 ? (num % base).toString(36) : chars[num % base]);
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      dict.set(key, symtab[i] || key);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) => (dict.has(word) ? dict.get(word) : word));
    results.push(unpacked);
  }
  return results;
}

function isDecoyOrAdUrl(url) {
  if (!url) return true;
  return /(?:preview\.mp4|sample\.mp4|trailer\.mp4|top_banner|native-ad|stat\.php|blank\.gif|default_avatar)/i.test(url);
}

function isDirectMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (isDecoyOrAdUrl(s)) return false;
  try {
    const u = new URL(s);
    if (/\.(?:m3u8|mp4|flv|mpd|ts|m4s|mkv|webm)$/i.test(u.pathname)) {
      return true;
    }
    if (/(?:video\.twimg\.com|ext_tw_video|amplify_video)/i.test(s) && /\.(?:mp4|m3u8)/i.test(s)) {
      return true;
    }
  } catch {
    return /\.(?:m3u8|mp4)(?:\?|$)/i.test(s);
  }
  return false;
}

function unwrapNestedPlayerUrl(rawUrl, baseOrigin = activeDomain) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const full = normalizeUrl(rawUrl.trim(), baseOrigin);
  try {
    const parsed = new URL(full);
    if (/\.(?:m3u8|mp4|flv|mpd|mkv|webm)$/i.test(parsed.pathname)) {
      return full;
    }
    const paramNames = ['url', 'v', 'vid', 'src', 'play', 'm3u8', 'file'];
    for (const key of paramNames) {
      let val = parsed.searchParams.get(key);
      if (val) {
        for (let pass = 0; pass < 2; pass++) {
          try {
            const dec = decodeURIComponent(val);
            if (dec === val) break;
            val = dec;
          } catch {
            const dec = customUnescape(val);
            if (dec === val) break;
            val = dec;
          }
        }
        val = val.replace(/\\\//g, '/').trim();
        const candidate = normalizeUrl(val, parsed.origin);
        if (isDirectMediaUrl(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // ignore URL parse error
  }
  return full;
}

function normalizeStreamCandidate(rawUrl, baseOrigin = activeDomain) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let cleaned = decodeCmsPlayerUrl(rawUrl, 0);
  cleaned = unwrapNestedPlayerUrl(cleaned, baseOrigin);
  return normalizeUrl(cleaned, baseOrigin);
}

function extractStreamSyncFromHtml(html, baseOrigin = activeDomain) {
  if (!html || typeof html !== 'string') return '';

  // Stage 1: Balanced-brace CMS player object (player_aaaa, player_data, player_config)
  const playerObj = extractBalancedJsonObject(html);
  if (playerObj && playerObj.url) {
    const decoded = decodeCmsPlayerUrl(playerObj.url, playerObj.encrypt);
    const unwrapped = unwrapNestedPlayerUrl(decoded, baseOrigin);
    if (isDirectMediaUrl(unwrapped)) {
      return unwrapped;
    }
  }

  // Stage 2: Unpack Dean Edwards packed JS blocks
  const unpackedBlocks = unpackDeanEdwards(html);
  for (const block of unpackedBlocks) {
    const packedPlayer = extractBalancedJsonObject(block);
    if (packedPlayer && packedPlayer.url) {
      const decoded = decodeCmsPlayerUrl(packedPlayer.url, packedPlayer.encrypt);
      const unwrapped = unwrapNestedPlayerUrl(decoded, baseOrigin);
      if (isDirectMediaUrl(unwrapped)) {
        return unwrapped;
      }
    }
    const normalizedBlock = decodeCmsPlayerUrl(block, 0);
    const m3u8OrMp4 = normalizedBlock.match(/https?:\/\/[^\s'"<>\\]+\.(?:m3u8|mp4)(?:\?[^\s'"<>\\]*)?/i);
    if (m3u8OrMp4 && isDirectMediaUrl(m3u8OrMp4[0])) {
      return unwrapNestedPlayerUrl(m3u8OrMp4[0], baseOrigin);
    }
  }

  // Stage 3: BadNews primary video attributes (data-source, <video src>, <source src>)
  const dataSourceRegex = /data-source=['"]([^'"]+)['"]/gi;
  let m;
  while ((m = dataSourceRegex.exec(html)) !== null) {
    const candidate = normalizeStreamCandidate(m[1], baseOrigin);
    if (isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  const videoSrcRegex = /<(?:video|source)[^>]+src=['"]([^'"]+)['"]/gi;
  while ((m = videoSrcRegex.exec(html)) !== null) {
    const candidate = normalizeStreamCandidate(m[1], baseOrigin);
    if (isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  // Stage 4: Unescape escaped slashes/unicode across HTML and match .m3u8 / .mp4 URLs
  const unescapedHtml = decodeCmsPlayerUrl(html, 0);

  // Check wrapper URLs with ?url=...m3u8/.mp4 first
  const wrapperRegex = /https?:\/\/[^\s'"<>\\]+\?(?:[^\s'"<>\\]*&)?(?:url|v|src|file)=([^\s'"<>\\&]+)/gi;
  while ((m = wrapperRegex.exec(unescapedHtml)) !== null) {
    const unwrapped = unwrapNestedPlayerUrl(m[0], baseOrigin);
    if (isDirectMediaUrl(unwrapped)) {
      return unwrapped;
    }
  }

  const directMediaRegex = /https?:\/\/[^\s'"<>\\]+\.(?:m3u8|mp4)(?:\?[^\s'"<>\\]*)?/gi;
  while ((m = directMediaRegex.exec(unescapedHtml)) !== null) {
    const candidate = unwrapNestedPlayerUrl(m[0], baseOrigin);
    if (isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  return '';
}

async function resolvePlayStreamFromPage(html, pageUrl) {
  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(pageUrl).origin;
  } catch {
    baseOrigin = activeDomain;
  }

  const direct = extractStreamSyncFromHtml(html, baseOrigin);
  if (direct) return direct;

  // Stage 4b: Check if player_aaaa had a wrapper URL that needs fetching
  const playerObj = extractBalancedJsonObject(html);
  if (playerObj && playerObj.url) {
    const decoded = decodeCmsPlayerUrl(playerObj.url, playerObj.encrypt);
    const unwrapped = unwrapNestedPlayerUrl(decoded, baseOrigin);
    if (isDirectMediaUrl(unwrapped)) return unwrapped;
    if (/^https?:\/\//i.test(unwrapped) || unwrapped.startsWith('/')) {
      const subRes = await fetchHtml(unwrapped, { headers: { Referer: pageUrl } });
      if (subRes.ok) {
        const subStream = extractStreamSyncFromHtml(subRes.body, subRes.url);
        if (subStream) return subStream;
      }
    }
  }

  // Stage 5: Follow embedded <iframe src="..."> or data-src
  const iframeRegex = /<iframe[^>]+(?:src|data-src)=['"]([^'"]+)['"]/gi;
  let m;
  while ((m = iframeRegex.exec(html)) !== null) {
    const rawIframe = m[1].trim();
    if (!rawIframe || /^javascript:/i.test(rawIframe) || /^about:/i.test(rawIframe)) continue;
    const unwrappedIframe = unwrapNestedPlayerUrl(rawIframe, baseOrigin);
    if (isDirectMediaUrl(unwrappedIframe)) {
      return unwrappedIframe;
    }
    const iframeUrl = normalizeUrl(rawIframe, baseOrigin);
    const iframeRes = await fetchHtml(iframeUrl, { headers: { Referer: pageUrl } });
    if (iframeRes.ok) {
      const iframeStream = extractStreamSyncFromHtml(iframeRes.body, iframeRes.url);
      if (iframeStream) return iframeStream;
    }
  }

  // Stage 6: Discover alternative play routes on page (e.g. /dm/play/id-xxx or /vodplay/xxx-2-1.html)
  const altRouteRegex = /href=['"]([^'"]*(?:\/dm\/play\/id-\d+|\/t\/\d+|sid\/\d+\/nid\/\d+|vodplay\/[^'"]+)[^'"]*)['"]/gi;
  const visited = new Set([pageUrl]);
  while ((m = altRouteRegex.exec(html)) !== null) {
    const altUrl = normalizeUrl(m[1], baseOrigin);
    if (visited.has(altUrl)) continue;
    visited.add(altUrl);
    if (visited.size > 4) break;
    const altRes = await fetchHtml(altUrl, { headers: { Referer: pageUrl } });
    if (altRes.ok) {
      const altStream = extractStreamSyncFromHtml(altRes.body, altRes.url);
      if (altStream) return altStream;
    }
  }

  return '';
}

function buildDetailPathFromId(vodId) {
  const raw = String(vodId || '1').trim();
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
    return raw;
  }
  if (raw.startsWith('dm_')) {
    const realId = raw.replace(/^dm_/, '');
    return `/dm/play/id-${realId}`;
  }
  return `/t/${raw}`;
}

function sanitizeEpisodeId(rawId) {
  let s = String(rawId || '').trim();
  if (!s) return '';

  // Strip custom metadata suffix @@@
  if (s.includes('@@@')) {
    s = s.split('@@@')[0].trim();
  }

  // Strip leading episode label like "正片$https://..." or "01$..."
  if (s.includes('$')) {
    const dollarIdx = s.indexOf('$');
    const prefix = s.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      s = s.slice(dollarIdx + 1).trim();
    }
  }

  return s;
}

async function home(inReq) {
  let homeList = [];
  try {
    const { path, isDm } = buildCategoryPath(CATEGORIES[0].type_id, 1);
    const res = await fetchHtml(path);
    if (res.ok) {
      homeList = isDm
        ? parseDmCards(res.body, activeDomain)
        : parseStandardCards(res.body, activeDomain);
    }
  } catch {
    homeList = [];
  }

  return {
    class: CATEGORIES,
    filters: {},
    list: homeList,
    style: CARD_STYLE,
  };
}

async function category(inReq) {
  const params = unwrapRequestParams(inReq);
  const tid = params.id ?? params.tid ?? params.type_id ?? 'porn_hot';
  const pg = params.page ?? params.pg ?? 1;

  const { path, isDm, page } = buildCategoryPath(tid, pg);
  const res = await fetchHtml(path);

  let vodList = [];
  if (res.ok) {
    let origin = activeDomain;
    try {
      origin = new URL(res.url).origin;
    } catch {
      origin = activeDomain;
    }
    vodList = isDm
      ? parseDmCards(res.body, origin)
      : parseStandardCards(res.body, origin);
  }

  return {
    page,
    pagecount: vodList.length >= 10 ? page + 1 : page,
    limit: 20,
    total: 9999,
    list: vodList,
    style: CARD_STYLE,
  };
}

async function detail(inReq) {
  const params = unwrapRequestParams(inReq);
  let rawId = params.id ?? params.ids ?? params.vod_id ?? params.url ?? '1';
  if (Array.isArray(rawId)) {
    rawId = rawId[0] ?? '1';
  }
  const vodId = String(rawId).trim();
  const targetPath = buildDetailPathFromId(vodId);

  const res = await fetchHtml(targetPath);
  const body = res.ok ? res.body : '';
  let origin = activeDomain;
  try {
    if (res.url) origin = new URL(res.url).origin;
  } catch {
    origin = activeDomain;
  }

  let title = `视频 ${vodId}`;
  const tMatch = body.match(/<title>([\s\S]*?)<\/title>/i);
  if (tMatch && tMatch[1]) {
    const cleanedTitle = unescapeHtml(tMatch[1].replace(/[\r\n\t]+/g, ' ').trim());
    if (cleanedTitle) title = cleanedTitle;
  }

  let pic = '';
  const posterMatch = body.match(/poster=['"]([^'"]+)['"]/i);
  if (posterMatch) {
    pic = posterMatch[1].trim();
  }
  if (!pic) {
    const echoMatch = body.match(/data-echo=['"]([^'"]+)['"]/i);
    if (echoMatch) {
      pic = echoMatch[1].trim();
    }
  }
  if (pic.startsWith('/')) {
    pic = `${origin.replace(/\/+$/, '')}${pic}`;
  }

  const pageUrl = res.url || normalizeUrl(targetPath, origin);
  const resolvedStream = body ? await resolvePlayStreamFromPage(body, pageUrl) : '';

  const playTarget = resolvedStream || pageUrl;
  if (resolvedStream) {
    setPlayCache(vodId, resolvedStream);
    setPlayCache(pageUrl, resolvedStream);
    setPlayCache(targetPath, resolvedStream);
  }

  const vod = {
    vod_id: vodId,
    vod_name: title,
    vod_pic: pic,
    vod_remarks: '蝴蝶影视',
    vod_actor: '🦋 TG群: @tvshare23',
    vod_director: '🦋 蝴蝶影视',
    vod_content: '🦋 官方交流群: @tvshare23\n本资源来自网络聚合，仅供交流学习使用。',
    vod_play_from: 'BadNews',
    vod_play_url: `正片$${playTarget}`,
  };

  return { list: [vod] };
}

async function search(inReq) {
  const params = unwrapRequestParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pgRaw = params.page ?? params.pg ?? 1;
  const page = Number.isFinite(Number(pgRaw)) && Number(pgRaw) > 0 ? Math.floor(Number(pgRaw)) : 1;

  if (!key) {
    return {
      page: 1,
      pagecount: 1,
      limit: 20,
      total: 0,
      list: [],
    };
  }

  const qEnc = encodeURIComponent(key);
  const path =
    page > 1
      ? `/search/q-${qEnc}/type-porn/page-${page}`
      : `/search/q-${qEnc}/type-porn`;

  const res = await fetchHtml(path);
  let vodList = [];
  if (res.ok) {
    let origin = activeDomain;
    try {
      origin = new URL(res.url).origin;
    } catch {
      origin = activeDomain;
    }
    vodList = parseStandardCards(res.body, origin);
    if (vodList.length === 0 && /<article\b/i.test(res.body)) {
      vodList = parseDmCards(res.body, origin);
    }
  }

  return {
    page,
    pagecount: vodList.length >= 10 ? page + 1 : page,
    limit: 20,
    total: 9999,
    list: vodList,
  };
}

async function play(inReq) {
  const params = unwrapRequestParams(inReq);
  const rawInput = params.id ?? params.url ?? params.playUrl ?? '';
  const cleanedId = sanitizeEpisodeId(rawInput);

  if (!cleanedId) {
    const headers = buildPlayHeaders('', activeDomain);
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: '',
      header: headers,
      headers,
    };
  }

  // 1. Check PLAY_CACHE first
  const cached = getPlayCache(cleanedId);
  if (cached && isDirectMediaUrl(cached)) {
    const headers = buildPlayHeaders(cached, activeDomain);
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: cached,
      header: headers,
      headers,
    };
  }

  // 2. Unwrap if it's a wrapper player URL (?url=https%3A%2F%2F...m3u8) or direct media stream
  const unwrapped = unwrapNestedPlayerUrl(cleanedId, activeDomain);
  if (isDirectMediaUrl(unwrapped)) {
    const headers = buildPlayHeaders(unwrapped, activeDomain);
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: unwrapped,
      header: headers,
      headers,
    };
  }

  // 3. Otherwise treat as detail/play page URL or video ID and fetch to extract stream
  const targetPath = buildDetailPathFromId(cleanedId);
  const res = await fetchHtml(targetPath);
  if (res.ok && res.body) {
    const resolved = await resolvePlayStreamFromPage(res.body, res.url);
    if (resolved && isDirectMediaUrl(resolved)) {
      setPlayCache(cleanedId, resolved);
      setPlayCache(res.url, resolved);
      const headers = buildPlayHeaders(resolved, activeDomain);
      return {
        parse: 0,
        jx: 0,
        playUrl: '',
        url: resolved,
        header: headers,
        headers,
      };
    }
  }

  // 4. Fallback to client sniffing if page had no extractable direct stream
  const fallbackUrl = normalizeUrl(targetPath, activeDomain);
  const headers = buildPlayHeaders(fallbackUrl, activeDomain);
  return {
    parse: 1,
    jx: 0,
    playUrl: '',
    url: fallbackUrl,
    header: headers,
    headers,
  };
}

async function proxyPicHandler(query = {}) {
  const rawUrl = query.url || query.pic || '';
  const targetUrl = normalizeUrl(rawUrl, activeDomain);
  if (!targetUrl) {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
  try {
    const headers = buildHeaders(targetUrl);
    const resp = await req.get(targetUrl, {
      headers,
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const contentType =
      resp?.headers?.['content-type'] ||
      resp?.headers?.['Content-Type'] ||
      'image/jpeg';
    const rawData = resp?.data ?? resp?.body ?? Buffer.alloc(0);
    const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
    return { mime: contentType, data };
  } catch {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'badnews',
    name: 'BadNews',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/badnews_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};