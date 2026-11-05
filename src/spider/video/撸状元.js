import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const DEFAULT_HOST = 'https://xn--b33a.lzytv.cfd';
const SITE_DOMAINS = [
  'https://xn--b33a.lzytv.cfd',
  'https://lzytv.cfd',
];

let activeDomain = DEFAULT_HOST;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CLASSES = [
  { type_id: '10082', type_name: '国产' },
  { type_id: '10083', type_name: '传媒' },
  { type_id: '10084', type_name: '黑料' },
  { type_id: '10085', type_name: '欧美' },
  { type_id: '10086', type_name: '动漫' },
  { type_id: '10087', type_name: '有码' },
  { type_id: '10088', type_name: '无码' },
  { type_id: '10089', type_name: '字幕' },
  { type_id: '10090', type_name: '巨乳美乳' },
  { type_id: '10091', type_name: '人妻熟女' },
  { type_id: '10092', type_name: '强奸乱伦' },
  { type_id: '10093', type_name: '制服丝袜' },
];

const CARD_STYLE = { type: 'rect', ratio: 1.78 };

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

function getBaseIndexUrl(domain = activeDomain) {
  return `${String(domain || DEFAULT_HOST).replace(/\/+$/, '')}/vod/index.php`;
}

function getPlayHeaders(domain = activeDomain) {
  return {
    'User-Agent': UA,
    Referer: getBaseIndexUrl(domain),
  };
}

