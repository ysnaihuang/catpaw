import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://www.lookluping.xyz',
  'https://lookluping.xyz',
];

let activeDomain = SITE_DOMAINS[0];

const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

const CLASSES = [{ type_name: '免费视频', type_id: 'free' }];

const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const PLAY_CACHE = new Map();
const META_CACHE = new Map();
const PAGE_ITEMS_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_CACHE_TTL_MS = 3 * 60 * 1000;

function getCache(map, key, ttl = CACHE_TTL_MS) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttl) {
    map.delete(key);
    return null;
  }
  return entry.val;
}

function setCache(map, key, val) {
  if (map.size > 500) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, { val, ts: Date.now() });
}

function unwrapParams(inReq) {
  const merged = {};
  const sources = [inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          continue;
        } catch {}
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) merged[k] = v;
      } catch {}
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function fixLatin1Mojibake(str) {
  if (!str || typeof str !== 'string') return '';
  let hasHighByte = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code > 0xff) return str;
    if (code >= 0x80) hasHighByte = true;
  }
  if (!hasHighByte) return str;
  try {
    const buf = Buffer.from(str, 'latin1');
    const utf8 = buf.toString('utf8');
    if (!utf8.includes('\ufffd')) return utf8;
  } catch {}
  return str;
}

function decodeResponseBuffer(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return fixLatin1Mojibake(raw);
  let buf = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof ArrayBuffer
      ? Buffer.from(raw)
      : ArrayBuffer.isView(raw)
        ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
        : null;
  if (!buf) {
    if (typeof raw === 'object') {
      try {
        return JSON.stringify(raw);
      } catch {
        return String(raw);
      }
    }
    return String(raw);
  }
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = zlib.gunzipSync(buf);
    } catch {}
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\ufffd')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if ((gbk.match(/\ufffd/g) || []).length < (utf8.match(/\ufffd/g) || []).length) {
        return gbk;
      }
    } catch {}
  }
  return utf8;
}

function getCandidateDomains() {
  const seen = new Set();
  const list = [];
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    if (d && !seen.has(d)) {
      seen.add(d);
      list.push(d.replace(/\/+$/, ''));
    }
  }
  return list;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  return SITE_DOMAINS.some((d) => {
    try {
      const dh = new URL(d).hostname.toLowerCase();
      return h === dh || h.endsWith('.' + dh) || dh.endsWith('.' + h);
    } catch {
      return false;
    }
  });
}

function expandCandidateUrls(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return [];
  const domains = getCandidateDomains();
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (isKnownSiteHost(u.hostname)) {
        const suffix = u.pathname + u.search;
        return domains.map((d) => d + suffix);
      }
      return [raw];
    } catch {
      return [raw];
    }
  }
  const rel = raw.startsWith('/') ? raw : '/' + raw;
  return domains.map((d) => d + rel);
}

function looksLikeValidSiteContent(text, url) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('{') &&
    (trimmed.includes('"nr"') ||
      trimmed.includes('"url"') ||
      trimmed.includes('DownSys') ||
      trimmed.includes('.m3u8') ||
      trimmed.includes('.mp4'))
  ) {
    return true;
  }
  if (
    trimmed.includes('buyvideo') ||
    trimmed.includes('/free/') ||
    trimmed.includes('DownSys/play') ||
    trimmed.includes('信息提示') ||
    /<h1[^>]*>/i.test(trimmed) ||
    /<title[^>]*>/i.test(trimmed) ||
    /url\s*:\s*['"][^'"]+['"]/i.test(trimmed) ||
    /player_aaaa|player_data|DPlayer|Artplayer|ckplayer/i.test(trimmed) ||
    /\.m3u8|\.mp4/i.test(trimmed)
  ) {
    return true;
  }
  if (/\/e\/moyublog\/bofang\/|\/e\/DownSys\/play\//i.test(url) && trimmed.length > 10) {
    return true;
  }
  return false;
}

