// 小穴生 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 小穴生.py（MacCMS v10 殼子）移植，修復 player_aaaa 嵌套對象解析、斜槓轉義、多重加密解碼與播放容錯。
import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// 域名池：支持主站及自動跟隨重定向更新可用域名
const DOMAINS = ['kkb2.sixnicexxs.cc'];
let activeDomain = DOMAINS[0];

const RECT_178_STYLE = { type: 'rect', ratio: 1.78 };

const CLASSES = [
  ['6', '国产自拍'],
  ['7', '网爆黑料'],
  ['8', '无码专区'],
  ['9', '熟女人妻'],
  ['10', '欧美无码'],
  ['11', '麻豆传媒'],
  ['12', '萝莉少女'],
  ['20', '女优明星'],
  ['13', '制服诱惑'],
  ['14', '女同性爱'],
  ['15', 'SM调教'],
  ['16', '三级伦理'],
  ['21', '多人群交'],
  ['22', 'AV解说'],
  ['23', 'AI换脸'],
  ['24', '美乳巨乳'],
  ['25', '中文字幕'],
  ['26', '强奸乱伦'],
  ['27', '卡通动漫'],
  ['28', '抖音视频'],
  ['29', '欧美系列'],
  ['30', '韩国主播'],
  ['31', '美女主播'],
  ['32', '网红头条'],
];

const toStr = (v) => (v == null ? '' : String(v));

// ===================== 通用工具 =====================

