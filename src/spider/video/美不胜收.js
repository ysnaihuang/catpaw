import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://mbss3.xyz',
  'https://mbss2.xyz',
  'https://mbss1.xyz',
];

let activeDomain = SITE_DOMAINS[0];

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

const CATEGORIES = [
  { type_id: '20', type_name: '在线一区' },
  { type_id: '21', type_name: '国产色情' },
  { type_id: '22', type_name: '主播直播' },
  { type_id: '23', type_name: '亚洲精品' },
  { type_id: '24', type_name: '中文字幕' },
  { type_id: '25', type_name: '人妻熟女' },
  { type_id: '26', type_name: '强奸乱伦' },
  { type_id: '27', type_name: '欧美精品' },
  { type_id: '28', type_name: '成人动漫' },
  { type_id: '29', type_name: '在线二区' },
  { type_id: '30', type_name: '自拍偷拍' },
  { type_id: '31', type_name: '制服丝袜' },
  { type_id: '32', type_name: '变态另类' },
  { type_id: '33', type_name: 'AI换脸' },
  { type_id: '34', type_name: '三级伦理' },
  { type_id: '35', type_name: 'AV解说' },
  { type_id: '36', type_name: '传媒探花' },
  { type_id: '37', type_name: '美乳巨乳' },
];

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function setPlayCache(key, value) {
  if (!key || !value || !value.url) return;
  PLAY_CACHE.set(key, { ...value, ts: Date.now() });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(key);
    return null;
  }
  return entry;
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
  return merged;
}

function getKnownHosts() {
  const hosts = new Set();
  for (const d of SITE_DOMAINS) {
    try {
      hosts.add(new URL(d).hostname.toLowerCase());
    } catch (_) {}
  }
  return hosts;
}

function getOrderedDomains() {
  return [activeDomain, ...SITE_DOMAINS.filter((d) => d !== activeDomain)];
}

