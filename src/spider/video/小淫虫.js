import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://xyc01.eu.cc',
];

let activeDomain = SITE_DOMAINS[0];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const RECT_178_STYLE = { type: 'rect', ratio: 1.78 };

const MAIN_CLASSES = [
  { type_id: '1', type_name: '杏吧资源' },
  { type_id: '2', type_name: '滴滴资源' },
  { type_id: '3', type_name: '黄色仓库' },
];

const FILTERS_CACHE = {
  '1': [
    {
      key: 'sub_id',
      name: '子分类',
      init: '1',
      value: [
        { n: '全部', v: '1' },
        { n: '日韩无码', v: '6' },
        { n: '国产精品', v: '7' },
        { n: '日韩精品', v: '8' },
        { n: '欧美精品', v: '9' },
        { n: '自拍偷拍', v: '11' },
        { n: '伦理影片', v: '12' },
        { n: '中文字幕', v: '20' },
        { n: '人妻系列', v: '21' },
        { n: '制服诱惑', v: '22' },
        { n: '强奸乱伦', v: '23' },
        { n: 'AV明星', v: '24' },
        { n: 'SM重味', v: '25' },
        { n: '巨乳系列', v: '26' },
        { n: '颜射系列', v: '27' },
        { n: '口交视频', v: '28' },
        { n: '自慰系列', v: '29' },
        { n: '教师学生', v: '30' },
        { n: '大秀视频', v: '31' },
        { n: '明星换脸', v: '32' },
        { n: 'AV解说', v: '33' },
      ],
    },
  ],
  '2': [
    {
      key: 'sub_id',
      name: '子分类',
      init: '2',
      value: [
        { n: '全部', v: '2' },
        { n: '特色专区', v: '13' },
        { n: '精品动漫', v: '14' },
        { n: '爱豆传媒', v: '15' },
        { n: '国产精品', v: '17' },
        { n: '国产探花', v: '18' },
        { n: '国产乱伦', v: '34' },
        { n: '美女主播', v: '35' },
        { n: '网红大V精选', v: '36' },
        { n: 'ASMR', v: '37' },
        { n: '制服诱惑', v: '38' },
        { n: '日本无码', v: '39' },
        { n: '日本有码', v: '40' },
        { n: '网曝门事件', v: '41' },
        { n: '麻豆传媒', v: '42' },
        { n: '中文字幕', v: '44' },
        { n: '欧美专区', v: '45' },
        { n: 'AV解说', v: '46' },
        { n: '其他传媒', v: '47' },
        { n: 'SM调教', v: '48' },
      ],
    },
  ],
  '3': [
    {
      key: 'sub_id',
      name: '子分类',
      init: '3',
      value: [
        { n: '全部', v: '3' },
        { n: '人妻熟女', v: '49' },
        { n: '日本无码', v: '50' },
        { n: '美乳巨乳', v: '51' },
        { n: '强制侵犯', v: '52' },
        { n: '制服诱惑', v: '53' },
        { n: '绝色佳人', v: '54' },
        { n: '风俗泡泡浴', v: '55' },
        { n: '家庭乱伦', v: '56' },
        { n: '少女萝莉', v: '57' },
        { n: 'SM调教', v: '58' },
        { n: '绝顶潮吹', v: '59' },
        { n: '魔镜系列', v: '60' },
        { n: '时间停止', v: '61' },
        { n: '催眠洗脑', v: '62' },
        { n: '漫改系列', v: '63' },
        { n: '电车痴汉', v: '64' },
        { n: '淫欲痴女', v: '65' },
        { n: '欧美区', v: '43' },
        { n: '中国AV', v: '16' },
        { n: '动漫精品', v: '10' },
      ],
    },
  ],
};

// In-memory stream cache warmed by /detail (10-minute TTL)
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function setPlayCache(key, streamUrl, refererUrl) {
  if (!key || !streamUrl) return;
  PLAY_CACHE.set(String(key), {
    url: streamUrl,
    referer: refererUrl || `${activeDomain}/`,
    ts: Date.now(),
  });
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

function getDefaultHeaders(referer) {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: referer || `${activeDomain}/`,
  };
}

function unwrapRequestParams(inReq) {
  const merged = {};
  const sources = [inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') Object.assign(merged, parsed);
          continue;
        } catch (_) {}
      }
      try {
        const params = new URLSearchParams(trimmed);
        for (const [k, v] of params.entries()) {
          merged[k] = v;
        }
      } catch (_) {}
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  if (typeof merged.extend === 'string') {
    const extStr = merged.extend.trim();
    if (extStr.startsWith('{')) {
      try {
        merged.extend = JSON.parse(extStr);
      } catch (_) {}
    }
  }
  if (typeof merged.filters === 'string') {
    const fltStr = merged.filters.trim();
    if (fltStr.startsWith('{')) {
      try {
        merged.filters = JSON.parse(fltStr);
      } catch (_) {}
    }
  }
  return merged;
}

