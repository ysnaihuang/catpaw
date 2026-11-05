import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://www.jiujiu.live',
  'https://jiujiu.live',
];

let activeDomain = SITE_DOMAINS[0];
let wafCookie = '';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BRAND_NAME = '🦋 蝴蝶影视';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const BRAND_CONTENT = '🦋 蝴蝶影视专线直连 | 极速高清画质 | 官方交流群: @tvshare23';
const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const CATEGORY_CACHE = new Map();
const PLAY_CACHE = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
const PLAY_CACHE_TTL_MS = 10 * 60 * 1000;

const STATIC_CLASSES = [
  { type_id: '23', type_name: '日本無碼' },
  { type_id: '9', type_name: '中文字幕' },
  { type_id: '82', type_name: '日韓無碼' },
  { type_id: '78', type_name: 'AV明星' },
  { type_id: '31', type_name: '制服誘惑' },
  { type_id: '24', type_name: '日本有碼' },
  { type_id: '25', type_name: '歐美精品' },
  { type_id: '113', type_name: '無碼專區' },
  { type_id: '87', type_name: '動漫精品' },
  { type_id: '201', type_name: '歐美-高清無碼' },
  { type_id: '136', type_name: '歐美情色' },
  { type_id: '55', type_name: '成人動漫' },
  { type_id: '133', type_name: '歐美性愛' },
  { type_id: '271', type_name: '日韓精品' },
  { type_id: '116', type_name: '卡通動漫' },
  { type_id: '148', type_name: '倫理三級' },
  { type_id: '64', type_name: '巨乳美乳' },
  { type_id: '81', type_name: '童顏巨乳' },
  { type_id: '66', type_name: '亞洲有碼' },
  { type_id: '86', type_name: '歐美極品' },
  { type_id: '32', type_name: 'AV解說' },
  { type_id: '110', type_name: '女優明星' },
  { type_id: '309', type_name: '歐美' },
  { type_id: '41', type_name: '倫理片' },
  { type_id: '100', type_name: 'SWAG' },
  { type_id: '143', type_name: '人妻熟女' },
  { type_id: '8', type_name: '高清無碼' },
  { type_id: '358', type_name: '日本-素人' },
  { type_id: '90', type_name: '日本片商' },
  { type_id: '132', type_name: '卡通動畫' },
  { type_id: '71', type_name: '歐美激情' },
  { type_id: '155', type_name: '明星換臉' },
  { type_id: '176', type_name: '動漫卡通' },
  { type_id: '440', type_name: '無碼流出' },
  { type_id: '52', type_name: 'AI換臉' },
  { type_id: '68', type_name: '亞洲無碼' },
  { type_id: '217', type_name: '日本-高清有碼' },
  { type_id: '122', type_name: '麻豆視頻' },
  { type_id: '163', type_name: '換臉明星' },
  { type_id: '269', type_name: '倫理影片' },
  { type_id: '238', type_name: '日本素人' },
  { type_id: '191', type_name: '獨家DMM' },
  { type_id: '101', type_name: '三級倫理' },
  { type_id: '109', type_name: '麻豆傳媒' },
  { type_id: '112', type_name: '歐美系列' },
  { type_id: '92', type_name: '激情動漫' },
  { type_id: '219', type_name: '日本-無碼流出' },
  { type_id: '331', type_name: '劇情介紹' },
  { type_id: '7', type_name: '3D動漫' },
  { type_id: '336', type_name: '日本精品' },
  { type_id: '193', type_name: 'HEY誘惑' },
  { type_id: '200', type_name: '動漫-黃漫' },
  { type_id: '308', type_name: '華語AV' },
  { type_id: '203', type_name: '日本-一本道' },
  { type_id: '448', type_name: '動漫精選' },
  { type_id: '433', type_name: '歐美勁爆' },
  { type_id: '207', type_name: '傳媒-麻豆傳媒' },
  { type_id: '67', type_name: '日本女優' },
  { type_id: '402', type_name: '日本動漫' },
  { type_id: '73', type_name: '有碼精品' },
  { type_id: '199', type_name: '動漫-里番中字' },
  { type_id: '443', type_name: '高清有碼' },
  { type_id: '111', type_name: '歐美無碼' },
  { type_id: '489', type_name: '韓國三級' },
];

const SORT_FILTER = [
  {
    key: 'sort',
    name: '排序',
    value: [
      { n: '最新发布', v: '' },
      { n: '最多播放', v: 'hits' },
    ],
  },
];