function buildHeaders(referer, extra = {}) {
  const ref = referer || getBaseIndexUrl(activeDomain);
  return {
    'User-Agent': UA,
    Referer: ref,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...extra,
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
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function unescapeJsSlashesAndUnicode(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function customUnescape(str) {
  if (!str) return '';
  const step1 = String(str).replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  try {
    return decodeURIComponent(step1);
  } catch (_) {
    return step1.replace(/%([0-9a-fA-F]{2})/gi, (__, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
}

function fixUrl(url, host = activeDomain) {
  if (!url) return '';
  const raw = unescapeHtml(String(url).trim());
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  const baseHost = String(host || activeDomain || DEFAULT_HOST).replace(/\/+$/, '');
  if (raw.startsWith('/')) return `${baseHost}${raw}`;
  return `${baseHost}/vod/${raw.replace(/^\.\//, '')}`;
}

function extractImgUrlFromTag(imgTag) {
  if (!imgTag) return '';
  const attrOrder = ['original', 'data-original', 'data-src', 'src'];
  for (const attr of attrOrder) {
    const m = imgTag.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
    if (m && m[1] && !m[1].startsWith('data:')) {
      return m[1].trim();
    }
  }
  return '';
}

function parsePageNum(pg) {
  const n = parseInt(String(pg ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function unwrapParams(inReq) {
  const out = {};
  if (!inReq) return out;
  const mergeSource = (src) => {
    if (!src) return;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') Object.assign(out, parsed);
          return;
        } catch (_) {}
      }
      const sp = new URLSearchParams(trimmed);
      for (const [k, v] of sp.entries()) out[k] = v;
      return;
    }
    if (typeof src === 'object') {
      Object.assign(out, src);
    }
  };
  mergeSource(inReq.query);
  mergeSource(inReq.body);
  return out;
}

function getKnownHosts() {
  const set = new Set();
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    try {
      set.add(new URL(d).hostname.toLowerCase());
    } catch (_) {}
  }
  return set;
}

function expandCandidateUrls(targetUrlOrPath) {
  const raw = String(targetUrlOrPath || '').trim();
  if (!raw) return [];
  const domains = Array.from(new Set([activeDomain, ...SITE_DOMAINS].filter(Boolean))).map((d) =>
    d.replace(/\/+$/, '')
  );

  if (raw.startsWith('/')) {
    return domains.map((d) => `${d}${raw}`);
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const knownHosts = getKnownHosts();
      if (knownHosts.has(u.hostname.toLowerCase())) {
        const pathAndQuery = `${u.pathname}${u.search}`;
        const list = domains.map((d) => `${d}${pathAndQuery}`);
        if (!list.includes(raw)) list.unshift(raw);
        return Array.from(new Set(list));
      }
    } catch (_) {}
    return [raw];
  }

  return domains.map((d) => `${d}/vod/${raw.replace(/^\/+/, '')}`);
}

function decodeResponseBuffer(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  let buf = Buffer.isBuffer(data)
    ? data
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : ArrayBuffer.isView(data)
        ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        : null;

  if (!buf) {
    if (typeof data === 'object') {
      try {
        return JSON.stringify(data);
      } catch (_) {
        return String(data);
      }
    }
    return String(data);
  }

  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = zlib.gunzipSync(buf);
    } catch (_) {}
  }

  const utf8Text = buf.toString('utf-8');
  if (utf8Text.includes('\ufffd')) {
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
    html.includes('thumb-item') ||
    html.includes('detail=') ||
    html.includes('.m3u8') ||
    html.includes('.mp4') ||
    html.includes('player_') ||
    /<h1[^>]*>/i.test(html) ||
    /<video[\s>]/i.test(html) ||
    /<iframe[\s>]/i.test(html)
  );
}

async function fetchHtml(targetUrlOrPath, customReferer = '') {
  const candidates = expandCandidateUrls(targetUrlOrPath);
  let fallbackText = '';

  for (const url of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(url).origin;
    } catch (_) {}
    const referer = customReferer
      ? customReferer.replace(/^https?:\/\/[^/]+/i, origin)
      : `${origin}/vod/index.php`;

    try {
      const res = await req.get(url, {
        headers: buildHeaders(referer),
        timeout: 15000,
      });
      const status = res?.status ?? 200;
      if (status >= 200 && status < 400) {
        const text = decodeResponseBuffer(res?.data ?? res?.body ?? res);
        if (text && looksLikeValidSiteHtml(text)) {
          activeDomain = origin;
          return text;
        }
        if (text && !fallbackText) {
          fallbackText = text;
        }
      }
    } catch (_) {}
  }

  return fallbackText;
}

function parseVideoCards(html) {
  const list = [];
  if (!html) return list;
  const seen = new Set();

  // Pattern 1: Exact Python spider structure with priority lazy-load image attribute extraction
  const blockRegex =
    /<div[^>]*class="[^"]*thumb-item[^"]*"[^>]*>[\s\S]*?<a[^>]*href="[^"]*detail=(\d+)[^"]*"[^>]*>[\s\S]*?(<img[^>]*>)[\s\S]*?thumb-item__title[^>]*>([\s\S]*?)<\/h2>/gi;
  let match;
  while ((match = blockRegex.exec(html)) !== null) {
    const vid = match[1].trim();
    const pic = extractImgUrlFromTag(match[2]);
    const rawTitle = match[3].replace(/<[^>]+>/g, '').trim();
    if (!vid || seen.has(vid)) continue;
    seen.add(vid);
    list.push({
      vod_id: vid,
      vod_name: unescapeHtml(rawTitle),
      vod_pic: fixUrl(pic, activeDomain),
    });
  }

  // Pattern 2: Flexible fallback if attribute or tag order inside thumb-item varies
  if (list.length === 0) {
    const parts = html.split(/<div[^>]*class="[^"]*thumb-item(?![^"]*__)/i);
    for (let i = 1; i < parts.length; i++) {
      const seg = parts[i];
      const idMatch = seg.match(/href="[^"]*detail=(\d+)[^"]*"/i);
      if (!idMatch) continue;
      const vid = idMatch[1].trim();
      if (!vid || seen.has(vid)) continue;

      const imgTagMatch = seg.match(/<img[^>]*>/i);
      const pic = imgTagMatch ? extractImgUrlFromTag(imgTagMatch[0]) : '';

      const titleMatch =
        seg.match(/thumb-item__title[^>]*>([\s\S]*?)<\/h2>/i) ||
        seg.match(/title="([^"]+)"/i) ||
        seg.match(/alt="([^"]+)"/i);
      const title = titleMatch ? unescapeHtml(titleMatch[1].replace(/<[^>]+>/g, '').trim()) : `视频 ${vid}`;

      seen.add(vid);
      list.push({
        vod_id: vid,
        vod_name: title,
        vod_pic: fixUrl(pic, activeDomain),
      });
    }
  }

  return list;
}

function parseMaxPage(html, currentPage = 1) {
  if (!html) return currentPage;
  let maxPage = currentPage;
  const pageRegex = /href="[^"]*page=(\d+)[^"]*"[^>]*>(\d+)(?:<\/a>)?/gi;
  let m;
  while ((m = pageRegex.exec(html)) !== null) {
    const n1 = parseInt(m[1], 10);
    const n2 = parseInt(m[2], 10);
    if (Number.isFinite(n1) && n1 > maxPage) maxPage = n1;
    if (Number.isFinite(n2) && n2 > maxPage) maxPage = n2;
  }
  return maxPage;
}

function isDecoyMediaUrl(url) {
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
  const cleaned = url.split('@@@')[0].trim();
  if (!/^https?:\/\//i.test(cleaned)) return false;
  if (isDecoyMediaUrl(cleaned)) return false;
  try {
    const u = new URL(cleaned);
    const pathname = u.pathname.toLowerCase();
    if (/\.(m3u8|mp4|m4v|flv|webm|ts)$/i.test(pathname)) {
      return true;
    }
    if (
      !/\.(html?|php|jsp|asp)$/i.test(pathname) &&
      /\.(m3u8|mp4|m4v|flv|webm)(\b|$)/i.test(pathname)
    ) {
      return true;
    }
  } catch (_) {
    return /\.(m3u8|mp4|m4v|flv|webm)(\?|$)/i.test(cleaned);
  }
  return false;
}

function unwrapNestedMediaUrl(rawUrl, baseHost = activeDomain) {
  if (!rawUrl) return '';
  let candidate = unescapeHtml(unescapeJsSlashesAndUnicode(String(rawUrl).trim()));
  if (!candidate) return '';

  try {
    const full = fixUrl(candidate, baseHost);
    const parsed = new URL(full);
    const pathname = parsed.pathname.toLowerCase();
    if (!/\.(m3u8|mp4|m4v|flv|webm)$/i.test(pathname)) {
      for (const paramKey of ['url', 'v', 'vid', 'src', 'file', 'm3u8']) {
        const inner = parsed.searchParams.get(paramKey);
        if (inner) {
          let decoded = inner;
          for (let i = 0; i < 2; i++) {
            const next = customUnescape(decoded);
            if (next === decoded) break;
            decoded = next;
          }
          decoded = unescapeHtml(unescapeJsSlashesAndUnicode(decoded.trim()));
          if (/^https?:\/\//i.test(decoded) || decoded.startsWith('/')) {
            return fixUrl(decoded, parsed.origin);
          }
        }
      }
    }
    return full;
  } catch (_) {
    return candidate;
  }
}

function extractBalancedJsonObjects(html, varNames = ['player_aaaa', 'player_data', 'player_config', 'cms_player']) {
  const objects = [];
  if (!html) return objects;

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
              const jsonText = html.slice(startBrace, i + 1);
              try {
                objects.push(JSON.parse(jsonText));
              } catch (_) {}
              break;
            }
          }
        }
      }
    }
  }
  return objects;
}