function decodeResponseBuffer(rawData, headers = {}) {
  if (rawData == null) return '';
  if (typeof rawData === 'string') return rawData;

  let buf = Buffer.isBuffer(rawData)
    ? rawData
    : rawData instanceof ArrayBuffer
      ? Buffer.from(rawData)
      : ArrayBuffer.isView(rawData)
        ? Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength)
        : null;

  if (!buf) {
    if (typeof rawData === 'object') {
      try {
        return JSON.stringify(rawData);
      } catch (_) {
        return String(rawData);
      }
    }
    return String(rawData);
  }

  // Decompress gzip if magic bytes 0x1f 0x8b are present
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = zlib.gunzipSync(buf);
    } catch (_) {}
  }

  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  if (contentType.includes('gbk') || contentType.includes('gb2312') || contentType.includes('gb18030')) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch (_) {}
  }

  const utf8Text = buf.toString('utf8');
  if (utf8Text.includes('\ufffd')) {
    try {
      const gbkText = new TextDecoder('gbk').decode(buf);
      if (!gbkText.includes('\ufffd')) return gbkText;
    } catch (_) {}
  }
  return utf8Text;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    try {
      if (new URL(d).hostname.toLowerCase() === lower) return true;
    } catch (_) {}
  }
  return false;
}

function expandCandidateUrls(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return [];
  const uniqueDomains = Array.from(new Set([activeDomain, ...SITE_DOMAINS].filter(Boolean)));

  if (raw.startsWith('/')) {
    return uniqueDomains.map((d) => `${d.replace(/\/+$/, '')}${raw}`);
  }

  try {
    const parsed = new URL(raw);
    if (isKnownSiteHost(parsed.hostname)) {
      const pathAndQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      const list = uniqueDomains.map((d) => `${d.replace(/\/+$/, '')}${pathAndQuery}`);
      if (!list.includes(raw)) list.unshift(raw);
      return Array.from(new Set(list));
    }
  } catch (_) {}

  return [raw];
}

function hasValidSiteFingerprint(html) {
  if (!html || typeof html !== 'string') return false;
  return (
    html.includes('/index.php/vod/') ||
    html.includes('player_aaaa') ||
    html.includes('yt-video-title') ||
    html.includes('.m3u8') ||
    html.includes('.mp4') ||
    html.includes('<video') ||
    html.includes('<iframe') ||
    html.includes('<h1') ||
    html.includes('vodPic')
  );
}

