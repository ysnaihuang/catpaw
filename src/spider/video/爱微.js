import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://bav52.cc',
  'https://bav53.cc',
  'https://bav62.cc',
  'https://avjb.com',
];

let activeDomain = SITE_DOMAINS[0];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const CATEGORIES = [
  { type_id: 'new', type_name: '最新' },
  { type_id: 'f238838498ffcbbb9dec54cff3d68e1f', type_name: '福利姬' },
  { type_id: 'c8ed8a54e38ed0c5276281131a5a128e', type_name: '网红' },
  { type_id: 'd28b92e24cc1d6cb1e5e44c32f2c53bb', type_name: '制服' },
  { type_id: '79981faea06a7ee7c0f04fb66bb54663', type_name: '丝袜' },
  { type_id: 'db7ad71b1af7e9f5a07a18aa1dc0daf0', type_name: '御姐' },
  { type_id: '8abae1aec219fe06cf74b24338093e74', type_name: '高颜值' },
  { type_id: 'a686a94189bca9341082307e1ce07663', type_name: '美女' },
  { type_id: '9b39cf7137c40ff936512e0f34f7f472', type_name: '尤物' },
  { type_id: '239c00a652ca5330d6aaa4b49c2d724d', type_name: '极品' },
  { type_id: '9a0cd4bae997e3e887e537453eac235c', type_name: '姐姐' },
  { type_id: 'b7d9f81d20aa9e44d1c129b9ba335fc4', type_name: '成熟的女人' },
  { type_id: 'd5dda49a594b691685feaadb9d7d1352', type_name: '已婚女人' },
  { type_id: '32b531f1c1664ce095f938ed30543827', type_name: '已婚妇女' },
  { type_id: 'e69d1bdaa72210b0c599fdcaab0bf2cd', type_name: '性感' },
  { type_id: '409463c53c9018e77e4293fef31cf4ab', type_name: '私拍' },
  { type_id: '920ff7821a4fb5775a40a8aace6fdfcb', type_name: '裸舞' },
  { type_id: '542e1afd76c7ea706511ef5f7ebf80fe', type_name: '调教' },
  { type_id: 'ed33a738add85dea56df71cffc7be030', type_name: '高潮' },
  { type_id: '5c8163bf649cc7e5e4959f597f152755', type_name: '自慰' },
  { type_id: 'ae5655f7352b5ce0e7a161307a5c1b35', type_name: '口交' },
  { type_id: 'b33fb20acf363e469e8ed78c09a9098c', type_name: '中出' },
  { type_id: 'a4814e695b2ecfc35571261b8ef61d22', type_name: '内射' },
  { type_id: 'acb2fff953a2fc113feb9291acf42f1a', type_name: '啪啪' },
  { type_id: '978b25a74287b9460f6ada67a09bc88c', type_name: '白虎' },
  { type_id: '081dcb0707dbf724ff2288b8ff26d986', type_name: '自拍' },
  { type_id: 'e33cc5c74cbaff91e5708e787baf7cb1', type_name: '合集' },
  { type_id: 'c4427022dc5bdbe8503d905e7cc02eb3', type_name: '福利' },
  { type_id: '6507c6a0e88c6c7e5697954e5e298675', type_name: '主播' },
  { type_id: '449fb65a4e573a79f841806867176c48', type_name: '女神' },
  { type_id: '2f62dec4a397b6a623431560eb75f31c', type_name: '母狗' },
  { type_id: 'ff0dab09a85e14aca3ae3d3add1f21a6', type_name: '荡妇' },
  { type_id: '76c630d4dbb32cf90cc1e8dd448fafac', type_name: '奇闻趣事' },
  { type_id: 'e4e1d3efc7b6b8f6ab1710e7a507bcb5', type_name: '大乳房' },
  { type_id: '478ac59966b81472230b7a1ad0b62c62', type_name: '美丽的胸部' },
  { type_id: 'ac966f94352daed5af9df932b9790dae', type_name: '反差' },
  { type_id: 'ac99bd13252867b827d283fc86cb8faf', type_name: '细长的' },
  { type_id: '0053940855c6f53434b1e2ab3108ce4a', type_name: '业余' },
  { type_id: 'dd8b8266543a2a94c2439da757ccbc6d', type_name: '美丽的女孩' },
  { type_id: '628f137420927a319756451b39f716f1', type_name: '高视力' },
  { type_id: '594df1249e1ffe309cc0f1757a2f0c53', type_name: '独家的' },
  { type_id: '571a16325e48458862fa3253cb2b9750', type_name: '单一作品' },
  { type_id: '6c3afde44e16da0e78ff332970933fee', type_name: '仅限送货' },
  { type_id: '4k', type_name: '4K' },
  { type_id: '3fb45bdb43ca4aee2690ebaeffb973bc', type_name: '推特' },
  { type_id: 'onlyfans', type_name: 'OnlyFans' },
  { type_id: 'f6dd4a7cc63f05cf7bd3b52bd45073ec', type_name: '最新' },
  { type_id: '6b8a7db8f9f181757eb1f3bd1bbf4b80', type_name: '淫妻' },
  { type_id: 'e1132ac433d65a9f6b73d5c2a7d71370', type_name: '网红2' },
  { type_id: '0773312bdeb075a53eefa401d99ec9cd', type_name: '口交2' },
  { type_id: '827a793aea37e65a5e4de82dac880eab', type_name: '工具' },
  { type_id: 'ol7', type_name: '哦' },
];