async function fetchHtml(pathOrUrl, options = {}) {
  const candidates = expandCandidateUrls(pathOrUrl);
  const method = (options.method || (options.data != null ? 'POST' : 'GET')).toUpperCase();
  for (const targetUrl of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(targetUrl).origin;
    } catch {}
    const headers = {
      ...DEFAULT_HEADERS,
      Referer: origin + '/',
      ...(options.headers || {}),
    };
    if (headers.Referer) {
      try {
        const refUrl = new URL(headers.Referer);
        if (isKnownSiteHost(refUrl.hostname)) {
          headers.Referer = origin + refUrl.pathname + refUrl.search;
        }
      } catch {}
    }
    try {
      let resp;
      if (method === 'POST') {
        let bodyData = options.data;
        if (
          bodyData &&
          typeof bodyData === 'object' &&
          !(bodyData instanceof URLSearchParams) &&
          !Buffer.isBuffer(bodyData)
        ) {
          bodyData = new URLSearchParams(
            Object.entries(bodyData).map(([k, v]) => [k, String(v ?? '')])
          ).toString();
        }
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        }
        resp = await req.post(targetUrl, bodyData, {
          headers,
          timeout: options.timeout || 15000,
        });
      } else {
        resp = await req.get(targetUrl, {
          headers,
          timeout: options.timeout || 15000,
        });
      }
      const rawPayload =
        resp?.data !== undefined ? resp.data : resp?.body !== undefined ? resp.body : resp;
      const text = decodeResponseBuffer(rawPayload);
      if (looksLikeValidSiteContent(text, targetUrl)) {
        if (isKnownSiteHost(new URL(targetUrl).hostname)) {
          activeDomain = origin;
        }
        return text;
      }
    } catch {}
  }
  return '';
}

function wrapPic(pic) {
  if (!pic) return '';
  let p = String(pic).trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1).trim();
  }
  p = p.replace(/&amp;/g, '&');
  if (!p) return '';
  if (p.includes('127.0.0.1') || p.includes('proxy')) return p;
  if (p.startsWith('//')) return 'https:' + p;
  if (!/^https?:\/\//i.test(p)) {
    return p.startsWith('/') ? activeDomain + p : activeDomain + '/' + p;
  }
  try {
    const u = new URL(p);
    if (isKnownSiteHost(u.hostname)) {
      return activeDomain + u.pathname + u.search;
    }
  } catch {}
  return p;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function normalizeVodPath(rawId, defaultTid = 'free') {
  let s = String(rawId || '').trim();
  if (!s) return { aid: '', path: '' };
  if (s.includes('@@@')) {
    s = s.split('@@@')[0].trim();
  }
  if (s.includes('$')) {
    const firstDollar = s.indexOf('$');
    const prefix = s.slice(0, firstDollar).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      s = s.slice(firstDollar + 1).trim();
    }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      s = u.pathname;
    } catch {}
  }
  s = s.replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
  if (/^\d+$/.test(s)) {
    return { aid: s, path: `${defaultTid}/${s}` };
  }
  const m = s.match(/(\d+)/);
  const aid = m ? m[1] : s;
  const path = s.includes('/') ? s : `${defaultTid}/${s}`;
  return { aid, path };
}