async function fetchHtml(urlOrPath, customHeaders = {}) {
  const candidates = expandCandidateUrls(urlOrPath);
  let lastError = null;
  let lastHtml = '';
  let lastUrl = candidates[0] || String(urlOrPath);

  for (const targetUrl of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(targetUrl).origin;
    } catch (_) {}

    const headers = {
      ...getDefaultHeaders(`${origin}/`),
      ...customHeaders,
    };
    if (customHeaders.Referer) {
      try {
        const refUrl = new URL(customHeaders.Referer);
        if (isKnownSiteHost(refUrl.hostname)) {
          headers.Referer = `${origin}${refUrl.pathname}${refUrl.search}`;
        }
      } catch (_) {}
    }

    try {
      const resp = await req.get(targetUrl, {
        headers,
        timeout: 10000,
      });
      const status = resp?.status ?? resp?.statusCode ?? 200;
      const html = decodeResponseBuffer(resp?.data ?? resp?.body ?? resp, resp?.headers);
      lastHtml = html;
      lastUrl = targetUrl;

      if (status >= 200 && status < 400 && html && hasValidSiteFingerprint(html)) {
        if (isKnownSiteHost(new URL(targetUrl).hostname)) {
          activeDomain = origin;
        }
        return { html, status, finalUrl: targetUrl };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return {
    html: lastHtml || (lastError ? String(lastError.message || lastError) : ''),
    status: lastHtml ? 200 : 500,
    finalUrl: lastUrl,
  };
}

function cleanPic(picUrl, baseUrl = activeDomain) {
  if (!picUrl) return '';
  let clean = String(picUrl)
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
  if (!clean) return '';
  if (clean.startsWith('data:')) return '';
  if (clean.startsWith('//')) return `https:${clean}`;
  if (!/^https?:\/\//i.test(clean)) {
    const base = (baseUrl || activeDomain).replace(/\/+$/, '');
    clean = clean.startsWith('/') ? `${base}${clean}` : `${base}/${clean}`;
  }
  return clean;
}

function cleanTitle(rawTitle) {
  if (!rawTitle) return '正片';
  let t = String(rawTitle)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .trim();
  t = t.replace(/\s*-\s*(?:正片|HD|高清观看|小淫虫).*$/i, '');
  t = t.replace(/^在线播放\s*/i, '');
  return t.trim() || '正片';
}

function isUsableCoverImg(candidate) {
  if (!candidate) return false;
  const s = String(candidate).trim();
  if (!s || s.startsWith('data:')) return false;
  if (s.includes('/statics/img/')) return false;
  if (/\.gif(?:[?#]|$)/i.test(s)) return false;
  return true;
}

function extractBestImgFromBlock(body, baseUrl = activeDomain) {
  if (!body) return '';
  const attrRegex = /\b(?:data-original|data-src|data-lazy-src|src)\s*=\s*['"]([^'"]+)['"]/gi;
  const candidates = [];
  let m;
  while ((m = attrRegex.exec(body)) !== null) {
    if (m[1]) candidates.push(m[1]);
  }
  for (const cand of candidates) {
    if (isUsableCoverImg(cand)) {
      return cleanPic(cand, baseUrl);
    }
  }
  return '';
}

function parseCardsFromHtml(html, baseUrl = activeDomain) {
  if (!html || typeof html !== 'string') return [];

  const cardMap = new Map();
  const orderedIds = [];

  // Match all anchor tags linking to /index.php/vod/play/id/<vid> or /index.php/vod/detail/id/<vid>
  const anchorBoundaryRegex =
    /<a\s+([^>]*href\s*=\s*['"][^'"]*?\/index\.php\/vod\/(?:play|detail)\/id\/(\d+)[^'"]*['"][^>]*)>([\s\S]*?)(?=<a\s+[^>]*href\s*=\s*['"][^'"]*?\/index\.php\/vod\/(?:play|detail)\/id\/|<\/body>|$)/gi;

  let match;
  while ((match = anchorBoundaryRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const vid = match[2];
    const body = match[3] || '';

    if (!vid) continue;
    if (body.includes('ad-item') || body.includes('pg43h') || attrs.includes('ad-item')) {
      continue;
    }

    const titleAttrMatch = attrs.match(/\btitle\s*=\s*['"]([^'"]+)['"]/i);
    let rawTitle = titleAttrMatch ? titleAttrMatch[1].trim() : '';

    if (!rawTitle) {
      const innerTitleAttr = body.match(/\b(?:title|alt)\s*=\s*['"]([^'"]+)['"]/i);
      if (innerTitleAttr) rawTitle = innerTitleAttr[1].trim();
    }
    if (!rawTitle) {
      const textOnly = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (textOnly) rawTitle = textOnly;
    }

    const pic = extractBestImgFromBlock(body, baseUrl);

    if (!cardMap.has(vid)) {
      orderedIds.push(vid);
      cardMap.set(vid, {
        vod_id: String(vid),
        vod_name: rawTitle ? cleanTitle(rawTitle) : `编号 ${vid}`,
        vod_pic: pic,
        vod_remarks: '蝴蝶影视 | HD',
        style: RECT_178_STYLE,
      });
    } else {
      const existing = cardMap.get(vid);
      if ((!existing.vod_name || existing.vod_name === `编号 ${vid}` || existing.vod_name === '正片') && rawTitle) {
        existing.vod_name = cleanTitle(rawTitle);
      }
      if (!existing.vod_pic && pic) {
        existing.vod_pic = pic;
      }
    }
  }

  return orderedIds.map((id) => cardMap.get(id));
}

function unescapeUnicodeAndHex(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
}

function customUnescape(str) {
  if (!str) return '';
  let s = String(str)
    .replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  try {
    s = decodeURIComponent(s);
  } catch (_) {}
  return s;
}

function decodePlayerUrlByEncrypt(rawUrl, encryptType = 0) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let u = rawUrl.trim();
  const enc = Number(encryptType) || 0;

  if (enc === 1) {
    u = customUnescape(u);
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      u = customUnescape(b64Decoded);
    } catch (_) {}
  }

  u = unescapeUnicodeAndHex(u).trim();
  return u;
}

function isDecoyOrAdUrl(urlStr) {
  if (!urlStr) return true;
  const lower = String(urlStr).toLowerCase();
  return (
    lower.includes('preview.mp4') ||
    lower.includes('sample.mp4') ||
    lower.includes('trailer.mp4') ||
    lower.includes('top_banner') ||
    lower.includes('native-ad') ||
    lower.includes('stat.php') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.png')
  );
}

function isDirectMediaUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const s = urlStr.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (isDecoyOrAdUrl(s)) return false;
  try {
    const parsed = new URL(s);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(?:m3u8|mp4|flv|mpd|ts|mkv)(?:$)/i.test(pathname)) {
      return true;
    }
  } catch (_) {
    if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(s) && !/[?&]url=/i.test(s)) {
      return true;
    }
  }
  return false;
}

function unwrapNestedMediaUrl(rawUrl, baseUrl = activeDomain) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let candidate = unescapeUnicodeAndHex(rawUrl).trim();
  if (!candidate) return '';

  if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else if (candidate.startsWith('/')) {
    candidate = `${(baseUrl || activeDomain).replace(/\/+$/, '')}${candidate}`;
  }

  for (let pass = 0; pass < 2; pass++) {
    if (isDirectMediaUrl(candidate)) return candidate;
    try {
      const parsed = new URL(candidate);
      const pathname = parsed.pathname.toLowerCase();
      if (!/\.(?:m3u8|mp4|flv|mpd)$/i.test(pathname)) {
        for (const paramKey of ['url', 'v', 'vid', 'src', 'file', 'm3u8', 'play']) {
          const innerVal = parsed.searchParams.get(paramKey);
          if (innerVal) {
            let decodedInner = customUnescape(innerVal);
            decodedInner = unescapeUnicodeAndHex(decodedInner).trim();
            if (decodedInner.startsWith('//')) decodedInner = `https:${decodedInner}`;
            if (/^https?:\/\//i.test(decodedInner)) {
              candidate = decodedInner;
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  return candidate;
}

/**
 * Balanced-brace JSON extractor for CMS player variables (e.g., player_aaaa, player_data, player_config).
 * Safely handles nested objects like vod_data: {"vod_name": "..."} without truncating at the inner '}'.
 */
function extractBalancedObjectsByVarNames(html, varNames = ['player_aaaa', 'player_data', 'player_config']) {
  if (!html || typeof html !== 'string') return [];
  const results = [];

  for (const varName of varNames) {
    const regex = new RegExp(`(?:var|let|const|window\\.)?\\s*${varName}\\s*=\\s*\\{`, 'g');
    let m;
    while ((m = regex.exec(html)) !== null) {
      const startBraceIdx = m.index + m[0].lastIndexOf('{');
      let depth = 0;
      let inString = false;
      let quoteChar = '';
      let escaped = false;

      for (let i = startBraceIdx; i < html.length; i++) {
        const ch = html[i];
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
              results.push(html.slice(startBraceIdx, i + 1));
              break;
            }
          }
        }
      }
    }
  }

  return results;
}

/**
 * Unpack Dean Edwards Packer blocks: eval(function(p,a,c,k,e,d)...('payload',radix,count,'dict'.split('|')))
 */
function unpackDeanEdwardsPacker(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const unpackedBlocks = [];
  const packerRegex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  const encodeBase = (num, radix) => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (num < radix) {
      return num < 36 ? num.toString(36) : chars[num] || '';
    }
    return encodeBase(Math.floor(num / radix), radix) + (num % radix < 36 ? (num % radix).toString(36) : chars[num % radix]);
  };

  let m;
  while ((m = packerRegex.exec(html)) !== null) {
    const payload = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    const radix = parseInt(m[3], 10) || 36;
    const count = parseInt(m[4], 10) || 0;
    const symtab = m[6].split('|');

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const token = encodeBase(i, radix);
      const replacement = symtab[i];
      if (replacement) {
        dict.set(token, replacement);
      }
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) => (dict.has(word) ? dict.get(word) : word));
    unpackedBlocks.push(unpacked);
  }
  return unpackedBlocks;
}