function buildFilters() {
  const filters = {};
  for (const c of STATIC_CLASSES) {
    filters[c.type_id] = SORT_FILTER;
  }
  return filters;
}

function formatRemarks(brand = BRAND_NAME, meta = '') {
  const cleanMeta = String(meta || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return cleanMeta ? `${brand} | ${cleanMeta}` : brand;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function unwrapRequestParams(inReq) {
  const merged = {};
  const sources = [inReq?.params, inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            Object.assign(merged, parsed);
            continue;
          }
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
  if (typeof merged.extend === 'string' && merged.extend.trim()) {
    const extStr = merged.extend.trim();
    if (extStr.startsWith('{')) {
      try {
        merged.extend = JSON.parse(extStr);
      } catch (_) {}
    }
  }
  return merged;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const low = hostname.toLowerCase();
  return SITE_DOMAINS.some((d) => {
    try {
      return new URL(d).hostname.toLowerCase() === low;
    } catch (_) {
      return false;
    }
  });
}

function expandCandidateUrls(targetUrl) {
  const raw = String(targetUrl || '').trim();
  if (!raw) return [];
  const domains = Array.from(new Set([activeDomain, ...SITE_DOMAINS]));

  if (raw.startsWith('//')) {
    return [`https:${raw}`];
  }
  if (raw.startsWith('/')) {
    return domains.map((d) => `${d.replace(/\/+$/, '')}${raw}`);
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (isKnownSiteHost(u.hostname)) {
        const rel = `${u.pathname}${u.search}${u.hash}`;
        return domains.map((d) => `${d.replace(/\/+$/, '')}${rel}`);
      }
    } catch (_) {}
    return [raw];
  }
  const cleanRel = `/${raw.replace(/^\/+/, '')}`;
  return domains.map((d) => `${d.replace(/\/+$/, '')}${cleanRel}`);
}

function decodeResponseBuffer(rawBuf, contentEncoding = '') {
  if (!rawBuf) return '';
  let buf = Buffer.isBuffer(rawBuf)
    ? rawBuf
    : rawBuf instanceof Uint8Array
      ? Buffer.from(rawBuf)
      : Buffer.from(String(rawBuf));

  const enc = String(contentEncoding || '').toLowerCase();
  try {
    if ((buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) || enc.includes('gzip')) {
      buf = zlib.gunzipSync(buf);
    } else if (enc.includes('deflate')) {
      try {
        buf = zlib.inflateSync(buf);
      } catch (_) {
        buf = zlib.inflateRawSync(buf);
      }
    }
  } catch (_) {}

  let text = buf.toString('utf8');
  if (text.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      const gbkText = gbkDecoder.decode(buf);
      if (!gbkText.includes('\ufffd')) {
        text = gbkText;
      }
    } catch (_) {}
  }
  return text;
}

