import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

// ================= 常量与配置 =================
const KEY_STR = '22946bc50fd63164b79df55070a85a92';
const IV_STR = 'kaixin1234567890';
const KEY_BUF = Buffer.from(KEY_STR, 'utf8');
const IV_BUF = Buffer.from(IV_STR, 'utf8');

const SITE_DOMAINS = [
  'https://37cyx4.com',
];
const JSON_BASES = [
  'https://portal.instruno.com/public2/json',
];

let activeSiteDomain = SITE_DOMAINS[0];
let activeJsonBase = JSON_BASES[0];

const UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const CDN_DEFAULT = [
  'https://m3u8.41cdn.com',
  'https://m3u8.44cdn.com',
  'https://m3u8.46cdn.com',
  'https://m3u8.47cdn.com',
  'https://m3u8.48cdn.com',
  'https://m3u8.34cdn.com',
];
const CDN_ACTOR = ['https://m3u8.73cdn.com', 'https://m3u8.74cdn.com'];
const CDN_SELF = ['https://publices.ttjkbx.com'];

const DEFAULT_CLASS = [
  { type_id: '1', type_name: '国产' },
  { type_id: '4', type_name: '自拍视频' },
  { type_id: '5', type_name: '淫妻作乐' },
  { type_id: '6', type_name: '开放青年' },
  { type_id: '8', type_name: '网红主播' },
  { type_id: '9', type_name: '手机视频' },
  { type_id: '28', type_name: '女优' },
  { type_id: '37', type_name: '电影' },
  { type_id: '38', type_name: '经典三级' },
  { type_id: '39', type_name: '动漫卡通' },
  { type_id: '40', type_name: '无码中字' },
  { type_id: '47', type_name: '欧美系列' },
  { type_id: '64', type_name: '国产传媒' },
  { type_id: '119', type_name: 'JVID专区' },
  { type_id: '139', type_name: 'SWAG专区' },
  { type_id: '157', type_name: 'AI 换脸' },
  { type_id: '158', type_name: 'AI 黄剧' },
  { type_id: 'day', type_name: '日排行榜' },
  { type_id: 'week', type_name: '周排行榜' },
  { type_id: 'moon', type_name: '月排行榜' },
];

const CAT_BLACKLIST = new Set(['7']);
const TXT_RE = /\.txt(\?|$)/i;

// 进程内缓存
const API_CACHE = new Map();
const PIC_CACHE = new Map();
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

export function clearCaches() {
  API_CACHE.clear();
  PIC_CACHE.clear();
  PLAY_CACHE.clear();
}

// ================= AES-256-CBC 加解密 (URL-safe Base64) =================
export function b64uDec(s) {
  let str = String(s || '')
    .trim()
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const pad = (4 - (str.length % 4)) % 4;
  if (pad) str += '='.repeat(pad);
  return Buffer.from(str, 'base64');
}

export function b64uEnc(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'utf8');
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function aesDecText(s, keyBuf = KEY_BUF, ivBuf = IV_BUF) {
  const raw = b64uDec(s);
  if (!raw.length) return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, ivBuf);
    const pt = Buffer.concat([decipher.update(raw), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuf, ivBuf);
    decipher.setAutoPadding(false);
    let pt = Buffer.concat([decipher.update(raw), decipher.final()]);
    const p = pt.length ? pt[pt.length - 1] : 0;
    if (p > 0 && p <= 16) {
      pt = pt.subarray(0, pt.length - p);
    }
    return pt.toString('utf8');
  }
}

export function aesDecJson(s) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  const txt = aesDecText(s);
  return JSON.parse(txt);
}