function parseStreamFromPlayerObjectString(rawObjStr, baseUrl = activeDomain) {
  if (!rawObjStr) return '';

  // Try strict JSON.parse first
  try {
    const parsed = JSON.parse(rawObjStr);
    if (parsed && typeof parsed === 'object' && parsed.url) {
      const decoded = decodePlayerUrlByEncrypt(String(parsed.url), parsed.encrypt);
      const unwrapped = unwrapNestedMediaUrl(decoded, baseUrl);
      if (unwrapped) return unwrapped;
    }
  } catch (_) {}

  // Fallback regex extraction on raw object string if keys are unquoted or contain JS expressions
  const encMatch = rawObjStr.match(/['"]?encrypt['"]?\s*:\s*['"]?(\d+)['"]?/i);
  const encryptType = encMatch ? parseInt(encMatch[1], 10) : 0;

  const urlFieldRegex = /['"]?url['"]?\s*:\s*(['"])((?:\\.|(?!\1).)+)\1/gi;
  let m;
  while ((m = urlFieldRegex.exec(rawObjStr)) !== null) {
    const rawCandidate = m[2];
    const decoded = decodePlayerUrlByEncrypt(rawCandidate, encryptType);
    const unwrapped = unwrapNestedMediaUrl(decoded, baseUrl);
    if (isDirectMediaUrl(unwrapped) || /^https?:\/\//i.test(unwrapped)) {
      return unwrapped;
    }
  }

  return '';
}

function extractStreamSyncFromHtml(html, baseUrl = activeDomain) {
  if (!html || typeof html !== 'string') return { streamUrl: '', wrapperUrl: '' };

  let wrapperCandidate = '';

  // Stage 1: Balanced-brace extraction of CMS player config objects
  const balancedObjs = extractBalancedObjectsByVarNames(html, ['player_aaaa', 'player_data', 'player_config']);
  for (const objStr of balancedObjs) {
    const candidate = parseStreamFromPlayerObjectString(objStr, baseUrl);
    if (candidate) {
      if (isDirectMediaUrl(candidate)) {
        return { streamUrl: candidate, wrapperUrl: '' };
      }
      if (!wrapperCandidate && /^https?:\/\//i.test(candidate)) {
        wrapperCandidate = candidate;
      }
    }
  }

  // Stage 2: Unpack Dean Edwards packed JS blocks and scan
  const unpackedList = unpackDeanEdwardsPacker(html);
  for (const unpacked of unpackedList) {
    const innerObjs = extractBalancedObjectsByVarNames(unpacked, ['player_aaaa', 'player_data', 'player_config']);
    for (const objStr of innerObjs) {
      const candidate = parseStreamFromPlayerObjectString(objStr, baseUrl);
      if (isDirectMediaUrl(candidate)) {
        return { streamUrl: candidate, wrapperUrl: '' };
      }
    }
    const normalizedUnpacked = unescapeUnicodeAndHex(unpacked);
    const unpackedM3u8 = normalizedUnpacked.match(/https?:\/\/[^\s'"<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s'"<>\\]*)?/gi) || [];
    for (const rawMatch of unpackedM3u8) {
      const unwrapped = unwrapNestedMediaUrl(rawMatch, baseUrl);
      if (isDirectMediaUrl(unwrapped)) {
        return { streamUrl: unwrapped, wrapperUrl: '' };
      }
    }
  }

  // Stage 3: Unescape slashes/unicode across HTML and scan priority variables and direct media URLs
  const normalizedHtml = unescapeUnicodeAndHex(html);

  const priorityVarRegex =
    /\b(?:playUrl|videoUrl|m3u8Url|vUrl|video_url|stream_url|hlsUrl)\s*[:=]\s*['"]([^'"]+)['"]/gi;
  let pm;
  while ((pm = priorityVarRegex.exec(normalizedHtml)) !== null) {
    const unwrapped = unwrapNestedMediaUrl(pm[1], baseUrl);
    if (isDirectMediaUrl(unwrapped)) {
      return { streamUrl: unwrapped, wrapperUrl: '' };
    }
  }

  const directRegex = /['"](https?:\/\/[^'"\s<>\\]+?\.(?:m3u8|mp4)[^'"\s<>\\]*)['"]/gi;
  let dm;
  while ((dm = directRegex.exec(normalizedHtml)) !== null) {
    const unwrapped = unwrapNestedMediaUrl(dm[1], baseUrl);
    if (isDirectMediaUrl(unwrapped)) {
      return { streamUrl: unwrapped, wrapperUrl: '' };
    }
  }

  // Stage 4 candidate discovery: look for embedded player iframe src / data-src
  if (!wrapperCandidate) {
    const iframeRegex = /<iframe\s+[^>]*?(?:data-src|src)\s*=\s*['"]([^'"]+)['"]/gi;
    let im;
    while ((im = iframeRegex.exec(html)) !== null) {
      const rawIframeSrc = im[1].trim();
      if (!rawIframeSrc || rawIframeSrc.startsWith('javascript:') || rawIframeSrc === 'about:blank') continue;
      const unwrapped = unwrapNestedMediaUrl(rawIframeSrc, baseUrl);
      if (isDirectMediaUrl(unwrapped)) {
        return { streamUrl: unwrapped, wrapperUrl: '' };
      }
      let fullIframeUrl = rawIframeSrc;
      if (fullIframeUrl.startsWith('//')) fullIframeUrl = `https:${fullIframeUrl}`;
      else if (fullIframeUrl.startsWith('/')) fullIframeUrl = `${baseUrl.replace(/\/+$/, '')}${fullIframeUrl}`;
      if (/^https?:\/\//i.test(fullIframeUrl) && !isDecoyOrAdUrl(fullIframeUrl)) {
        wrapperCandidate = fullIframeUrl;
        break;
      }
    }
  }

  return { streamUrl: '', wrapperUrl: wrapperCandidate };
}

function extractPlayRoutesFromHtml(html, vid) {
  if (!html || typeof html !== 'string') return [];
  const routes = [];
  const seen = new Set();
  const routeRegex = new RegExp(
    `(/index\\.php/vod/play/id/${vid || '\\d+'}/sid/(\\d+)/nid/(\\d+)\\.html)`,
    'gi'
  );
  let m;
  while ((m = routeRegex.exec(html)) !== null) {
    const path = m[1];
    const sid = m[2];
    const nid = m[3];
    if (!seen.has(path)) {
      seen.add(path);
      routes.push({ path, sid, nid });
    }
  }
  return routes;
}

async function resolveFullStreamFromPlayHtml(html, playPageUrl, vid = '') {
  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(playPageUrl).origin;
  } catch (_) {}

  const syncRes = extractStreamSyncFromHtml(html, baseOrigin);
  if (syncRes.streamUrl) {
    return { streamUrl: syncRes.streamUrl, referer: `${baseOrigin}/` };
  }

  // Stage 4: Follow wrapper player URL or iframe URL
  if (syncRes.wrapperUrl) {
    const unwrappedDirect = unwrapNestedMediaUrl(syncRes.wrapperUrl, baseOrigin);
    if (isDirectMediaUrl(unwrappedDirect)) {
      return { streamUrl: unwrappedDirect, referer: playPageUrl };
    }
    try {
      const { html: iframeHtml, finalUrl: iframeFinalUrl } = await fetchHtml(syncRes.wrapperUrl, {
        Referer: playPageUrl,
      });
      if (iframeHtml) {
        let iframeOrigin = baseOrigin;
        try {
          iframeOrigin = new URL(iframeFinalUrl).origin;
        } catch (_) {}
        const innerRes = extractStreamSyncFromHtml(iframeHtml, iframeOrigin);
        if (innerRes.streamUrl) {
          return { streamUrl: innerRes.streamUrl, referer: iframeFinalUrl };
        }
      }
    } catch (_) {}
  }

  // Stage 5: Discover alternative play routes (e.g. sid/2/nid/1) if default route had no stream
  if (vid) {
    let candidateRoutes = extractPlayRoutesFromHtml(html, vid);
    if (candidateRoutes.length === 0) {
      try {
        const { html: detailHtml } = await fetchHtml(`/index.php/vod/detail/id/${vid}.html`);
        if (detailHtml) {
          candidateRoutes = extractPlayRoutesFromHtml(detailHtml, vid);
        }
      } catch (_) {}
    }

    for (const route of candidateRoutes) {
      if (playPageUrl.includes(route.path)) continue;
      try {
        const { html: altHtml, finalUrl: altFinalUrl } = await fetchHtml(route.path);
        if (!altHtml) continue;
        const altSync = extractStreamSyncFromHtml(altHtml, baseOrigin);
        if (altSync.streamUrl) {
          return { streamUrl: altSync.streamUrl, referer: `${baseOrigin}/` };
        }
        if (altSync.wrapperUrl) {
          const unwrappedAlt = unwrapNestedMediaUrl(altSync.wrapperUrl, baseOrigin);
          if (isDirectMediaUrl(unwrappedAlt)) {
            return { streamUrl: unwrappedAlt, referer: altFinalUrl };
          }
        }
      } catch (_) {}
    }
  }

  return { streamUrl: '', referer: `${baseOrigin}/` };
}

function sanitizeEpisodeId(rawId) {
  let id = String(rawId || '').trim();
  if (!id) return '';

  // Strip custom metadata suffix @@@
  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }

  // Strip leading episode label prefix like "正片$12345" or "第1集$https://..."
  if (id.includes('$')) {
    const dollarIdx = id.indexOf('$');
    const prefix = id.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      id = id.slice(dollarIdx + 1).trim();
    }
  }

  return id;
}

