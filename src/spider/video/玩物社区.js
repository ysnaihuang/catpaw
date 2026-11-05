// 玩物社区 —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 _____T3v1.5_1_fh80.py（webhtv 系殼子 T3v1.5）移植，修復播放解析與域名容錯。
import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// 域名池：將最穩定的官方主站與最新入口置首，避免失效域名導致超時掛起
const DOMAINS = ['wanwuu.com', 'c3ca18.vc40p53k.cc', 'wanwuu.pages.dev', 'pku.daqbqrri.cc', 'c5ad.oqgciumz.cc'];
let activeDomain = DOMAINS[0];

const CLASSES = [
  ['popular', '当前最热'],
  ['new', '最近更新'],
  ['zhibo-huifang', '直播回放'],
  ['guochan-sm', '国产SM'],
  ['rihan-sm', '日韩SM'],
  ['oumei-sm', '欧美SM'],
  ['dongman-sm', '动漫SM'],
  ['tiaojiao-av', '调教AV'],
  ['ai-duanju', 'AI成人短剧'],
  ['moviesets', '精选合集'],
];

// 封面 AES-128-CBC/NoPadding 密鑰（寫死在 /static/web/js/plugins/lazyload.js）
const AES_KEY = Buffer.from('f5d965df75336270', 'utf8');
const AES_IV = Buffer.from('97b60394abc2fbe1', 'utf8');

const toStr = (v) => (v == null ? '' : String(v));

// ===================== 通用工具 =====================