const CARD_STYLE = { type: 'rect', ratio: 1.78 };
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function setPlayCache(key, value) {
  if (!key || !value) return;
  PLAY_CACHE.set(key, { value, ts: Date.now() });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function buildHeaders(originOrUrl, extra = {}) {
  let origin = activeDomain;
  try {
    if (originOrUrl && /^https?:\/\//i.test(originOrUrl)) {
      origin = new URL(originOrUrl).origin;
    }
  } catch (_) {}
  const baseCookie = '_safe=1';
  const mergedCookie = extra.Cookie
    ? extra.Cookie.includes('_safe=')
      ? extra.Cookie
      : `${baseCookie}; ${extra.Cookie}`
    : baseCookie;
  return {
    'User-Agent': UA,
    Referer: `${origin}/`,
    Origin: origin,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...extra,
    Cookie: mergedCookie,
  };
}

function getParams(inReq) {
  const merged = {};
  for (const src of [inReq?.query, inReq?.body]) {
    if (!src) continue;
    if (typeof src === 'string') {
      const s = src.trim();
      if (!s) continue;
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          Object.assign(merged, JSON.parse(s));
          continue;
        } catch (_) {}
      }
      try {
        for (const [k, v] of new URLSearchParams(s).entries()) {
          merged[k] = v;
        }
      } catch (_) {}
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function formatPicUrl(rawUrl) {
  if (!rawUrl) return '';
  let u = String(rawUrl).trim();
  if (!u) return '';
  if (u.startsWith('https://wsrv.nl/')) return u;
  if (u.startsWith('//')) u = `https:${u}`;
  else if (u.startsWith('/')) u = `${activeDomain}${u}`;
  u = u.replace(/^https?:\/\/[^/]+\//i, 'https://bmc2.imgclh.com/');
  return `https://wsrv.nl/?url=${encodeURIComponent(u)}&output=jpeg`;
}

function toRelativeVideoPath(urlOrPath) {
  if (!urlOrPath) return '';
  const s = String(urlOrPath).trim();
  if (s.startsWith('/')) return s;
  try {
    const parsed = new URL(s);
    const knownHosts = new Set(SITE_DOMAINS.map((d) => new URL(d).hostname));
    if (knownHosts.has(parsed.hostname)) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch (_) {}
  return s;
}

function getDomainPool() {
  const ordered = [activeDomain, ...SITE_DOMAINS];
  return [...new Set(ordered)];
}

function expandCandidateUrls(urlOrPath) {
  if (!urlOrPath) return [];
  const s = String(urlOrPath).trim();
  const pool = getDomainPool();
  if (s.startsWith('/')) {
    return pool.map((d) => `${d}${s}`);
  }
  try {
    const parsed = new URL(s);
    const knownHosts = new Set(SITE_DOMAINS.map((d) => new URL(d).hostname));
    if (knownHosts.has(parsed.hostname)) {
      const rel = `${parsed.pathname}${parsed.search}`;
      return pool.map((d) => `${d}${rel}`);
    }
  } catch (_) {}
  return [s];
}

function decodeBufferToText(buf) {
  if (typeof buf === 'string') return buf;
  if (!buf) return '';
  let bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = zlib.gunzipSync(bytes);
    } catch (_) {}
  }
  const utf8 = bytes.toString('utf8');
  if (utf8.includes('\ufffd')) {
    try {
      return new TextDecoder('gbk').decode(bytes);
    } catch (_) {}
  }
  return utf8;
}

function isValidSiteHtml(html) {
  if (!html || typeof html !== 'string') return false;
  if (html.length < 40) return false;
  return (
    html.includes('/video/') ||
    html.includes('Playerjs') ||
    html.includes('player_aaaa') ||
    html.includes('player_data') ||
    html.includes('og:image') ||
    /<h1[\s>]/i.test(html) ||
    /<video[\s>]/i.test(html) ||
    /\.m3u8|\.mp4/i.test(html)
  );
}

async function fetchHtml(urlOrPath, options = {}) {
  const candidates = expandCandidateUrls(urlOrPath);
  for (const targetUrl of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const origin = new URL(targetUrl).origin;
        const headers = buildHeaders(origin, options.headers || {});
        const resp = await req.get(targetUrl, {
          headers,
          timeout: options.timeout || 10000,
          responseType: 'arraybuffer',
        });
        const status = resp?.status ?? 200;
        if (status >= 200 && status < 300) {
          const rawData = resp?.data ?? resp?.body ?? resp;
          const text = decodeBufferToText(rawData);
          if (text && (options.allowAnyHtml || isValidSiteHtml(text))) {
            if (SITE_DOMAINS.includes(origin)) {
              activeDomain = origin;
            }
            return { text, url: targetUrl, origin };
          }
        }
      } catch (_) {}
    }
  }
  return null;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(str) {
  if (!str) return '';
  return decodeHtmlEntities(String(str).replace(/<[^>]*>/g, '')).trim();
}

function parseItems(html) {
  if (!html) return [];
  const rows = [];
  const seen = new Set();

  // Exact Python regex pattern first (supporting both full URL and relative /video/ paths)
  const exactRegex =
    /href="((?:https?:\/\/[^/"]+)?\/video\/\d+\/[^"]+)"[^>]*title="([^"]*)"[\s\S]*?data-original="([^"]+)"[\s\S]*?<\/a>/gi;
  let match;
  while ((match = exactRegex.exec(html)) !== null) {
    const rawHref = match[1];
    const vodId = toRelativeVideoPath(rawHref);
    if (!vodId || seen.has(vodId)) continue;
    seen.add(vodId);

    const block = match[0];
    let remarks = '';
    const durMatch = block.match(/class="[^"]*(?:duration|time|badge)[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (durMatch) {
      remarks = stripTags(durMatch[1]);
    }
    rows.push({
      vod_id: vodId,
      vod_name: stripTags(match[2]),
      vod_pic: formatPicUrl(match[3]),
      vod_remarks: remarks,
    });
  }

  // Fallback anchor scanner for cards with alternative attribute order or split anchors
  const anchorRegex = /<a\b([^>]*href="((?:https?:\/\/[^/"]+)?\/video\/\d+\/[^"]+)"[^>]*)>([\s\S]*?)<\/a>/gi;
  const cardMap = new Map();
  while ((match = anchorRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const rawHref = match[2] || '';
    const inner = match[3] || '';
    const vodId = toRelativeVideoPath(rawHref);
    if (!vodId || seen.has(vodId)) continue;

    const existing = cardMap.get(vodId) || {
      vod_id: vodId,
      vod_name: '',
      vod_pic: '',
      vod_remarks: '',
    };

    const titleAttr = attrs.match(/\btitle="([^"]*)"/i) || inner.match(/\balt="([^"]*)"/i);
    if (titleAttr && titleAttr[1] && !existing.vod_name) {
      existing.vod_name = stripTags(titleAttr[1]);
    }

    const imgMatch =
      inner.match(/\bdata-original="([^"]+)"/i) ||
      inner.match(/\bdata-src="([^"]+)"/i) ||
      inner.match(/<img[^>]+src="([^"]+)"/i);
    if (imgMatch && imgMatch[1] && !existing.vod_pic) {
      existing.vod_pic = formatPicUrl(imgMatch[1]);
    }

    const remMatch = inner.match(/class="[^"]*(?:duration|time|badge)[^"]*"[^>]*>([\s\S]*?)<\//i);
    if (remMatch && remMatch[1] && !existing.vod_remarks) {
      existing.vod_remarks = stripTags(remMatch[1]);
    }

    if (!existing.vod_name) {
      const plainText = stripTags(inner);
      if (plainText) existing.vod_name = plainText;
    }

    cardMap.set(vodId, existing);
  }

  for (const card of cardMap.values()) {
    if (card.vod_name || card.vod_pic) {
      rows.push(card);
    }
  }

  return rows;
}