function normalizeVidAndPlayPath(rawId) {
  const cleaned = sanitizeEpisodeId(rawId);
  if (!cleaned) return { vid: '', playPath: '' };

  if (/^\d+$/.test(cleaned)) {
    return {
      vid: cleaned,
      playPath: `/index.php/vod/play/id/${cleaned}/sid/1/nid/1.html`,
    };
  }

  const playMatch = cleaned.match(/\/index\.php\/vod\/play\/id\/(\d+)(?:\/sid\/(\d+)\/nid\/(\d+))?/i);
  if (playMatch) {
    const vid = playMatch[1];
    const sid = playMatch[2] || '1';
    const nid = playMatch[3] || '1';
    return {
      vid,
      playPath: `/index.php/vod/play/id/${vid}/sid/${sid}/nid/${nid}.html`,
    };
  }

  const detailMatch = cleaned.match(/\/index\.php\/vod\/detail\/id\/(\d+)/i);
  if (detailMatch) {
    const vid = detailMatch[1];
    return {
      vid,
      playPath: `/index.php/vod/play/id/${vid}/sid/1/nid/1.html`,
    };
  }

  return {
    vid: cleaned,
    playPath: cleaned.startsWith('/') || /^https?:\/\//i.test(cleaned)
      ? cleaned
      : `/index.php/vod/play/id/${cleaned}/sid/1/nid/1.html`,
  };
}