function decodeCmsPlayerUrl(cfg) {
  if (!cfg || typeof cfg !== 'object' || !cfg.url) return '';
  let raw = String(cfg.url).trim();
  const encrypt = Number(cfg.encrypt || 0);

  if (encrypt === 1) {
    raw = customUnescape(raw);
  } else if (encrypt === 2) {
    try {
      const b64Decoded = Buffer.from(raw, 'base64').toString('utf-8');
      raw = customUnescape(b64Decoded);
    } catch (_) {}
  } else {
    raw = unescapeHtml(unescapeJsSlashesAndUnicode(raw));
  }

  return unwrapNestedMediaUrl(raw, activeDomain);
}

function unpackDeanEdwards(html) {
  const unpackedChunks = [];
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return unpackedChunks;

  const packerRegex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let m;
  while ((m = packerRegex.exec(html)) !== null) {
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
      return encodeBase(Math.floor(num / base), base) + (num % base < 36 ? (num % base).toString(36) : chars[num % base]);
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      const val = symtab[i];
      if (val) dict.set(key, val);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) => dict.get(word) ?? word);
    unpackedChunks.push(unpacked);
  }
  return unpackedChunks;
}

function extractStreamFromTextBlock(rawBlock, baseOrigin = activeDomain) {
  if (!rawBlock) return '';

  // Stage 1: Balanced-brace CMS player object
  const playerConfigs = extractBalancedJsonObjects(rawBlock);
  for (const cfg of playerConfigs) {
    const decoded = decodeCmsPlayerUrl(cfg);
    if (isDirectMediaUrl(decoded)) return decoded;
  }

  // Normalize escaped slashes and HTML entities before regex scan
  const normalized = unescapeHtml(unescapeJsSlashesAndUnicode(rawBlock));

  // Unwrap any wrapper URL with ?url=...m3u8 inside normalized block
  const wrapperRegex = /https?:\/\/[^\s"'<>]+?\?(?:[^"'<>\s]*&)?(?:url|v|src)=([^&"'<>\s]+)/gi;
  let wm;
  while ((wm = wrapperRegex.exec(normalized)) !== null) {
    const unwrapped = unwrapNestedMediaUrl(wm[0], baseOrigin);
    if (isDirectMediaUrl(unwrapped)) return unwrapped;
  }

  // Stage 3a: Direct m3u8 URL match
  const m3u8Regex = /(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/gi;
  let mm;
  while ((mm = m3u8Regex.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(mm[1], baseOrigin);
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  // Stage 3b: Direct mp4 URL match
  const mp4Regex = /(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/gi;
  while ((mm = mp4Regex.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(mm[1], baseOrigin);
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  // Stage 3c: Relative m3u8 / mp4 in <video>, <source>, or player variables
  const relMediaRegex =
    /(?:src|url|videoUrl|playUrl|file)\s*[:=]\s*(['"])(\/[^\s"'<>]+?\.(?:m3u8|mp4)[^\s"'<>]*)\1/gi;
  while ((mm = relMediaRegex.exec(normalized)) !== null) {
    const candidate = fixUrl(mm[2], baseOrigin);
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  return '';
}

async function resolvePlayStreamFromHtml(html, pageUrl = '') {
  if (!html) return '';
  let baseOrigin = activeDomain;
  try {
    if (pageUrl) baseOrigin = new URL(pageUrl).origin;
  } catch (_) {}

  // Stage 1 & 3 on main HTML
  const direct = extractStreamFromTextBlock(html, baseOrigin);
  if (direct) return direct;

  // Stage 2: Unpack Dean Edwards packed scripts
  const unpackedList = unpackDeanEdwards(html);
  for (const chunk of unpackedList) {
    const fromPacked = extractStreamFromTextBlock(chunk, baseOrigin);
    if (fromPacked) return fromPacked;
  }

  // Stage 4: Check embedded <iframe src="..."> players
  const iframeRegex = /<iframe[^>]+?(?:src|data-src)=['"]([^'"]+)['"]/gi;
  let im;
  while ((im = iframeRegex.exec(html)) !== null) {
    const rawIframeUrl = im[1].trim();
    if (!rawIframeUrl || rawIframeUrl.startsWith('javascript:') || rawIframeUrl === 'about:blank') {
      continue;
    }
    const unwrapped = unwrapNestedMediaUrl(rawIframeUrl, baseOrigin);
    if (isDirectMediaUrl(unwrapped)) return unwrapped;

    const fullIframeUrl = fixUrl(rawIframeUrl, baseOrigin);
    if (/^https?:\/\//i.test(fullIframeUrl)) {
      const iframeHtml = await fetchHtml(fullIframeUrl, pageUrl || getBaseIndexUrl(baseOrigin));
      if (iframeHtml) {
        const fromIframe = extractStreamFromTextBlock(iframeHtml, baseOrigin);
        if (fromIframe) return fromIframe;
        for (const chunk of unpackDeanEdwards(iframeHtml)) {
          const fromIframePacked = extractStreamFromTextBlock(chunk, baseOrigin);
          if (fromIframePacked) return fromIframePacked;
        }
      }
    }
  }

  return '';
}

function sanitizePlayId(rawId) {
  if (!rawId) return '';
  let pid = String(rawId).trim();
  if (pid.includes('@@@')) {
    pid = pid.split('@@@')[0].trim();
  }
  if (pid.includes('$')) {
    const idx = pid.indexOf('$');
    const prefix = pid.slice(0, idx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      pid = pid.slice(idx + 1).trim();
    }
  }
  return pid;
}

function extractNumericVid(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (/^\d+$/.test(str)) return str;
  const m = str.match(/[?&]detail=(\d+)/i) || str.match(/\/detail\/(\d+)/i);
  return m ? m[1] : str;
}

async function init(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const cfg = params.extend || params;
  if (cfg) {
    let parsed = cfg;
    if (typeof cfg === 'string' && cfg.trim().startsWith('{')) {
      try {
        parsed = JSON.parse(cfg);
      } catch (_) {}
    }
    if (parsed && typeof parsed === 'object') {
      const customHost = parsed.host || parsed.HOST || '';
      if (customHost && typeof customHost === 'string') {
        const cleanHost = customHost.trim().replace(/\/+$/, '');
        if (/^https?:\/\//i.test(cleanHost)) {
          activeDomain = cleanHost;
          if (!SITE_DOMAINS.includes(cleanHost)) {
            SITE_DOMAINS.unshift(cleanHost);
          }
        }
      }
    }
  }
  return {};
}

async function home(_inReq, _outResp) {
  let list = [];
  try {
    const html = await fetchHtml('/vod/index.php');
    if (html) {
      list = parseVideoCards(html);
    }
  } catch (_) {}

  return {
    class: CLASSES,
    filters: {},
    list,
    style: CARD_STYLE,
  };
}

async function homeVod(_inReq, _outResp) {
  const html = await fetchHtml('/vod/index.php');
  const list = html ? parseVideoCards(html) : [];
  return { list };
}

async function category(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const tid = String(params.id ?? params.tid ?? params.type_id ?? '0').trim();
  const page = parsePageNum(params.page ?? params.pg ?? 1);

  const path =
    tid === '0' || !tid
      ? '/vod/index.php'
      : `/vod/index.php?class=${encodeURIComponent(tid)}&page=${page}`;

  const html = await fetchHtml(path);
  if (!html) {
    return {
      list: [],
      page,
      pagecount: 1,
      limit: 24,
      total: 0,
      style: CARD_STYLE,
    };
  }

  const list = parseVideoCards(html);
  const pagecount = parseMaxPage(html, page);

  return {
    list,
    page,
    pagecount,
    limit: 24,
    total: list.length * pagecount,
    style: CARD_STYLE,
  };
}

async function detail(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawId = params.id ?? params.ids ?? params.url ?? '';
  const firstId = Array.isArray(rawId) ? rawId[0] : rawId;
  const vid = extractNumericVid(firstId);
  if (!vid) return { list: [] };

  const detailPath = `/vod/index.php?detail=${encodeURIComponent(vid)}`;
  const html = await fetchHtml(detailPath);
  if (!html) return { list: [] };

  let title = '';
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    title = unescapeHtml(h1Match[1].replace(/<[^>]+>/g, '').trim());
  }
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      title = unescapeHtml(titleMatch[1].replace(/<[^>]+>/g, '').trim());
    }
  }

  let pic = '';
  const coverTagMatch =
    html.match(/<img[^>]*class="[^"]*cover[^"]*"[^>]*>/i) ||
    html.match(/<img[^>]+(?:jpg|jpeg|png|webp|gif)[^>]*>/i);
  if (coverTagMatch) {
    pic = fixUrl(extractImgUrlFromTag(coverTagMatch[0]), activeDomain);
  }

  const resolvedStream = await resolvePlayStreamFromHtml(html, `${activeDomain}${detailPath}`);

  let vodPlayUrl = `正片$${vid}`;
  if (resolvedStream) {
    setPlayCache(vid, resolvedStream);
    vodPlayUrl = `播放$${resolvedStream}`;
  }

  return {
    list: [
      {
        vod_id: vid,
        vod_name: title || `视频 ${vid}`,
        vod_pic: pic,
        vod_play_from: '默认',
        vod_play_url: vodPlayUrl,
      },
    ],
  };
}

async function play(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawId = params.id ?? params.url ?? '';
  const pid = sanitizePlayId(rawId);

  if (!pid) {
    const playHeaders = getPlayHeaders(activeDomain);
    return { parse: 0, jx: 0, url: '', header: playHeaders, headers: playHeaders };
  }

  const maybeUnwrapped = unwrapNestedMediaUrl(pid, activeDomain);
  if (isDirectMediaUrl(maybeUnwrapped)) {
    const playHeaders = getPlayHeaders(activeDomain);
    return {
      parse: 0,
      jx: 0,
      url: maybeUnwrapped,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const vid = extractNumericVid(pid);
  const cachedStream = getPlayCache(vid);
  if (cachedStream && isDirectMediaUrl(cachedStream)) {
    const playHeaders = getPlayHeaders(activeDomain);
    return {
      parse: 0,
      jx: 0,
      url: cachedStream,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const detailPath = `/vod/index.php?detail=${encodeURIComponent(vid)}`;
  const html = await fetchHtml(detailPath);
  if (html) {
    const streamUrl = await resolvePlayStreamFromHtml(html, `${activeDomain}${detailPath}`);
    if (streamUrl && isDirectMediaUrl(streamUrl)) {
      setPlayCache(vid, streamUrl);
      const playHeaders = getPlayHeaders(activeDomain);
      return {
        parse: 0,
        jx: 0,
        url: streamUrl,
        header: playHeaders,
        headers: playHeaders,
      };
    }
  }

  const playHeaders = getPlayHeaders(activeDomain);
  const fallbackUrl = /^https?:\/\//i.test(pid)
    ? pid
    : `${activeDomain}/vod/index.php?detail=${encodeURIComponent(vid)}`;
  return {
    parse: 1,
    jx: 0,
    url: fallbackUrl,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function search(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const page = parsePageNum(params.page ?? params.pg ?? 1);

  if (!key) {
    return { list: [], page: 1, pagecount: 1, limit: 24, total: 0 };
  }

  const searchPath = `/vod/index.php?wd=${encodeURIComponent(key)}&page=${page}`;
  const html = await fetchHtml(searchPath);
  if (!html) {
    return { list: [], page, pagecount: 1, limit: 24, total: 0 };
  }

  const list = parseVideoCards(html);
  const pagecount = parseMaxPage(html, page);

  return {
    list,
    page,
    pagecount,
    limit: 24,
    total: list.length * pagecount,
  };
}

async function proxyPicHandler(query) {
  const picUrl = fixUrl(query?.url || query?.pic || '', activeDomain);
  if (!picUrl) {
    return { mime: 'text/plain', data: Buffer.from('') };
  }
  try {
    const res = await req.get(picUrl, {
      headers: buildHeaders(getBaseIndexUrl(activeDomain)),
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const mime = res?.headers?.['content-type'] || 'image/jpeg';
    const raw = res?.data ?? res?.body ?? '';
    const buf = Buffer.isBuffer(raw)
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw)
        : Buffer.from(String(raw));
    return { mime, data: buf };
  } catch (_) {
    return { mime: 'text/plain', data: Buffer.from('') };
  }
}

export default {
  meta: {
    key: 'lzytv',
    name: '撸状元',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/homeVod', homeVod);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/lzytv_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
  spider: {
    init,
    home,
    homeVod,
    category,
    detail,
    play,
    search,
  },
};