function parseItems(html) {
  if (!html || typeof html !== 'string') return [];
  const items = [];
  const byVid = new Map();
  const anchorRe = /<a\s+[^>]*href=["']([^"']*?\/(\d+)\.html)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const rawHref = m[1];
    const vid = m[2];
    const attrPart = m[3] || '';
    const innerHtml = m[4] || '';

    let cleanPath = rawHref.trim();
    if (/^https?:\/\//i.test(cleanPath)) {
      try {
        cleanPath = new URL(cleanPath).pathname;
      } catch {}
    }
    cleanPath = cleanPath.replace(/^\/+|\/+$/g, '');
    if (!cleanPath.startsWith('free/')) continue;

    const titleMatch =
      attrPart.match(/title=["']([^"']*)["']/i) || m[0].match(/title=["']([^"']*)["']/i);
    const candidateName = titleMatch ? titleMatch[1].trim() : stripTags(innerHtml);

    const innerImgMatch = innerHtml.match(
      /<img[^>]+(?:data-original|data-src|original|src)=["']([^"']+)["']/i
    );
    const afterSlice = html.slice(m.index + m[0].length, m.index + m[0].length + 800);
    const afterImgMatch = afterSlice.match(
      /<img[^>]+(?:data-original|data-src|original|src)=["']([^"']+)["']/i
    );
    const candidatePic = wrapPic(
      innerImgMatch ? innerImgMatch[1] : afterImgMatch ? afterImgMatch[1] : ''
    );

    const existing = byVid.get(vid);
    if (!existing) {
      const entry = {
        vod_id: cleanPath,
        vod_name: candidateName && candidateName.length <= 100 ? candidateName.slice(0, 50) : '',
        vod_pic: candidatePic,
        vod_remarks: '',
      };
      byVid.set(vid, entry);
      if (entry.vod_name) items.push(entry);
    } else {
      if (!existing.vod_name && candidateName && candidateName.length <= 100) {
        existing.vod_name = candidateName.slice(0, 50);
        items.push(existing);
      }
      if (!existing.vod_pic && candidatePic) {
        existing.vod_pic = candidatePic;
      }
    }
  }
  return items;
}

function parsePageCount(html, pn = 1) {
  if (!html || typeof html !== 'string') return pn;
  const pages = [];
  const re = /index_(\d+)\.html/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const num = parseInt(m[1], 10);
    if (Number.isFinite(num)) pages.push(num);
  }
  if (pages.length > 0) {
    return Math.max(...pages, pn);
  }
  if (html.includes('下一页') || html.includes(`index_${pn + 1}.html`)) {
    return pn + 5;
  }
  return pn;
}

async function fetchFreePageItems(pg) {
  const pageNum = Math.max(1, parseInt(pg, 10) || 1);
  const cached = getCache(PAGE_ITEMS_CACHE, pageNum, PAGE_CACHE_TTL_MS);
  if (cached) return cached;
  const url = pageNum === 1 ? '/free/' : `/free/index_${pageNum}.html`;
  const html = await fetchHtml(url);
  if (!html || html.slice(0, 2000).includes('信息提示')) {
    return { html: '', items: [], invalid: true };
  }
  const items = parseItems(html);
  const res = { html, items, invalid: false };
  setCache(PAGE_ITEMS_CACHE, pageNum, res);
  return res;
}

async function buildSeriesPlayUrl(name, vid, path) {
  const cleanName = String(name || '').trim();
  const mm = cleanName.match(/^(.*?)\s*\((\d+)\)\s*\.\w+$/);
  const normalizedId = path.endsWith('.html') ? path : `${path}.html`;
  if (!mm) {
    return `正片$${path}`;
  }
  const seriesBaseName = mm[1];
  const curPart = parseInt(mm[2], 10);
  const seriesMap = new Map();
  seriesMap.set(curPart, normalizedId);

  for (let p = 1; p <= 5; p++) {
    const pageData = await fetchFreePageItems(p);
    if (pageData.invalid || !pageData.html) break;
    for (const it of pageData.items) {
      const im = String(it.vod_name || '')
        .trim()
        .match(/^(.*?)\s*\((\d+)\)\s*\.\w+$/);
      if (im && im[1] === seriesBaseName) {
        const partNum = parseInt(im[2], 10);
        if (!seriesMap.has(partNum)) {
          seriesMap.set(partNum, it.vod_id);
        }
      }
    }
    if (seriesMap.size >= 60) break;
  }

  const sortedEntries = Array.from(seriesMap.entries()).sort((a, b) => a[0] - b[0]);
  if (sortedEntries.length === 0) {
    return `正片$${path}`;
  }
  return sortedEntries.map(([num, itemPath]) => `第${num}段$${itemPath}`).join('#');
}

function unescapeTextSequences(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, '&');
}