async function home(inReq, _outResp) {
  let list = [];
  try {
    const { html, finalUrl } = await fetchHtml('/index.php/vod/type/id/1/page/1.html');
    let baseOrigin = activeDomain;
    try {
      baseOrigin = new URL(finalUrl).origin;
    } catch (_) {}
    list = parseCardsFromHtml(html, baseOrigin);
  } catch (_) {}

  return {
    class: MAIN_CLASSES,
    filters: FILTERS_CACHE,
    list,
    style: RECT_178_STYLE,
  };
}

async function category(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const tid = String(params.id ?? params.tid ?? '1');
  const pg = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);
  const ext = params.extend || params.filters || {};

  let targetId = tid;
  if (ext && typeof ext === 'object' && ext.sub_id) {
    targetId = String(ext.sub_id);
  }

  const path = `/index.php/vod/type/id/${targetId}/page/${pg}.html`;
  const { html, finalUrl } = await fetchHtml(path);

  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(finalUrl).origin;
  } catch (_) {}

  const cards = parseCardsFromHtml(html, baseOrigin);

  let total = cards.length;
  let pagecount = pg;
  const pageMatch = html.match(/共(\d+)条数据\s*[,，]\s*当前(\d+)\/(\d+)页/);
  if (pageMatch) {
    total = parseInt(pageMatch[1], 10) || cards.length;
    pagecount = parseInt(pageMatch[3], 10) || pg;
  } else {
    const pageNums = [...html.matchAll(/\/index\.php\/vod\/type\/id\/\d+\/page\/(\d+)\.html/gi)].map((m) =>
      parseInt(m[1], 10)
    );
    if (pageNums.length > 0) {
      pagecount = Math.max(pg, ...pageNums);
      total = pagecount * Math.max(cards.length, 20);
    }
  }

  return {
    page: pg,
    pagecount,
    limit: cards.length,
    total,
    list: cards,
    style: RECT_178_STYLE,
  };
}

