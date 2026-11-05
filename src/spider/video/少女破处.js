import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const DEFAULT_DOMAINS = [
  'https://83w43wdlty.md-md22.top',
];

let activeDomain = DEFAULT_DOMAINS[0];

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const FALLBACK_CLASSES = [
  { type_id: '1', type_name: '少女自拍' },
  { type_id: '2', type_name: '国产乱伦' },
  { type_id: '3', type_name: '人妻熟女' },
  { type_id: '4', type_name: '探花偷拍' },
  { type_id: '5', type_name: '制服丝袜' },
  { type_id: '6', type_name: '巨乳美胸' },
  { type_id: '7', type_name: '主播直播' },
  { type_id: '8', type_name: '无码中字' },
  { type_id: '9', type_name: '欧美高清' },
  { type_id: '10', type_name: '三级伦理' },
  { type_id: '11', type_name: '成人动漫' },
  { type_id: '12', type_name: '麻豆传媒' },
  { type_id: '13', type_name: '天美传媒' },
  { type_id: '14', type_name: '蜜桃传媒' },
  { type_id: '15', type_name: '精东影业' },
  { type_id: '16', type_name: '皇家华人' },
  { type_id: '17', type_name: '星空传媒' },
  { type_id: '18', type_name: '乐播传媒' },
  { type_id: '19', type_name: '乌鸦传媒' },
  { type_id: '20', type_name: '大象传媒' },
];

const PLAY_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

function setPlayCache(key, value) {
  if (!key || !value) return;
  PLAY_CACHE.set(String(key), { value, ts: Date.now() });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return entry.value;
}