export function aesEncB64u(text, keyBuf = KEY_BUF, ivBuf = IV_BUF) {
  const data = Buffer.from(String(text || ''), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', keyBuf, ivBuf);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return b64uEnc(ct);
}

// ================= 工具与参数归一化 =================
function toInt(v, d = 1) {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : d;
}

function cleanText(s) {
  return String(s || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[$#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatYear(ts) {
  const sec = toInt(ts, 0);
  if (!sec || sec <= 0) return '';
  const d = new Date(sec * 1000);
  const y = d.getFullYear();
  return Number.isFinite(y) && y > 1970 ? String(y) : '';
}

function unwrapParams(inReq) {
  if (!inReq) return {};
  const merged = {};
  for (const src of [inReq.query, inReq.body]) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (trimmed.startsWith('{')) {
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

function defaultHeaders(refererBase = activeSiteDomain) {
  let ref = refererBase || activeSiteDomain || SITE_DOMAINS[0];
  if (!ref.endsWith('/')) ref += '/';
  return {
    'User-Agent': UA,
    Referer: ref,
  };
}

function setPlayCache(key, val) {
  if (!key || !val) return;
  PLAY_CACHE.set(String(key), { val, exp: Date.now() + PLAY_CACHE_TTL });
}

function getPlayCache(key) {
  if (!key) return null;
  const hit = PLAY_CACHE.get(String(key));
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return hit.val;
}

// ================= 网络层与多域名容灾 =================
function decodeResponseBuffer(raw, contentEncoding = '') {
  let buf = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
    ? Buffer.from(raw)
    : Buffer.from(String(raw ?? ''), 'utf8');

  if (
    /gzip/i.test(contentEncoding) ||
    (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)
  ) {
    try {
      buf = zlib.gunzipSync(buf);
    } catch {}
  }

  let text = buf.toString('utf8');
  if (text.includes('\ufffd')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if (!gbk.includes('\ufffd')) text = gbk;
    } catch {}
  }
  return { buf, text };
}

function expandSiteUrls(inputUrl) {
  const u = String(inputUrl || '').trim();
  if (!u) return [];
  const pool = Array.from(new Set([activeSiteDomain, ...SITE_DOMAINS]));
  if (u.startsWith('/')) {
    return pool.map((base) => base.replace(/\/+$/, '') + u);
  }
  try {
    const parsed = new URL(u);
    const knownHosts = new Set(
      pool.map((d) => {
        try {
          return new URL(d).hostname.toLowerCase();
        } catch {
          return '';
        }
      })
    );
    if (knownHosts.has(parsed.hostname.toLowerCase())) {
      const pathAndQuery = parsed.pathname + parsed.search;
      return pool.map((base) => base.replace(/\/+$/, '') + pathAndQuery);
    }
  } catch {}
  return [u];
}

function expandJsonApiUrls(pathOrUrl) {
  const p = String(pathOrUrl || '').trim();
  if (!p) return [];
  const pool = Array.from(new Set([activeJsonBase, ...JSON_BASES]));
  if (p.startsWith('/')) {
    return pool.map((base) => base.replace(/\/+$/, '') + p);
  }
  try {
    const parsed = new URL(p);
    const knownHosts = new Set(
      pool.map((d) => {
        try {
          return new URL(d).hostname.toLowerCase();
        } catch {
          return '';
        }
      })
    );
    if (knownHosts.has(parsed.hostname.toLowerCase())) {
      const idx = parsed.pathname.indexOf('/public2/json/');
      if (idx !== -1) {
        const sub = parsed.pathname.slice(idx + '/public2/json'.length) + parsed.search;
        return pool.map((base) => base.replace(/\/+$/, '') + sub);
      }
    }
  } catch {}
  return [p];
}

async function rawRequest(url, options = {}) {
  const timeout = options.timeout || 4000;
  const retries = options.retries ?? 1;
  let candidateUrls = [url];
  if (options.isJsonApi) {
    candidateUrls = expandJsonApiUrls(url);
  } else if (options.expandSite !== false) {
    candidateUrls = expandSiteUrls(url);
  }

  let lastErr = null;
  for (const targetUrl of candidateUrls) {
    let origin = activeSiteDomain;
    try {
      origin = new URL(targetUrl).origin;
    } catch {}
    const headers = {
      ...defaultHeaders(options.syncRefererOrigin ? origin : activeSiteDomain),
      ...(options.headers || {}),
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await req.get(targetUrl, {
          headers,
          timeout,
          responseType: options.responseType || 'arraybuffer',
        });
        const status = res?.status ?? 200;
        if (status >= 400) {
          throw new Error(`HTTP ${status} for ${targetUrl}`);
        }
        const rawData = res?.data ?? res?.body ?? res ?? '';
        const ce = res?.headers?.['content-encoding'] || '';
        const ct = res?.headers?.['content-type'] || '';
        let buf;
        let text;
        if (typeof rawData === 'object' && !Buffer.isBuffer(rawData) && !(rawData instanceof Uint8Array)) {
          text = JSON.stringify(rawData);
          buf = Buffer.from(text, 'utf8');
        } else {
          ({ buf, text } = decodeResponseBuffer(rawData, ce));
        }

        if (options.validateContent && !options.validateContent(text, targetUrl)) {
          throw new Error(`Invalid site fingerprint from ${targetUrl}`);
        }

        if (options.isJsonApi) {
          const idx = targetUrl.indexOf('/public2/json');
          if (idx !== -1) activeJsonBase = targetUrl.slice(0, idx + '/public2/json'.length);
        } else {
          try {
            const uObj = new URL(targetUrl);
            if (SITE_DOMAINS.some((d) => new URL(d).hostname === uObj.hostname)) {
              activeSiteDomain = uObj.origin;
            }
          } catch {}
        }

        return { status, headers: res?.headers || {}, contentType: ct, buf, text, url: targetUrl };
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error(`Request failed: ${url}`);
}

async function jsonApi(path, { fast = false } = {}) {
  const normPath = path.startsWith('/') ? path : '/' + path;
  if (API_CACHE.has(normPath)) {
    return API_CACHE.get(normPath);
  }
  try {
    const res = await rawRequest(normPath, {
      isJsonApi: true,
      timeout: fast ? 2000 : 4000,
      retries: fast ? 0 : 1,
    });
    let d = JSON.parse(res.text);
    if (d && typeof d === 'object' && typeof d.data === 'string') {
      d = aesDecJson(d.data);
    }
    if (d && typeof d === 'object') {
      API_CACHE.set(normPath, d);
    }
    return d || {};
  } catch (err) {
    if (fast) return {};
    throw err;
  }
}

// ================= 封面代理与补图 =================
function resolveRoutePrefix(inReq) {
  const srvPrefix = inReq?.server?.prefix;
  if (srvPrefix) return String(srvPrefix).replace(/\/+$/, '');
  const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
  if (rawUrl) {
    return rawUrl.replace(/\/(init|home|category|detail|play|search|proxy|37cyx4_pic)\/?$/i, '');
  }
  return '';
}

function buildPicUrl(url, inReq) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (u.startsWith('data:')) return u;
  if (!TXT_RE.test(u)) return u;

  const tok = b64uEnc(u);
  const prefix = resolveRoutePrefix(inReq);
  const host = inReq?.headers?.host || inReq?.hostname || '';
  const proto = inReq?.protocol || 'http';
  if (host) {
    return `${proto}://${host}${prefix}/37cyx4_pic?type=pic&url=${tok}`;
  }
  if (prefix) {
    return `${prefix}/37cyx4_pic?type=pic&url=${tok}`;
  }
  return `/37cyx4_pic?type=pic&url=${tok}`;
}

function picById(vid) {
  const k = String(vid || '').trim();
  if (!k) return '';
  if (PIC_CACHE.has(k)) return PIC_CACHE.get(k);
  for (const [path, data] of API_CACHE.entries()) {
    if (!path.startsWith('/category/') || !data || !Array.isArray(data.data)) continue;
    for (const it of data.data) {
      if (String(it?.id) === k && it?.titlepic) {
        const tp = String(it.titlepic).trim();
        if (tp) {
          PIC_CACHE.set(k, tp);
          return tp;
        }
      }
    }
  }
  return '';
}

function pickPic(it) {
  const pic = String(it?.titlepic || '').trim();
  if (pic) return pic;
  return picById(it?.id);
}

async function fillPics(items, cap = 20, budgetMs = 6000) {
  if (!Array.isArray(items) || !items.length) return items;
  const pending = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (String(it.titlepic || '').trim()) continue;
    const vid = String(it.id || '').trim();
    if (!vid) continue;
    const cached = picById(vid);
    if (cached) {
      it.titlepic = cached;
    } else if (pending.length < cap) {
      pending.push({ it, vid });
    }
  }
  if (!pending.length) return items;

  const deadline = Date.now() + budgetMs;
  for (const { it, vid } of pending) {
    if (Date.now() > deadline) break;
    try {
      const d = await jsonApi(`/video/${vid}.json`, { fast: true });
      const tp = String(d?.titlepic || '').trim();
      if (tp) {
        it.titlepic = tp;
        PIC_CACHE.set(vid, tp);
      }
    } catch {}
  }
  return items;
}

export async function proxyPicHandler(query = {}) {
  try {
    let u = String(query.url || '').trim();
    if (u) {
      try {
        const dec = b64uDec(u).toString('utf8');
        if (/^https?:\/\//i.test(dec)) {
          u = dec;
        } else {
          u = decodeURIComponent(u);
        }
      } catch {
        try {
          u = decodeURIComponent(u);
        } catch {}
      }
    }
    if (u && /^https?:\/\//i.test(u)) {
      const res = await rawRequest(u, { expandSite: false, timeout: 4000, retries: 1 });
      const txt = res.text.trim();
      const m = txt.match(/^data:image\/([A-Za-z0-9+.-]+);base64,([\s\S]*)$/i);
      if (m) {
        const ext = m[1].toLowerCase();
        const mime = 'image/' + (ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext);
        const raw = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
        return { mime, data: raw };
      }
      return {
        mime: res.contentType || 'image/jpeg',
        data: res.buf,
      };
    }
  } catch {}
  return { mime: 'image/jpeg', data: Buffer.alloc(0) };
}

// ================= 视频卡片转换与分类 =================
function toVod(it, inReq) {
  if (!it || typeof it !== 'object') return null;
  const vid = String(it.id ?? it.vod_id ?? '').trim();
  if (!vid) return null;
  const rawPic = pickPic(it);
  if (rawPic) PIC_CACHE.set(vid, rawPic);
  return {
    vod_id: vid,
    vod_name: cleanText(it.title ?? it.vod_name ?? ''),
    vod_pic: buildPicUrl(rawPic, inReq),
    vod_year: formatYear(it.newstime),
    vod_area: cleanText(it.classname || ''),
    vod_remarks: cleanText(it.classname ?? it.vod_remarks ?? ''),
    vod_tag: '',
  };
}

function toVods(arr, inReq) {
  const out = [];
  const seen = new Set();
  for (const it of arr || []) {
    const v = toVod(it, inReq);
    if (v && !seen.has(v.vod_id)) {
      seen.add(v.vod_id);
      out.push(v);
    }
  }
  return out;
}

async function fetchCategories() {
  try {
    let o = await jsonApi('/category-list.json');
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      o = o.data || o.list || [];
    }
    const out = [];
    const seen = new Set();
    const add = (cid, nm) => {
      if (!cid || !nm) return;
      const idStr = String(cid).trim();
      if (!idStr || seen.has(idStr) || CAT_BLACKLIST.has(idStr)) return;
      seen.add(idStr);
      out.push({ type_id: idStr, type_name: String(nm).trim() });
    };

    for (const top of o || []) {
      if (!top || typeof top !== 'object') continue;
      if (top.tbname === 'movie') {
        add(top.classid, top.classname);
      }
      for (const it of top.items || []) {
        if (!it || typeof it !== 'object') continue;
        if (it.tbname === 'movie') {
          add(it.classid, it.classname);
        }
      }
    }

    if (out.length > 0) {
      out.sort((a, b) => toInt(a.type_id, 9999) - toInt(b.type_id, 9999));
      out.push(
        { type_id: 'day', type_name: '日排行榜' },
        { type_id: 'week', type_name: '周排行榜' },
        { type_id: 'moon', type_name: '月排行榜' }
      );
      return out;
    }
  } catch {}
  return DEFAULT_CLASS.map((x) => ({ ...x }));
}

// ================= 多阶段播放流解析与防干扰提纯 =================
const DECOY_MEDIA_RE =
  /(?:preview|sample|trailer|top_banner|native-ad|stat\.php|login|register|vip_tip)/i;

export function isDirectMediaUrl(urlStr) {
  const s = String(urlStr || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (DECOY_MEDIA_RE.test(s)) return false;
  try {
    const u = new URL(s);
    const p = u.pathname.toLowerCase();
    if (/\.(m3u8|mp4|flv|mkv|webm|mov|ts|mpd)$/i.test(p)) {
      return true;
    }
  } catch {}
  return false;
}

function unescapeCmsString(str) {
  return String(str || '')
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"');
}

function jsUnescape(str) {
  return String(str || '')
    .replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeCmsPlayerUrl(rawUrl, encryptType = 0) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const enc = toInt(encryptType, 0);
  if (enc === 1) {
    u = jsUnescape(u);
  } else if (enc === 2) {
    try {
      const b64 = Buffer.from(u, 'base64').toString('utf8');
      try {
        u = decodeURIComponent(b64);
      } catch {
        u = jsUnescape(b64);
      }
    } catch {}
  } else {
    u = unescapeCmsString(u);
  }
  return unescapeCmsString(u).trim();
}

export function unwrapNestedPlayerUrl(rawUrl) {
  let cur = unescapeCmsString(String(rawUrl || '').trim());
  if (!cur) return '';
  for (let pass = 0; pass < 2; pass++) {
    try {
      const uObj = new URL(cur, activeSiteDomain);
      const pathname = uObj.pathname.toLowerCase();
      if (/\.(m3u8|mp4|flv|mkv|webm|ts)$/i.test(pathname)) {
        return uObj.href;
      }
      for (const key of ['url', 'v', 'vid', 'src', 'file', 'm3u8']) {
        const paramVal = uObj.searchParams.get(key);
        if (paramVal) {
          let decoded = paramVal.trim();
          for (let i = 0; i < 2; i++) {
            if (/%[0-9a-fA-F]{2}/i.test(decoded)) {
              try {
                decoded = decodeURIComponent(decoded);
              } catch {
                decoded = jsUnescape(decoded);
              }
            }
          }
          decoded = unescapeCmsString(decoded);
          if (/^https?:\/\//i.test(decoded) || decoded.startsWith('/')) {
            cur = new URL(decoded, uObj.origin).href;
            break;
          }
        }
      }
    } catch {
      break;
    }
  }
  return cur;
}

export function extractBalancedJsonObjects(html, varNames = ['player_aaaa', 'player_data', 'player_config']) {
  const results = [];
  const src = String(html || '');
  for (const name of varNames) {
    const re = new RegExp(`\\b${name}\\s*=\\s*\\{`, 'g');
    let match;
    while ((match = re.exec(src)) !== null) {
      const startIdx = match.index + match[0].length - 1;
      let depth = 0;
      let inStr = false;
      let quoteChar = '';
      let escaped = false;
      for (let i = startIdx; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === quoteChar) {
            inStr = false;
          }
        } else {
          if (ch === '"' || ch === "'") {
            inStr = true;
            quoteChar = ch;
          } else if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
            if (depth === 0) {
              const jsonCandidate = src.slice(startIdx, i + 1);
              try {
                results.push(JSON.parse(jsonCandidate));
              } catch {}
              break;
            }
          }
        }
      }
    }
  }
  return results;
}

export function unpackDeanEdwards(html) {
  const src = String(html || '');
  const unpackedBlocks = [];
  const packerRe =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let m;
  while ((m = packerRe.exec(src)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10) || 36;
    const count = parseInt(m[4], 10) || 0;
    const symtab = m[6].split('|');

    const encodeBase = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) return chars[num];
      return encodeBase(Math.floor(num / base), base) + chars[num % base];
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const token = encodeBase(i, radix);
      dict.set(token, symtab[i] || token);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpackedBlocks.push(unpacked);
  }
  return unpackedBlocks;
}