async function detail(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const rawIdInput = Array.isArray(params.ids)
    ? params.ids[0]
    : Array.isArray(params.id)
      ? params.id[0]
      : (params.id ?? params.ids ?? params.url ?? '');

  const { vid, playPath } = normalizeVidAndPlayPath(rawIdInput);
  const { html, finalUrl } = await fetchHtml(playPath);

  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(finalUrl).origin;
  } catch (_) {}

  const titleH1 = html.match(/<h1[^>]*class\s*=\s*['"][^'"]*yt-video-title[^'"]*['"][^>]*>([\s\S]*?)<\/h1>/i);
  const titleTag = html.match(/<title>([^<]+)<\/title>/i);
  const rawTitle = titleH1 ? titleH1[1] : titleTag ? titleTag[1] : '';
  const finalTitle = cleanTitle(rawTitle);

  let pic = '';
  const picMatch = html.match(/vodPic\s*=\s*['"]([^'"]+)['"]/i);
  if (picMatch && isUsableCoverImg(picMatch[1])) {
    pic = cleanPic(picMatch[1], baseOrigin);
  }
  if (!pic) {
    const imgAttrRegex = /\b(?:data-original|data-src|src)\s*=\s*['"]([^'"]+)['"]/gi;
    let im;
    while ((im = imgAttrRegex.exec(html)) !== null) {
      const cand = im[1];
      if (
        isUsableCoverImg(cand) &&
        (cand.includes('/upload/') || cand.includes('xbpic') || cand.includes('uyjthen'))
      ) {
        pic = cleanPic(cand, baseOrigin);
        break;
      }
    }
  }

  // Pre-resolve and warm PLAY_CACHE for instant /play response
  try {
    const resolved = await resolveFullStreamFromPlayHtml(html, finalUrl, vid);
    if (resolved.streamUrl) {
      setPlayCache(vid, resolved.streamUrl, resolved.referer);
      setPlayCache(playPath, resolved.streamUrl, resolved.referer);
    }
  } catch (_) {}

  const vod = {
    vod_id: String(vid),
    vod_name: finalTitle,
    vod_pic: pic,
    vod_actor: '🦋 TG群: @tvshare23',
    vod_director: '🦋 蝴蝶影视',
    vod_content: '🦋 官方频道: t.me/huliys9 | 官方交流: t.me/tvshare23',
    vod_play_from: '蝴蝶专线',
    vod_play_url: `正片$${vid}`,
  };

  return { list: [vod] };
}

async function play(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const rawId = params.id ?? params.url ?? '';
  const cleanedId = sanitizeEpisodeId(rawId);

  const defaultPlayHeaders = {
    'User-Agent': UA,
    Referer: `${activeDomain}/`,
  };

  // If the client already passed a direct media URL, return it immediately
  const unwrappedDirect = unwrapNestedMediaUrl(cleanedId, activeDomain);
  if (isDirectMediaUrl(unwrappedDirect)) {
    return {
      parse: 0,
      jx: 0,
      url: unwrappedDirect,
      header: defaultPlayHeaders,
      headers: defaultPlayHeaders,
    };
  }

  const { vid, playPath } = normalizeVidAndPlayPath(cleanedId);

  // Check pre-warmed PLAY_CACHE first
  const cached = getPlayCache(cleanedId) || getPlayCache(vid) || getPlayCache(playPath);
  if (cached && cached.url) {
    const playHeaders = {
      'User-Agent': UA,
      Referer: cached.referer || `${activeDomain}/`,
    };
    return {
      parse: 0,
      jx: 0,
      url: cached.url,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const { html, finalUrl } = await fetchHtml(playPath);
  const resolved = await resolveFullStreamFromPlayHtml(html, finalUrl, vid);

  const playHeaders = {
    'User-Agent': UA,
    Referer: resolved.referer || `${activeDomain}/`,
  };

  if (resolved.streamUrl) {
    setPlayCache(vid, resolved.streamUrl, resolved.referer);
    setPlayCache(playPath, resolved.streamUrl, resolved.referer);
    return {
      parse: 0,
      jx: 0,
      url: resolved.streamUrl,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  // Stage 6 Fallback: client sniffing if no direct stream could be extracted
  return {
    parse: 1,
    jx: 0,
    url: finalUrl || `${activeDomain}${playPath}`,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function search(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const wd = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pg = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);

  if (!wd) {
    return {
      page: 1,
      pagecount: 1,
      limit: 0,
      total: 0,
      list: [],
      style: RECT_178_STYLE,
    };
  }

  const path = `/index.php/vod/search/page/${pg}/wd/${encodeURIComponent(wd)}.html`;
  const { html, finalUrl } = await fetchHtml(path);

  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(finalUrl).origin;
  } catch (_) {}

  const cards = parseCardsFromHtml(html, baseOrigin);

  return {
    page: pg,
    pagecount: 1,
    limit: cards.length,
    total: cards.length,
    list: cards,
    style: RECT_178_STYLE,
  };
}

async function proxyPicHandler(query = {}) {
  const rawUrl = query.url || query.pic || '';
  const targetUrl = cleanPic(rawUrl, activeDomain);
  if (!targetUrl) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
  try {
    let origin = activeDomain;
    try {
      origin = new URL(targetUrl).origin;
    } catch (_) {}
    const resp = await req.get(targetUrl, {
      headers: {
        'User-Agent': UA,
        Referer: `${origin}/`,
      },
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    const rawData = resp?.data ?? resp?.body ?? resp;
    const buf = Buffer.isBuffer(rawData)
      ? rawData
      : rawData instanceof ArrayBuffer
        ? Buffer.from(rawData)
        : Buffer.from(String(rawData || ''));
    const mime =
      resp?.headers?.['content-type'] ||
      resp?.headers?.['Content-Type'] ||
      (targetUrl.endsWith('.png') ? 'image/png' : targetUrl.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    return { mime, data: buf };
  } catch (_) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'xyc',
    name: '小淫虫',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/xyc_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};