function parsePageCount(html, currentPage = 1) {
  if (!html) return currentPage;
  const fromMatches = [...html.matchAll(/from:(\d+)/g)].map((m) => parseInt(m[1], 10)).filter(Number.isFinite);
  if (fromMatches.length > 0) {
    return Math.floor(Math.max(...fromMatches) / 20) + 1;
  }
  const lastMatch = html.match(/最后\s*->\s*[^"]*?\/(\d+)\//i);
  if (lastMatch) {
    return parseInt(lastMatch[1], 10) || 1;
  }
  const pageLinks = [...html.matchAll(/\/(?:new|tags\/[^/"']+)\/(\d+)\//gi)]
    .map((m) => parseInt(m[1], 10))
    .filter(Number.isFinite);
  if (pageLinks.length > 0) {
    return Math.max(currentPage, ...pageLinks);
  }
  return Math.max(1, currentPage);
}

function extractBalancedObject(text, startIdx) {
  const firstBrace = text.indexOf('{', startIdx);
  if (firstBrace === -1) return null;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(firstBrace, i + 1);
      }
    }
  }
  return null;
}

function unescapeText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, '&')
    .trim();
}

function customUnescape(str) {
  if (!str) return '';
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeCmsUrl(rawUrl, encrypt = 0) {
  if (!rawUrl) return '';
  let u = String(rawUrl).trim();
  const enc = Number(encrypt) || 0;
  if (enc === 1) {
    u = customUnescape(u);
  } else if (enc === 2) {
    try {
      const b64 = Buffer.from(u, 'base64').toString('utf8');
      u = customUnescape(b64);
    } catch (_) {}
  }
  return unescapeText(u);
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return '';
  const unpackedBlocks = [];
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const symtab = m[6].split('|');
    if (!radix || !count || symtab.length === 0) continue;

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

    const decoded = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) => (dict.has(word) ? dict.get(word) : word));
    unpackedBlocks.push(decoded);
  }
  return unpackedBlocks.join('\n');
}