function safeDecodeUrlComponent(str) {
  if (!str || typeof str !== 'string') return '';
  const withUnicode = str.replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  if (!/%[0-9a-fA-F]{2}/.test(withUnicode)) return withUnicode;
  try {
    return decodeURIComponent(withUnicode);
  } catch {
    return withUnicode.replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
}

function decodeCmsPlayerUrl(rawUrl, encrypt = 0) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const encMode = Number(encrypt) || 0;
  if (encMode === 1) {
    u = safeDecodeUrlComponent(u);
  } else if (encMode === 2) {
    try {
      const decodedB64 = Buffer.from(u, 'base64').toString('utf8');
      u = safeDecodeUrlComponent(decodedB64);
    } catch {}
  }
  return unescapeTextSequences(u).trim();
}

function extractBalancedJsonObject(text, varPattern) {
  if (!text) return null;
  const re = new RegExp(varPattern, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const startIdx = text.indexOf('{', m.index + m[0].length - 1);
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
          const rawJson = text.slice(startIdx, i + 1);
          try {
            return JSON.parse(rawJson);
          } catch {
            try {
              const normalized = rawJson.replace(/,\s*([}\]])/g, '$1');
              return JSON.parse(normalized);
            } catch {}
          }
          break;
        }
      }
    }
  }
  return null;
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const results = [];
  const packerRe =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = packerRe.exec(html)) !== null) {
    let payload = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const radix = parseInt(m[3], 10) || 36;
    const count = parseInt(m[4], 10) || 0;
    const symtab = m[6].split('|');

    const encodeBase = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) {
        return num < 36 ? num.toString(36) : chars[num] || '';
      }
      return encodeBase(Math.floor(num / base), base) + encodeBase(num % base, base);
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      dict.set(key, symtab[i] || key);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    results.push(unpacked);
  }
  return results;
}

function isDecoyMediaUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes('preview.mp4') ||
    lower.includes('sample.mp4') ||
    lower.includes('trailer.mp4') ||
    lower.includes('top_banner') ||
    lower.includes('native-ad') ||
    lower.includes('stat.php')
  );
}

function isDirectMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const cleaned = unescapeTextSequences(url).trim();
  if (!cleaned || isDecoyMediaUrl(cleaned)) return false;
  try {
    const u = new URL(cleaned, activeDomain);
    if (!/^https?:$/i.test(u.protocol)) return false;
    if (/\.(m3u8|mp4|flv|avi|mkv|ts)(\?|$)/i.test(u.pathname)) return true;
    if (/(\.m3u8|\.mp4)/i.test(u.search) && !/\.(html?|php|jsp|asp)$/i.test(u.pathname)) {
      return true;
    }
  } catch {
    if (/\.(m3u8|mp4|flv|avi|mkv)(\?|$)/i.test(cleaned)) return true;
  }
  return false;
}

function normalizeResolvedStreamUrl(rawUrl, baseOrigin = activeDomain) {
  let u = unescapeTextSequences(String(rawUrl || '')).trim();
  if (!u) return '';
  if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
    u = u.slice(1, -1).trim();
  }
  if (!u) return '';
  if (u.startsWith('//')) u = 'https:' + u;
  else if (u.startsWith('/')) u = baseOrigin.replace(/\/+$/, '') + u;

  for (let pass = 0; pass < 2; pass++) {
    try {
      const parsed = new URL(u, baseOrigin);
      if (!/\.(m3u8|mp4|flv|avi|mkv)$/i.test(parsed.pathname)) {
        const inner =
          parsed.searchParams.get('url') ||
          parsed.searchParams.get('v') ||
          parsed.searchParams.get('vid') ||
          parsed.searchParams.get('src');
        if (inner) {
          let decodedInner = inner;
          for (let d = 0; d < 2; d++) {
            const next = safeDecodeUrlComponent(decodedInner);
            if (next === decodedInner) break;
            decodedInner = next;
          }
          decodedInner = unescapeTextSequences(decodedInner).trim();
          if (
            /^https?:\/\//i.test(decodedInner) ||
            decodedInner.startsWith('//') ||
            decodedInner.startsWith('/')
          ) {
            u = decodedInner.startsWith('//')
              ? 'https:' + decodedInner
              : decodedInner.startsWith('/')
                ? baseOrigin.replace(/\/+$/, '') + decodedInner
                : decodedInner;
            continue;
          }
        }
      }
      u = parsed.href;
      break;
    } catch {
      break;
    }
  }
  return u;
}