export function extractPlayStreamFromHtml(html, baseUrl = activeSiteDomain) {
  const rawHtml = String(html || '');
  if (!rawHtml) return null;

  const blocksToScan = [rawHtml, ...unpackDeanEdwards(rawHtml)];

  for (const block of blocksToScan) {
    // Stage 1: Balanced-brace CMS player configs (player_aaaa, player_data, player_config)
    const configs = extractBalancedJsonObjects(block);
    for (const cfg of configs) {
      if (!cfg || typeof cfg !== 'object') continue;
      const decoded = decodeCmsPlayerUrl(cfg.url, cfg.encrypt);
      if (decoded) {
        const unwrapped = unwrapNestedPlayerUrl(decoded);
        if (isDirectMediaUrl(unwrapped)) {
          return unwrapped;
        }
        if (/^https?:\/\//i.test(unwrapped)) {
          return unwrapped;
        }
      }
    }

    // Stage 2: High-priority explicit stream variables
    const priorityRe =
      /\b(?:m3u8Url|realPlayUrl|playUrl|videoUrl|video_url|mp4Url|hlsUrl)\s*[:=]\s*(['"])([\s\S]*?)\1/g;
    let pm;
    while ((pm = priorityRe.exec(block)) !== null) {
      const cand = unwrapNestedPlayerUrl(unescapeCmsString(pm[2]));
      if (isDirectMediaUrl(cand)) {
        return cand;
      }
    }

    // Stage 3: Full unescaped direct .m3u8 / .mp4 regex scan (filtering decoys)
    const normalized = unescapeCmsString(block);
    const directRe = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
    let dm;
    while ((dm = directRe.exec(normalized)) !== null) {
      const cand = unwrapNestedPlayerUrl(dm[0]);
      if (isDirectMediaUrl(cand)) {
        return cand;
      }
    }
  }

  // Stage 4: Embedded iframe player URL
  const iframeRe = /<iframe[^>]+?(?:src|data-src)\s*=\s*(['"])([^'"]+)\1/gi;
  let im;
  while ((im = iframeRe.exec(rawHtml)) !== null) {
    const rawSrc = unescapeCmsString(im[2]);
    if (!rawSrc || /^javascript:/i.test(rawSrc) || /about:blank/i.test(rawSrc)) continue;
    const unwrapped = unwrapNestedPlayerUrl(rawSrc);
    if (isDirectMediaUrl(unwrapped)) {
      return unwrapped;
    }
    try {
      const resolved = new URL(unwrapped, baseUrl).href;
      if (isDirectMediaUrl(resolved)) return resolved;
      return { iframeUrl: resolved };
    } catch {}
  }

  // Stage 5: Alternative play route discovery on page
  const altRouteRe = /href\s*=\s*(['"])([^'"]*?(?:\/sid\/[2-9]\/nid\/\d+|-[2-9]-\d+\.html)[^'"]*)\1/gi;
  let am;
  while ((am = altRouteRe.exec(rawHtml)) !== null) {
    try {
      const altUrl = new URL(unescapeCmsString(am[2]), baseUrl).href;
      if (altUrl !== baseUrl) {
        return { altPlayUrl: altUrl };
      }
    } catch {}
  }

  return null;
}

function buildDetailPlayLines(o) {
  let crumb = '';
  try {
    const bcs = o?.breadcrumb || [];
    if (Array.isArray(bcs) && bcs.length > 0) {
      crumb = String(bcs[0]?.title || '').trim();
    }
  } catch {}

  let cdns = CDN_DEFAULT;
  if (crumb === 'self') {
    cdns = CDN_SELF;
  } else if (crumb === 'actor') {
    cdns = CDN_ACTOR;
  }

  const m3u8 = String(o?.m3u8 || '').trim();
  const mp4 = String(o?.mp4 || '').trim();
  const froms = [];
  const urls = [];
  const allDirectUrls = [];

  if (mp4) {
    froms.push('MP4');
    urls.push(`正片$${mp4}`);
    allDirectUrls.push(mp4);
  }
  if (m3u8) {
    const normalizedM3u8 = m3u8.startsWith('http')
      ? [m3u8]
      : cdns.map((c) => c.replace(/\/+$/, '') + (m3u8.startsWith('/') ? m3u8 : '/' + m3u8));
    froms.push('HLS');
    urls.push(`正片$${normalizedM3u8[0]}`);
    allDirectUrls.push(normalizedM3u8[0]);
    if (normalizedM3u8.length > 1) {
      froms.push('HLS2');
      urls.push(`正片$${normalizedM3u8[1]}`);
      allDirectUrls.push(normalizedM3u8[1]);
    }
  }
  if (!froms.length) {
    froms.push('线路');
    urls.push('暂无片源$http://');
  }
  return { froms, urls, allDirectUrls };
}

export function sanitizeEpisodeId(rawId) {
  let v = String(rawId || '').trim();
  if (!v) return '';
  if (v.includes('@@@')) {
    v = v.split('@@@')[0].trim();
  }
  if (v.includes('#')) {
    v = v.split('#')[0].trim();
  }
  if (v.includes('$')) {
    const firstDollar = v.indexOf('$');
    const prefix = v.slice(0, firstDollar).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      v = v.slice(firstDollar + 1).trim();
    } else {
      v = v.slice(v.lastIndexOf('$') + 1).trim();
    }
  }
  if (v.includes('@@@')) {
    v = v.split('@@@')[0].trim();
  }
  return v;
}

// ================= 核心接口实现 =================
async function init(inReq) {
  const params = unwrapParams(inReq);
  if (params.domain && /^https?:\/\//i.test(String(params.domain))) {
    const dom = String(params.domain).replace(/\/+$/, '');
    if (!SITE_DOMAINS.includes(dom)) SITE_DOMAINS.unshift(dom);
    activeSiteDomain = dom;
  }
  return {};
}

async function home(inReq) {
  const classes = await fetchCategories();
  let list = [];
  try {
    const o = await jsonApi('/category/1-1.json');
    list = toVods(o?.data || [], inReq).slice(0, 20);
  } catch {
    list = [];
  }
  return {
    class: classes,
    filters: {},
    list,
    style: { type: 'rect', ratio: 1.78 },
  };
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const tid = String(params.id ?? params.tid ?? '1').trim();
  const pg = Math.max(toInt(params.page ?? params.pg, 1), 1);

  try {
    if (tid === 'day' || tid === 'week' || tid === 'moon') {
      const o = await jsonApi('/top/top.json');
      const arr = Array.isArray(o?.[tid]) ? o[tid].map((x) => ({ ...x })) : [];
      await fillPics(arr);
      const list = toVods(arr, inReq);
      return {
        list,
        page: 1,
        pagecount: 1,
        limit: list.length,
        total: list.length,
        parse: 0,
        jx: 0,
      };
    }

    const o = await jsonApi(`/category/${tid}-${pg}.json`);
    const list = toVods(o?.data || [], inReq);
    const last = Math.max(toInt(o?.last_page, 1), 1);
    const total = toInt(o?.total, list.length);
    const per = toInt(o?.per_page, list.length || 1);
    return {
      list,
      page: pg,
      pagecount: last,
      limit: per,
      total,
      parse: 0,
      jx: 0,
    };
  } catch {
    return {
      page: pg,
      pagecount: 1,
      limit: 0,
      total: 0,
      list: [],
      parse: 0,
      jx: 0,
    };
  }
}

function extractFirstId(params) {
  let raw = params.id ?? params.ids ?? params.url ?? '';
  if (Array.isArray(raw)) {
    return String(raw[0] ?? '').trim().replace(/^["'\[\]]+|["'\[\]]+$/g, '');
  }
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.length) return String(parsed[0]).trim();
    } catch {}
  }
  return s.split(',')[0].trim().replace(/^["'\[\]]+|["'\[\]]+$/g, '');
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  const vid = extractFirstId(params);
  if (!vid) return { list: [] };

  try {
    const cleanId = vid.replace(/^\/video\/|\.json$/gi, '');
    const o = await jsonApi(`/video/${cleanId}.json`);
    if (!o || typeof o !== 'object' || (!o.title && !o.m3u8 && !o.mp4)) {
      return { list: [] };
    }

    const { froms, urls, allDirectUrls } = buildDetailPlayLines(o);
    if (allDirectUrls.length > 0) {
      setPlayCache(cleanId, allDirectUrls[0]);
      setPlayCache(vid, allDirectUrls[0]);
    }

    const rawPic = String(o.titlepic || '').trim() || picById(cleanId);
    if (rawPic) PIC_CACHE.set(cleanId, rawPic);

    const kws = cleanText(o.keyboard || '').replace(/,/g, ' / ');
    const catn = cleanText(o.category_name || '');
    const contentParts = [];
    if (catn) contentParts.push('分类：' + catn);
    if (kws) contentParts.push('标签：' + kws);

    const vod = {
      vod_id: cleanId,
      vod_name: cleanText(o.title),
      vod_pic: buildPicUrl(rawPic, inReq),
      vod_year: formatYear(o.newstime),
      vod_area: catn,
      vod_remarks: catn,
      vod_content: contentParts.join('\n'),
      vod_play_from: froms.join('$$$'),
      vod_play_url: urls.join('$$$'),
    };
    return { list: [vod] };
  } catch {
    return { list: [] };
  }
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const page = Math.max(toInt(params.page ?? params.pg, 1), 1);
  if (!key) return { list: [], page: 1 };

  try {
    const enc = aesEncB64u(key);
    const searchPath = `/api/v2/search?keyword=${encodeURIComponent(enc)}&classid=0&page=${page}`;
    const res = await rawRequest(searchPath, {
      expandSite: true,
      syncRefererOrigin: true,
      timeout: 4000,
      retries: 1,
    });
    const d = JSON.parse(res.text);
    if (!d || typeof d !== 'object' || d.status !== 1 || !d.data) {
      return { list: [], page };
    }
    const o = aesDecJson(d.data) || {};
    const arr = Array.isArray(o.data) ? o.data.map((x) => ({ ...x })) : [];
    await fillPics(arr);
    const list = toVods(arr, inReq);
    return { list, page };
  } catch {
    return { list: [], page: 1 };
  }
}

async function play(inReq) {
  const params = unwrapParams(inReq);
  const rawId = params.id ?? params.url ?? params.playUrl ?? '';
  const cand = sanitizeEpisodeId(rawId);
  const hdr = defaultHeaders(activeSiteDomain);

  if (!cand || cand === 'http://') {
    return { parse: 1, jx: 0, url: activeSiteDomain + '/', header: hdr, headers: hdr };
  }

  // 1. Check PLAY_CACHE first
  const cachedStream = getPlayCache(cand);
  if (cachedStream && isDirectMediaUrl(cachedStream)) {
    return { parse: 0, jx: 0, url: cachedStream, header: hdr, headers: hdr };
  }

  // 2. Relative .m3u8 / .mp4 path -> expand with default CDN
  if (cand.startsWith('/') && /\.(m3u8|mp4)(\?|$)/i.test(cand)) {
    const fullCdnUrl = CDN_DEFAULT[0] + cand;
    return { parse: 0, jx: 0, url: fullCdnUrl, header: hdr, headers: hdr };
  }

  // 3. Unwrap nested wrapper player URLs (?url=https%3A%2F%2F...m3u8)
  const unwrapped = unwrapNestedPlayerUrl(cand);
  if (isDirectMediaUrl(unwrapped)) {
    return { parse: 0, jx: 0, url: unwrapped, header: hdr, headers: hdr };
  }

  // 4. Direct HTTP URL check or HTML/JSON resolution
  if (/^https?:\/\//i.test(unwrapped)) {
    try {
      const res = await rawRequest(unwrapped, {
        expandSite: true,
        syncRefererOrigin: true,
        timeout: 4000,
        retries: 1,
      });
      let pageReferer = activeSiteDomain + '/';
      try {
        pageReferer = new URL(res.url).origin + '/';
      } catch {}
      const pageHdr = defaultHeaders(pageReferer.replace(/\/+$/, ''));

      // Check if JSON video response
      if (res.text.trim().startsWith('{')) {
        try {
          let j = JSON.parse(res.text);
          if (j && typeof j.data === 'string') j = aesDecJson(j.data);
          const { allDirectUrls } = buildDetailPlayLines(j);
          if (allDirectUrls.length > 0) {
            return { parse: 0, jx: 0, url: allDirectUrls[0], header: pageHdr, headers: pageHdr };
          }
        } catch {}
      }

      // Extract stream from HTML page
      const extracted = extractPlayStreamFromHtml(res.text, res.url);
      if (typeof extracted === 'string' && /^https?:\/\//i.test(extracted)) {
        return { parse: 0, jx: 0, url: extracted, header: pageHdr, headers: pageHdr };
      }
      if (extracted && extracted.iframeUrl) {
        const iframeRes = await rawRequest(extracted.iframeUrl, {
          expandSite: false,
          headers: { Referer: res.url },
          timeout: 4000,
          retries: 1,
        });
        const iframeStream = extractPlayStreamFromHtml(iframeRes.text, extracted.iframeUrl);
        if (typeof iframeStream === 'string' && /^https?:\/\//i.test(iframeStream)) {
          return { parse: 0, jx: 0, url: iframeStream, header: pageHdr, headers: pageHdr };
        }
      }
      if (extracted && extracted.altPlayUrl) {
        const altRes = await rawRequest(extracted.altPlayUrl, {
          expandSite: true,
          headers: { Referer: res.url },
          timeout: 4000,
          retries: 1,
        });
        const altStream = extractPlayStreamFromHtml(altRes.text, extracted.altPlayUrl);
        if (typeof altStream === 'string' && /^https?:\/\//i.test(altStream)) {
          return { parse: 0, jx: 0, url: altStream, header: pageHdr, headers: pageHdr };
        }
      }
    } catch {}

    return { parse: 0, jx: 0, url: unwrapped, header: hdr, headers: hdr };
  }

  // 5. Numeric/string video ID -> fetch /video/<id>.json
  try {
    const cleanVid = cand.replace(/^\/video\/|\.json$/gi, '');
    const o = await jsonApi(`/video/${cleanVid}.json`);
    const { allDirectUrls } = buildDetailPlayLines(o);
    if (allDirectUrls.length > 0) {
      setPlayCache(cleanVid, allDirectUrls[0]);
      return { parse: 0, jx: 0, url: allDirectUrls[0], header: hdr, headers: hdr };
    }
  } catch {}

  return { parse: 1, jx: 0, url: activeSiteDomain + '/', header: hdr, headers: hdr };
}

export default {
  meta: { key: '37cyx4', name: '4虎', type: 3 },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/37cyx4_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
    fastify.get('/proxy', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};