function isDecoyMediaUrl(url) {
  if (!url) return true;
  return /(?:preview|sample|trailer|top_banner|native-ad|stat\.php)/i.test(url);
}

function isDirectMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const cleaned = url.split('@@@')[0].trim();
  if (!/^https?:\/\//i.test(cleaned)) return false;
  if (isDecoyMediaUrl(cleaned)) return false;
  try {
    const parsed = new URL(cleaned);
    if (/\.(?:m3u8|mp4|flv|mpd|ts|mkv|webm)$/i.test(parsed.pathname)) {
      return true;
    }
    if (/(?:video_limt\.mp4|mime=video|\.m3u8|\.mp4)/i.test(parsed.search)) {
      // Make sure it's not a wrapper HTML/PHP player carrying ?url=...
      if (!/\.(?:html?|php|jsp|asp)$/i.test(parsed.pathname) && !parsed.searchParams.has('url')) {
        return true;
      }
    }
  } catch (_) {}
  return false;
}

function unwrapNestedMediaUrl(rawUrl, baseOrigin = activeDomain) {
  if (!rawUrl) return '';
  let u = unescapeText(rawUrl.split('@@@')[0].trim());
  if (u.startsWith('//')) u = `https:${u}`;
  else if (u.startsWith('/')) u = `${baseOrigin}${u}`;

  try {
    const parsed = new URL(u);
    if (!/\.(?:m3u8|mp4|flv|mpd)$/i.test(parsed.pathname)) {
      for (const paramName of ['url', 'v', 'src', 'file', 'vid']) {
        const inner = parsed.searchParams.get(paramName);
        if (inner) {
          let decoded = inner;
          for (let i = 0; i < 2; i++) {
            try {
              const next = decodeURIComponent(decoded);
              if (next === decoded) break;
              decoded = next;
            } catch (_) {
              decoded = customUnescape(decoded);
            }
          }
          decoded = unescapeText(decoded);
          if (decoded.startsWith('//')) decoded = `https:${decoded}`;
          else if (decoded.startsWith('/')) decoded = `${ parsed.origin }${decoded}`;
          if (isDirectMediaUrl(decoded)) {
            return decoded;
          }
        }
      }
    }
  } catch (_) {}
  return u;
}