function extractStreamFromText(rawText, baseOrigin = activeDomain) {
  if (!rawText || typeof rawText !== 'string') return '';

  const candidateBlocks = [rawText, ...unpackDeanEdwards(rawText)];

  for (const block of candidateBlocks) {
    const cmsObj = extractBalancedJsonObject(
      block,
      '(?:var|let|const|window\\.)?\\s*(?:player_aaaa|player_data|player_config|cms_player)\\s*=\\s*\\{'
    );
    if (cmsObj && cmsObj.url) {
      const decoded = decodeCmsPlayerUrl(cmsObj.url, cmsObj.encrypt);
      const norm = normalizeResolvedStreamUrl(decoded, baseOrigin);
      if (isDirectMediaUrl(norm)) return norm;
    }

    const urlPropRe = /(?:["']?url["']?\s*:\s*|videoUrl\s*=\s*|playUrl\s*=\s*)["']([^"']+)["']/gi;
    let m;
    while ((m = urlPropRe.exec(block)) !== null) {
      const candidate = normalizeResolvedStreamUrl(m[1], baseOrigin);
      if (isDirectMediaUrl(candidate)) return candidate;
    }

    const unescaped = unescapeTextSequences(block);
    const directRe = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|flv)(?:\?[^\s"'<>\\]*)?/gi;
    while ((m = directRe.exec(unescaped)) !== null) {
      const candidate = normalizeResolvedStreamUrl(m[0], baseOrigin);
      if (isDirectMediaUrl(candidate)) return candidate;
    }
  }

  return '';
}

function extractBuyVideoParams(html, fallbackAid = '') {
  if (!html) return { cid: '26', xid: fallbackAid };
  let m =
    html.match(/buyvideo["'][^>]*classid=["'](\d+)["'][^>]*xxid=["'](\d+)["']/i) ||
    html.match(/classid=["'](\d+)["'][^>]*xxid=["'](\d+)["']/i);
  if (m) return { cid: m[1], xid: m[2] };
  m = html.match(/xxid=["'](\d+)["'][^>]*classid=["'](\d+)["']/i);
  if (m) return { cid: m[2], xid: m[1] };
  return { cid: '26', xid: fallbackAid };
}

async function resolveVideoStream(rawId, detailHtmlOpt = null) {
  const { aid, path } = normalizeVodPath(rawId);
  if (!aid && !path) return '';

  const cachedStream = getCache(PLAY_CACHE, path) || (aid ? getCache(PLAY_CACHE, aid) : null);
  if (cachedStream) return cachedStream;

  let html = detailHtmlOpt;
  const detailPath = `/${path}.html`;
  if (!html) {
    html = await fetchHtml(detailPath);
  }

  if (html) {
    const directFromDetail = extractStreamFromText(html, activeDomain);
    if (directFromDetail) {
      setCache(PLAY_CACHE, path, directFromDetail);
      if (aid) setCache(PLAY_CACHE, aid, directFromDetail);
      return directFromDetail;
    }
  }

  const cachedMeta = getCache(META_CACHE, path) || (aid ? getCache(META_CACHE, aid) : null);
  const { cid, xid } = html
    ? extractBuyVideoParams(html, aid)
    : cachedMeta || { cid: '26', xid: aid };

  if (cid && xid) {
    setCache(META_CACHE, path, { cid, xid });
    if (aid) setCache(META_CACHE, aid, { cid, xid });
  }

  if (xid) {
    const bofangResp = await fetchHtml('/e/moyublog/bofang/', {
      method: 'POST',
      data: { id: xid, classid: cid || '26' },
      headers: {
        Referer: `${activeDomain}${detailPath}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (bofangResp) {
      let nr = bofangResp;
      try {
        const obj = JSON.parse(bofangResp);
        nr = obj?.nr || obj?.url || obj?.data || bofangResp;
      } catch {}

      const directStream = extractStreamFromText(String(nr), activeDomain);
      if (directStream) {
        setCache(PLAY_CACHE, path, directStream);
        if (aid) setCache(PLAY_CACHE, aid, directStream);
        return directStream;
      }

      const unescapedNr = unescapeTextSequences(String(nr));
      const downSysMatch =
        unescapedNr.match(/src\s*=\s*["']?\s*(\/e\/DownSys\/play\/[^"'\s>]+)/i) ||
        unescapedNr.match(/(\/e\/DownSys\/play\/[^"'\s<>]+)/i) ||
        unescapedNr.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);

      if (downSysMatch && downSysMatch[1]) {
        const playFrameUrl = downSysMatch[1].replace(/\s+/g, '');
        const frameHtml = await fetchHtml(playFrameUrl, {
          headers: { Referer: `${activeDomain}${detailPath}` },
        });
        if (frameHtml) {
          const frameStream = extractStreamFromText(frameHtml, activeDomain);
          if (frameStream) {
            setCache(PLAY_CACHE, path, frameStream);
            if (aid) setCache(PLAY_CACHE, aid, frameStream);
            return frameStream;
          }
        }
      }
    }
  }

  if (html) {
    const iframeMatch = html.match(/<iframe[^>]+(?:data-src|src)=["']([^"']+)["']/i);
    if (iframeMatch && iframeMatch[1]) {
      const frameUrl = unescapeTextSequences(iframeMatch[1]).trim();
      const DirectWrapper = normalizeResolvedStreamUrl(frameUrl, activeDomain);
      if (isDirectMediaUrl(DirectWrapper)) {
        setCache(PLAY_CACHE, path, DirectWrapper);
        if (aid) setCache(PLAY_CACHE, aid, DirectWrapper);
        return DirectWrapper;
      }
      const frameHtml = await fetchHtml(frameUrl, {
        headers: { Referer: `${activeDomain}${detailPath}` },
      });
      if (frameHtml) {
        const stream = extractStreamFromText(frameHtml, activeDomain);
        if (stream) {
          setCache(PLAY_CACHE, path, stream);
          if (aid) setCache(PLAY_CACHE, aid, stream);
          return stream;
        }
      }
    }
  }

  return '';
}

async function home(_inReq, _outResp) {
  const filters = {};
  for (const c of CLASSES) {
    filters[c.type_id] = [];
  }
  let list = [];
  const homeHtml = await fetchHtml('/');
  if (homeHtml) {
    list = parseItems(homeHtml).slice(0, 48);
  }
  if (list.length === 0) {
    const freePage = await fetchFreePageItems(1);
    list = (freePage.items || []).slice(0, 48);
  }
  return {
    class: CLASSES,
    filters,
    list,
    style: CARD_STYLE,
  };
}

async function category(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const tid = String(params.id || params.tid || 'free').trim() || 'free';
  let pg = parseInt(params.page || params.pg || 1, 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;

  const url = pg === 1 ? `/${tid}/` : `/${tid}/index_${pg}.html`;
  const html = await fetchHtml(url);
  if (!html || html.slice(0, 2000).includes('信息提示')) {
    return {
      page: pg,
      pagecount: 1,
      limit: 24,
      total: 0,
      list: [],
      style: CARD_STYLE,
    };
  }
  const vodList = parseItems(html);
  if (tid === 'free') {
    setCache(PAGE_ITEMS_CACHE, pg, { html, items: vodList, invalid: false });
  }
  const pagecount = parsePageCount(html, pg);
  return {
    page: pg,
    pagecount,
    limit: vodList.length || 24,
    total: 48 * pagecount,
    list: vodList,
    style: CARD_STYLE,
  };
}

async function detail(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawIds = params.ids || params.id || params.url || '';
  const vid = Array.isArray(rawIds) ? String(rawIds[0] || '') : String(rawIds || '');
  const { aid, path } = normalizeVodPath(vid);
  if (!path) return { list: [] };

  const html = await fetchHtml(`/${path}.html`);
  if (!html || (!html.includes('buyvideo') && !/<h1[^>]*>/i.test(html))) {
    return { list: [] };
  }

  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const name = h1Match
    ? stripTags(h1Match[1])
    : titleMatch
      ? stripTags(titleMatch[1])
      : path;

  let picMatch = html.match(/<img[^>]+src=["']([^"']*?\/video\/[^"']+)["']/i);
  if (!picMatch) {
    picMatch = html.match(/<img[^>]+(?:data-original|original|src)=["']([^"']+)["']/i);
  }
  const vodPic = wrapPic(picMatch ? picMatch[1] : '');

  const { cid, xid } = extractBuyVideoParams(html, aid);
  setCache(META_CACHE, path, { cid, xid });
  if (aid) setCache(META_CACHE, aid, { cid, xid });

  const [playUrl] = await Promise.all([
    buildSeriesPlayUrl(name, vid, path),
    resolveVideoStream(path, html).catch(() => ''),
  ]);

  const vod = {
    vod_id: vid || `${path}.html`,
    vod_name: name,
    vod_pic: vodPic,
    vod_remarks: '',
    vod_actor: '',
    vod_director: '',
    type_name: '免费视频',
    vod_year: '',
    vod_area: '',
    vod_content: name,
    vod_play_from: '直播录屏',
    vod_play_url: playUrl,
  };

  return { list: [vod] };
}

async function play(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawId = params.id || params.url || '';
  const { path } = normalizeVodPath(rawId);
  if (!path) return {};

  const playHeaders = {
    Referer: `${activeDomain}/`,
    'User-Agent': UA,
  };

  if (isDirectMediaUrl(String(rawId))) {
    const directUrl = normalizeResolvedStreamUrl(String(rawId), activeDomain);
    return {
      parse: 0,
      jx: 0,
      url: directUrl,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const streamUrl = await resolveVideoStream(rawId);
  if (streamUrl) {
    return {
      parse: 0,
      jx: 0,
      url: streamUrl,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  return {
    parse: 1,
    jx: 0,
    url: `${activeDomain}/${path}.html`,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function search(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const wd = String(params.wd || params.key || params.keyword || '').trim();
  const pg = Math.max(1, parseInt(params.page || params.pg || 1, 10) || 1);
  if (!wd) return { list: [], page: pg };

  const keywordLower = wd.toLowerCase();
  const items = [];
  const seen = new Set();

  for (let p = 1; p <= 5; p++) {
    const pageData = await fetchFreePageItems(p);
    if (pageData.invalid || !pageData.html) break;
    for (const it of pageData.items) {
      if (!String(it.vod_name || '').toLowerCase().includes(keywordLower)) continue;
      if (seen.has(it.vod_id)) continue;
      seen.add(it.vod_id);
      items.push(it);
      if (items.length >= 80) break;
    }
    if (items.length >= 80) break;
  }

  return {
    list: items.slice(0, 80),
    page: pg,
    style: CARD_STYLE,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = wrapPic(query.url || query.pic || '');
  if (!picUrl) {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
  try {
    const resp = await req.get(picUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        Referer: `${activeDomain}/`,
      },
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const raw = resp?.data !== undefined ? resp.data : resp;
    const buf = Buffer.isBuffer(raw)
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : ArrayBuffer.isView(raw)
          ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
          : Buffer.from(String(raw || ''), 'binary');
    const mime =
      resp?.headers?.['content-type'] ||
      (picUrl.endsWith('.png')
        ? 'image/png'
        : picUrl.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg');
    return { mime, data: buf };
  } catch {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'lookluping',
    name: '直播录屏',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/lookluping_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};