function getDefaultHeaders(referer) {
  return {
    'User-Agent': UA,
    Referer: referer || `${activeDomain}/`,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

function resolveUrl(u, base = activeDomain) {
  if (!u) return '';
  const trimmed = String(u).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const cleanBase = (base || activeDomain).replace(/\/+$/, '');
  if (trimmed.startsWith('/')) return `${cleanBase}${trimmed}`;
  return `${cleanBase}/${trimmed}`;
}

function getOriginFromUrl(u, fallback = activeDomain) {
  try {
    return new URL(u).origin;
  } catch {
    return fallback;
  }
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
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodePercentUnicode(str) {
  if (!str) return '';
  const step1 = String(str).replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  try {
    return decodeURIComponent(step1);
  } catch {
    return step1.replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
}

function decodeHtmlWords(html) {
  if (!html) return '';
  const m = html.match(/var\s+Words\s*=\s*["']([^"']+)["']/);
  if (!m) return html;
  return decodePercentUnicode(m[1]);
}

function decodeBufferToText(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch {
      // ignore gunzip error
    }
  }
  const utf8 = raw.toString('utf8');
  if (utf8.includes('\ufffd')) {
    try {
      const dec = new TextDecoder('gbk');
      return dec.decode(raw);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

async function fetchHtml(urlOrPath, customHeaders = {}) {
  const candidates = [];
  if (/^https?:\/\//i.test(urlOrPath)) {
    candidates.push(urlOrPath);
  } else {
    const domains = [
      activeDomain,
      ...DEFAULT_DOMAINS.filter((d) => d !== activeDomain),
    ];
    for (const d of domains) {
      candidates.push(resolveUrl(urlOrPath, d));
    }
  }

  for (const targetUrl of candidates) {
    const origin = getOriginFromUrl(targetUrl, activeDomain);
    const headers = {
      ...getDefaultHeaders(`${origin}/`),
      ...customHeaders,
    };
    if (customHeaders.Referer) {
      try {
        const refUrl = new URL(customHeaders.Referer);
        const targetOrigin = new URL(targetUrl).origin;
        if (refUrl.origin !== targetOrigin && DEFAULT_DOMAINS.includes(refUrl.origin)) {
          headers.Referer = customHeaders.Referer.replace(refUrl.origin, targetOrigin);
        }
      } catch {
        // keep custom Referer
      }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await req.get(targetUrl, {
          headers,
          timeout: 8000,
          responseType: 'arraybuffer',
        });
        const data = resp && resp.data !== undefined ? resp.data : resp;
        const text = decodeBufferToText(data);
        if (text && text.trim()) {
          if (DEFAULT_DOMAINS.includes(origin)) {
            activeDomain = origin;
          }
          return decodeHtmlWords(text);
        }
      } catch {
        // try fallback or next attempt
      }
    }
  }
  return '';
}

function parseParams(inReq) {
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

function parseCards(html, baseDomain = activeDomain) {
  if (!html) return [];
  const list = [];
  const seen = new Set();

  const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = articleRegex.exec(html)) !== null) {
    const block = m[1];
    const um = block.match(/href=["'](\/detail\/\?\d+\.html)["']/i);
    if (!um) continue;
    const vidMatch = um[1].match(/\?(\d+)\.html/);
    if (!vidMatch) continue;
    const vid = vidMatch[1];
    if (seen.has(vid)) continue;

    let nm = block.match(/<cite[^>]*>([^<]+)<\/cite>/i);
    if (!nm) {
      nm = block.match(/alt=["']([^"']+)["']/i) || block.match(/title=["']([^"']+)["']/i);
    }
    const name = nm ? unescapeHtml(nm[1].trim()) : '';
    if (!name) continue;

    seen.add(vid);

    const pm =
      block.match(/data-src=["']([^"']+)["']/i) ||
      block.match(/data-original=["']([^"']+)["']/i) ||
      block.match(/<img[^>]*src=["']([^"']+)["']/i);
    const pic = pm ? resolveUrl(pm[1], baseDomain) : '';

    const durMatch = block.match(
      /<span[^>]*class=["'][^"']*(?:duration|time|tag)[^"']*["'][^>]*>([^<]+)<\/span>/i
    );
    const durText = durMatch && durMatch[1].trim() ? durMatch[1].trim() : '';
    const remarks = durText ? `蝴蝶影视 | ${durText}` : '蝴蝶影视 | 高清';

    list.push({
      vod_id: String(vid),
      vod_name: name,
      vod_pic: pic,
      vod_remarks: remarks,
      style: CARD_STYLE,
    });
  }

  return list;
}

function extractCategories(html) {
  const cats = [];
  const seen = new Set();
  if (html) {
    const re = /href=["'](\/list\/\?(\d+)\.html)["'][^>]*>([^<]{1,12})<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const cid = String(m[2]);
      const name = unescapeHtml(m[3].trim());
      if (!name || seen.has(cid) || name.includes('更多')) continue;
      seen.add(cid);
      cats.push({ type_id: cid, type_name: name });
    }
  }
  if (cats.length === 0) {
    return FALLBACK_CLASSES.map((c) => ({ ...c }));
  }
  return cats;
}

function extractBalancedJson(html, varName) {
  if (!html || !varName) return null;
  const pattern = new RegExp(`(?:var|let|const|window\\.)?\\s*${varName}\\s*=\\s*`, 'g');
  let match;
  while ((match = pattern.exec(html)) !== null) {
    let idx = match.index + match[0].length;
    while (idx < html.length && /\s/.test(html[idx])) idx++;
    if (html[idx] !== '{') continue;

    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;
    const start = idx;

    for (let i = start; i < html.length; i++) {
      const ch = html[i];
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
            const rawObj = html.slice(start, i + 1);
            try {
              return JSON.parse(rawObj);
            } catch {
              try {
                const normalized = rawObj
                  .replace(/,\s*([}\]])/g, '$1')
                  .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => {
                    return `"${inner.replace(/"/g, '\\"')}"`;
                  });
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

function decodeCmsUrl(rawUrl, encrypt = 0) {
  if (!rawUrl) return '';
  let u = String(rawUrl).trim();
  const enc = Number(encrypt) || 0;

  try {
    if (enc === 1) {
      u = decodePercentUnicode(u);
    } else if (enc === 2) {
      const unquotedInput = decodePercentUnicode(u);
      const decodedB64 = Buffer.from(unquotedInput, 'base64').toString('utf8');
      u = decodePercentUnicode(decodedB64);
    }
  } catch {
    // fallback to raw
  }

  u = u
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .trim();

  return unwrapNestedPlayerUrl(u);
}

function isDirectMediaPath(urlStr) {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr, activeDomain);
    return /\.(?:m3u8|mp4|flv|ts|mpd)$/i.test(parsed.pathname);
  } catch {
    const clean = String(urlStr).split('?')[0].split('#')[0];
    return /\.(?:m3u8|mp4|flv|ts|mpd)$/i.test(clean);
  }
}

function unwrapNestedPlayerUrl(urlStr) {
  if (!urlStr) return '';
  const trimmed = String(urlStr).trim();
  if (isDirectMediaPath(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed, activeDomain);
    const paramNames = ['url', 'v', 'vid', 'src', 'play', 'm3u8', 'file'];
    for (const key of paramNames) {
      const val = parsed.searchParams.get(key);
      if (val) {
        const decoded = decodePercentUnicode(val).replace(/\\\//g, '/').trim();
        if (/^https?:\/\//i.test(decoded) || /\.(?:m3u8|mp4)/i.test(decoded)) {
          return unwrapNestedPlayerUrl(decoded);
        }
      }
    }
    for (const [, val] of parsed.searchParams.entries()) {
      const decoded = decodePercentUnicode(val).replace(/\\\//g, '/').trim();
      if (/^https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)/i.test(decoded)) {
        return unwrapNestedPlayerUrl(decoded);
      }
    }
  } catch {
    // ignore URL parse failure
  }
  return trimmed;
}

function unpackPackerBlocks(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const results = [];
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  const encodeBase = (num, radix) => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (num === 0) return '0';
    let out = '';
    let n = num;
    while (n > 0) {
      out = chars[n % radix] + out;
      n = Math.floor(n / radix);
    }
    return out;
  };

  let m;
  while ((m = regex.exec(html)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const symtab = m[6].split('|');
    if (!radix || !count) continue;

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const token = radix <= 36 ? i.toString(radix) : encodeBase(i, radix);
      dict.set(token, symtab[i] || token);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    results.push(unpacked);
  }
  return results;
}

function decodeObfuscatedDictJs(html) {
  if (!html) return '';
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRegex.exec(html)) !== null) {
    const s = sm[1].trim();
    if (s.length < 50 || !s.includes('var b=')) continue;
    const dictMatch = s.match(/var\s+b\s*=\s*(\{[\s\S]*?\});/);
    if (!dictMatch) continue;

    const mp = new Map();
    const pairRegex = /(?:"([^"]+)"|([A-Za-z0-9_]+))\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let pm;
    while ((pm = pairRegex.exec(dictMatch[1])) !== null) {
      const key = pm[1] || pm[2];
      const val = pm[3];
      mp.set(key, val);
    }

    const encMatch = s.match(/var\s+b\s*=\s*a\(`([^`]+)`/);
    if (!encMatch) continue;

    let decoded = '';
    for (const ch of encMatch[1]) {
      decoded += mp.has(ch) ? mp.get(ch) : ch;
    }
    const normalized = decoded.replace(/\\\//g, '/');
    const urlMatch = normalized.match(/https?:\/\/[^\s"'<>]+?\.(?:m3u8|mp4)[^\s"'<>]*/i);
    if (urlMatch) {
      return unwrapNestedPlayerUrl(urlMatch[0]);
    }
  }
  return '';
}

function extractStreamFromText(html, baseDomain = activeDomain) {
  if (!html) return { mediaUrl: '', iframeUrl: '' };

  // Stage 1: Player JSON objects (player_aaaa, player_data, player_config)
  for (const varName of ['player_aaaa', 'player_data', 'player_config']) {
    const data = extractBalancedJson(html, varName);
    if (data && data.url) {
      const decoded = decodeCmsUrl(data.url, data.encrypt);
      if (decoded) {
        const abs = resolveUrl(decoded, baseDomain);
        if (isDirectMediaPath(abs) || /^https?:\/\//i.test(abs)) {
          return { mediaUrl: abs, iframeUrl: '' };
        }
      }
    }
  }

  // Stage 2: MacPlayer.PlayUrl and dp_video_url
  const macMatch = html.match(/MacPlayer\.PlayUrl\s*=\s*["']([^"']+)["']/i);
  if (macMatch && macMatch[1].trim()) {
    const u = decodeCmsUrl(macMatch[1].trim(), 0);
    if (u) return { mediaUrl: resolveUrl(u, baseDomain), iframeUrl: '' };
  }

  const dpMatch = html.match(/var\s+dp_video_url\s*=\s*["']([^"']+)["']/i);
  if (dpMatch && dpMatch[1].trim()) {
    const rawDp = dpMatch[1].trim();
    if (/^https?:\/\//i.test(rawDp) || rawDp.startsWith('/')) {
      return { mediaUrl: resolveUrl(unwrapNestedPlayerUrl(rawDp), baseDomain), iframeUrl: '' };
    }
    try {
      const b64Decoded = Buffer.from(rawDp, 'base64').toString('utf8').trim();
      if (b64Decoded) {
        return {
          mediaUrl: resolveUrl(unwrapNestedPlayerUrl(b64Decoded), baseDomain),
          iframeUrl: '',
        };
      }
    } catch {
      // ignore base64 error
    }
  }

  // Stage 3: Custom obfuscated dictionary JS (`var b={...}; var b=a(\`...\`)`)
  const obfUrl = decodeObfuscatedDictJs(html);
  if (obfUrl) {
    return { mediaUrl: resolveUrl(obfUrl, baseDomain), iframeUrl: '' };
  }

  // Stage 4: Packed JS (`eval(function(p,a,c,k,e,d)...)`)
  const unpackedBlocks = unpackPackerBlocks(html);
  for (const block of unpackedBlocks) {
    for (const varName of ['player_aaaa', 'player_data', 'player_config']) {
      const data = extractBalancedJson(block, varName);
      if (data && data.url) {
        const decoded = decodeCmsUrl(data.url, data.encrypt);
        if (decoded) {
          return { mediaUrl: resolveUrl(decoded, baseDomain), iframeUrl: '' };
        }
      }
    }
    const cleanBlock = block.replace(/\\\//g, '/');
    const packedMedia = cleanBlock.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)[^\s"'<>\\]*/i);
    if (packedMedia) {
      return { mediaUrl: unwrapNestedPlayerUrl(packedMedia[0]), iframeUrl: '' };
    }
  }

  // Stage 5: Unescape `\/` to `/` and scan JSON `"url": "..."` or direct `.m3u8` / `.mp4`
  const jsonUrlRegex = /"url"\s*:\s*"([^"]+)"/gi;
  let jm;
  while ((jm = jsonUrlRegex.exec(html)) !== null) {
    const u = jm[1].replace(/\\\//g, '/').replace(/\\/g, '').trim();
    const unwrapped = unwrapNestedPlayerUrl(u);
    if (/\.(?:m3u8|mp4)(\?|$)/i.test(unwrapped) && /^https?:\/\//i.test(unwrapped)) {
      return { mediaUrl: unwrapped, iframeUrl: '' };
    }
  }

  const normalizedHtml = html.replace(/\\\//g, '/');
  const directRegex = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let dm;
  while ((dm = directRegex.exec(normalizedHtml)) !== null) {
    const candidate = unwrapNestedPlayerUrl(dm[0]);
    if (isDirectMediaPath(candidate)) {
      return { mediaUrl: candidate, iframeUrl: '' };
    }
  }

  // Stage 6: Check `<iframe src="...">`
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
  let im;
  while ((im = iframeRegex.exec(html)) !== null) {
    const src = im[1].trim();
    if (!src || /^javascript:/i.test(src) || src === 'about:blank') continue;
    const absSrc = resolveUrl(src, baseDomain);
    const unwrapped = unwrapNestedPlayerUrl(absSrc);
    if (unwrapped !== absSrc && isDirectMediaPath(unwrapped)) {
      return { mediaUrl: unwrapped, iframeUrl: '' };
    }
    return { mediaUrl: '', iframeUrl: absSrc };
  }

  return { mediaUrl: '', iframeUrl: '' };
}

async function resolvePlayStream(playUrlOrId) {
  const input = String(playUrlOrId || '').trim();
  if (!input) return { url: '', referer: `${activeDomain}/`, direct: false };

  const cached = getPlayCache(input);
  if (cached) {
    return { url: cached, referer: `${activeDomain}/`, direct: true };
  }

  if (isDirectMediaPath(input) && /^https?:\/\//i.test(input)) {
    return { url: input, referer: `${activeDomain}/`, direct: true };
  }

  const unwrappedInput = unwrapNestedPlayerUrl(input);
  if (unwrappedInput !== input && isDirectMediaPath(unwrappedInput)) {
    return { url: unwrappedInput, referer: `${activeDomain}/`, direct: true };
  }

  let playPageUrl = input;
  let vid = '';
  if (/^\d+$/.test(input)) {
    vid = input;
    const cachedByVid = getPlayCache(vid);
    if (cachedByVid) {
      return { url: cachedByVid, referer: `${activeDomain}/`, direct: true };
    }
    playPageUrl = `${activeDomain}/video/?${vid}-0-0.html`;
  } else {
    playPageUrl = resolveUrl(input, activeDomain);
    const vidMatch =
      playPageUrl.match(/\/(?:video|play|detail)\/\?(\d+)/i) ||
      playPageUrl.match(/\/id\/(\d+)/i);
    if (vidMatch) {
      vid = vidMatch[1];
      const cachedByVid = getPlayCache(vid);
      if (cachedByVid) {
        return { url: cachedByVid, referer: playPageUrl, direct: true };
      }
    }
  }

  const baseOrigin = getOriginFromUrl(playPageUrl, activeDomain);
  const html = await fetchHtml(playPageUrl, { Referer: `${baseOrigin}/` });
  if (html) {
    const { mediaUrl, iframeUrl } = extractStreamFromText(html, baseOrigin);
    if (mediaUrl) {
      setPlayCache(input, mediaUrl);
      if (vid) setPlayCache(vid, mediaUrl);
      return { url: mediaUrl, referer: playPageUrl, direct: true };
    }

    if (iframeUrl) {
      const iframeOrigin = getOriginFromUrl(iframeUrl, baseOrigin);
      const iframeHtml = await fetchHtml(iframeUrl, { Referer: playPageUrl });
      if (iframeHtml) {
        const nested = extractStreamFromText(iframeHtml, iframeOrigin);
        if (nested.mediaUrl) {
          setPlayCache(input, nested.mediaUrl);
          if (vid) setPlayCache(vid, nested.mediaUrl);
          return { url: nested.mediaUrl, referer: iframeUrl, direct: true };
        }
      }
      return { url: iframeUrl, referer: playPageUrl, direct: false };
    }
  }

  // Stage 5: Alternative play route discovery via detail page or alternate route patterns
  const altUrls = [];
  if (vid) {
    const detailUrl = `${baseOrigin}/detail/?${vid}.html`;
    const detailHtml = await fetchHtml(detailUrl, { Referer: `${baseOrigin}/` });
    if (detailHtml) {
      const directInDetail = extractStreamFromText(detailHtml, baseOrigin);
      if (directInDetail.mediaUrl) {
        setPlayCache(input, directInDetail.mediaUrl);
        setPlayCache(vid, directInDetail.mediaUrl);
        return { url: directInDetail.mediaUrl, referer: detailUrl, direct: true };
      }
      const linkRegex = /<a[^>]+href=["'](\/play\/\?[^"']+|\/video\/\?[^"']+)["']/gi;
      let lm;
      while ((lm = linkRegex.exec(detailHtml)) !== null) {
        const candidateUrl = resolveUrl(lm[1], baseOrigin);
        if (candidateUrl !== playPageUrl && !altUrls.includes(candidateUrl)) {
          altUrls.push(candidateUrl);
        }
      }
    }
    for (const pattern of [
      `${baseOrigin}/play/?${vid}-0-0.html`,
      `${baseOrigin}/play/?${vid}-1-1.html`,
      `${baseOrigin}/video/?${vid}-0-0.html`,
      `${baseOrigin}/video/?${vid}-1-1.html`,
    ]) {
      if (pattern !== playPageUrl && !altUrls.includes(pattern)) {
        altUrls.push(pattern);
      }
    }
  } else if (/sid\/1\/nid\/1/i.test(playPageUrl)) {
    altUrls.push(playPageUrl.replace(/sid\/1\/nid\/1/i, 'sid/2/nid/1'));
  }

  for (const altUrl of altUrls) {
    const altHtml = await fetchHtml(altUrl, { Referer: playPageUrl });
    if (!altHtml) continue;
    const { mediaUrl, iframeUrl } = extractStreamFromText(altHtml, baseOrigin);
    if (mediaUrl) {
      setPlayCache(input, mediaUrl);
      if (vid) setPlayCache(vid, mediaUrl);
      return { url: mediaUrl, referer: altUrl, direct: true };
    }
    if (iframeUrl) {
      const iframeOrigin = getOriginFromUrl(iframeUrl, baseOrigin);
      const iframeHtml = await fetchHtml(iframeUrl, { Referer: altUrl });
      if (iframeHtml) {
        const nested = extractStreamFromText(iframeHtml, iframeOrigin);
        if (nested.mediaUrl) {
          setPlayCache(input, nested.mediaUrl);
          if (vid) setPlayCache(vid, nested.mediaUrl);
          return { url: nested.mediaUrl, referer: iframeUrl, direct: true };
        }
      }
    }
  }

  return { url: playPageUrl, referer: `${baseOrigin}/`, direct: false };
}

async function home() {
  const html = await fetchHtml('/');
  const classes = extractCategories(html);
  let list = parseCards(html, activeDomain);
  if (list.length === 0 && classes.length > 0) {
    const firstCatHtml = await fetchHtml(`/list/?${classes[0].type_id}.html`);
    list = parseCards(firstCatHtml, activeDomain);
  }
  return {
    class: classes,
    filters: {},
    list,
    style: CARD_STYLE,
  };
}

async function category(inReq) {
  const params = parseParams(inReq);
  const tid = String(params.id || params.tid || params.type_id || '1').trim();
  const pgRaw = parseInt(params.page || params.pg || '1', 10);
  const page = Number.isFinite(pgRaw) && pgRaw > 0 ? pgRaw : 1;

  const path = page <= 1 ? `/list/?${tid}.html` : `/list/?${tid}-${page}.html`;
  const html = await fetchHtml(path);
  const list = parseCards(html, activeDomain);

  return {
    list,
    page,
    pagecount: list.length >= 12 ? page + 1 : page,
    limit: 20,
    total: list.length > 0 ? 9999 : 0,
    style: CARD_STYLE,
  };
}

async function detail(inReq) {
  const params = parseParams(inReq);
  const rawId =
    params.id ||
    (Array.isArray(params.ids) ? params.ids[0] : params.ids) ||
    params.url ||
    '';
  const idStr = String(rawId).trim();
  if (!idStr) return { list: [] };

  let vid = idStr;
  let detailUrl = `${activeDomain}/detail/?${vid}.html`;
  if (/^https?:\/\//i.test(idStr) || idStr.startsWith('/')) {
    detailUrl = resolveUrl(idStr, activeDomain);
    const m = detailUrl.match(/\?(\d+)\.html/);
    if (m) vid = m[1];
  }

  const html = await fetchHtml(detailUrl);
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const name = titleMatch
    ? unescapeHtml(titleMatch[1].trim()).slice(0, 60)
    : `视频 ${vid}`;

  const picMatch =
    html.match(/data-src=["']([^"']+)["']/i) ||
    html.match(/data-original=["']([^"']+)["']/i) ||
    html.match(/<img[^>]*src=["']([^"']+)["']/i);
  const pic = picMatch ? resolveUrl(picMatch[1], activeDomain) : '';

  // Pre-warm PLAY_CACHE if the detail page itself embeds the stream
  const preExtracted = extractStreamFromText(html, activeDomain);
  if (preExtracted.mediaUrl) {
    setPlayCache(vid, preExtracted.mediaUrl);
    setPlayCache(detailUrl, preExtracted.mediaUrl);
  }

  const episodes = [];
  const playRegex =
    /<a[^>]+href=["'](\/play\/\?[^"']+|\/video\/\?[^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let pm;
  while ((pm = playRegex.exec(html)) !== null) {
    const purl = resolveUrl(pm[1], activeDomain);
    const ptitle = unescapeHtml(pm[2].trim()) || '正片';
    episodes.push(`${ptitle}$${purl}`);
    if (preExtracted.mediaUrl) {
      setPlayCache(purl, preExtracted.mediaUrl);
    }
  }

  if (episodes.length === 0) {
    const singleMatch = html.match(
      /<a[^>]+href=["'](\/play\/\?[^"']+|\/video\/\?[^"']+)["']/i
    );
    if (singleMatch) {
      const purl = resolveUrl(singleMatch[1], activeDomain);
      episodes.push(`高清正片$${purl}`);
      if (preExtracted.mediaUrl) {
        setPlayCache(purl, preExtracted.mediaUrl);
      }
    } else {
      const fallbackPlayUrl = `${activeDomain}/video/?${vid}-0-0.html`;
      episodes.push(`高清正片$${fallbackPlayUrl}`);
      if (preExtracted.mediaUrl) {
        setPlayCache(fallbackPlayUrl, preExtracted.mediaUrl);
      }
    }
  }

  const vod = {
    vod_id: String(vid),
    vod_name: name,
    vod_pic: pic,
    type_name: '蝴蝶专区',
    vod_year: '2026',
    vod_area: '华语',
    vod_remarks: '蝴蝶影视 | 高清原画',
    vod_actor: '🦋 TG群: @tvshare23',
    vod_director: '🦋 蝴蝶影视',
    vod_content:
      '🦋 蝴蝶影视 | TG群: @tvshare23\n蝴蝶影视官方正版资源，关注TG群获取最新动态与防失联地址。',
    vod_play_from: '蝴蝶秒播云',
    vod_play_url: episodes.join('#'),
  };

  return { list: [vod] };
}

async function search(inReq) {
  const params = parseParams(inReq);
  const wd = String(params.wd || params.key || params.keyword || '').trim();
  const pgRaw = parseInt(params.page || params.pg || '1', 10);
  const page = Number.isFinite(pgRaw) && pgRaw > 0 ? pgRaw : 1;
  if (!wd) return { list: [], page: 1, pagecount: 1 };

  const searchPath = `/search.php?searchword=${encodeURIComponent(wd)}${
    page > 1 ? `&page=${page}` : ''
  }`;
  const html = await fetchHtml(searchPath);
  const list = parseCards(html, activeDomain);

  return {
    list,
    page,
    pagecount: list.length >= 12 ? page + 1 : page,
    style: CARD_STYLE,
  };
}

async function play(inReq) {
  const params = parseParams(inReq);
  const rawId = params.id || params.url || params.playUrl || '';
  const resolved = await resolvePlayStream(rawId);

  const playHeaders = {
    'User-Agent': UA,
    Referer: resolved.referer || `${activeDomain}/`,
  };

  if (resolved.direct && resolved.url) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: resolved.url,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  return {
    parse: 1,
    jx: 0,
    playUrl: '',
    url: resolved.url || String(rawId),
    header: playHeaders,
    headers: playHeaders,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = query.url || query.pic || '';
  if (!picUrl) {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
  const target = resolveUrl(picUrl, activeDomain);
  try {
    const resp = await req.get(target, {
      headers: getDefaultHeaders(`${getOriginFromUrl(target, activeDomain)}/`),
      timeout: 8000,
      responseType: 'arraybuffer',
    });
    const raw = resp && resp.data !== undefined ? resp.data : resp;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
    const mime =
      (resp && resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) ||
      (target.endsWith('.png') ? 'image/png' : target.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    return { mime, data: buf };
  } catch {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'shaonvpochu',
    name: '少女破处',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/shaonvpochu_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};