function parsePlayerjsFileValue(rawFile, baseOrigin = activeDomain) {
  if (!rawFile) return [];
  let s = unescapeText(rawFile).trim();
  if (!s) return [];

  // Handle PlayerJS #2 base64 obfuscation if present
  if (s.startsWith('#2')) {
    try {
      const b64 = s.slice(2).replace(/\/\/[^/]+/g, '');
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      if (decoded.includes('http') || decoded.includes('/')) {
        s = unescapeText(decoded);
      }
    } catch (_) {}
  }

  // Split " or " backup streams and comma-separated "[label]url" entries
  const parts = s.split(/\s+or\s+|,/i).map((p) => p.trim()).filter(Boolean);
  const results = [];
  for (const part of parts) {
    let label = '';
    let urlPart = part;
    const labelMatch = part.match(/^\[([^\]]+)\](.+)$/);
    if (labelMatch) {
      label = labelMatch[1].trim();
      urlPart = labelMatch[2].trim();
    }
    const resolved = unwrapNestedMediaUrl(urlPart, baseOrigin);
    if (resolved && /^https?:\/\//i.test(resolved) && !isDecoyMediaUrl(resolved)) {
      results.push({ label, url: resolved });
    }
  }
  return results;
}

function buildFallbackCdnUrl(videoPageUrlOrPath) {
  if (!videoPageUrlOrPath) return '';
  const m = String(videoPageUrlOrPath).match(/\/video\/(\d+)\//i);
  if (!m) return '';
  const vid = parseInt(m[1], 10);
  if (!Number.isFinite(vid) || vid <= 0) return '';
  const bucket = Math.floor(vid / 1000) * 1000;
  return `https://r22.jb-aiwei.cc/videos/${bucket}/${vid}/${vid}video_limt.mp4`;
}

function extractPlayerjsConfig(html, baseOrigin = activeDomain) {
  const result = { files: [], poster: '' };
  if (!html) return result;

  const pjRegex = /Playerjs\s*\(/gi;
  let m;
  while ((m = pjRegex.exec(html)) !== null) {
    const objStr = extractBalancedObject(html, m.index);
    if (!objStr) continue;

    const fileMatch =
      objStr.match(/["']?file["']?\s*:\s*"([^"]+)"/i) ||
      objStr.match(/["']?file["']?\s*:\s*'([^']+)'/i);
    if (fileMatch && fileMatch[1]) {
      const parsedFiles = parsePlayerjsFileValue(fileMatch[1], baseOrigin);
      for (const item of parsedFiles) {
        if (!result.files.some((x) => x.url === item.url)) {
          result.files.push(item);
        }
      }
    }

    const posterMatch =
      objStr.match(/["']?poster["']?\s*:\s*"([^"]+)"/i) ||
      objStr.match(/["']?poster["']?\s*:\s*'([^']+)'/i);
    if (posterMatch && posterMatch[1] && !result.poster) {
      result.poster = unescapeText(posterMatch[1]);
    }
  }
  return result;
}

function extractStreamsFromHtml(html, pageUrl = activeDomain) {
  const baseOrigin = (() => {
    try {
      return new URL(pageUrl).origin;
    } catch (_) {
      return activeDomain;
    }
  })();

  const found = [];
  const addCandidate = (url, label = '') => {
    const unwrapped = unwrapNestedMediaUrl(url, baseOrigin);
    if (isDirectMediaUrl(unwrapped) && !found.some((x) => x.url === unwrapped)) {
      found.push({ label, url: unwrapped });
    }
  };

  const fullText = `${html || ''}\n${unpackDeanEdwards(html || '')}`;

  // Stage 1: Playerjs({ ... }) balanced-brace extraction
  const pj = extractPlayerjsConfig(fullText, baseOrigin);
  for (const item of pj.files) {
    addCandidate(item.url, item.label || '直链');
  }

  // Stage 2: CMS player_aaaa / player_data / player_config balanced-brace extraction
  const cmsRegex = /\b(?:player_aaaa|player_data|player_config)\s*=/gi;
  let m;
  while ((m = cmsRegex.exec(fullText)) !== null) {
    const objStr = extractBalancedObject(fullText, m.index);
    if (!objStr) continue;
    try {
      const parsed = JSON.parse(objStr);
      if (parsed?.url) {
        const decoded = decodeCmsUrl(parsed.url, parsed.encrypt);
        addCandidate(decoded, '直链');
      }
    } catch (_) {
      const urlMatch = objStr.match(/["']?url["']?\s*:\s*["']([^"']+)["']/i);
      const encMatch = objStr.match(/["']?encrypt["']?\s*:\s*(\d+)/i);
      if (urlMatch && urlMatch[1]) {
        const decoded = decodeCmsUrl(urlMatch[1], encMatch ? Number(encMatch[1]) : 0);
        addCandidate(decoded, '直链');
      }
    }
  }

  // Stage 3: <video> / <source> tags and explicit file/video_url assignments
  const sourceRegex = /<(?:video|source)\b[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = sourceRegex.exec(fullText)) !== null) {
    addCandidate(m[1], '网页');
  }

  // Stage 4: Normalized direct .m3u8 / .mp4 scan
  const normalized = unescapeText(fullText);
  const directRegex = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  while ((m = directRegex.exec(normalized)) !== null) {
    addCandidate(m[0], '网页');
  }

  // Stage 5: Deterministic CDN pattern from /video/<vid>/
  const cdnFallback = buildFallbackCdnUrl(pageUrl);
  if (cdnFallback) {
    addCandidate(cdnFallback, found.length === 0 ? '直链' : '备用');
  }

  return { streams: found, poster: pj.poster };
}

async function resolveStreamsFromDetail(pageUrlOrPath) {
  const fetched = await fetchHtml(pageUrlOrPath);
  if (!fetched) {
    const cdnUrl = buildFallbackCdnUrl(pageUrlOrPath);
    return {
      html: '',
      url: pageUrlOrPath,
      origin: activeDomain,
      streams: cdnUrl ? [{ label: '直链', url: cdnUrl }] : [],
      poster: '',
    };
  }

  const { text, url, origin } = fetched;
  const extracted = extractStreamsFromHtml(text, url);

  // Follow embedded iframe if no direct stream was found yet
  if (extracted.streams.length === 0) {
    const iframeMatch = text.match(/<iframe\b[^>]*\b(?:data-)?src=["']([^"']+)["']/i);
    if (iframeMatch && iframeMatch[1]) {
      const iframeRaw = unescapeText(iframeMatch[1]);
      const unwrappedIframe = unwrapNestedMediaUrl(iframeRaw, origin);
      if (isDirectMediaUrl(unwrappedIframe)) {
        extracted.streams.push({ label: '直链', url: unwrappedIframe });
      } else {
        const iframeUrl = iframeRaw.startsWith('http')
          ? iframeRaw
          : iframeRaw.startsWith('//')
            ? `https:${iframeRaw}`
            : `${origin}${iframeRaw.startsWith('/') ? '' : '/'}${iframeRaw}`;
        const iframeRes = await fetchHtml(iframeUrl, {
          headers: { Referer: url },
          allowAnyHtml: true,
        });
        if (iframeRes?.text) {
          const sub = extractStreamsFromHtml(iframeRes.text, iframeRes.url);
          for (const s of sub.streams) {
            if (!extracted.streams.some((x) => x.url === s.url)) {
              extracted.streams.push(s);
            }
          }
        }
      }
    }
  }

  return {
    html: text,
    url,
    origin,
    streams: extracted.streams,
    poster: extracted.poster,
  };
}

function sanitizePlayId(rawId) {
  if (!rawId) return '';
  let s = String(rawId).trim();
  if (s.includes('@@@')) {
    s = s.split('@@@')[0].trim();
  }
  const dollarIdx = s.indexOf('$');
  if (dollarIdx !== -1) {
    const prefix = s.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      s = s.slice(dollarIdx + 1).trim();
    }
  }
  return s;
}

async function home(_inReq, _outResp) {
  const fetched = await fetchHtml('/new/');
  const list = fetched ? parseItems(fetched.text) : [];
  return {
    class: CATEGORIES,
    filters: {},
    list,
    style: CARD_STYLE,
  };
}

async function category(inReq, _outResp) {
  const params = getParams(inReq);
  const tid = String(params.id || params.tid || 'new').trim();
  const pg = Math.max(1, parseInt(params.page || params.pg || 1, 10) || 1);

  let relPath;
  if (tid === 'new') {
    relPath = pg === 1 ? '/new/' : `/new/${pg}/`;
  } else {
    relPath = pg === 1 ? `/tags/${tid}/` : `/tags/${tid}/${pg}/`;
  }

  const fetched = await fetchHtml(relPath);
  if (!fetched) {
    return {
      list: [],
      page: pg,
      pagecount: pg,
      limit: 20,
      total: 0,
      style: CARD_STYLE,
    };
  }

  const list = parseItems(fetched.text);
  const pagecount = parsePageCount(fetched.text, pg);
  return {
    list,
    page: pg,
    pagecount,
    limit: 20,
    total: pagecount * 20,
    style: CARD_STYLE,
  };
}

async function detail(inReq, _outResp) {
  const params = getParams(inReq);
  const rawIds = params.id ?? params.ids ?? params.url ?? '';
  const idList = Array.isArray(rawIds) ? rawIds : [rawIds];
  const target = String(idList[0] || '').trim();
  if (!target) return { list: [] };

  const relOrUrl = toRelativeVideoPath(target);
  const resolved = await resolveStreamsFromDetail(relOrUrl);
  if (!resolved.html && resolved.streams.length === 0) {
    return { list: [] };
  }

  const t = resolved.html;
  const titleMatch = t.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const descMatch =
    t.match(/id="description"[^>]*>([\s\S]*?)<\//i) ||
    t.match(/name="description"[^>]*content="([^"]+)"/i);
  const durMatch = t.match(/video:duration"\s+content="(\d+)"/i);

  let poster = resolved.poster;
  if (!poster) {
    const ogMatch = t.match(/property="og:image"[^>]*content="([^"]+)"/i);
    if (ogMatch && ogMatch[1]) poster = ogMatch[1];
  }

  let remark = '试看';
  if (durMatch && durMatch[1]) {
    const mins = Math.floor(parseInt(durMatch[1], 10) / 60);
    remark = `HD · ${mins}分钟 试看`;
  }

  const playFrom = [];
  const playUrls = [];
  const usedLabels = new Set();

  for (let i = 0; i < resolved.streams.length; i++) {
    const item = resolved.streams[i];
    let tabName = item.label || (i === 0 ? '直链' : `线路${i + 1}`);
    if (usedLabels.has(tabName)) {
      tabName = i === 1 ? '网页' : `${tabName}${i + 1}`;
    }
    usedLabels.add(tabName);
    playFrom.push(tabName);
    playUrls.push(`播放$${item.url}`);
    setPlayCache(item.url, item.url);
  }

  if ( resolved.streams.length > 0 ) {
    const primaryStream = resolved.streams[0].url;
    setPlayCache(target, primaryStream);
    setPlayCache(relOrUrl, primaryStream);
    setPlayCache(resolved.url, primaryStream);
  }

  const vod = {
    vod_id: toRelativeVideoPath(resolved.url || target),
    vod_name: titleMatch ? stripTags(titleMatch[1]) : '',
    vod_pic: poster ? formatPicUrl(poster) : '',
    vod_content: descMatch ? stripTags(descMatch[1]) : '',
    vod_remarks: remark,
    vod_play_from: playFrom.join('$$$'),
    vod_play_url: playUrls.join('$$$'),
  };

  return { list: [vod] };
}

async function search(inReq, _outResp) {
  const params = getParams(inReq);
  const key = String(params.wd || params.key || params.q || '').trim();
  const pg = Math.max(1, parseInt(params.page || params.pg || 1, 10) || 1);
  if (!key) return { list: [], page: pg, pagecount: 0 };

  const encoded = encodeURIComponent(key);
  const searchPath = pg === 1 ? `/search/?q=${encoded}` : `/search/?q=${encoded}&from=${(pg - 1) * 20}`;
  const fetched = await fetchHtml(searchPath);
  const list = fetched ? parseItems(fetched.text) : [];
  const pagecount = fetched ? parsePageCount(fetched.text, pg) : 0;

  return {
    list,
    page: pg,
    pagecount,
    style: CARD_STYLE,
  };
}

async function play(inReq, _outResp) {
  const params = getParams(inReq);
  const rawId = params.id || params.url || params.pid || '';
  const cleanId = sanitizePlayId(rawId);
  const headers = buildHeaders(activeDomain);

  if (!cleanId) {
    return { parse: 0, jx: 0, url: '', header: headers, headers };
  }

  const cached = getPlayCache(cleanId) || getPlayCache(toRelativeVideoPath(cleanId));
  if (cached && isDirectMediaUrl(cached)) {
    return {
      parse: 0,
      jx: 0,
      url: cached,
      header: headers,
      headers,
    };
  }

  // Unwrap PlayerJS [label]url or nested ?url= wrapper strings directly
  const parsedPj = parsePlayerjsFileValue(cleanId, activeDomain);
  if (parsedPj.length > 0 && isDirectMediaUrl(parsedPj[0].url)) {
    const directUrl = parsedPj[0].url;
    setPlayCache(cleanId, directUrl);
    return {
      parse: 0,
      jx: 0,
      url: directUrl,
      header: headers,
      headers,
    };
  }

  const unwrapped = unwrapNestedMediaUrl(cleanId, activeDomain);
  if (isDirectMediaUrl(unwrapped)) {
    setPlayCache(cleanId, unwrapped);
    return {
      parse: 0,
      jx: 0,
      url: unwrapped,
      header: headers,
      headers,
    };
  }

  // Otherwise resolve from the detail/play page with full mirror failover
  const resolved = await resolveStreamsFromDetail(cleanId);
  const activeHeaders = buildHeaders(resolved.origin || activeDomain);
  if (resolved.streams.length > 0) {
    const finalUrl = resolved.streams[0].url;
    setPlayCache(cleanId, finalUrl);
    return {
      parse: 0,
      jx: 0,
      url: finalUrl,
      header: activeHeaders,
      headers: activeHeaders,
    };
  }

  const fallbackPageUrl = expandCandidateUrls(cleanId)[0] || cleanId;
  return {
    parse: 1,
    jx: 0,
    url: fallbackPageUrl,
    header: activeHeaders,
    headers: activeHeaders,
  };
}

async function proxyPicHandler(query = {}) {
  const rawUrl = query.url || '';
  if (!rawUrl) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
  try {
    const resp = await req.get(rawUrl, {
      headers: buildHeaders(activeDomain),
      timeout: 10000,
      responseType: 'arraybuffer',
    });
    const mime = resp?.headers?.['content-type'] || 'image/jpeg';
    const data = Buffer.isBuffer(resp?.data) ? resp.data : Buffer.from(resp?.data || []);
    return { mime, data };
  } catch (_) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'aiwei',
    name: '爱微社区',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/aiwei_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};