function quoteSafe(s) {
  return encodeURIComponent(toStr(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function safeUnquote(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// 兼容 MacCMS encrypt=1 的 JavaScript unescape（支持 %uXXXX 與 %XX）
function jsUnescape(str) {
  if (!str) return '';
  const s = toStr(str)
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  try {
    return decodeURIComponent(escape(s));
  } catch {
    return s;
  }
}

function b64d(s) {
  try {
    const cleanStr = String(s).trim().replace(/[\r\n\s]/g, '');
    if (!cleanStr || !/^[A-Za-z0-9+/=_-]+$/.test(cleanStr)) return '';
    const norm = cleanStr.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (norm.length % 4)) % 4);
    return Buffer.from(norm + pad, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function htmlUnescape(s) {
  let out = toStr(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, ent) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const cp = parseInt(ent.slice(2), 16);
      return Number.isNaN(cp) ? m : String.fromCodePoint(cp);
    }
    if (ent.startsWith('#')) {
      const cp = parseInt(ent.slice(1), 10);
      return Number.isNaN(cp) ? m : String.fromCodePoint(cp);
    }
    return ent in NAMED_ENTITIES ? NAMED_ENTITIES[ent] : m;
  });
  out = out.replace(/&(amp|lt|gt|quot|apos|nbsp)(?![a-zA-Z0-9;])/g, (m, ent) => NAMED_ENTITIES[ent]);
  return out;
}

function clean(s) {
  if (!s) return '';
  return htmlUnescape(toStr(s).replace(/<[^>]+>/g, '')).trim();
}

function rx(pattern, text, flags = '') {
  const m = toStr(text).match(new RegExp(pattern, flags));
  return m ? (m[1] ?? m[2] ?? '').trim() : '';
}

function urlJoin(base, rel) {
  try {
    return new URL(rel, base).toString();
  } catch {
    return toStr(rel);
  }
}

function absUrl(url, base) {
  if (!url) return '';
  const u = String(url).trim();
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('http://') || u.startsWith('https://')) return u;
  const domain = activeDomain || DOMAINS[0];
  const origin = base || `https://${domain}`;
  if (u.startsWith('/')) return urlJoin(origin, u);
  return urlJoin(`${origin}/`, u);
}

// ===================== Dean Edwards packer 解包（單趟字典替換） =====================

const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PACKER_SRC = String.raw`eval\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\5)[\s\S])*?)\5\.split\(\s*(['"])\|\7\s*\)(?:\s*,\s*\d+\s*,\s*(?:\{\}|\[\]))?\s*\)`;

function toBase(n, base) {
  if (base <= 62) {
    if (n <= 0) return '0';
    let s = '';
    while (n > 0) {
      s = B62[n % base] + s;
      n = Math.floor(n / base);
    }
    return s;
  }
  return (n < base ? '' : toBase(Math.floor(n / base), base)) + String.fromCharCode((n % base) + 29);
}

function unescapeJsStr(s) {
  return s
    .split('\\\\').join('\x00')
    .split("\\'").join("'")
    .split('\\"').join('"')
    .split('\\/').join('/')
    .split('\\n').join('\n')
    .split('\\r').join('\r')
    .split('\\t').join('\t')
    .split('\x00').join('\\');
}

function unpackPayload(payload, radix, count, symtab) {
  if (!payload || !radix || !count) return payload || '';
  const dict = new Map();
  for (let i = count - 1; i >= 0; i--) {
    const word = toBase(i, radix);
    const val = i < symtab.length && symtab[i] !== '' ? symtab[i] : word;
    dict.set(word, val);
  }
  return payload.replace(/\b[0-9a-zA-Z_]+\b/g, (w) => (dict.has(w) ? dict.get(w) : w));
}

function unpackAll(js, maxDepth = 3) {
  const out = [];
  if (!js) return out;
  for (const m of js.matchAll(new RegExp(PACKER_SRC, 'gs'))) {
    try {
      const payload = unescapeJsStr(m[2]);
      const radix = parseInt(m[3], 10);
      const count = parseInt(m[4], 10);
      const symtab = unescapeJsStr(m[6]).split('|');
      let unpacked = unpackPayload(payload, radix, count, symtab);
      let depth = 1;
      while (depth < maxDepth && unpacked && unpacked.includes('eval(function(p,a,c,k,e,')) {
        const nextMatch = new RegExp(PACKER_SRC, 's').exec(unpacked);
        if (!nextMatch) break;
        const nextPayload = unescapeJsStr(nextMatch[2]);
        const nextRadix = parseInt(nextMatch[3], 10);
        const nextCount = parseInt(nextMatch[4], 10);
        const nextSymtab = unescapeJsStr(nextMatch[6]).split('|');
        unpacked = unpackPayload(nextPayload, nextRadix, nextCount, nextSymtab);
        depth++;
      }
      if (unpacked) out.push(unpacked);
    } catch {
      continue;
    }
  }
  return out;
}

// ===================== 圖片與佔位圖工具 =====================

const AES_KEY = Buffer.from('f5d965df75336270', 'utf8');
const AES_IV = Buffer.from('97b60394abc2fbe1', 'utf8');

function gunzipMaybe(data) {
  if (!data || data.length < 2) return data;
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  try {
    return zlib.gunzipSync(data);
  } catch {
    return data;
  }
}

function imgMime(data) {
  if (!data || data.length < 4) return '';
  const buf = gunzipMaybe(data);
  const n = buf.length;
  if (n >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (n >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (n >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (n >= 6 && (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  if (n >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  if (n >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'heic') return 'image/heic';
    if (brand === 'heif' || brand === 'mif1') return 'image/heif';
  }
  return '';
}

function aesCbcDecrypt(ct, key, iv) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

function decryptCover(data) {
  if (!data || data.length === 0 || imgMime(data)) return data;
  const candidates = [data];
  if (data.length % 16 !== 0) {
    candidates.push(Buffer.concat([data, Buffer.alloc(16 - (data.length % 16))]));
  }
  if (data.length > 16 && data.length % 16 === 0) {
    candidates.push(data.subarray(16));
  }
  for (const c of candidates) {
    if (c.length >= 16 && c.length % 16 === 0) {
      try {
        const pt = aesCbcDecrypt(c, AES_KEY, AES_IV);
        if (imgMime(pt)) return pt;
      } catch {
        continue;
      }
    }
  }
  return data;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(tag, data) {
  const tagBuf = Buffer.from(tag, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tagBuf, data])), 0);
  return Buffer.concat([lenBuf, tagBuf, data, crcBuf]);
}

function blankPng(w = 320, h = 180, rgb = [0x1c, 0x1c, 0x22]) {
  const [br, bg, bb] = rgb;
  const rowLen = 1 + w * 3;
  const raw = Buffer.alloc(h * rowLen);
  for (let y = 0; y < h; y++) {
    const rowOff = y * rowLen;
    raw[rowOff] = 0;
    for (let x = 0; x < w; x++) {
      const on = (((x >> 3) + (y >> 3)) & 1) !== 0;
      const off = rowOff + 1 + x * 3;
      raw[off] = on ? Math.min(255, br + 12) : br;
      raw[off + 1] = on ? Math.min(255, bg + 12) : bg;
      raw[off + 2] = on ? Math.min(255, bb + 14) : bb;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

let BLANK = null;
function blank() {
  if (BLANK === null) {
    try {
      BLANK = blankPng();
    } catch {
      BLANK = Buffer.alloc(0);
    }
  }
  return BLANK;
}

// ===================== 網絡請求與域名容錯 =====================

function getDefaultHeaders(referer = '') {
  const domain = activeDomain || DOMAINS[0];
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: referer || `https://${domain}/`,
  };
}

function getSortedDomains() {
  const set = new Set([activeDomain, ...DOMAINS]);
  return Array.from(set);
}

function expandUrls(urlOrPath) {
  const urls = [];
  const sorted = getSortedDomains();
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    try {
      const u = new URL(urlOrPath);
      urls.push(u.toString());
      for (const d of sorted) {
        const nu = new URL(u.toString());
        nu.host = d;
        const s = nu.toString();
        if (!urls.includes(s)) urls.push(s);
      }
    } catch {
      urls.push(urlOrPath);
    }
  } else {
    const path = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
    for (const d of sorted) urls.push(`https://${d}${path}`);
  }
  return urls;
}

function isOkStatus(resp) {
  const s = resp?.status;
  return s == null || (s >= 200 && s < 400);
}

function decodeHtmlBuffer(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const unzipped = gunzipMaybe(buf);
    const utf8 = unzipped.toString('utf8');
    if (!utf8.includes('\ufffd')) return utf8;
    try {
      return new TextDecoder('gbk').decode(unzipped);
    } catch {
      return utf8;
    }
  }
  return toStr(data);
}

async function fetchWithFallback(urlOrPath, { referer = '', timeout = 8000 } = {}) {
  let lastErr = null;
  for (const url of expandUrls(urlOrPath)) {
    try {
      let curReferer = referer;
      if (curReferer) {
        try {
          const refUrl = new URL(curReferer);
          const curUrl = new URL(url);
          refUrl.host = curUrl.host;
          curReferer = refUrl.toString();
        } catch {}
      }
      const headers = getDefaultHeaders(curReferer || url);
      const resp = await req.get(url, { headers, timeout, validateStatus: () => true });
      const text = decodeHtmlBuffer(resp?.data);
      if (isOkStatus(resp) && Buffer.byteLength(text, 'utf8') >= 20) {
        try {
          activeDomain = new URL(url).host;
        } catch {}
        return { text, finalUrl: url };
      }
      lastErr = new Error(`HTTP ${resp?.status ?? 0} @ ${url}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`请求失败: ${lastErr ? lastErr.message : urlOrPath}`);
}

async function getText(urlOrPath, referer = '', timeout = 8000) {
  try {
    const { text } = await fetchWithFallback(urlOrPath, { referer, timeout });
    return text;
  } catch (e) {
    console.error('[小穴生] GET err:', urlOrPath, e.message);
    return '';
  }
}

// ===================== 列表與卡片解析 =====================

function extractVidFromHref(href) {
  if (!href) return '';
  const s = toStr(href);
  const m =
    s.match(/id\/(\d+)/i) ||
    s.match(/vod-(?:play|detail)-id-(\d+)/i) ||
    s.match(/\/(\d+)(?:-\d+-\d+)?\.html/i);
  return m ? m[1] : '';
}

function parseCardsFromSegment(segmentHtml) {
  const cards = [];
  const seen = new Set();
  if (!segmentHtml) return cards;

  const re = /<a\s+([^>]*href=["']([^"']*(?:\/vod\/play\/|\/vod\/detail\/|\/detail\/|vod-play-id-|vod-detail-id-)[^"']*)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(segmentHtml)) !== null) {
    try {
      const aAttrs = m[1] || '';
      const href = m[2] || '';
      const inner = m[3] || '';
      const fullTag = m[0] || '';

      const vid = extractVidFromHref(href);
      if (!vid || seen.has(vid)) continue;

      // 優先從 inner 或 <a> 屬性提取標題
      let name =
        rx('title=["\']([^"\']+)["\']', inner, 'i') ||
        rx('alt=["\']([^"\']+)["\']', inner, 'i') ||
        rx('title=["\']([^"\']+)["\']', aAttrs, 'i') ||
        rx('alt=["\']([^"\']+)["\']', aAttrs, 'i');
      if (!name) {
        const cleaned = clean(inner);
        if (cleaned) {
          name = cleaned.split(/\r?\n/)[0].trim();
        }
      }
      // 若 <a> 僅包裹封面圖且標題在緊鄰的兄弟節點中，向後探測 500 字符
      if (!name) {
        const after = segmentHtml.slice(m.index + fullTag.length, m.index + fullTag.length + 500);
        const nextAnchorIdx = after.search(/<a\s+[^>]*href=["'][^"']*(?:\/vod\/play\/|\/vod\/detail\/|\/detail\/)/i);
        const lookahead = nextAnchorIdx >= 0 ? after.slice(0, nextAnchorIdx) : after;
        name =
          clean(rx('<h[2345][^>]*>([\\s\\S]*?)</h[2345]>', lookahead, 'i')) ||
          clean(rx('class=["\'][^"\']*(?:title|name|vodlist_title)[^"\']*["\'][^>]*>([\\s\\S]*?)<', lookahead, 'i')) ||
          clean(rx('title=["\']([^"\']+)["\']', lookahead, 'i'));
      }
      name = clean(name);

      // 提取封面圖（同時檢查 inner 與 <a> 自身屬性、style 背景圖）
      const combinedTag = `${aAttrs}\n${inner}`;
      let pic =
        rx('(?:data-original|data-src|data-echo|data-lazy-src|src)=["\']([^"\']+\\.(?:jpg|jpeg|png|webp|gif|avif)[^"\']*)["\']', combinedTag, 'i') ||
        rx('(?:data-original|data-src|data-echo|data-lazy-src)=["\']([^"\']+)["\']', combinedTag, 'i') ||
        rx('background(?:-image)?\\s*:\\s*url\\(\\s*["\']?([^)"\']+)["\']?\\s*\\)', combinedTag, 'i');

      pic = absUrl(htmlUnescape(pic));

      // 提取備註標籤
      const rem = clean(rx('class=["\'][^"\']*(?:pic-text|remarks|notes|badge|dx-[^"\']*)[^"\']*["\'][^>]*>([\\s\\S]*?)<', inner, 'i'));
      const remarks = rem ? `蝴蝶影视 | ${rem}` : '蝴蝶影视';

      if (name && pic) {
        seen.add(vid);
        cards.push({
          vod_id: vid,
          vod_name: name,
          vod_pic: pic,
          vod_remarks: remarks,
          vod_actor: '🦋 TG群: @tvshare23',
          vod_director: '🦋 蝴蝶影视',
          style: RECT_178_STYLE,
        });
      }
    } catch {
      continue;
    }
  }
  return cards;
}

function parseCardsFromHtml(htmlText) {
  if (!htmlText) return [];
  let tailHtml = htmlText;
  if (htmlText.includes('热搜')) {
    tailHtml = htmlText.slice(htmlText.indexOf('热搜') + 2);
  } else if (htmlText.includes('dx-searchbar')) {
    tailHtml = htmlText.slice(htmlText.indexOf('dx-searchbar') + 12);
  }
  const cards = parseCardsFromSegment(tailHtml);
  if (cards.length > 0 || tailHtml === htmlText) return cards;
  // 若分割後為空（例如「热搜」出現在頁尾），自動回退掃描完整 HTML
  return parseCardsFromSegment(htmlText);
}

// ===================== 播放解析核心（修復嵌套 JSON、斜槓轉義與加密解碼） =====================

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;
const PLAY_CACHE_MAX = 256;

function setPlayCache(key, val) {
  if (!key || !val?.url) return;
  if (PLAY_CACHE.size >= PLAY_CACHE_MAX) {
    const oldest = PLAY_CACHE.keys().next().value;
    PLAY_CACHE.delete(oldest);
  }
  PLAY_CACHE.set(String(key), { ...val, ts: Date.now() });
}

function getPlayCache(key) {
  const item = PLAY_CACHE.get(String(key));
  if (!item) return null;
  if (Date.now() - item.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return item;
}

// 平衡括號提取 JS 變量對象（解決 player_aaaa 含嵌套 vod_data 對象時非貪婪正則提前截斷的 Bug）
function extractBalancedObject(text, varNames = ['player_aaaa', 'player_data', 'player_config', 'MacPlayer']) {
  const results = [];
  if (!text) return results;
  for (const name of varNames) {
    const re = new RegExp(`\\b${name}\\s*=\\s*\\{`, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const startIdx = m.index + m[0].length - 1; // 指向 '{'
      let depth = 0;
      let inStr = false;
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
        if (inStr) {
          if (ch === quoteChar) inStr = false;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = true;
          quoteChar = ch;
          continue;
        }
        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            results.push(text.slice(startIdx, i + 1));
            break;
          }
        }
      }
    }
  }
  return results;
}

function decodeUnicodeEscapes(s) {
  return toStr(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function normalizeMediaUrl(rawUrl, baseUrl = '') {
  if (!rawUrl) return '';
  let u = decodeUnicodeEscapes(htmlUnescape(toStr(rawUrl).trim()))
    .replaceAll('\\/', '/')
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'")
    .trim();

  // 若仍為 URL 編碼 (https%3A%2F%2F...)
  if (/^https?%3A%2F%2F/i.test(u) || (u.includes('%2F') && !u.includes('/'))) {
    u = jsUnescape(u).trim();
  }

  // 若為 Base64 編碼的流地址
  if (!u.startsWith('http') && !u.startsWith('/')) {
    const dec = b64d(u);
    if (dec) {
      const unesc = /^https?%3A%2F%2F/i.test(dec) ? jsUnescape(dec) : dec;
      if (unesc.startsWith('http://') || unesc.startsWith('https://') || unesc.startsWith('/')) {
        u = unesc.trim();
      }
    }
  }

  if (u.startsWith('//')) u = `https:${u}`;
  else if (u.startsWith('/')) u = absUrl(u, baseUrl);

  // 若是嵌套播放器地址（如 /player/dplayer.html?url=https://...m3u8），檢查 pathname 非媒體直鏈時提取內層 url 參數
  if (u.startsWith('http')) {
    try {
      const parsed = new URL(u);
      if (!/\.(?:m3u8|mp4)$/i.test(parsed.pathname)) {
        const inner = parsed.searchParams.get('url') || parsed.searchParams.get('v') || parsed.searchParams.get('src');
        if (inner) {
          const normInner = normalizeMediaUrl(inner, u);
          if (normInner.startsWith('http')) return normInner;
        }
      }
    } catch {}
  }

  return u;
}

function decodePlayerConfigUrl(rawUrl, encryptType = 0, baseUrl = '') {
  if (!rawUrl) return '';
  let target = toStr(rawUrl).trim();
  const enc = Number(encryptType) || 0;

  if (enc === 1) {
    target = jsUnescape(target);
  } else if (enc === 2) {
    const decoded = b64d(target);
    if (decoded) {
      target = jsUnescape(decoded);
    }
  } else if (enc === 3) {
    const decoded = b64d(target) || jsUnescape(target);
    if (decoded) target = decoded;
  }

  return normalizeMediaUrl(target, baseUrl);
}

function parsePlayerObjectBlock(jsonBlock, baseUrl = '') {
  if (!jsonBlock) return null;
  // 1. 標準 JSON.parse
  try {
    const cfg = JSON.parse(jsonBlock);
    const rawUrl = cfg.url || cfg.play_url || cfg.src || '';
    const enc = cfg.encrypt ?? 0;
    const playUrl = decodePlayerConfigUrl(rawUrl, enc, baseUrl);
    if (playUrl && playUrl.startsWith('http')) {
      return {
        url: playUrl,
        vodName: cfg?.vod_data?.vod_name || '',
        vodPic: cfg?.vod_data?.vod_pic ? absUrl(cfg.vod_data.vod_pic, baseUrl) : '',
      };
    }
  } catch {}

  // 2. 容錯正則提取（應對非標準 JSON 鍵名無引號、單引號或尾隨逗號）
  const rawUrl =
    rx('["\']?url["\']?\\s*:\\s*["\']([^"\']+)["\']', jsonBlock, 'i') ||
    rx('["\']?url_next["\']?\\s*:\\s*["\']([^"\']+)["\']', jsonBlock, 'i');
  const encStr = rx('["\']?encrypt["\']?\\s*:\\s*(\\d+)', jsonBlock, 'i');
  if (rawUrl) {
    const playUrl = decodePlayerConfigUrl(rawUrl, encStr ? parseInt(encStr, 10) : 0, baseUrl);
    if (playUrl && playUrl.startsWith('http')) {
      const vodName = decodeUnicodeEscapes(rx('["\']?vod_name["\']?\\s*:\\s*["\']([^"\']+)["\']', jsonBlock, 'i'));
      const vodPic = decodeUnicodeEscapes(rx('["\']?vod_pic["\']?\\s*:\\s*["\']([^"\']+)["\']', jsonBlock, 'i'));
      return {
        url: playUrl,
        vodName: clean(vodName),
        vodPic: vodPic ? absUrl(vodPic.replaceAll('\\/', '/'), baseUrl) : '',
      };
    }
  }
  return null;
}

function extractDirectStreamFromText(text, baseUrl = '') {
  if (!text) return '';
  const s = decodeUnicodeEscapes(htmlUnescape(text))
    .replaceAll('\\/', '/')
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");

  // 1. 優先匹配引號或屬性中的 .m3u8
  let m = s.match(/["']((?:https?:|\/\/)[^"'\s<>]+\.m3u8[^"'\s<>]*)["']/i);
  if (m && m[1]) return normalizeMediaUrl(m[1], baseUrl);

  // 2. 匹配裸露的 https://...m3u8
  m = s.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/i);
  if (m && m[0]) return normalizeMediaUrl(m[0], baseUrl);

  // 3. 匹配引號或屬性中的 .mp4
  m = s.match(/["']((?:https?:|\/\/)[^"'\s<>]+\.mp4[^"'\s<>]*)["']/i);
  if (m && m[1]) return normalizeMediaUrl(m[1], baseUrl);

  // 4. 匹配相對路徑的 .m3u8 / .mp4 或帶 url= 參數的播放器路徑
  m = s.match(/(?:url|src|source|file|video)\s*[:=]\s*["'](\/[^"'\s<>]+(?:\.m3u8|\.mp4)[^"'\s<>]*)["']/i);
  if (m && m[1]) return normalizeMediaUrl(m[1], baseUrl);

  return '';
}

function parsePlayInfoFromHtml(htmlText, baseUrl = '') {
  if (!htmlText) return { url: '', vodName: '', vodPic: '' };

  // 1. 平衡大括號提取 player_aaaa / player_data 等配置塊
  const blocks = extractBalancedObject(htmlText);
  for (const blk of blocks) {
    const parsed = parsePlayerObjectBlock(blk, baseUrl);
    if (parsed && parsed.url) return parsed;
  }

  // 2. 解包 Dean Edwards Packer 混淆腳本並提取
  const unpackedList = unpackAll(htmlText);
  for (const unpacked of unpackedList) {
    const innerBlocks = extractBalancedObject(unpacked);
    for (const blk of innerBlocks) {
      const parsed = parsePlayerObjectBlock(blk, baseUrl);
      if (parsed && parsed.url) return parsed;
    }
    const stream = extractDirectStreamFromText(unpacked, baseUrl);
    if (stream) return { url: stream, vodName: '', vodPic: '' };
  }

  // 3. 在完整頁面（已反轉義 \/）中直接匹配 .m3u8 / .mp4
  const direct = extractDirectStreamFromText(htmlText, baseUrl);
  if (direct) return { url: direct, vodName: '', vodPic: '' };

  return { url: '', vodName: '', vodPic: '' };
}

function buildPlayPageUrl(idOrUrl) {
  const s = toStr(idOrUrl).trim();
  const domain = activeDomain || DOMAINS[0];
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/')) return `https://${domain}${s}`;
  return `https://${domain}/index.php/vod/play/id/${s}/sid/1/nid/1.html`;
}

async function resolvePlayUrl(idOrUrl) {
  const raw = toStr(idOrUrl).trim();
  const cached = getPlayCache(raw);
  if (cached && cached.url) return cached;

  const playPageUrl = buildPlayPageUrl(raw);
  const { text: html, finalUrl } = await fetchWithFallback(playPageUrl);

  // 步驟 1：從播放頁提取
  const info = parsePlayInfoFromHtml(html, finalUrl);
  if (info.url) {
    const res = { url: info.url, referer: finalUrl };
    setPlayCache(raw, res);
    return res;
  }

  // 步驟 2：若播放頁內嵌了第三方/本地播放器 iframe，追蹤進入 iframe 提取
  const iframeSrc = rx('<iframe[^>]+src=["\']([^"\']+)["\']', html, 'i');
  if (iframeSrc && !/^javascript:/i.test(iframeSrc) && !iframeSrc.includes('about:blank')) {
    const iframeUrl = absUrl(htmlUnescape(iframeSrc), finalUrl);
    const directFromQuery = normalizeMediaUrl(iframeUrl, finalUrl);
    if (/\.(?:m3u8|mp4)(?:$|\?)/i.test(directFromQuery)) {
      const res = { url: directFromQuery, referer: finalUrl };
      setPlayCache(raw, res);
      return res;
    }
    try {
      const { text: iframeHtml, finalUrl: iframeFinal } = await fetchWithFallback(iframeUrl, { referer: finalUrl });
      const iframeInfo = parsePlayInfoFromHtml(iframeHtml, iframeFinal);
      if (iframeInfo.url) {
        const res = { url: iframeInfo.url, referer: iframeFinal || finalUrl };
        setPlayCache(raw, res);
        return res;
      }
    } catch {}
  }

  // 步驟 3：若 sid/1/nid/1 並非該影片的有效線路，回退查詢詳情頁中的真實播放鏈接
  const vid = extractVidFromHref(raw) || (/^\d+$/.test(raw) ? raw : '');
  if (vid) {
    try {
      const detailUrl = `/index.php/vod/detail/id/${vid}.html`;
      const { text: detailHtml, finalUrl: detailFinal } = await fetchWithFallback(detailUrl, { referer: finalUrl });
      const altPlayHref = rx('href=["\']([^"\']*\\/vod\\/play\\/id\\/' + vid + '[^"\']*)["\']', detailHtml, 'i');
      if (altPlayHref) {
        const altUrl = absUrl(altPlayHref, detailFinal);
        if (altUrl !== finalUrl) {
          const { text: altHtml, finalUrl: altFinal } = await fetchWithFallback(altUrl, { referer: detailFinal });
          const altInfo = parsePlayInfoFromHtml(altHtml, altFinal);
          if (altInfo.url) {
            const res = { url: altInfo.url, referer: altFinal };
            setPlayCache(raw, res);
            setPlayCache(vid, res);
            return res;
          }
        }
      }
    } catch {}
  }

  throw new Error('未能在播放页解析出有效的视频流地址');
}

// ===================== 參數歸一化與本地代理 =====================

function parseQuery(q) {
  const out = {};
  for (const [k, v] of new URLSearchParams(q)) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function extractQuery(s) {
  const i = s.indexOf('?');
  return i >= 0 ? s.slice(i + 1) : s;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v);
}

function unwrap(param) {
  let p = param;
  if (Buffer.isBuffer(p)) {
    p = p.toString('utf8');
  }
  if (typeof p === 'string') {
    const s = p.trim();
    if (s.startsWith('{')) {
      try {
        p = JSON.parse(s);
      } catch {
        p = { url: s };
      }
    } else if (s.startsWith('http') && !s.includes('url=') && !s.includes('u=')) {
      p = { url: s };
    } else if (s.includes('=')) {
      try {
        p = parseQuery(/^[a-zA-Z0-9_]+=/.test(s) ? s : extractQuery(s));
      } catch {
        p = { url: s };
      }
    } else {
      p = { url: s };
    }
  }
  if (!isPlainObject(p)) {
    p = { url: '' };
  }
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    let val = v;
    if (Array.isArray(val)) val = val.length ? val[0] : '';
    out[k] = typeof val === 'string' ? val : (val == null ? '' : String(val));
  }
  return out;
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(toStr(data), 'utf8');
}

async function xxsPic(param) {
  try {
    const p = unwrap(param);
    let url = p.url || p.u || p.img || p.pic || p.cover || '';
    if (!url) return { mime: 'image/png', data: blank() };
    url = absUrl(url);
    if (!url.startsWith('http')) return { mime: 'image/png', data: blank() };

    const headers = {
      'User-Agent': UA,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: `https://${activeDomain || DOMAINS[0]}/`,
    };
    const resp = await req.get(url, { headers, timeout: 10000, validateStatus: () => true, responseType: 'arraybuffer' });
    if (isOkStatus(resp) && resp.data) {
      const data = decryptCover(gunzipMaybe(toBuffer(resp.data)));
      const mime = imgMime(data);
      if (mime) return { mime, data };
    }
    return { mime: 'image/png', data: blank() };
  } catch (e) {
    console.error('[小穴生] xxsPic err:', e.message);
    return { mime: 'image/png', data: blank() };
  }
}

// ===================== 六大介面 =====================

async function home() {
  const classes = CLASSES.map(([cid, cname]) => ({
    type_id: cid,
    type_name: cname,
    style: RECT_178_STYLE,
  }));
  const filters = {};
  let list = [];
  try {
    const html = await getText('/index.php/vod/type/id/6.html');
    list = parseCardsFromHtml(html);
  } catch (e) {
    console.error('[小穴生] home error:', e.message);
  }
  return {
    class: classes,
    filters,
    list,
    style: RECT_178_STYLE,
  };
}

async function category(inReq) {
  const body = typeof inReq?.body === 'string' ? unwrap(inReq.body) : (inReq?.body || {});
  const query = inReq?.query || {};
  const tid = toStr(body.id || query.id || '6') || '6';
  const rawPg = body.page || query.page;
  const pg = /^\d+$/.test(String(rawPg ?? '')) ? parseInt(String(rawPg), 10) : 1;

  try {
    const path =
      pg <= 1
        ? `/index.php/vod/type/id/${tid}.html`
        : `/index.php/vod/type/id/${tid}/page/${pg}.html`;
    const html = await getText(path);
    const cards = parseCardsFromHtml(html);
    const hasNext = cards.length >= 20 || html.includes(`/page/${pg + 1}.html`) || html.includes(`/page/${pg + 1}/`);
    const totalPages = hasNext ? pg + 1 : pg;

    return {
      page: pg,
      pagecount: totalPages,
      limit: cards.length ? cards.length : 20,
      total: hasNext ? 9999 : pg * 20,
      list: cards,
      style: RECT_178_STYLE,
    };
  } catch (e) {
    console.error('[小穴生] category error:', e.message);
    return {
      page: pg,
      pagecount: pg,
      limit: 20,
      total: 0,
      list: [],
      style: RECT_178_STYLE,
    };
  }
}

async function detail(inReq) {
  let rawId = '';
  if (typeof inReq === 'string') {
    rawId = inReq;
  } else if (inReq) {
    const body = typeof inReq.body === 'string' ? unwrap(inReq.body) : (inReq.body || {});
    const query = inReq.query || {};
    rawId = body.id || body.ids || body.url || query.id || query.ids || query.url || '';
  }
  const idStr = Array.isArray(rawId) ? toStr(rawId[0]) : toStr(rawId);
  const vid = extractVidFromHref(idStr) || idStr.trim();
  if (!vid) return { list: [] };

  const vodDetail = {
    vod_id: vid,
    vod_name: '蝴蝶影视精选',
    vod_pic: '',
    vod_actor: '🦋 TG群: @tvshare23',
    vod_director: '🦋 蝴蝶影视',
    vod_content: '🦋 官方交流群: @tvshare23 | 严禁传播违规违法内容',
    vod_play_from: '蝴蝶专线',
    vod_play_url: `正片$${vid}`,
    style: RECT_178_STYLE,
  };

  try {
    const detailUrl = buildPlayPageUrl(vid);
    const { text: html, finalUrl } = await fetchWithFallback(detailUrl);
    if (html) {
      // 1. 提取標題
      const titleRaw = rx('<title>([\\s\\S]*?)</title>', html, 'i');
      if (titleRaw) {
        const t = clean(titleRaw).split(/\s*[-_|｜]\s*/)[0].trim();
        if (t) vodDetail.vod_name = t;
      }

      // 2. 預解析播放頁中的 player_aaaa，既可補全標題/封面，又能預熱 PLAY_CACHE 讓緊隨其後的 /play 瞬時響應
      const playInfo = parsePlayInfoFromHtml(html, finalUrl);
      if (playInfo.vodName && vodDetail.vod_name === '蝴蝶影视精选') {
        vodDetail.vod_name = clean(playInfo.vodName);
      }
      if (playInfo.vodPic) {
        vodDetail.vod_pic = playInfo.vodPic;
      }
      if (playInfo.url) {
        setPlayCache(vid, { url: playInfo.url, referer: finalUrl });
      }

      if (!vodDetail.vod_pic) {
        const ogPic =
          rx('<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']', html, 'i') ||
          rx('(?:data-original|data-src)=["\']([^"\']+\\.(?:jpg|jpeg|png|webp|gif|avif)[^"\']*)["\']', html, 'i');
        if (ogPic) vodDetail.vod_pic = absUrl(htmlUnescape(ogPic), finalUrl);
      }
    }
  } catch (e) {
    console.error('[小穴生] detail error:', e.message);
  }

  return { list: [vodDetail] };
}

async function play(inReq, maybeId) {
  let pid = '';
  if (typeof inReq === 'string') {
    pid = maybeId ? String(maybeId) : inReq;
  } else if (inReq) {
    const body = typeof inReq.body === 'string' ? unwrap(inReq.body) : (inReq.body || {});
    const query = inReq.query || {};
    pid = toStr(body.id || body.url || query.id || query.url || '');
  }
  pid = pid.trim();
  if (pid.includes('$')) {
    pid = pid.split('$').pop().trim();
  }
  if (!pid) return { parse: 0, jx: 0, playUrl: '', url: '' };

  // 情況 1：傳入的已經是直鏈 (.m3u8 / .mp4)
  if (/^https?:\/\/[^"'\s]+(?:\.m3u8|\.mp4)/i.test(pid)) {
    const headers = getDefaultHeaders();
    return {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: pid,
      header: headers,
      headers,
    };
  }

  // 情況 2：通過播放頁解析 player_aaaa / player_data / 媒體直鏈
  try {
    const { url, referer } = await resolvePlayUrl(pid);
    if (url) {
      const headers = getDefaultHeaders(referer);
      return {
        parse: 0,
        jx: 0,
        playUrl: '',
        url,
        header: headers,
        headers,
      };
    }
  } catch (e) {
    console.error('[小穴生] resolvePlayUrl 失败:', e.message);
  }

  // 情況 3：兜底回退至客戶端嗅探 (parse: 1)
  const fallbackUrl = buildPlayPageUrl(pid);
  const headers = getDefaultHeaders(fallbackUrl);
  return {
    parse: 1,
    jx: 0,
    playUrl: '',
    url: fallbackUrl,
    header: headers,
    headers,
  };
}

async function search(inReq) {
  const body = typeof inReq?.body === 'string' ? unwrap(inReq.body) : (inReq?.body || {});
  const query = inReq?.query || {};
  const rawPg = body.page || query.page;
  const pg = /^\d+$/.test(String(rawPg ?? '')) ? parseInt(String(rawPg), 10) : 1;
  const key = toStr(body.wd || body.key || query.wd || query.key || '').trim();
  if (!key) {
    return { page: 1, pagecount: 1, limit: 0, total: 0, list: [], style: RECT_178_STYLE };
  }

  try {
    const enc = quoteSafe(key);
    const path =
      pg <= 1
        ? `/index.php/vod/search.html?wd=${enc}`
        : `/index.php/vod/search/page/${pg}/wd/${enc}.html`;
    const html = await getText(path);
    const cards = parseCardsFromHtml(html);
    const hasNext = cards.length >= 20 || html.includes(`/page/${pg + 1}/`);
    return {
      page: pg,
      pagecount: hasNext ? pg + 1 : pg,
      limit: cards.length,
      total: hasNext ? 9999 : cards.length,
      list: cards,
      style: RECT_178_STYLE,
    };
  } catch (e) {
    console.error('[小穴生] search error:', e.message);
    return {
      page: pg,
      pagecount: 1,
      limit: 0,
      total: 0,
      list: [],
      style: RECT_178_STYLE,
    };
  }
}

export default {
  meta: { key: 'xxs', name: '小穴生', type: 3 },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/xxs_pic', async (request, reply) => {
      try {
        const res = await xxsPic(request.query || {});
        return reply.type(res.mime).send(res.data);
      } catch (e) {
        console.error('[小穴生] /xxs_pic error:', e.message);
        return reply.type('image/png').send(blank());
      }
    });
  },
};