function normalizeUrlToActive(rawUrl, baseDomain = activeDomain) {
  if (!rawUrl) return '';
  const str = String(rawUrl).trim();
  if (!str) return '';
  const base = (baseDomain || activeDomain).replace(/\/+$/, '');
  if (str.startsWith('//')) return `https:${str}`;
  if (/^https?:\/\//i.test(str)) {
    try {
      const parsed = new URL(str);
      if (getKnownHosts().has(parsed.hostname.toLowerCase())) {
        return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch (_) {}
    return str;
  }
  return str.startsWith('/') ? `${base}${str}` : `${base}/${str}`;
}

function expandCandidateUrls(inputUrl) {
  const str = String(inputUrl || '').trim();
  if (!str) return [];
  const domains = getOrderedDomains();

  if (!/^https?:\/\//i.test(str)) {
    const relPath = str.startsWith('/') ? str : `/${str}`;
    return domains.map((d) => `${d.replace(/\/+$/, '')}${relPath}`);
  }

  try {
    const parsed = new URL(str);
    const knownHosts = getKnownHosts();
    if (knownHosts.has(parsed.hostname.toLowerCase())) {
      const pathAndQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      const list = domains.map((d) => `${d.replace(/\/+$/, '')}${pathAndQuery}`);
      if (!list.includes(str)) list.push(str);
      return [...new Set(list)];
    }
  } catch (_) {}

  return [str];
}

function decodeBuffer(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch (_) {}
  }
  const utf8 = raw.toString('utf-8');
  if (utf8.includes('\ufffd')) {
    try {
      const gbk = new TextDecoder('gbk').decode(raw);
      if (!gbk.includes('\ufffd')) return gbk;
    } catch (_) {}
  }
  return utf8;
}

function hasValidSiteFingerprint(html) {
  if (!html || typeof html !== 'string') return false;
  if (html.length < 30) return false;
  return (
    /class=["']thumbnail["']/i.test(html) ||
    /class=["']vodtitle["']/i.test(html) ||
    /player_aaaa/i.test(html) ||
    /player_data/i.test(html) ||
    /\/index\.php\/vod\//i.test(html) ||
    /<video[\s>]/i.test(html) ||
    /<iframe[\s>]/i.test(html) ||
    /\.(?:m3u8|mp4)/i.test(html) ||
    /<h[15][\s>]/i.test(html)
  );
}

async function fetchHtml(inputUrl, customHeaders = {}) {
  const candidates = expandCandidateUrls(inputUrl);
  let lastHtml = '';

  for (const targetUrl of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(targetUrl).origin;
    } catch (_) {}

    const headers = {
      'User-Agent': DEFAULT_UA,
      Referer: `${origin}/`,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...customHeaders,
    };

    if (customHeaders.Referer) {
      try {
        const refParsed = new URL(customHeaders.Referer);
        const knownHosts = getKnownHosts();
        if (knownHosts.has(refParsed.hostname.toLowerCase())) {
          headers.Referer = `${origin}${refParsed.pathname}${refParsed.search}`;
        }
      } catch (_) {}
    }

    try {
      const resp = await req.get(targetUrl, {
        headers,
        timeout: 10000,
      });
      const rawData = resp?.data ?? resp?.body ?? resp ?? '';
      const text = decodeBuffer(rawData);
      if (text) {
        lastHtml = text;
        if (hasValidSiteFingerprint(text)) {
          if (SITE_DOMAINS.includes(origin)) {
            activeDomain = origin;
          }
          return { html: text, finalUrl: targetUrl, origin };
        }
      }
    } catch (_) {}
  }

  return {
    html: lastHtml,
    finalUrl: candidates[0] || String(inputUrl || ''),
    origin: activeDomain,
  };
}

function cleanHtmlText(str) {
  if (!str) return '';
  return String(str)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCards(html, baseOrigin = activeDomain) {
  if (!html) return [];
  const videos = [];
  const seen = new Set();

  let items = [];
  const liMatches = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/gi);
  if (liMatches && liMatches.length > 0) {
    items = liMatches;
  } else {
    const thumbMatches = html.match(/<a\s+class=["']thumbnail["'][\s\S]*?<\/div>/gi);
    if (thumbMatches) items = thumbMatches;
  }

  for (const item of items) {
    const hrefMatch =
      item.match(/<a\s+[^>]*class=["'][^"']*thumbnail[^"']*["'][^>]*href=["']([^"']+)["']/i) ||
      item.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*thumbnail[^"']*["']/i) ||
      item.match(/href=["'](\/index\.php\/vod\/(?:detail|play)\/[^"']+)["']/i);

    const picMatch =
      item.match(/data-original=["']([^"']+)["']/i) ||
      item.match(/data-src=["']([^"']+)["']/i) ||
      item.match(/<img[^>]+src=["']([^"']+)["']/i);

    if (!hrefMatch || !picMatch) continue;

    const vodId = normalizeUrlToActive(hrefMatch[1].trim(), baseOrigin);
    if (seen.has(vodId)) continue;
    seen.add(vodId);

    let pic = picMatch[1].trim();
    if (pic && !/^https?:\/\//i.test(pic) && !pic.startsWith('data:')) {
      pic = normalizeUrlToActive(pic, baseOrigin);
    }

    const titleMatch =
      item.match(/<h5[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) ||
      item.match(/<a[^>]+title=["']([^"']+)["']/i) ||
      item.match(/alt=["']([^"']+)["']/i);
    const vodName = titleMatch ? cleanHtmlText(titleMatch[1]) || '未知视频' : '未知视频';

    let vodRemarks = '高清';
    const remarkMatch = item.match(/<p\s+class=["']vodtitle["'][^>]*>([\s\S]*?)<\/p>/i);
    if (remarkMatch) {
      const rawRemark = cleanHtmlText(remarkMatch[1]);
      const dateMatch = rawRemark.match(/\d{4}-(\d{2}-\d{2})/);
      const viewMatch = rawRemark.match(/观看:\s*(\d+)/);
      const tags = [];
      if (dateMatch) tags.push(dateMatch[1]);
      if (viewMatch) {
        const views = parseInt(viewMatch[1], 10);
        if (views >= 10000) {
          tags.push(`👁${Math.round((views / 10000) * 10) / 10}w`);
        } else {
          tags.push(`👁${views}`);
        }
      }
      if (tags.length > 0) {
        vodRemarks = tags.join(' ');
      } else if (rawRemark) {
        vodRemarks = rawRemark;
      }
    }

    videos.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: pic,
      vod_remarks: vodRemarks,
    });
  }

  return videos;
}

function parsePageCount(html, currentPage = 1) {
  if (!html) return 999;
  let maxPage = currentPage;
  const pageMatches = html.matchAll(/\/page\/(\d+)\.html/gi);
  for (const m of pageMatches) {
    const p = parseInt(m[1], 10);
    if (!Number.isNaN(p) && p > maxPage) maxPage = p;
  }
  return maxPage > currentPage ? maxPage : 999;
}

function unescapeText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\([?&=#:'"])/g, '$1')
    .replace(/&amp;/gi, '&');
}

function customUnescape(str) {
  if (!str) return '';
  let out = String(str).replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  try {
    out = decodeURIComponent(out);
  } catch (_) {
    out = out.replace(/%([0-9a-fA-F]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
  return out;
}

function decodePlayerUrl(rawUrl, encrypt = 0) {
  if (!rawUrl) return '';
  let url = unescapeText(String(rawUrl).trim());
  const enc = Number(encrypt) || 0;

  if (enc === 1) {
    url = customUnescape(url);
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(url, 'base64').toString('utf-8');
      url = customUnescape(b64Decoded);
    } catch (_) {
      url = customUnescape(url);
    }
  } else if (/%3A|%2F/i.test(url)) {
    url = customUnescape(url);
  }

  return unescapeText(url).trim();
}

function isDecoyOrAdUrl(url) {
  if (!url) return true;
  const lower = String(url).toLowerCase();
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
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (isDecoyOrAdUrl(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(m3u8|mp4|flv|mpd|ts)$/i.test(pathname)) {
      return true;
    }
  } catch (_) {
    if (/\.(m3u8|mp4)(\?|$)/i.test(trimmed)) return true;
  }
  return false;
}

function unwrapNestedMediaUrl(rawUrl, baseOrigin = activeDomain) {
  if (!rawUrl) return '';
  let current = normalizeUrlToActive(unescapeText(rawUrl), baseOrigin);

  for (let pass = 0; pass < 2; pass++) {
    if (isDirectMediaUrl(current)) return current;
    try {
      const parsed = new URL(current);
      const paramKeys = ['url', 'v', 'vid', 'src', 'file', 'm3u8', 'play'];
      let extracted = '';
      for (const k of paramKeys) {
        const val = parsed.searchParams.get(k);
        if (val && /\.(m3u8|mp4)/i.test(val)) {
          extracted = val;
          break;
        }
      }
      if (!extracted) {
        for (const [, val] of parsed.searchParams.entries()) {
          if (val && /\.(m3u8|mp4)/i.test(val)) {
            extracted = val;
            break;
          }
        }
      }
      if (extracted) {
        let decoded = customUnescape(extracted);
        if (/%3A|%2F/i.test(decoded)) {
          decoded = customUnescape(decoded);
        }
        current = normalizeUrlToActive(unescapeText(decoded), parsed.origin);
        if (isDirectMediaUrl(current)) return current;
      } else {
        break;
      }
    } catch (_) {
      break;
    }
  }

  return isDirectMediaUrl(current) ? current : '';
}

function extractBalancedJson(html, varNames = ['player_aaaa', 'player_data', 'player_config', 'MacPlayer']) {
  const results = [];
  if (!html) return results;

  for (const name of varNames) {
    const regex = new RegExp(`\\b${name}\\s*=\\s*\\{`, 'g');
    let match;
    while ((match = regex.exec(html)) !== null) {
      const startBrace = match.index + match[0].length - 1;
      let depth = 0;
      let inString = false;
      let quoteChar = '';
      let escaped = false;

      for (let i = startBrace; i < html.length; i++) {
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
              const rawObj = html.slice(startBrace, i + 1);
              results.push(rawObj);
              break;
            }
          }
        }
      }
    }
  }

  return results;
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const unpackedList = [];
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const payload = match[2];
    const radix = parseInt(match[3], 10);
    const count = parseInt(match[4], 10);
    const keywords = match[6].split('|');

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
      dict.set(key, keywords[i] || key);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpackedList.push(unpacked);
  }

  return unpackedList;
}

function extractStreamFromHtmlSync(html, baseOrigin = activeDomain) {
  if (!html) return '';

  // Stage 1: Balanced-brace extraction for MacCMS player_aaaa / player_data
  const jsonBlocks = extractBalancedJson(html);
  for (const rawBlock of jsonBlocks) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawBlock);
    } catch (_) {
      try {
        const normalizedJson = rawBlock
          .replace(/\\\//g, '/')
          .replace(/\\([^"\\/bfnrtu])/g, '$1');
        parsed = JSON.parse(normalizedJson);
      } catch (_2) {}
    }

    if (parsed && parsed.url) {
      const decoded = decodePlayerUrl(parsed.url, parsed.encrypt);
      const unwrapped = unwrapNestedMediaUrl(decoded, baseOrigin);
      if (unwrapped) return unwrapped;
      const candidate = normalizeUrlToActive(decoded, baseOrigin);
      if (isDirectMediaUrl(candidate)) return candidate;
    }

    // Fallback regex on the balanced block if non-standard JS keys were used
    const urlFieldMatch = rawBlock.match(/["']?url["']?\s*:\s*["']([^"']+)["']/i);
    if (urlFieldMatch) {
      const encMatch = rawBlock.match(/["']?encrypt["']?\s*:\s*(\d+)/i);
      const enc = encMatch ? parseInt(encMatch[1], 10) : 0;
      const decoded = decodePlayerUrl(urlFieldMatch[1], enc);
      const unwrapped = unwrapNestedMediaUrl(decoded, baseOrigin);
      if (unwrapped) return unwrapped;
      const candidate = normalizeUrlToActive(decoded, baseOrigin);
      if (isDirectMediaUrl(candidate)) return candidate;
    }
  }

  // Stage 2: Unpack Dean Edwards packed JS blocks and inspect them
  const unpackedBlocks = unpackDeanEdwards(html);
  for (const block of unpackedBlocks) {
    const fromUnpacked = extractStreamFromHtmlSync(block, baseOrigin);
    if (fromUnpacked) return fromUnpacked;
  }

  // Stage 3: High-priority variable assignments and unescaped direct media scan
  const unescapedHtml = unescapeText(html);
  const directMatches = unescapedHtml.matchAll(
    /(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?)/gi
  );
  for (const m of directMatches) {
    const candidate = m[1];
    const unwrapped = unwrapNestedMediaUrl(candidate, baseOrigin);
    if (unwrapped && !isDecoyOrAdUrl(unwrapped)) {
      return unwrapped;
    }
    if (isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  return '';
}

async function resolveStreamFromPlayHtml(playHtml, playPageUrl, origin = activeDomain) {
  const syncStream = extractStreamFromHtmlSync(playHtml, origin);
  if (syncStream) return syncStream;

  // Stage 4: Check if player_aaaa had a non-direct wrapper URL or if page has an <iframe>
  const jsonBlocks = extractBalancedJson(playHtml);
  for (const rawBlock of jsonBlocks) {
    const urlFieldMatch = rawBlock.match(/["']?url["']?\s*:\s*["']([^"']+)["']/i);
    if (urlFieldMatch) {
      const encMatch = rawBlock.match(/["']?encrypt["']?\s*:\s*(\d+)/i);
      const enc = encMatch ? parseInt(encMatch[1], 10) : 0;
      const decoded = decodePlayerUrl(urlFieldMatch[1], enc);
      const unwrapped = unwrapNestedMediaUrl(decoded, origin);
      if (unwrapped) return unwrapped;
      if (/^https?:\/\//i.test(decoded) || decoded.startsWith('/')) {
        const wrapperUrl = normalizeUrlToActive(decoded, origin);
        const { html: wrapperHtml, origin: wrapperOrigin } = await fetchHtml(wrapperUrl, {
          Referer: playPageUrl || `${origin}/`,
        });
        const innerStream = extractStreamFromHtmlSync(wrapperHtml, wrapperOrigin);
        if (innerStream) return innerStream;
      }
    }
  }

  const iframeMatches = playHtml.matchAll(
    /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi
  );
  for (const m of iframeMatches) {
    const rawSrc = m[1].trim();
    if (!rawSrc || rawSrc.startsWith('javascript:') || rawSrc === 'about:blank') continue;
    const unwrapped = unwrapNestedMediaUrl(rawSrc, origin);
    if (unwrapped) return unwrapped;

    const iframeUrl = normalizeUrlToActive(rawSrc, origin);
    const { html: iframeHtml, origin: iframeOrigin } = await fetchHtml(iframeUrl, {
      Referer: playPageUrl || `${origin}/`,
    });
    const iframeStream = extractStreamFromHtmlSync(iframeHtml, iframeOrigin);
    if (iframeStream) return iframeStream;
  }

  return '';
}

function extractPlayLinksFromDetail(detailHtml, baseOrigin = activeDomain) {
  if (!detailHtml) return [];
  const links = [];
  const seen = new Set();
  const matches = detailHtml.matchAll(
    /href=["']((?:https?:\/\/[^"']+)?\/index\.php\/vod\/play\/[^"']+)["']/gi
  );
  for (const m of matches) {
    const full = normalizeUrlToActive(m[1], baseOrigin);
    if (!seen.has(full)) {
      seen.add(full);
      links.push(full);
    }
  }
  return links;
}

function sanitizeEpisodeId(rawId) {
  if (!rawId) return '';
  let id = String(rawId).trim();
  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }
  if (id.includes('$')) {
    const idx = id.indexOf('$');
    const prefix = id.slice(0, idx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      id = id.slice(idx + 1).trim();
    }
  }
  return id;
}

async function resolveFullPlayback(targetId) {
  const cleanId = sanitizeEpisodeId(targetId);
  if (!cleanId) return { streamUrl: '', referer: `${activeDomain}/` };

  if (isDirectMediaUrl(cleanId)) {
    return { streamUrl: cleanId, referer: `${activeDomain}/` };
  }

  const unwrappedDirect = unwrapNestedMediaUrl(cleanId, activeDomain);
  if (unwrappedDirect) {
    return { streamUrl: unwrappedDirect, referer: `${activeDomain}/` };
  }

  const normalizedId = normalizeUrlToActive(cleanId);
  const cached = getPlayCache(cleanId) || getPlayCache(normalizedId);
  if (cached && cached.url) {
    return { streamUrl: cached.url, referer: cached.referer || `${activeDomain}/` };
  }

  const { html: firstHtml, finalUrl: firstUrl, origin: firstOrigin } = await fetchHtml(cleanId);

  // Try extracting directly from the fetched page first (handles /vod/play/ URLs or embedded players)
  const directStream = await resolveStreamFromPlayHtml(firstHtml, firstUrl, firstOrigin);
  if (directStream) {
    const referer = `${firstOrigin}/`;
    setPlayCache(cleanId, { url: directStream, referer });
    setPlayCache(normalizedId, { url: directStream, referer });
    setPlayCache(firstUrl, { url: directStream, referer });
    return { streamUrl: directStream, referer };
  }

  // Stage 5: Discover play routes from detail page (or derive alternate routes)
  let candidatePlayUrls = extractPlayLinksFromDetail(firstHtml, firstOrigin);

  // If cleanId was a /vod/play/ URL that failed, derive detail page URL to discover alternate play routes
  if (candidatePlayUrls.length === 0 && /\/index\.php\/vod\/play\/id\/(\d+)/i.test(cleanId)) {
    const vidMatch = cleanId.match(/\/index\.php\/vod\/play\/id\/(\d+)/i);
    if (vidMatch) {
      const detailUrl = `${firstOrigin}/index.php/vod/detail/id/${vidMatch[1]}.html`;
      const { html: detailHtml, origin: detailOrigin } = await fetchHtml(detailUrl);
      candidatePlayUrls = extractPlayLinksFromDetail(detailHtml, detailOrigin);
    }
  }

  // If cleanId was a /vod/detail/id/{vid} URL with no explicit links, construct standard MacCMS play route
  if (candidatePlayUrls.length === 0 && /\/index\.php\/vod\/detail\/id\/(\d+)/i.test(cleanId)) {
    const vidMatch = cleanId.match(/\/index\.php\/vod\/detail\/id\/(\d+)/i);
    if (vidMatch) {
      candidatePlayUrls.push(
        `${firstOrigin}/index.php/vod/play/id/${vidMatch[1]}/sid/1/nid/1.html`
      );
    }
  }

  for (const playUrl of candidatePlayUrls) {
    if (playUrl === firstUrl) continue;
    const { html: playHtml, finalUrl: resolvedPlayUrl, origin: playOrigin } = await fetchHtml(
      playUrl,
      { Referer: firstUrl }
    );
    const stream = await resolveStreamFromPlayHtml(playHtml, resolvedPlayUrl, playOrigin);
    if (stream) {
      const referer = `${playOrigin}/`;
      setPlayCache(cleanId, { url: stream, referer });
      setPlayCache(normalizedId, { url: stream, referer });
      setPlayCache(playUrl, { url: stream, referer });
      setPlayCache(resolvedPlayUrl, { url: stream, referer });
      return { streamUrl: stream, referer };
    }
  }

  return {
    streamUrl: '',
    fallbackUrl: candidatePlayUrls[0] || firstUrl || normalizedId,
    referer: `${firstOrigin}/`,
  };
}

async function home(inReq, _outResp) {
  let list = [];
  try {
    const firstTid = CATEGORIES[0].type_id;
    const { html, origin } = await fetchHtml(
      `/index.php/vod/type/id/${firstTid}/page/1.html`
    );
    list = parseCards(html, origin);
  } catch (_) {}

  return {
    class: CATEGORIES,
    filters: {},
    list,
    style: { type: 'rect', ratio: 1.78 },
  };
}

async function category(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const tid = String(params.id ?? params.tid ?? params.type_id ?? CATEGORIES[0].type_id);
  const pg = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);

  const relUrl = `/index.php/vod/type/id/${tid}/page/${pg}.html`;
  const { html, origin } = await fetchHtml(relUrl);
  const videos = parseCards(html, origin);

  if (!videos || videos.length === 0) {
    return {
      list: [],
      page: pg,
      pagecount: pg,
      limit: 0,
      total: 0,
    };
  }

  const pagecount = parsePageCount(html, pg);
  return {
    list: videos,
    page: pg,
    pagecount,
    limit: videos.length,
    total: pagecount * videos.length,
  };
}

async function detail(inReq, _outResp) {
  const params = unwrapParams(inReq);
  let rawId = params.id ?? params.ids ?? params.url ?? '';
  if (Array.isArray(rawId)) {
    rawId = rawId[0] ?? '';
  }
  const targetUrl = sanitizeEpisodeId(String(rawId || ''));
  let normalizedTarget = normalizeUrlToActive(targetUrl);

  let vodName = '美不胜收(免翻)';
  let vodPic = '';
  let vodRemarks = '高清';
  let vodPlayUrl = `原画直连$${normalizedTarget}`;

  try {
    const { html, finalUrl, origin } = await fetchHtml(targetUrl);
    normalizedTarget = normalizeUrlToActive(targetUrl, origin);
    vodPlayUrl = `原画直连$${normalizedTarget}`;

    if (html) {
      const titleMatch =
        html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
        html.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i) ||
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        const cleanedTitle = cleanHtmlText(titleMatch[1]).replace(/[-_|].*$/, '').trim();
        if (cleanedTitle) vodName = cleanedTitle;
      }

      const picMatch =
        html.match(/data-original=["']([^"']+)["']/i) ||
        html.match(/class=["'][^"']*poster[^"']*["'][^>]*src=["']([^"']+)["']/i);
      if (picMatch) {
        vodPic = normalizeUrlToActive(picMatch[1], origin);
      }

      // Pre-warm PLAY_CACHE so subsequent /play is instant
      const directStream = await resolveStreamFromPlayHtml(html, finalUrl, origin);
      if (directStream) {
        const referer = `${origin}/`;
        setPlayCache(targetUrl, { url: directStream, referer });
        setPlayCache(normalizedTarget, { url: directStream, referer });
        setPlayCache(finalUrl, { url: directStream, referer });
      } else {
        const playLinks = extractPlayLinksFromDetail(html, origin);
        if (playLinks.length > 0) {
          const firstPlayUrl = playLinks[0];
          const {
            html: playHtml,
            finalUrl: resolvedPlayUrl,
            origin: playOrigin,
          } = await fetchHtml(firstPlayUrl, { Referer: finalUrl });
          const stream = await resolveStreamFromPlayHtml(
            playHtml,
            resolvedPlayUrl,
            playOrigin
          );
          if (stream) {
            const referer = `${playOrigin}/`;
            setPlayCache(targetUrl, { url: directStream || stream, referer });
            setPlayCache(normalizedTarget, { url: stream, referer });
            setPlayCache(firstPlayUrl, { url: stream, referer });
            setPlayCache(resolvedPlayUrl, { url: stream, referer });
          }
        }
      }
    }
  } catch (_) {}

  const vod = {
    vod_id: normalizedTarget || targetUrl,
    vod_name: vodName,
    vod_pic: vodPic,
    vod_remarks: vodRemarks,
    vod_director: 'YJ-Gemini',
    vod_play_from: 'YJ-Gemini 专线',
    vod_play_url: vodPlayUrl,
  };

  return { list: [vod] };
}

async function play(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawId = params.id ?? params.url ?? '';
  const cleanId = sanitizeEpisodeId(rawId);

  const { streamUrl, fallbackUrl, referer } = await resolveFullPlayback(cleanId);
  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: referer || `${activeDomain}/`,
  };

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
    url: fallbackUrl || normalizeUrlToActive(cleanId),
    header: playHeaders,
    headers: playHeaders,
  };
}

async function search(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const wd = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pg = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);

  if (!wd) {
    return { list: [], page: 1, pagecount: 1, limit: 0, total: 0 };
  }

  const encodedWd = encodeURIComponent(wd);
  const searchPaths =
    pg === 1
      ? [
          `/index.php/vod/search.html?wd=${encodedWd}`,
          `/index.php/vod/search/page/${pg}/wd/${encodedWd}.html`,
        ]
      : [
          `/index.php/vod/search/page/${pg}/wd/${encodedWd}.html`,
          `/index.php/vod/search.html?wd=${encodedWd}&page=${pg}`,
        ];

  let videos = [];
  let lastHtml = '';
  for (const path of searchPaths) {
    const { html, origin } = await fetchHtml(path);
    lastHtml = html;
    videos = parseCards(html, origin);
    if (videos.length > 0) break;
  }

  const pagecount = videos.length > 0 ? parsePageCount(lastHtml, pg) : 1;
  return {
    list: videos,
    page: pg,
    pagecount,
    limit: videos.length,
    total: videos.length > 0 ? pagecount * videos.length : 0,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = query.url || query.pic || '';
  if (!picUrl) {
    return { mime: 'image/png', data: Buffer.alloc(0) };
  }
  try {
    const target = normalizeUrlToActive(picUrl);
    const origin = new URL(target).origin;
    const resp = await req.get(target, {
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: `${origin}/`,
      },
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    const raw = resp?.data ?? resp?.body ?? resp;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
    const mime = resp?.headers?.['content-type'] || 'image/jpeg';
    return { mime, data: buf };
  } catch (_) {
    return { mime: 'image/png', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'mbss',
    name: '美不胜收(免翻)',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/mbss_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};