function extractCookieFromHeaders(headers, targetKey) {
  if (!headers) return '';
  const rawSetCookie =
    headers['set-cookie'] || headers['Set-Cookie'] || headers['SET-COOKIE'] || [];
  const cookieList = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
  const escapedKey = String(targetKey || '_chg_waf_pow').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escapedKey}=[^;,\\s]+)`);
  for (const item of cookieList) {
    if (!item) continue;
    const m = String(item).match(re);
    if (m) return m[1].trim();
  }
  return '';
}

async function solveCdnlahPow(wafHtml, targetUrl, domainOrigin) {
  const cfgMatch = String(wafHtml || '').match(
    /<script[^>]+id=["']__cdnlah_pow_config["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!cfgMatch) return false;

  let cfg;
  try {
    cfg = JSON.parse(cfgMatch[1].trim());
  } catch (_) {
    return false;
  }

  const seed = String(cfg.seed || '');
  const difficulty = Number.parseInt(cfg.difficulty, 10) || 0;
  const verifyPath = cfg.verify_path || '/__cdnlah/pow/verify';
  const metadataField = cfg.metadata_field || 'challenge_metadata';
  const metadataToken = cfg.metadata_token || '';
  const challengeCookie = cfg.challenge_cookie || '_chg_waf_pow';
  const redirectVal = cfg.redirect || '/';

  if (!seed || difficulty <= 0) return false;

  const targetPrefix = '0'.repeat(difficulty);
  let nonceHex = '';

  for (let n = 0; n < 1500000; n++) {
    const candHex = n.toString(16).padStart(16, '0');
    const digest = crypto
      .createHash('sha256')
      .update(seed + candHex, 'utf8')
      .digest('hex');
    if (digest.slice(0, difficulty) === targetPrefix) {
      nonceHex = candHex;
      break;
    }
  }

  if (!nonceHex) return false;

  const baseOrigin = domainOrigin || activeDomain;
  const verifyUrl = verifyPath.startsWith('http')
    ? verifyPath
    : `${baseOrigin.replace(/\/+$/, '')}${verifyPath.startsWith('/') ? '' : '/'}${verifyPath}`;

  const formParams = new URLSearchParams();
  formParams.set('seed', seed);
  formParams.set('nonce', nonceHex);
  formParams.set('redirect', redirectVal);
  formParams.set('challenge_cookie', challengeCookie);
  formParams.set(metadataField, metadataToken);

  const headers = {
    'User-Agent': DEFAULT_UA,
    Origin: baseOrigin,
    Referer: targetUrl || `${baseOrigin}/`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh-TW,zh;q=0.9,en;q=0.8',
  };
  if (wafCookie) {
    headers.Cookie = wafCookie;
  }

  try {
    const resp = await req(verifyUrl, {
      method: 'POST',
      headers,
      data: formParams.toString(),
      body: formParams.toString(),
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 10000,
    });
    const ck = extractCookieFromHeaders(resp?.headers, challengeCookie);
    if (ck) {
      wafCookie = ck;
      return true;
    }
    const status = resp?.status || resp?.statusCode || 0;
    if ([200, 301, 302, 303, 307].includes(status) && wafCookie) {
      return true;
    }
  } catch (err) {
    const ck = extractCookieFromHeaders(err?.response?.headers, challengeCookie);
    if (ck) {
      wafCookie = ck;
      return true;
    }
  }
  return Boolean(wafCookie);
}

function hasValidSiteFingerprint(text) {
  if (!text || typeof text !== 'string') return false;
  return (
    text.includes('col-') ||
    text.includes('<video') ||
    text.includes('<source') ||
    text.includes('<iframe') ||
    text.includes('.m3u8') ||
    text.includes('.mp4') ||
    text.includes('player_aaaa') ||
    text.includes('player_data') ||
    text.includes('player_config') ||
    text.includes('decryptDatas') ||
    text.includes('<title>') ||
    text.includes('<h1>')
  );
}

async function fetchHtml(targetUrl, referer = '') {
  const candidates = expandCandidateUrls(targetUrl);
  if (!candidates.length) {
    return { code: 0, text: '', finalUrl: '' };
  }

  let lastResult = { code: -1, text: '', finalUrl: candidates[0] };

  for (const candidateUrl of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(candidateUrl).origin;
    } catch (_) {}

    let effectiveReferer = `${origin}/`;
    if (referer) {
      try {
        const refUrl = new URL(referer, origin);
        if (isKnownSiteHost(refUrl.hostname)) {
          effectiveReferer = `${origin}${refUrl.pathname}${refUrl.search}`;
        } else {
          effectiveReferer = refUrl.href;
        }
      } catch (_) {
        effectiveReferer = `${origin}/`;
      }
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const headers = {
        'User-Agent': DEFAULT_UA,
        Referer: effectiveReferer,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh-TW,zh;q=0.9,en;q=0.8',
      };
      if (wafCookie) {
        headers.Cookie = wafCookie;
      }

      try {
        const resp = await req(candidateUrl, {
          method: 'GET',
          headers,
          timeout: 10000,
          validateStatus: () => true,
        });

        const status = resp?.status ?? resp?.statusCode ?? 200;
        const rawData = resp?.data ?? resp?.body ?? '';
        const contentEncoding =
          resp?.headers?.['content-encoding'] || resp?.headers?.['Content-Encoding'] || '';
        const text =
          typeof rawData === 'string'
            ? rawData
            : decodeResponseBuffer(rawData, contentEncoding);

        const setCk = extractCookieFromHeaders(resp?.headers, '_chg_waf_pow');
        if (setCk) {
          wafCookie = setCk;
        }

        if ((status === 492 || text.includes('__cdnlah_pow_config')) && attempt < 2) {
          const solved = await solveCdnlahPow(text, candidateUrl, origin);
          if (solved) continue;
        }

        lastResult = { code: status, text, finalUrl: candidateUrl };

        if (status >= 200 && status < 400 && text) {
          if (isKnownSiteHost(new URL(candidateUrl).hostname) && hasValidSiteFingerprint(text)) {
            activeDomain = origin;
          }
          return lastResult;
        }

        if ([403, 429, 451, 502, 503].includes(status) && attempt < 2) {
          await new Promise((r) => setTimeout(r, 150));
          continue;
        }
        break;
      } catch (err) {
        const errStatus = err?.response?.status ?? -1;
        const errBody = err?.response?.data
          ? typeof err.response.data === 'string'
            ? err.response.data
            : decodeResponseBuffer(err.response.data)
          : '';
        if ((errStatus === 492 || errBody.includes('__cdnlah_pow_config')) && attempt < 2) {
          const solved = await solveCdnlahPow(errBody, candidateUrl, origin);
          if (solved) continue;
        }
        lastResult = { code: errStatus, text: errBody, finalUrl: candidateUrl };
        break;
      }
    }
  }

  return lastResult;
}

function cleanPicUrl(rawPic) {
  if (!rawPic) return '';
  let pic = decodeHtmlEntities(String(rawPic).trim());
  if (
    !pic ||
    pic.startsWith('data:image') ||
    pic.startsWith('about:blank') ||
    pic.startsWith('javascript:')
  ) {
    return '';
  }
  if (pic.startsWith('//')) {
    pic = `https:${pic}`;
  } else if (pic.startsWith('/')) {
    pic = `${activeDomain.replace(/\/+$/, '')}${pic}`;
  }
  if (pic.includes('@Referer=')) {
    return pic;
  }
  return `${pic}@Referer=${activeDomain}/`;
}

function extractImageFromFragment(fragment) {
  const attrs = [
    'data-original',
    'data-litespeed-src',
    'data-lazy-src',
    'data-src',
    'data-url',
    'src',
  ];
  for (const attr of attrs) {
    const re = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i');
    const m = fragment.match(re);
    if (m) {
      const cand = decodeHtmlEntities(m[1].trim());
      if (
        cand &&
        !cand.startsWith('data:') &&
        !cand.startsWith('about:blank') &&
        !cand.startsWith('javascript:')
      ) {
        return cand;
      }
    }
  }
  return '';
}

function parseVideoCards(htmlText) {
  if (!htmlText) return [];
  const vodItems = [];
  const byId = new Map();

  const rawBlocks = String(htmlText).split('<div class="col-');
  const blocksToScan = rawBlocks.length > 1 ? rawBlocks.slice(1) : [String(htmlText)];

  for (const block of blocksToScan) {
    const hrefMatch =
      block.match(/href=["'](?:https?:\/\/[^/"']+)?\/(\d+)(?:[/?#"'])/i) ||
      block.match(/href=["'](?:https?:\/\/[^/"']+)?\/(\d+)["']/i);
    if (!hrefMatch) continue;

    const vId = hrefMatch[1].trim();
    if (!vId) continue;

    let title = '';
    const linesMatch = block.match(
      /<div[^>]+class=["'][^"']*\blines\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    if (linesMatch) {
      title = decodeHtmlEntities(linesMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (!title) {
      const altMatch = block.match(/<img[^>]+alt=["']([^"']+)["']/i);
      if (altMatch) {
        title = decodeHtmlEntities(altMatch[1].trim());
      }
    }
    if (!title) {
      const aTitleMatch = block.match(/<a[^>]+title=["']([^"']+)["']/i);
      if (aTitleMatch) {
        title = decodeHtmlEntities(aTitleMatch[1].trim());
      }
    }

    const pic = extractImageFromFragment(block);
    const badgeMatch = block.match(
      /<span[^>]+class=["'][^"']*\bbadge\b[^"']*["'][^>]*>([^<]+)<\/span>/i,
    );
    const meta = badgeMatch ? decodeHtmlEntities(badgeMatch[1].trim()) : '';

    if (byId.has(vId)) {
      const existing = byId.get(vId);
      if ((!existing.vod_name || existing.vod_name.startsWith('影片 ')) && title) {
        existing.vod_name = title;
      }
      if (!existing.vod_pic && pic) {
        existing.vod_pic = cleanPicUrl(pic);
      }
      if (meta && existing.vod_remarks === formatRemarks(BRAND_NAME, 'HD')) {
        existing.vod_remarks = formatRemarks(BRAND_NAME, meta);
      }
      continue;
    }

    const card = {
      vod_id: vId,
      vod_name: title || `影片 ${vId}`,
      vod_pic: cleanPicUrl(pic),
      vod_remarks: formatRemarks(BRAND_NAME, meta || 'HD'),
      style: CARD_STYLE,
    };
    byId.set(vId, card);
    vodItems.push(card);
  }

  return vodItems;
}

function unescapeTextForUrlScan(raw) {
  if (!raw) return '';
  return decodeHtmlEntities(String(raw))
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function customUnescape(str) {
  if (!str) return '';
  let out = String(str).replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  try {
    out = decodeURIComponent(out);
  } catch (_) {
    out = out.replace(/%([0-9a-fA-F]{2})/gi, (_, hex) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
  }
  return out;
}

function decodeCmsPlayerUrl(rawUrl, encryptType = 0) {
  if (!rawUrl) return '';
  let u = String(rawUrl).trim();
  const enc = Number.parseInt(encryptType, 10) || 0;
  if (enc === 1) {
    u = customUnescape(u);
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      u = customUnescape(b64Decoded);
    } catch (_) {}
  }
  return unescapeTextForUrlScan(u).trim();
}

function extractBalancedJsonObject(text, varPattern) {
  const re = new RegExp(`${varPattern}\\s*=\\s*\\{`, 'g');
  const results = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    const startIdx = match.index + match[0].length - 1;
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
        if (ch === quoteChar) {
          inString = false;
          quoteChar = '';
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = true;
        quoteChar = ch;
        continue;
      }
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const jsonCandidate = text.slice(startIdx, i + 1);
          results.push(jsonCandidate);
          break;
        }
      }
    }
  }
  return results;
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const unpackedList = [];
  const re =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let m;
  while ((m = re.exec(html)) !== null) {
    const payload = m[2];
    const radix = Number.parseInt(m[3], 10) || 36;
    const count = Number.parseInt(m[4], 10) || 0;
    const symtab = m[6].split('|');

    const encodeBase = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) return chars[num];
      return encodeBase(Math.floor(num / base), base) + chars[num % base];
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      dict.set(key, symtab[i] || key);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word,
    );
    unpackedList.push(unpacked);
  }
  return unpackedList;
}

function isDecoyOrAdUrl(urlStr) {
  if (!urlStr) return true;
  const low = String(urlStr).toLowerCase();
  const blocked = [
    'preview.mp4',
    'sample.mp4',
    'trailer.mp4',
    'top_banner',
    'native-ad',
    'stat.php',
    'about:blank',
    'javascript:',
  ];
  return blocked.some((b) => low.includes(b));
}

function isDirectMediaUrl(urlStr, baseOrigin = activeDomain) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const cleaned = urlStr.trim();
  if (!cleaned || isDecoyOrAdUrl(cleaned)) return false;
  try {
    const u = new URL(cleaned, baseOrigin);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const pathname = u.pathname.toLowerCase();
    return /\.(m3u8|mp4|flv|mpd)(\b|$)/i.test(pathname);
  } catch (_) {
    return false;
  }
}

function unwrapNestedPlayerUrl(rawUrl, baseOrigin = activeDomain) {
  if (!rawUrl) return '';
  let current = unescapeTextForUrlScan(rawUrl).trim();
  if (!current) return '';

  for (let pass = 0; pass < 2; pass++) {
    try {
      const parsed = new URL(current, baseOrigin);
      const pathname = parsed.pathname.toLowerCase();
      if (/\.(m3u8|mp4|flv|mpd)$/i.test(pathname)) {
        return parsed.href;
      }
      const paramKeys = ['url', 'v', 'vid', 'src', 'play', 'm3u8'];
      let extracted = '';
      for (const k of paramKeys) {
        const val = parsed.searchParams.get(k);
        if (val && (val.includes('.m3u8') || val.includes('.mp4') || /^https?:|^\/|^%2f/i.test(val))) {
          extracted = val;
          break;
        }
      }
      if (!extracted) {
        const rawQueryMatch = parsed.search.match(/[?&](?:url|v|src|play)=([^&]+)/i);
        if (rawQueryMatch) {
          extracted = rawQueryMatch[1];
        }
      }
      if (!extracted) break;

      let decoded = extracted;
      for (let d = 0; d < 2; d++) {
        const next = customUnescape(decoded);
        if (next === decoded) break;
        decoded = next;
      }
      current = unescapeTextForUrlScan(decoded).trim();
    } catch (_) {
      break;
    }
  }

  try {
    return new URL(current, baseOrigin).href;
  } catch (_) {
    return current;
  }
}

function extractStreamFromTextBlock(htmlText, baseOrigin = activeDomain) {
  if (!htmlText) return { streamUrl: '', iframeUrl: '' };

  const blocksToInspect = [htmlText, ...unpackDeanEdwards(htmlText)];

  for (const block of blocksToInspect) {
    // Stage 1: Balanced-brace CMS player objects
    const cmsObjects = extractBalancedJsonObject(
      block,
      '(?:var\\s+|window\\.)?(?:player_aaaa|player_data|player_config)',
    );
    for (const jsonStr of cmsObjects) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && parsed.url) {
          const decoded = decodeCmsPlayerUrl(parsed.url, parsed.encrypt);
          const unwrapped = unwrapNestedPlayerUrl(decoded, baseOrigin);
          if (isDirectMediaUrl(unwrapped, baseOrigin)) {
            return { streamUrl: unwrapped, iframeUrl: '' };
          }
          if (unwrapped && /^https?:\/\//i.test(unwrapped) && !isDecoyOrAdUrl(unwrapped)) {
            return { streamUrl: '', iframeUrl: unwrapped };
          }
        }
      } catch (_) {}
    }

    const normalizedBlock = unescapeTextForUrlScan(block);

    // Stage 2: <source src="...m3u8/mp4...">
    const sourceRegex = /<source[^>]+src=["']([^"']+)["']/gi;
    let srcMatch;
    while ((srcMatch = sourceRegex.exec(normalizedBlock)) !== null) {
      const unwrapped = unwrapNestedPlayerUrl(srcMatch[1], baseOrigin);
      if (isDirectMediaUrl(unwrapped, baseOrigin)) {
        return { streamUrl: unwrapped, iframeUrl: '' };
      }
    }

    // Stage 3: High-priority JS variables (playUrl, videoUrl, url, m3u8)
    const varRegex =
      /\b(?:play_?url|video_?url|stream_?url|hls_?url|m3u8_?url)\s*[:=]\s*["']([^"']+)["']/gi;
    let vMatch;
    while ((vMatch = varRegex.exec(normalizedBlock)) !== null) {
      const unwrapped = unwrapNestedPlayerUrl(vMatch[1], baseOrigin);
      if (isDirectMediaUrl(unwrapped, baseOrigin)) {
        return { streamUrl: unwrapped, iframeUrl: '' };
      }
    }

    // Stage 4: Direct .m3u8 URLs in HTML
    const m3u8Regex = /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/gi;
    let m3u8Match;
    while ((m3u8Match = m3u8Regex.exec(normalizedBlock)) !== null) {
      const unwrapped = unwrapNestedPlayerUrl(m3u8Match[0], baseOrigin);
      if (isDirectMediaUrl(unwrapped, baseOrigin)) {
        return { streamUrl: unwrapped, iframeUrl: '' };
      }
    }

    // Stage 5: <video src="...">
    const videoRegex = /<video[^>]+src=["']([^"']+)["']/gi;
    let vidMatch;
    while ((vidMatch = videoRegex.exec(normalizedBlock)) !== null) {
      const unwrapped = unwrapNestedPlayerUrl(vidMatch[1], baseOrigin);
      if (isDirectMediaUrl(unwrapped, baseOrigin)) {
        return { streamUrl: unwrapped, iframeUrl: '' };
      }
    }

    // Stage 6: Direct .mp4 URLs in HTML (excluding previews/ads)
    const mp4Regex = /https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/gi;
    let mp4Match;
    while ((mp4Match = mp4Regex.exec(normalizedBlock)) !== null) {
      const unwrapped = unwrapNestedPlayerUrl(mp4Match[0], baseOrigin);
      if (isDirectMediaUrl(unwrapped, baseOrigin)) {
        return { streamUrl: unwrapped, iframeUrl: '' };
      }
    }
  }

  // Stage 7: Check for embedded player <iframe src="..."> or data-src
  const iframeTagRegex = /<iframe[^>]+>/gi;
  let iframeTagMatch;
  while ((iframeTagMatch = iframeTagRegex.exec(htmlText)) !== null) {
    const tag = iframeTagMatch[0];
    const attrs = ['data-litespeed-src', 'data-lazy-src', 'data-src', 'src'];
    for (const attr of attrs) {
      const m = tag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      if (m) {
        const rawIframe = decodeHtmlEntities(m[1].trim());
        if (
          rawIframe &&
          !rawIframe.startsWith('about:blank') &&
          !rawIframe.startsWith('javascript:') &&
          !rawIframe.startsWith('data:') &&
          !isDecoyOrAdUrl(rawIframe)
        ) {
          const unwrapped = unwrapNestedPlayerUrl(rawIframe, baseOrigin);
          if (isDirectMediaUrl(unwrapped, baseOrigin)) {
            return { streamUrl: unwrapped, iframeUrl: '' };
          }
          try {
            return { streamUrl: '', iframeUrl: new URL(rawIframe, baseOrigin).href };
          } catch (_) {}
        }
      }
    }
  }

  return { streamUrl: '', iframeUrl: '' };
}

async function resolvePlayStreamFromPage(pagePathOrUrl, initialHtml = '', initialFinalUrl = '') {
  let html = initialHtml;
  let finalUrl = initialFinalUrl;

  if (!html) {
    const fetched = await fetchHtml(pagePathOrUrl);
    html = fetched.text;
    finalUrl = fetched.finalUrl || pagePathOrUrl;
  }

  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(finalUrl || activeDomain).origin;
  } catch (_) {}

  const firstPass = extractStreamFromTextBlock(html, baseOrigin);
  if (firstPass.streamUrl) {
    return firstPass.streamUrl;
  }

  if (firstPass.iframeUrl) {
    const iframeRes = await fetchHtml(firstPass.iframeUrl, finalUrl || `${baseOrigin}/`);
    if (iframeRes.text) {
      let iframeOrigin = baseOrigin;
      try {
        iframeOrigin = new URL(iframeRes.finalUrl || firstPass.iframeUrl).origin;
      } catch (_) {}
      const secondPass = extractStreamFromTextBlock(iframeRes.text, iframeOrigin);
      if (secondPass.streamUrl) {
        return secondPass.streamUrl;
      }
    }
  }

  return '';
}

function sanitizePlayId(rawId) {
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

async function home(inReq, _outResp) {
  let homeList = [];
  try {
    const firstTid = STATIC_CLASSES[0]?.type_id || '23';
    const catRes = await getCategoryData(firstTid, 1, {});
    homeList = catRes.list || [];
  } catch (_) {}

  return {
    class: STATIC_CLASSES,
    filters: buildFilters(),
    list: homeList,
    style: CARD_STYLE,
  };
}

async function getCategoryData(tid, page, extendObj) {
  const sortVal =
    extendObj && typeof extendObj === 'object' ? String(extendObj.sort || '').trim() : '';
  const cacheKey = `cat_${tid}_${page}_${sortVal}`;
  const now = Date.now();
  const cached = CATEGORY_CACHE.get(cacheKey);
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.data;
  }

  const queryParts = [];
  if (page > 1) {
    queryParts.push(`page=${page}`);
  }
  if (sortVal) {
    queryParts.push(`sort=${encodeURIComponent(sortVal)}`);
  }
  const queryStr = queryParts.length ? `?${queryParts.join('&')}` : '';
  const targetPath = `/c/${tid}${queryStr}`;

  const fetchRes = await fetchHtml(targetPath);
  const vodItems = parseVideoCards(fetchRes.text);

  const outData = {
    page,
    pagecount: vodItems.length >= 20 ? page + 1 : page,
    limit: vodItems.length || 20,
    total: 9999,
    list: vodItems,
    style: CARD_STYLE,
  };

  if (vodItems.length > 0) {
    CATEGORY_CACHE.set(cacheKey, { time: now, data: outData });
  }
  return outData;
}

async function category(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const tid = String(params.id ?? params.tid ?? params.type_id ?? STATIC_CLASSES[0].type_id).trim();
  let page = Number.parseInt(params.page ?? params.pg ?? '1', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  const extendObj =
    params.extend && typeof params.extend === 'object'
      ? params.extend
      : params.filters && typeof params.filters === 'object'
        ? params.filters
        : { sort: params.sort || '' };

  return getCategoryData(tid, page, extendObj);
}

async function detail(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const rawIds = params.id ?? params.ids ?? params.vod_id ?? params.url ?? '';
  const firstId = Array.isArray(rawIds) ? rawIds[0] : rawIds;
  const vid = String(firstId || '').trim();
  if (!vid) {
    return { list: [] };
  }

  const detailPath =
    vid.startsWith('http://') || vid.startsWith('https://') || vid.startsWith('/')
      ? vid
      : `/${vid}`;

  const res = await fetchHtml(detailPath);
  const htmlText = res.text || '';

  let vodTitle = `影片 ${vid}`;
  const titleMatch = htmlText.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const cleanedTitle = decodeHtmlEntities(titleMatch[1].split('-')[0].trim());
    if (cleanedTitle) vodTitle = cleanedTitle;
  } else {
    const h1Match = htmlText.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const cleanedH1 = decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, '').trim());
      if (cleanedH1) vodTitle = cleanedH1;
    }
  }

  let vodPic = '';
  const posterMatch =
    htmlText.match(/\bposter=["']([^"']+)["']/i) ||
    htmlText.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    htmlText.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (posterMatch) {
    vodPic = posterMatch[1].trim();
  }

  let resolvedPlayUrl = await resolvePlayStreamFromPage(detailPath, htmlText, res.finalUrl);
  if (!resolvedPlayUrl) {
    resolvedPlayUrl = detailPath.startsWith('http')
      ? detailPath
      : `${activeDomain.replace(/\/+$/, '')}${detailPath}`;
  } else {
    PLAY_CACHE.set(vid, { time: Date.now(), url: resolvedPlayUrl });
    PLAY_CACHE.set(detailPath, { time: Date.now(), url: resolvedPlayUrl });
  }

  const vod = {
    vod_id: vid,
    vod_name: vodTitle,
    vod_pic: cleanPicUrl(vodPic),
    vod_actor: BRAND_ACTOR,
    vod_director: BRAND_DIRECTOR,
    vod_remarks: formatRemarks(BRAND_NAME, '正片'),
    vod_content: BRAND_CONTENT,
    vod_play_from: '蝴蝶专线',
    vod_play_url: `超清正片$${resolvedPlayUrl}`,
  };

  return { list: [vod] };
}

async function play(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const rawInput = params.id ?? params.url ?? params.playUrl ?? '';
  const cleanedId = sanitizePlayId(rawInput);

  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: `${activeDomain.replace(/\/+$/, '')}/`,
  };

  if (!cleanedId) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: '',
      header: playHeaders,
      headers: playHeaders,
    };
  }

  // Check if cleanedId is already a direct stream or a wrapper URL with embedded stream
  const unwrappedDirect = unwrapNestedPlayerUrl(cleanedId, activeDomain);
  if (isDirectMediaUrl(unwrappedDirect, activeDomain)) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: unwrappedDirect,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  // Check PLAY_CACHE
  const cached = PLAY_CACHE.get(cleanedId);
  if (cached && Date.now() - cached.time < PLAY_CACHE_TTL_MS && isDirectMediaUrl(cached.url)) {
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: cached.url,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  // Otherwise resolve from page
  const pageTarget =
    cleanedId.startsWith('http://') || cleanedId.startsWith('https://') || cleanedId.startsWith('/')
      ? cleanedId
      : `/${cleanedId}`;

  const resolvedStream = await resolvePlayStreamFromPage(pageTarget);
  if (resolvedStream && isDirectMediaUrl(resolvedStream, activeDomain)) {
    PLAY_CACHE.set(cleanedId, { time: Date.now(), url: resolvedStream });
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: resolvedStream,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const fallbackUrl =
    expandCandidateUrls(pageTarget)[0] ||
    `${activeDomain.replace(/\/+$/, '')}/${cleanedId.replace(/^\/+/, '')}`;

  return {
    parse: 1,
    jx: 0,
    playUrl: '',
    url: fallbackUrl,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function search(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  let page = Number.parseInt(params.page ?? params.pg ?? '1', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  if (!key) {
    return { page: 1, pagecount: 1, limit: 20, total: 0, list: [] };
  }

  let queryStr = `?keyword=${encodeURIComponent(key)}`;
  if (page > 1) {
    queryStr += `&page=${page}`;
  }

  const searchPath = `/node/search${queryStr}`;
  const res = await fetchHtml(searchPath);
  const vodItems = parseVideoCards(res.text);

  return {
    page,
    pagecount: vodItems.length >= 20 ? page + 1 : page,
    limit: vodItems.length || 20,
    total: 9999,
    list: vodItems,
    style: CARD_STYLE,
  };
}

async function proxyPicHandler(query = {}) {
  const rawUrl = String(query.url || query.pic || '').split('@Referer=')[0].trim();
  if (!rawUrl) {
    return { mime: 'text/plain; charset=utf-8', data: 'Missing url' };
  }
  try {
    const resp = await req(rawUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: `${activeDomain}/`,
      },
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    const mime =
      resp?.headers?.['content-type'] || resp?.headers?.['Content-Type'] || 'image/jpeg';
    const data = resp?.data ?? resp?.body ?? Buffer.alloc(0);
    return { mime, data: Buffer.isBuffer(data) ? data : Buffer.from(data) };
  } catch (_) {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'jiujiu',
    name: '久久网',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/jiujiu_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};