function quoteSafe(s) {
  return encodeURIComponent(toStr(s)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  sbquo: '‚', bdquo: '„', dagger: '†', Dagger: '‡', bull: '•', prime: '′',
  Prime: '″', euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤',
  brvbar: '¦', sect: '§', uml: '¨', ordf: 'ª', ordm: 'º', para: '¶',
  iexcl: '¡', iquest: '¿', times: '×', divide: '÷', plusmn: '±', deg: '°',
  micro: 'µ', middot: '·', sup1: '¹', sup2: '²', sup3: '³', frac12: '½',
  frac14: '¼', frac34: '¾', agrave: 'à', aacute: 'á', acirc: 'â',
  atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì',
  iacute: 'í', icirc: 'î', iuml: 'ï', ograve: 'ò', oacute: 'ó',
  ocirc: 'ô', otilde: 'õ', ouml: 'ö', ugrave: 'ù', uacute: 'ú',
  ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', szlig: 'ß',
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
  return htmlUnescape(s.replace(/<[^>]+>/g, '')).trim();
}

function rx(pattern, text, flags = '') {
  const m = toStr(text).match(new RegExp(pattern, flags));
  return m ? m[1].trim() : '';
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function urlJoin(base, rel) {
  try {
    return new URL(rel, base).toString();
  } catch {
    return toStr(rel);
  }
}

// ===================== Dean Edwards packer 解包（單趟字典替換） =====================

const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
// 增強型 Packer 正則：支持形參 d/r、空格、轉義引號以及結尾可選的 ,0,{} 或 ,0,[]
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

// 關鍵修復：使用單趟正則查表替換，避免高位替換出的 URL/Token 內部字符被低位詞元（如 0, 1, u, t, id）二次覆蓋篡改
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

function doUnpack(js) {
  const all = unpackAll(js);
  return all.length ? all.join('\n') : null;
}

// ===================== 圖片工具 =====================

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
    const compat = buf.subarray(8, 64);
    if (compat.indexOf(Buffer.from('avif')) !== -1 || compat.indexOf(Buffer.from('avis')) !== -1) return 'image/avif';
    if (compat.indexOf(Buffer.from('heic')) !== -1 || compat.indexOf(Buffer.from('heif')) !== -1) return 'image/heif';
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

const DEC_CACHE = new Map();
const DEC_CACHE_MAX = 256;

function decryptCached(url, data) {
  if (url) {
    const hit = DEC_CACHE.get(url);
    if (hit && hit.length) return hit;
  }
  const out = decryptCover(data);
  if (!url || !imgMime(out)) return out;
  if (DEC_CACHE.size >= DEC_CACHE_MAX) {
    const oldest = DEC_CACHE.keys().next().value;
    DEC_CACHE.delete(oldest);
  }
  DEC_CACHE.set(url, out);
  return out;
}

// ===================== 占位 PNG =====================

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

function blankPng(w = 300, h = 450, rgb = [0x1c, 0x1c, 0x22]) {
  const [br, bg, bb] = rgb;
  const rowLen = 1 + w * 3;
  const raw = Buffer.alloc(h * rowLen);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const triH = 70;
  const triW = 56;
  const halfH = Math.floor(triH / 2);
  const thirdW = Math.floor(triW / 3);
  for (let y = 0; y < h; y++) {
    const rowOff = y * rowLen;
    raw[rowOff] = 0;
    for (let x = 0; x < w; x++) {
      let r = br;
      let g = bg;
      let b = bb;
      const on = (((x >> 3) + (y >> 3)) & 1) !== 0;
      if (on) {
        r = Math.min(255, r + 16);
        g = Math.min(255, g + 16);
        b = Math.min(255, b + 18);
      }
      const dy = Math.abs(y - cy);
      if (dy <= halfH) {
        const half = Math.floor((1 - dy / halfH) * triW);
        if (x >= cx - thirdW && x <= cx - thirdW + half) {
          r = 200;
          g = 200;
          b = 210;
        }
      }
      const off = rowOff + 1 + x * 3;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
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

function weservUrl(url) {
  const u = url.replace(/^https?:\/\//, '');
  return `https://images.weserv.nl/?url=${quoteSafe(u)}`;
}

// ===================== 網絡（域名池 + 內容指紋） =====================

function looksLikeSite(html) {
  return html.includes('玩物社区') || html.includes('video-item') || html.includes('detail_play') || html.includes('data-url');
}

function looksLikePlayerJs(js) {
  if (!js) return false;
  return (
    js.includes('data-url') ||
    js.includes('.m3u8') ||
    js.includes('.mp4') ||
    js.includes('eval(') ||
    js.includes('mse') ||
    js.includes('player') ||
    js.includes('video')
  );
}

function getSortedDomains() {
  const set = new Set([activeDomain, ...DOMAINS]);
  return Array.from(set);
}

function expandUrls(urlOrPath) {
  const urls = [];
  const sorted = getSortedDomains();
  if (urlOrPath.startsWith('http')) {
    try {
      const u = new URL(urlOrPath);
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

async function fetchWithFallback(urlOrPath, { referer = '', expect = 'site', timeout = 8000 } = {}) {
  let lastErr = null;
  for (const url of expandUrls(urlOrPath)) {
    try {
      const headers = { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' };
      if (referer) {
        try {
          const refUrl = new URL(referer);
          const curUrl = new URL(url);
          refUrl.host = curUrl.host;
          headers.Referer = refUrl.toString();
        } catch {
          headers.Referer = referer;
        }
      }
      const resp = await req.get(url, { headers, timeout, validateStatus: () => true });
      const text = typeof resp.data === 'string' ? resp.data : toStr(resp.data);
      const minLen = expect === 'site' ? 200 : 10;
      if (isOkStatus(resp) && Buffer.byteLength(text, 'utf8') >= minLen) {
        if (expect === 'site' && !looksLikeSite(text)) {
          lastErr = new Error(`内容指纹不符(疑似劫持页) @ ${url}`);
          continue;
        }
        if (expect === 'js' && !looksLikePlayerJs(text)) {
          lastErr = new Error(`播放接口返回异常 @ ${url}`);
          continue;
        }
        try {
          activeDomain = new URL(url).host;
        } catch {}
        return { text, finalUrl: url };
      }
      lastErr = new Error(`HTTP ${resp.status ?? 0} @ ${url}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`全部域名均请求失败: ${lastErr ? lastErr.message : ''}`);
}

async function getText(urlOrPath, timeout = 8000) {
  try {
    const { text } = await fetchWithFallback(urlOrPath, { expect: 'site', timeout });
    return text;
  } catch (e) {
    console.error('[玩物社区] GET err', urlOrPath, e.message);
    return '';
  }
}

function absUrl(url) {
  if (!url) return '';
  const u = String(url).trim();
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('http')) return u;
  const domain = activeDomain || DOMAINS[0];
  if (u.startsWith('/')) return `https://${domain}${u}`;
  return `https://${domain}/${u}`;
}

function proxyPic(pic) {
  const abs = absUrl(pic);
  if (!abs) return '';
  return `/wanwu_pic?type=pic&url=${encodeURIComponent(abs)}`;
}

// ===================== 列表解析 =====================

function parseVideoList(html) {
  const vods = [];
  const seen = new Set();
  if (!html) return vods;
  const re = /href="(\/videos\/(?!cate\/)[^"]*?\/vd-[A-Za-z0-9-]+\/?)"/g;
  let m;
  const domain = activeDomain || DOMAINS[0];
  while ((m = re.exec(html)) !== null) {
    try {
      const href = m[1];
      if (seen.has(href)) continue;
      seen.add(href);
      const seg = html.slice(m.index, m.index + 8000);
      const pic = rx('data-src="(https?://[^"]+)"', seg)
        || rx('data-original="(https?://[^"]+)"', seg)
        || rx('data-lazy-src="(https?://[^"]+)"', seg)
        || rx('data-url="(https?://[^"]+)"', seg)
        || rx('src="((?:https?://|/)[^"]+\\.(?:jpg|jpeg|png|webp|avif|gif))"', seg);
      let name = clean(rx('<h[23][^>]*>(.*?)</h[23]>', seg, 's'));
      if (!name) name = clean(rx('<a[^>]*class="[^"]*line-clamp[^"]*"[^>]*>([^<]{1,200})</a>', seg));
      if (!name) name = clean(rx('<img[^>]*alt="([^"]{1,200})"', seg));
      const remark = rx('>(\\d{1,3}:\\d{2}(?::\\d{2})?)<', seg);
      if (!name) continue;
      vods.push({
        vod_id: urlJoin(`https://${domain}`, href),
        vod_name: name,
        vod_pic: proxyPic(pic),
        vod_remarks: remark,
      });
    } catch {
      continue;
    }
  }
  return vods;
}

function parseMoviesetList(html) {
  const vods = [];
  const seen = new Set();
  if (!html) return vods;
  const re = /href="(\/moviesets\/[A-Za-z0-9-]+\/?)"/g;
  let m;
  const domain = activeDomain || DOMAINS[0];
  while ((m = re.exec(html)) !== null) {
    try {
      const href = m[1];
      if (seen.has(href)) continue;
      seen.add(href);
      const seg = html.slice(m.index, m.index + 6000);
      if (!seg.includes('<h2') && !seg.includes('<h3')) continue;
      if (!seg.includes('data-src') && !seg.includes('data-original')) continue;
      const pic = rx('data-src="(https?://[^"]+)"', seg)
        || rx('data-original="(https?://[^"]+)"', seg)
        || rx('src="((?:https?://|/)[^"]+\\.(?:jpg|jpeg|png|webp|avif|gif))"', seg);
      const name = clean(rx('<h[23][^>]*>(.*?)</h[23]>', seg, 's'));
      const remark = clean(rx('>(\\d+部)<', seg));
      if (!name) continue;
      vods.push({
        vod_id: urlJoin(`https://${domain}`, href),
        vod_name: name,
        vod_pic: proxyPic(pic),
        vod_remarks: remark,
      });
    } catch {
      continue;
    }
  }
  return vods;
}

function total(html) {
  const m = toStr(html).match(/"numberOfItems":\s*(\d+)/);
  return m ? m[1] : '0';
}

// ===================== 播放鏈核心修復 =====================

function safeUnquote(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// 解析 id/img/ads/token 並拼裝完整的 detail_play 地址
function buildDetailPlay(text, pageUrl) {
  if (!text) return '';
  const s = text.replaceAll('\\/', '/').replaceAll('\\"', '"');
  const rx1 = (p) => {
    const m = s.match(new RegExp(p));
    return m ? (m[1] ?? m[2] ?? '') : '';
  };

  const vid = rx1('[?&]id=(\\d+)') || rx1('["\']?id["\']?\\s*[:=]\\s*["\']?(\\d+)');
  // 允許 img/ads 為空字符串，避免回退誤抓頁面其他 img 屬性
  let img = '';
  const imgMatch = s.match(/[?&]img=([^"&'\s+]*)/);
  if (imgMatch) {
    img = imgMatch[1] || '';
  } else {
    img = rx1('["\']img["\']\\s*[:=]\\s*["\']([^"\']*)["\']');
  }

  let ads = '0';
  const adsMatch = s.match(/[?&]ads=([^"&'\s+]*)/);
  if (adsMatch && adsMatch[1] !== undefined) {
    ads = adsMatch[1];
  } else {
    ads = rx1('["\']ads["\']\\s*[:=]\\s*["\']([^"\']*)["\']') || '0';
  }

  // 優先匹配 u= 處拼接的 encodeURIComponent(...)，其次匹配所有 encodeURIComponent 最後一個非圖片參數，最後匹配字面量 u=
  let tok = rx1('[?&]u=["\']?\\s*\\+\\s*encodeURIComponent\\(\\s*[\'"]([^\'"]+)[\'"]\\s*\\)');
  if (!tok) {
    const encMatches = [...s.matchAll(/encodeURIComponent\(\s*['"]([^'"]+)['"]\s*\)/g)];
    for (let i = encMatches.length - 1; i >= 0; i--) {
      const candidate = encMatches[i][1];
      if (candidate && candidate !== img && !/\.(?:jpg|jpeg|png|webp|gif|avif)$/i.test(candidate)) {
        tok = candidate;
        break;
      }
    }
  }
  if (!tok) {
    tok = rx1('[?&]u=([^\'"&\\s+]+)') || rx1('["\']u["\']\\s*[:=]\\s*["\']([^\'"]+)["\']');
  }

  if (!(vid && tok)) return '';
  const t = String(Math.floor(Date.now() / 1000 / 1800));
  let origin = 'https://' + (activeDomain || DOMAINS[0]);
  try {
    const u = new URL(pageUrl);
    origin = `${u.protocol}//${u.host}`;
  } catch {}
  // 先 safeUnquote 再 quoteSafe，防止已編碼 token 被二次編碼為 %25
  const cleanTok = safeUnquote(tok);
  return `${origin}/videos/detail_play?id=${vid}&img=${img}&ads=${ads}&u=${quoteSafe(cleanTok)}&t=${t}`;
}

// 判斷直接正則匹配到的 detail_play URL 是否包含完整有效的 u= 參數（未被字符串拼接截斷）
function isCompleteDetailPlayUrl(u) {
  if (!u || !u.includes('detail_play')) return false;
  try {
    const parsed = new URL(u, `https://${activeDomain || DOMAINS[0]}`);
    const id = parsed.searchParams.get('id');
    const tok = parsed.searchParams.get('u');
    if (!id || !tok || tok.includes('encodeURIComponent') || tok.endsWith('+')) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizePlayUrl(raw, baseUrl) {
  if (!raw) return '';
  let u = htmlUnescape(String(raw).trim()).replaceAll('\\/', '/').replaceAll('&amp;', '&');
  // 若是 base64 編碼的 http 鏈接 (aHR0c...)
  if (!u.startsWith('http') && !u.startsWith('/')) {
    const dec = b64d(u);
    if (dec && (dec.startsWith('http') || dec.startsWith('/')) && (dec.includes('.m3u8') || dec.includes('.mp4'))) {
      u = dec.trim();
    }
  }
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return urlJoin(baseUrl || `https://${activeDomain || DOMAINS[0]}`, u);
  return u;
}

// 從文本中提取真實媒體流地址 (.m3u8 / .mp4)
// allowDataUrlFallback 僅在解析 detail_play 播放器腳本時開啟，避免在詳情頁 HTML 中誤抓圖片/按鈕的 data-url
function extractM3u8FromText(text, baseUrl = '', allowDataUrlFallback = false) {
  if (!text) return '';
  const s = text.replaceAll('\\"', '"').replaceAll("\\'", "'").replaceAll('\\/', '/');

  // 1. 優先匹配明確帶有 .m3u8 或 .mp4 的 data-url
  let m = s.match(/data-url\s*=\s*["']([^"'\s<>]+(?:\.m3u8|\.mp4)[^"'\s<>]*)["']/i);
  if (m && m[1]) return normalizePlayUrl(m[1], baseUrl);

  // 2. 匹配 url / source / src 字段中的 .m3u8 或 .mp4（支持絕對路徑與相對路徑）
  m = s.match(/(?:url|source|src|file)\s*[:=]\s*["']((?:https?:|\/\/|\/)[^"'\s<>]+(?:\.m3u8|\.mp4)[^"'\s<>]*)["']/i);
  if (m && m[1]) return normalizePlayUrl(m[1], baseUrl);

  // 3. 匹配引號內的完整 .m3u8 地址
  m = s.match(/["']((?:https?:|\/\/)[^"'\s<>]+\.m3u8[^"'\s<>]*)["']/i);
  if (m && m[1]) return normalizePlayUrl(m[1], baseUrl);

  // 4. 匹配任意裸露的 http(s) m3u8 地址
  m = s.match(/https?:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/i);
  if (m && m[0]) return normalizePlayUrl(m[0], baseUrl);

  // 5. 若是在 detail_play 腳本中（allowDataUrlFallback = true），檢查 #mse 的 data-url（可能為無後綴流或 base64）
  if (allowDataUrlFallback) {
    m = s.match(/data-url\s*=\s*["']([^"']+)["']/i);
    if (m && m[1]) {
      const candidate = normalizePlayUrl(m[1], baseUrl);
      if (
        candidate.includes('.m3u8') ||
        candidate.includes('.mp4') ||
        (candidate.startsWith('http') && !/\.(?:jpg|jpeg|png|webp|gif|avif|html?)(?:$|\?)/i.test(candidate))
      ) {
        return candidate;
      }
    }
  }

  return '';
}

function resolveDetailPlayFromSnippet(snippet, finalUrl) {
  if (!snippet || !snippet.includes('detail_play')) return '';
  const norm = snippet.replaceAll('\\/', '/').replaceAll('\\"', '"');

  // 1. 優先使用 buildDetailPlay 解析拼接參數 (id / img / ads / encodeURIComponent(u) / t)
  const built = buildDetailPlay(norm, finalUrl);
  if (built) return built;

  // 2. 檢查是否有已經拼好的完整 detail_play 字面量 URL
  const m = norm.match(/\/videos\/detail_play\?[^"'\s<>]+/);
  if (m) {
    let candidate = urlJoin(finalUrl, htmlUnescape(m[0]));
    if (!candidate.includes('&t=')) {
      const t = String(Math.floor(Date.now() / 1000 / 1800));
      candidate += `&t=${t}`;
    }
    if (isCompleteDetailPlayUrl(candidate)) {
      return candidate;
    }
  }
  return '';
}

// 詳情頁 -> detail_play -> 解包 -> m3u8
async function getM3u8(detailUrl) {
  const { text: html, finalUrl: final } = await fetchWithFallback(detailUrl, { expect: 'site' });

  // 1. 先行檢測：僅當詳情頁自身已直接包含明確的 .m3u8/.mp4 地址時才返回（絕不將普通元素的 data-url 誤判為視頻流）
  const directM3u8 = extractM3u8FromText(html, final, false);
  if (directM3u8) return { m3u8: directM3u8, referer: final };

  // 2. 從 Packer 打包塊或頁面腳本中解析 detail_play 播放接口地址
  let dpUrl = '';
  const unpackedBlocks = unpackAll(html);
  for (const packed of unpackedBlocks) {
    // 若解包塊裡已經直接含有 .m3u8 地址，直接提取返回
    const packedM3u8 = extractM3u8FromText(packed, final, false);
    if (packedM3u8) return { m3u8: packedM3u8, referer: final };

    if (packed.includes('detail_play')) {
      dpUrl = resolveDetailPlayFromSnippet(packed, final);
      if (dpUrl) break;
    }
  }

  if (!dpUrl) {
    dpUrl = resolveDetailPlayFromSnippet(html, final);
  }

  if (!dpUrl) {
    const iframeSrc = rx('<iframe[^>]+src="([^"]+)"', html);
    if (iframeSrc && iframeSrc.includes('detail_play')) {
      dpUrl = urlJoin(final, htmlUnescape(iframeSrc));
    }
  }

  if (!dpUrl) throw new Error('未找到 detail_play 播放接口');

  // 3. 請求 detail_play 獲取播放器 JS 並解包提取 m3u8
  const { text: jsText, finalUrl: dpFinal } = await fetchWithFallback(dpUrl, { referer: final, expect: 'js' });
  const unpackedJs = doUnpack(jsText);
  const combined = (unpackedJs ? `${unpackedJs}\n${jsText}` : jsText)
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'")
    .replaceAll('\\/', '/');

  const m3 = extractM3u8FromText(combined, dpFinal || final, true);
  if (!m3) throw new Error('detail_play 返回中未找到有效的 m3u8 地址');
  return { m3u8: m3, referer: final };
}

// ===================== localProxy 參數歸一化 =====================

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
        p = parseQuery( /^[a-zA-Z0-9_]+=/.test(s) ? s : extractQuery(s));
      } catch {
        p = { url: s };
      }
    } else {
      p = { url: s };
    }
  }
  if (!isPlainObject(p)) {
    let urlCandidate = '';
    const qbuf = [];
    let found = false;
    for (const x of (p || [])) {
      if (isPlainObject(x)) {
        p = x;
        found = true;
        break;
      }
      const sx = String(x).trim();
      if (!sx) continue;
      if (sx.startsWith('{')) {
        try {
          p = JSON.parse(sx);
          found = true;
          break;
        } catch {
          continue;
        }
      }
      if (sx.startsWith('http')) {
        if (!urlCandidate) urlCandidate = sx;
        continue;
      }
      qbuf.push(sx);
    }
    if (!found) {
      const q = qbuf.join('&');
      const mm = q.match(/(?:^|[&?])(url|u|img|pic|cover)=(.+)$/);
      if (mm) {
        p = { [mm[1]]: safeUnquote(mm[2]) };
      } else if (urlCandidate) {
        p = { url: urlCandidate };
      } else if (q) {
        try {
          const d = parseQuery(q);
          p = Object.keys(d).length ? d : { url: '' };
        } catch {
          p = { url: '' };
        }
      } else {
        p = { url: '' };
      }
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(p)) {
    let val = v;
    if (Array.isArray(val)) val = val.length ? val[0] : '';
    out[k] = typeof val === 'string' ? val : (val == null ? '' : String(val));
  }
  return out;
}

function b64d(s) {
  try {
    const cleanStr = String(s).trim();
    if (!/^[A-Za-z0-9+/=_-]+$/.test(cleanStr)) return '';
    const pad = '='.repeat((4 - (cleanStr.length % 4)) % 4);
    return Buffer.from(cleanStr + pad, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(toStr(data), 'utf8');
}

async function fetchImgBytes(url, referer = '', timeout = 10000) {
  if (!referer) referer = `https://${activeDomain || DOMAINS[0]}/`;
  const headers = {
    'User-Agent': UA,
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: referer,
  };
  try {
    const resp = await req.get(url, { headers, timeout, validateStatus: () => true, responseType: 'arraybuffer' });
    if (isOkStatus(resp) && resp.data) {
      const buf = toBuffer(resp.data);
      if (buf.length) return gunzipMaybe(buf);
    }
  } catch {}
  return Buffer.alloc(0);
}

async function wanwuPic(param) {
  try {
    const p = unwrap(param);
    let url = p.url || p.u || p.img || p.pic || p.cover || '';
    if (!url) return { mime: 'image/png', data: blank() };
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      const q2 = parseQuery(extractQuery(url));
      url = q2.url || q2.u || '';
      if (!url) return { mime: 'image/png', data: blank() };
    }
    if (!url.startsWith('http')) {
      const dec = b64d(url);
      if (dec.startsWith('http')) url = dec;
    }
    if (url.startsWith('//')) {
      url = `https:${url}`;
    } else if (url.startsWith('/')) {
      url = absUrl(url);
    }
    if (!url.startsWith('http')) return { mime: 'image/png', data: blank() };

    const cached = DEC_CACHE.get(url);
    if (cached && cached.length && imgMime(cached)) {
      return { mime: imgMime(cached), data: cached };
    }
    let data = decryptCached(url, await fetchImgBytes(url));
    if (!imgMime(data)) {
      data = decryptCached(url, await fetchImgBytes(weservUrl(url), '', 8000));
    }
    const mime = imgMime(data);
    if (!mime) {
      return { mime: 'image/png', data: blank() };
    }
    return { mime, data };
  } catch (e) {
    console.error('[玩物社区] localProxy err:', e.message);
    return { mime: 'image/png', data: blank() };
  }
}

// ===================== 六大介面 =====================

async function home() {
  const classes = CLASSES.map(([tid, name]) => ({ type_id: tid, type_name: name }));
  const filters = {};
  let list = [];
  try {
    const domain = activeDomain || DOMAINS[0];
    const html = await getText(`https://${domain}/videos/new/`);
    list = parseVideoList(html);
  } catch (e) {
    console.error('[玩物社区] home error:', e.message);
  }
  return { class: classes, filters, list };
}

function catPath(tid) {
  if (tid === 'moviesets') return '/moviesets/';
  if (tid.startsWith('ai-')) return `/ai/${tid}/`;
  return `/videos/${tid}/`;
}

async function category(inReq) {
  const body = typeof inReq?.body === 'string' ? unwrap(inReq.body) : (inReq?.body || {});
  const query = inReq?.query || {};
  const tid = toStr(body.id || query.id || '');
  const rawPg = body.page || query.page;
  const pg = /^\d+$/.test(String(rawPg ?? '')) ? parseInt(String(rawPg), 10) : 1;
  try {
    let path = catPath(tid);
    if (pg > 1) path = `${path}page/${pg}/`;
    const html = await getText(path);
    const vods = tid === 'moviesets' ? parseMoviesetList(html) : parseVideoList(html);
    const hasNext = html.includes(`/page/${pg + 1}/`);
    return {
      list: vods,
      page: pg,
      pagecount: hasNext ? '9999' : String(pg),
      limit: vods.length,
      total: total(html),
    };
  } catch (e) {
    console.error('[玩物社区] category error:', e.message);
    return { list: [], page: pg, pagecount: '1', limit: 0, total: '0' };
  }
}

async function moviesetDetail(url) {
  const html = await getText(url);
  if (!html) return { list: [] };
  let name = rx('<title>(.*?)</title>', html, 's') || rx('<h1[^>]*>(.*?)</h1>', html, 's');
  name = clean(name);
  name = name.replace(/\s*[|｜\-–—]\s*玩物社区\s*$/, '');
  name = name.replace(/\s*高清在线观看\s*$/, '');
  const pic = rx('<meta property="og:image" content="([^"]+)"', html)
    || rx('data-src="(https?://[^"]+\\.(?:jpg|jpeg|png|webp|avif|gif))"', html)
    || rx('data-original="(https?://[^"]+\\.(?:jpg|jpeg|png|webp|avif|gif))"', html);
  const vids = parseVideoList(html);
  const eps = vids.map((v) => `${v.vod_name}$${v.vod_id}`).join('#');
  return {
    list: [{
      vod_id: url,
      vod_name: name,
      vod_pic: proxyPic(pic),
      vod_play_from: '合集选集',
      vod_play_url: eps,
    }],
  };
}

async function detail(inReq) {
  let rawId = '';
  if (typeof inReq === 'string') {
    rawId = inReq;
  } else if (inReq) {
    const body = typeof inReq.body === 'string' ? unwrap(inReq.body) : (inReq.body || {});
    const query = inReq.query || {};
    rawId = body.id || body.url || query.id || query.url || '';
  }
  const url = Array.isArray(rawId) ? toStr(rawId[0]) : toStr(rawId);
  if (!url) return { list: [] };
  try {
    if (url.includes('/moviesets/') && !url.includes('/vd-')) {
      return await moviesetDetail(url);
    }
    const html = await getText(url);
    if (!html) return { list: [] };
    const name = rx('<title>(.*?)视频在线观看', html)
      || rx('<h1[^>]*>(.*?)</h1>', html, 's');
    const pic = rx('<meta property="og:image" content="([^"]+)"', html)
      || rx('data-src="(https?://[^"]+\\.(?:jpg|jpeg|png|webp|avif|gif))"', html)
      || rx('data-original="(https?://[^"]+\\.(?:jpg|jpeg|png|webp|avif|gif))"', html);
    const desc = rx('<meta name="description" content="([^"]+)"', html);
    return {
      list: [{
        vod_id: url,
        vod_name: clean(name),
        vod_pic: proxyPic(pic),
        vod_remarks: '',
        vod_year: '',
        vod_area: '',
        vod_actor: '',
        vod_content: clean(desc),
        vod_play_from: '玩物社区',
        vod_play_url: `立即播放$${url}`,
      }],
    };
  } catch (e) {
    console.error('[玩物社区] detail error:', e.message);
    return { list: [] };
  }
}

// /play：解析 m3u8 直鏈；解析失敗時自動回退至嗅探模式 (parse: 1)
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
  if (!pid) return { parse: 0, jx: 0, url: '' };

  if (!pid.startsWith('http')) {
    const domain = activeDomain || DOMAINS[0];
    pid = urlJoin(`https://${domain}`, pid);
  }

  // 情況 1：傳入的已經是 m3u8 或 mp4 直鏈
  if (pid.includes('.m3u8') || pid.includes('.mp4')) {
    return {
      parse: 0,
      jx: 0,
      url: pid,
      header: { 'User-Agent': UA, Referer: pid },
      headers: { 'User-Agent': UA, Referer: pid },
    };
  }

  // 情況 2：請求詳情頁解析 detail_play -> m3u8
  try {
    const { m3u8, referer } = await getM3u8(pid);
    if (m3u8) {
      const refHeader = referer || pid;
      return {
        parse: 0,
        jx: 0,
        url: m3u8,
        header: { 'User-Agent': UA, Referer: refHeader },
        headers: { 'User-Agent': UA, Referer: refHeader },
      };
    }
  } catch (e) {
    console.error('[玩物社区] getM3u8 解析失败:', e.message);
  }

  // 情況 3：兜底回退至客戶端嗅探解析 (parse: 1)
  console.log('[玩物社区] 启用客户端嗅探回退:', pid);
  return {
    parse: 1,
    jx: 0,
    url: pid,
    header: { 'User-Agent': UA, Referer: pid },
    headers: { 'User-Agent': UA, Referer: pid },
  };
}

async function search(inReq) {
  const body = typeof inReq?.body === 'string' ? unwrap(inReq.body) : (inReq?.body || {});
  const query = inReq?.query || {};
  const rawPg = body.page || query.page;
  const pg = /^\d+$/.test(String(rawPg ?? '')) ? parseInt(String(rawPg), 10) : 1;
  const key = toStr(body.wd || body.key || query.wd || query.key || '');
  try {
    const enc = encodeURIComponent(key);
    let path = `/videos/search/${enc}/`;
    if (pg > 1) path = `/videos/search/${enc}/page/${pg}/`;
    const html = await getText(path);
    const vods = parseVideoList(html);
    const hasNext = html.includes(`/page/${pg + 1}/`);
    return {
      list: vods,
      page: pg,
      pagecount: hasNext ? '9999' : String(pg),
      limit: vods.length,
      total: total(html),
    };
  } catch (e) {
    console.error('[玩物社区] search error:', e.message);
    return { list: [], page: pg, pagecount: '1', limit: 0, total: '0' };
  }
}

export default {
  meta: { key: 'wanwu', name: '玩物社区', type: 3 },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/wanwu_pic', async (request, reply) => {
      try {
        const res = await wanwuPic(request.query || {});
        return reply.type(res.mime).send(res.data);
      } catch (e) {
        console.error('[玩物社区] /wanwu_pic error:', e.message);
        return reply.type('image/png').send(blank());
      }
    });
  },
};