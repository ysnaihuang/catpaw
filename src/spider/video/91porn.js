import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'zlib';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const SITE_DOMAINS = [
  'https://91porn.com',
  'https://www.91porn.com',
  'https://0122.91p30.com',
  'https://91p51.com',
];

let activeDomain = SITE_DOMAINS[0];
let sessionEntered = false;
const cookieStore = new Map([['language', 'cn_CN']]);

const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const BRAND_DESC = '🦋 蝴蝶影视专线直连 | 极速硬解秒播 | 官方交流群: @tvshare23';
const BRAND_LINE = '蝴蝶专线';
const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const CLASSES = [
  { type_id: 'video', type_name: '全部视频', query: 'next=watch' },
  { type_id: 'ori', type_name: '91原创', query: 'category=ori&viewtype=basic' },
  { type_id: 'hot', type_name: '当前最热', query: 'category=hot&viewtype=basic' },
  { type_id: 'top', type_name: '本月最热', query: 'category=top&viewtype=basic' },
  { type_id: 'top_last', type_name: '上月最热', query: 'category=top&m=-1&viewtype=basic' },
  { type_id: 'rf', type_name: '最近加精', query: 'category=rf&viewtype=basic' },
  { type_id: 'long', type_name: '10分钟以上', query: 'category=long&viewtype=basic' },
  { type_id: 'longer', type_name: '20分钟以上', query: 'category=longer&viewtype=basic' },
  { type_id: 'tf', type_name: '本月收藏', query: 'category=tf&viewtype=basic' },
  { type_id: 'mf', type_name: '收藏最多', query: 'category=mf&viewtype=basic' },
  { type_id: 'md', type_name: '本月讨论', query: 'category=md&viewtype=basic' },
  { type_id: 'hd', type_name: '高清', query: 'category=hd&viewtype=basic' },
];

const CLASS_MAP = new Map(CLASSES.map((c) => [c.type_id, c]));

const TITLE_CACHE = new Map();
const PIC_CACHE = new Map();
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function randomPublicIp() {
  const firstOctets = [36, 42, 58, 61, 106, 110, 114, 117, 121, 180, 218, 222];
  const a = firstOctets[Math.floor(Math.random() * firstOctets.length)];
  const b = Math.floor(Math.random() * 254) + 1;
  const c = Math.floor(Math.random() * 254) + 1;
  const d = Math.floor(Math.random() * 254) + 1;
  return `${a}.${b}.${c}.${d}`;
}

function formatRemarks(brand = BRAND_DIRECTOR, meta = '') {
  const cleanMeta = String(meta || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return cleanMeta ? `${brand} | ${cleanMeta}` : brand;
}

function setCachedPlay(vid, data) {
  if (!vid || !data || !data.url) return;
  if (PLAY_CACHE.size > 1000) {
    const oldestKey = PLAY_CACHE.keys().next().value;
    if (oldestKey) PLAY_CACHE.delete(oldestKey);
  }
  PLAY_CACHE.set(String(vid), { ...data, ts: Date.now() });
}

function getCachedPlay(vid) {
  if (!vid) return null;
  const entry = PLAY_CACHE.get(String(vid));
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(String(vid));
    return null;
  }
  return entry;
}

function decodeHtmlEntities(str = '') {
  let s = String(str || '');
  for (let i = 0; i < 3; i++) {
    const prev = s;
    s = s
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
        const cp = parseInt(hex, 16);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      })
      .replace(/&#(\d+);/g, (_, dec) => {
        const cp = parseInt(dec, 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      });
    if (s === prev) break;
  }
  return s;
}

function cleanText(raw = '') {
  if (!raw) return '';
  let t = decodeHtmlEntities(String(raw));
  if (t.includes('%') && /%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      const u = decodeURIComponent(t);
      if (u !== t && /[\u4e00-\u9fa5]/.test(u) && !/[\u4e00-\u9fa5]/.test(t)) {
        t = u;
      }
    } catch {
      // ignore malformed URI sequence
    }
  }
  t = t
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\ufffd/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^(91\s*porn(\.com)?)\s*[-|_]\s*/i, '')
    .replace(/\s*[-|_]\s*(91\s*porn(\.com)?|91p\d+)\s*$/i, '')
    .replace(/\s+\d{1,3}:\d{2}(?::\d{2})?\s*$/, '');
  return t.trim();
}

function isValidTitle(title, vid = '') {
  if (!title) return false;
  const s = String(title).trim();
  if (s.length < 2) return false;
  if (vid && s.toLowerCase() === String(vid).toLowerCase()) return false;
  if (/^[0-9a-fA-F]{8,40}$/.test(s) && /[a-fA-F]/.test(s)) return false;
  if (!/[a-zA-Z\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(s)) return false;
  if (
    ['91porn', '91porn.com', '首页', '登录', '注册', '视频', 'watch', 'just a moment'].includes(
      s.toLowerCase()
    )
  ) {
    return false;
  }
  return true;
}

function rememberTitle(vid, title) {
  if (!vid || !title) return;
  if (TITLE_CACHE.size > 3000) TITLE_CACHE.clear();
  TITLE_CACHE.set(String(vid), String(title));
}

function knownTitle(vid) {
  if (!vid) return '';
  const t = TITLE_CACHE.get(String(vid)) || '';
  return isValidTitle(t, vid) ? t : '';
}

function rememberPic(vid, pic) {
  if (!vid || !pic) return;
  if (PIC_CACHE.size > 3000) PIC_CACHE.clear();
  PIC_CACHE.set(String(vid), String(pic));
}

function knownPic(vid) {
  if (!vid) return '';
  return PIC_CACHE.get(String(vid)) || '';
}

function unwrapParams(inReq) {
  const merged = {};
  const absorb = (src) => {
    if (!src) return;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') Object.assign(merged, parsed);
          return;
        } catch {
          // fall through to query string parsing
        }
      }
      const sp = new URLSearchParams(trimmed);
      for (const [k, v] of sp.entries()) merged[k] = v;
      return;
    }
    if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  };
  absorb(inReq && inReq.query);
  absorb(inReq && inReq.body);
  if (merged.ext && typeof merged.ext === 'string') {
    try {
      const decoded = JSON.parse(merged.ext);
      if (decoded && typeof decoded === 'object') merged.extObj = decoded;
    } catch {
      try {
        const b64 = Buffer.from(merged.ext, 'base64').toString('utf8');
        const decoded = JSON.parse(b64);
        if (decoded && typeof decoded === 'object') merged.extObj = decoded;
      } catch {
        // ignore
      }
    }
  } else if (merged.ext && typeof merged.ext === 'object') {
    merged.extObj = merged.ext;
  }
  return merged;
}

function getKnownHosts() {
  const hosts = new Set();
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    try {
      hosts.add(new URL(d).hostname.toLowerCase());
    } catch {
      // ignore
    }
  }
  return hosts;
}

function expandCandidateUrls(targetUrl) {
  if (!targetUrl) return [];
  let raw = String(targetUrl).trim();
  if (raw.startsWith('//')) raw = 'https:' + raw;

  const domains = Array.from(new Set([activeDomain, ...SITE_DOMAINS]));
  if (raw.startsWith('/')) {
    return domains.map((d) => `${d.replace(/\/+$/, '')}${raw}`);
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const knownHosts = getKnownHosts();
      if (knownHosts.has(parsed.hostname.toLowerCase())) {
        const suffix = `${parsed.pathname}${parsed.search}`;
        return domains.map((d) => `${d.replace(/\/+$/, '')}${suffix}`);
      }
    } catch {
      // ignore
    }
    return [raw];
  }
  return domains.map((d) => `${d.replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`);
}

function buildCookieHeader() {
  cookieStore.set('language', 'cn_CN');
  cookieStore.delete('watch_times');
  return Array.from(cookieStore.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function captureResponseCookies(headers) {
  if (!headers) return;
  const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const item of list) {
    const firstPart = String(item).split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      if (k && k.toLowerCase() !== 'watch_times') {
        cookieStore.set(k, v);
      }
    }
  }
}

function resetGuestSession() {
  cookieStore.clear();
  cookieStore.set('language', 'cn_CN');
}

function decodeBuffer(buf, contentEncoding = '') {
  if (!buf) return '';
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const enc = String(contentEncoding || '').toLowerCase();
  try {
    if ((raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) || enc.includes('gzip')) {
      raw = zlib.gunzipSync(raw);
    } else if (enc.includes('deflate')) {
      try {
        raw = zlib.inflateSync(raw);
      } catch {
        raw = zlib.inflateRawSync(raw);
      }
    }
  } catch {
    // use raw buffer if decompression fails
  }

  const headAscii = raw.subarray(0, 4096).toString('latin1');
  const charsetMatch =
    headAscii.match(/<meta[^>]+charset=["']?\s*([A-Za-z0-9_-]+)/i) ||
    headAscii.match(/charset=["']?\s*([A-Za-z0-9_-]+)/i);
  const metaEnc = charsetMatch ? charsetMatch[1].toLowerCase() : '';

  if (metaEnc && metaEnc.includes('gb')) {
    try {
      return new TextDecoder('gbk').decode(raw);
    } catch {
      // fallback to utf-8
    }
  }

  const utf8Text = raw.toString('utf8');
  if (utf8Text.includes('\ufffd')) {
    try {
      const gbkText = new TextDecoder('gbk').decode(raw);
      if (!gbkText.includes('\ufffd')) return gbkText;
    } catch {
      // ignore
    }
  }
  return utf8Text;
}

function isValidSiteHtml(html) {
  if (!html || typeof html !== 'string') return false;
  if (html.length < 30) return false;
  if (/cf-browser-verification|Attention Required! \| Cloudflare|Just a moment\.\.\.|_cf_chl_opt/i.test(html)) {
    return false;
  }
  return (
    /viewkey=/i.test(html) ||
    /videodetails|viewvideo-title|player_one|strencode/i.test(html) ||
    /<video|<iframe|<source|player_aaaa|\.mp4|\.m3u8/i.test(html) ||
    /well-sm|videos-text-align|search_result/i.test(html)
  );
}

async function fetchHtml(targetUrl, referer = '', timeoutMs = 7000) {
  const candidates = expandCandidateUrls(targetUrl);
  for (const url of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(url).origin;
    } catch {
      // ignore
    }
    let effectiveReferer = `${origin}/index.php`;
    if (referer) {
      try {
        const refUrl = new URL(referer, origin);
        effectiveReferer = `${origin}${refUrl.pathname}${refUrl.search}`;
      } catch {
        effectiveReferer = referer;
      }
    }

    const fakeIp = randomPublicIp();
    const headers = {
      'User-Agent': UA,
      Referer: effectiveReferer,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9',
      'X-Forwarded-For': fakeIp,
      'Client-IP': fakeIp,
      Cookie: buildCookieHeader(),
      Connection: 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    };

    try {
      const resp = await req.get(url, {
        headers,
        timeout: timeoutMs,
        responseType: 'arraybuffer',
      });
      captureResponseCookies(resp && resp.headers);
      const data = resp && resp.data !== undefined ? resp.data : resp;
      let text = '';
      if (typeof data === 'string') {
        text = data;
      } else if (Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer) {
        const encHeader =
          (resp && resp.headers && (resp.headers['content-encoding'] || resp.headers['Content-Encoding'])) || '';
        text = decodeBuffer(Buffer.from(data), encHeader);
      } else if (data && typeof data === 'object') {
        text = JSON.stringify(data);
      }
      if (text && (isValidSiteHtml(text) || url.endsWith('/index.php'))) {
        activeDomain = origin;
        sessionEntered = true;
        return text;
      }
    } catch {
      // try next candidate domain
    }
  }
  return '';
}

async function ensureEntered() {
  if (sessionEntered) return;
  sessionEntered = true;
  await fetchHtml('/index.php', '', 4000);
}

function normalizePicUrl(pic = '') {
  if (!pic) return '';
  const p = String(pic).trim();
  if (p.startsWith('//')) return 'https:' + p;
  if (p.startsWith('/')) return `${activeDomain.replace(/\/+$/, '')}${p}`;
  return p;
}

function parseList(html = '') {
  if (!html) return [];
  const items = [];
  const seen = new Set();

  let blocks = [];
  if (html.includes('<div class="well well-sm')) {
    blocks = html.split(/(?=<div class="well well-sm)/i);
  } else if (/class=["'][^"']*well\s+well-sm/i.test(html)) {
    blocks = html.split(/(?=<div[^>]+class=["'][^"']*well\s+well-sm)/i);
  } else if (/class=["'][^"']*videos-text-align/i.test(html)) {
    blocks = html.split(/(?=<div[^>]+class=["'][^"']*videos-text-align)/i);
  } else {
    blocks = [html];
  }

  for (const b of blocks) {
    if (!b.includes('viewkey=')) continue;
    const vkMatch = b.match(/viewkey=([a-z0-9]+)/i);
    if (!vkMatch) continue;
    const vid = vkMatch[1];
    if (seen.has(vid)) continue;
    seen.add(vid);

    const thumbMatch =
      b.match(/(?:data-original|data-src|src)=["']((?:https?:)?\/\/[^"']+thumb[^"']+)["']/i) ||
      b.match(/<img[^>]+(?:data-original|data-src|src)=["']((?:https?:)?\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    const durMatch = b.match(/duration["'][^>]*>([^<]+)</i);

    const cands = [];
    const spanTitleRe = /<span[^>]+class=["'][^"']*(?:title|video-title)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
    let sm;
    while ((sm = spanTitleRe.exec(b)) !== null) {
      const inner = sm[1];
      const innerText = inner.replace(/<[^>]+>/g, '').trim();
      if (innerText) cands.push(innerText);
      const tm = inner.match(/title=["']([^"']+)["']/i);
      if (tm) cands.push(tm[1]);
    }

    const linkWithTitle = b.match(/<a[^>]+href=["'][^"']*viewkey=[^"']*["'][^>]*title=["']([^"']+)["']/i);
    if (linkWithTitle) cands.push(linkWithTitle[1]);

    const vt = b.match(/class=["'][^"']*video-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (vt) {
      const seg = vt[1];
      const ta = seg.match(/<a[^>]*title=["']([^"']+)["']/i);
      const tt = seg.match(/<a[^>]*>([^<]+)<\/a>/i);
      if (ta) cands.push(ta[1]);
      if (tt) cands.push(tt[1]);
    }

    const textLinkRe = new RegExp(
      `<a[^>]+href=["'][^"']*viewkey=${vid}[^"']*["'][^>]*>([^<]{4,100})<\\/a>`,
      'i'
    );
    const textLink = b.match(textLinkRe);
    if (textLink) cands.push(textLink[1]);

    const alt = b.match(/alt=["']([^"']{4,})["']/i);
    if (alt) cands.push(alt[1]);

    let title = '';
    for (const c of cands) {
      const t = cleanText(c);
      if (isValidTitle(t, vid)) {
        title = t;
        break;
      }
    }

    if (!title) title = knownTitle(vid);
    if (!title) title = `视频 ${vid.slice(-6)}`;

    const picUrl = thumbMatch ? normalizePicUrl(thumbMatch[1]) : '';
    rememberTitle(vid, title);
    if (picUrl) rememberPic(vid, picUrl);

    items.push({
      id: vid,
      title,
      pic: picUrl,
      dur: durMatch ? cleanText(durMatch[1]) : '',
    });
  }
  return items;
}

function toVodCard(it) {
  return {
    vod_id: it.id,
    vod_name: it.title,
    vod_pic: it.pic,
    vod_remarks: formatRemarks(BRAND_DIRECTOR, it.dur),
    style: CARD_STYLE,
  };
}

function buildPageMeta(pg, count) {
  return {
    page: pg,
    pagecount: count >= 20 ? pg + 1 : pg,
    limit: 24,
    total: count >= 20 ? 999999 : pg * 24,
  };
}

function pickTitle(html = '', vid = '') {
  if (!html) return '';
  const pats = [
    /<div[^>]+id=["']videodetails["'][^>]*>[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>/i,
    /<title>([\s\S]*?)<\/title>/i,
    /<div[^>]+id=["']viewvideo-title["'][^>]*>\s*([^<]{2,300})/i,
    /id=["']viewvideo-title["'][^>]*>([\s\S]*?)<\/div>/i,
    /property=["']og:title["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']og:title["']/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /class=["'][^"']*login_registerHeader[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i,
    /id=["']player_one["'][^>]*>[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>/i,
    /<h4[^>]*>([\s\S]*?)<\/h4>/i,
    /class=["'][^"']*video-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /video_?title\s*[=:]\s*["']([^"']{2,200})["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{2,200})["']/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (!m) continue;
    const raw = m[1].replace(/<[^>]+>/g, ' ');
    const t = cleanText(raw);
    if (isValidTitle(t, vid)) return t;
  }
  return '';
}

function extractDetailPic(html = '', vid = '') {
  if (html) {
    const pats = [
      /id=["']vid["'][^>]+poster=["']([^"']+)["']/i,
      /id=["']player_one["'][^>]+poster=["']([^"']+)["']/i,
      /<video[^>]+poster=["']([^"']+)["']/i,
      /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      /poster=["']([^"']+)["']/i,
      /src=["']((?:https?:)?\/\/[^"']+thumb[^"']+)["']/i,
    ];
    for (const p of pats) {
      const m = html.match(p);
      if (m && m[1]) {
        const pic = normalizePicUrl(m[1]);
        if (vid && pic) rememberPic(vid, pic);
        return pic;
      }
    }
  }
  return knownPic(vid);
}

function jsUnescape(str = '') {
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function unescapeStreamText(str = '') {
  if (!str) return '';
  return decodeHtmlEntities(
    String(str)
      .replace(/\\\//g, '/')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  ).trim();
}

function isDecoyOrPreviewUrl(url = '') {
  const low = String(url || '').toLowerCase();
  if (!low) return true;
  return (
    low.includes('preview.mp4') ||
    low.includes('sample.mp4') ||
    low.includes('trailer.mp4') ||
    low.includes('top_banner') ||
    low.includes('native-ad') ||
    low.includes('stat.php')
  );
}

function isDirectMediaUrl(url = '') {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (isDecoyOrPreviewUrl(s)) return false;
  try {
    const u = new URL(s);
    const pathname = u.pathname.toLowerCase();
    if (/\.(m3u8|mp4|flv|mpd|ts|m4s|mkv|webm)$/i.test(pathname)) {
      return true;
    }
    return false;
  } catch {
    return /\.(m3u8|mp4)(?:\?|$)/i.test(s);
  }
}

function unwrapNestedMediaUrl(rawUrl = '', baseOrigin = activeDomain) {
  if (!rawUrl) return '';
  let candidate = unescapeStreamText(rawUrl);
  if (candidate.startsWith('//')) candidate = 'https:' + candidate;
  else if (candidate.startsWith('/')) candidate = `${baseOrigin.replace(/\/+$/, '')}${candidate}`;

  try {
    const parsed = new URL(candidate);
    if (!/\.(m3u8|mp4)$/i.test(parsed.pathname)) {
      for (const key of ['url', 'v', 'src', 'file', 'vid', 'play']) {
        const inner = parsed.searchParams.get(key);
        if (inner) {
          let dec = inner;
          for (let i = 0; i < 2; i++) {
            try {
              dec = decodeURIComponent(dec);
            } catch {
              dec = jsUnescape(dec);
            }
          }
          dec = unescapeStreamText(dec);
          if (isDirectMediaUrl(dec)) return dec;
        }
      }
    }
  } catch {
    // ignore
  }
  return candidate;
}

function extractBalancedJsonObject(text, varNames = ['player_aaaa', 'player_data', 'player_config']) {
  for (const name of varNames) {
    const re = new RegExp(`(?:var|let|const|window\\.)?\\s*${name}\\s*=\\s*\\{`, 'g');
    let match;
    while ((match = re.exec(text)) !== null) {
      const startBrace = match.index + match[0].length - 1;
      let depth = 0;
      let inStr = false;
      let quote = '';
      let escaped = false;
      for (let i = startBrace; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === quote) {
            inStr = false;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = true;
          quote = ch;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const rawObj = text.slice(startBrace, i + 1);
            try {
              return JSON.parse(rawObj);
            } catch {
              break;
            }
          }
        }
      }
    }
  }
  return null;
}

function decodeCmsPlayerUrl(url = '', encrypt = 0) {
  let u = String(url || '').trim();
  if (!u) return '';
  const encMode = Number(encrypt) || 0;
  if (encMode === 1) {
    try {
      u = decodeURIComponent(jsUnescape(u));
    } catch {
      u = jsUnescape(u);
    }
  } else if (encMode === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      try {
        u = decodeURIComponent(jsUnescape(b64Decoded));
      } catch {
        u = jsUnescape(b64Decoded);
      }
    } catch {
      // ignore
    }
  }
  return unwrapNestedMediaUrl(unescapeStreamText(u));
}

function unpackDeanEdwards(html = '') {
  const unpackedChunks = [];
  const packerRe =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = packerRe.exec(html)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const symtab = m[6].split('|');
    if (!radix || !count || symtab.length === 0) continue;

    const encodeToken = (num) => {
      const digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < radix) {
        return num < 36 ? num.toString(36) : digits[num] || '';
      }
      return encodeToken(Math.floor(num / radix)) + encodeToken(num % radix);
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeToken(i);
      const val = symtab[i];
      if (key && val) dict.set(key, val);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) => dict.get(word) || word);
    unpackedChunks.push(unpacked);
  }
  return unpackedChunks;
}

function decode91Strencode(html = '') {
  if (!html) return '';
  // 1. strencode2("...") - URL-encoded or hex-escaped HTML snippet containing <source src='...'>
  const m2 = html.match(/strencode2\(\s*(['"])([\s\S]*?)\1\s*\)/i);
  if (m2 && m2[2]) {
    const unescapedHex = unescapeStreamText(m2[2]);
    let dec = jsUnescape(unescapedHex);
    try {
      dec = decodeURIComponent(unescapedHex);
    } catch {
      // keep jsUnescape result
    }
    dec = unescapeStreamText(dec);
    const srcMatch =
      dec.match(/src\s*=\s*['"]([^'"]+)['"]/i) ||
      dec.match(/https?:\/\/[^\s"'<>\\]+/i);
    if (srcMatch) {
      const candidate = unwrapNestedMediaUrl(srcMatch[1] || srcMatch[0]);
      if (isDirectMediaUrl(candidate)) return candidate;
    }
  }

  // 2. strencode("inputB64", "key") - XOR + Base64
  const m1 = html.match(/strencode\(\s*(['"])([^'"]+)\1\s*,\s*(['"])([^'"]+)\3/i);
  if (m1 && m1[2] && m1[4]) {
    try {
      const inputBytes = Buffer.from(m1[2], 'base64');
      const key = m1[4];
      let out = '';
      for (let i = 0; i < inputBytes.length; i++) {
        out += String.fromCharCode(inputBytes[i] ^ key.charCodeAt(i % key.length));
      }
      const decodedHtml = unescapeStreamText(Buffer.from(out, 'base64').toString('utf8'));
      const srcMatch =
        decodedHtml.match(/src\s*=\s*['"]([^'"]+)['"]/i) ||
        decodedHtml.match(/https?:\/\/[^\s"'<>\\]+/i);
      if (srcMatch) {
        const candidate = unwrapNestedMediaUrl(srcMatch[1] || srcMatch[0]);
        if (isDirectMediaUrl(candidate)) return candidate;
      }
    } catch {
      // ignore
    }
  }
  return '';
}

function extract91NumericVidFallback(html = '', vid = '') {
  const sources = [html || '', knownPic(vid) || ''];
  for (const s of sources) {
    if (!s) continue;
    const vuidMatch =
      s.match(/id=["']VUID["'][^>]*>\s*(\d{4,12})\s*</i) ||
      s.match(/\/thumb\/(\d{4,12})(?:_[a-z0-9]+)?\.(?:jpg|jpeg|png|webp)/i) ||
      s.match(/VID\s*[=:]\s*["']?(\d{4,12})["']?/i);
    if (vuidMatch && vuidMatch[1]) {
      const numId = vuidMatch[1];
      return `https://la.killcovid2021.com/m3u8/${numId}/${numId}.m3u8`;
    }
  }
  return '';
}

function extractStreamFromText(html = '', vid = '') {
  if (!html) return '';

  // 1. 91porn strencode2 / strencode
  const s91 = decode91Strencode(html);
  if (s91) return s91;

  // 2. Balanced-brace CMS player object (player_aaaa, player_data, player_config)
  const cmsObj = extractBalancedJsonObject(html);
  if (cmsObj && cmsObj.url) {
    const decoded = decodeCmsPlayerUrl(cmsObj.url, cmsObj.encrypt);
    if (isDirectMediaUrl(decoded)) return decoded;
  }

  // 3. Packed JS blocks (Dean Edwards Packer)
  const unpackedList = unpackDeanEdwards(html);
  for (const chunk of unpackedList) {
    const packedCms = extractBalancedJsonObject(chunk);
    if (packedCms && packedCms.url) {
      const decoded = decodeCmsPlayerUrl(packedCms.url, packedCms.encrypt);
      if (isDirectMediaUrl(decoded)) return decoded;
    }
    const normChunk = unescapeStreamText(chunk);
    const directMatch = normChunk.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/i);
    if (directMatch) {
      const candidate = unwrapNestedMediaUrl(directMatch[0]);
      if (isDirectMediaUrl(candidate)) return candidate;
    }
  }

  // 4. <source src="..."> or <video src="...">
  const sourceRegex = /<(?:source|video)[^>]+src=["']([^"']+)["']/gi;
  let sm;
  while ((sm = sourceRegex.exec(html)) !== null) {
    const candidate = unwrapNestedMediaUrl(sm[1]);
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  // 5. Normalized full-HTML scan for direct .m3u8 / .mp4 streams
  const normalized = unescapeStreamText(html);
  const directRe = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let dm;
  while ((dm = directRe.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(dm[0]);
    if (isDirectMediaUrl(candidate)) return candidate;
  }

  // 6. 91porn numeric VUID / thumbnail ID HLS stream fallback
  const numFallback = extract91NumericVidFallback(html, vid);
  if (numFallback) return numFallback;

  return '';
}

async function resolvePlayStreamFromHtml(html = '', pageUrl = '', vid = '') {
  if (!html) return '';
  const direct = extractStreamFromText(html, vid);
  if (direct) return direct;

  // Stage 4: Check embedded <iframe src="...">
  const iframeRegex = /<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/gi;
  let im;
  while ((im = iframeRegex.exec(html)) !== null) {
    const rawIframeUrl = im[1];
    if (!rawIframeUrl || /^javascript:|about:blank/i.test(rawIframeUrl)) continue;
    const unwrapped = unwrapNestedMediaUrl(rawIframeUrl);
    if (isDirectMediaUrl(unwrapped)) return unwrapped;

    const fullIframeUrl = rawIframeUrl.startsWith('//')
      ? 'https:' + rawIframeUrl
      : rawIframeUrl.startsWith('/')
      ? `${activeDomain.replace(/\/+$/, '')}${rawIframeUrl}`
      : rawIframeUrl;
    if (/^https?:\/\//i.test(fullIframeUrl)) {
      const iframeHtml = await fetchHtml(fullIframeUrl, pageUrl || `${activeDomain}/`);
      const iframeStream = extractStreamFromText(iframeHtml, vid);
      if (iframeStream) return iframeStream;
    }
  }

  return '';
}

function sanitizePlayTarget(rawId = '') {
  let target = String(rawId || '').trim();
  if (!target) return '';
  if (target.includes('@@@')) {
    target = target.split('@@@')[0].trim();
  }
  if (target.includes('$')) {
    const idx = target.indexOf('$');
    const prefix = target.slice(0, idx).trim();
    const rest = target.slice(idx + 1).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      target = rest;
    }
  }
  return target;
}

function buildPlayHeaders(refererUrl = '') {
  let origin = activeDomain;
  try {
    if (refererUrl && /^https?:\/\//i.test(refererUrl)) {
      origin = new URL(refererUrl).origin;
    }
  } catch {
    // ignore
  }
  const h = {
    'User-Agent': UA,
    Referer: `${origin.replace(/\/+$/, '')}/`,
  };
  return { header: h, headers: { ...h } };
}

async function fetchVideoDetailHtml(vid) {
  if (!vid) return '';
  const detailPath = `/view_video.php?viewkey=${encodeURIComponent(vid)}`;
  let html = await fetchHtml(detailPath);
  if (!html || /作为游客|每天只可以观看/i.test(html)) {
    resetGuestSession();
    html = await fetchHtml(detailPath);
  }
  return html;
}

async function init(inReq) {
  const params = unwrapParams(inReq);
  const ext = params.extObj || params.extend || params.ext;
  if (ext && typeof ext === 'object' && ext.siteUrl) {
    activeDomain = String(ext.siteUrl).replace(/\/+$/, '');
  } else if (typeof ext === 'string' && /^https?:\/\//i.test(ext.trim())) {
    activeDomain = ext.trim().replace(/\/+$/, '');
  }
  sessionEntered = false;
  return {};
}

async function home() {
  const firstConf = CLASSES[0];
  const html = await fetchHtml(`/v.php?${firstConf.query}&page=1`, '', 4000);
  const items = parseList(html);
  return {
    class: CLASSES.map(({ type_id, type_name }) => ({ type_id, type_name })),
    filters: {},
    list: items.map(toVodCard),
    style: CARD_STYLE,
  };
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const cid = String(params.id || params.tid || params.type_id || 'video').trim();
  let pg = parseInt(params.page || params.pg || '1', 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;

  if (!sessionEntered) {
    await ensureEntered();
  }
  const conf = CLASS_MAP.get(cid);
  const query = conf ? conf.query : 'next=watch';
  const html = await fetchHtml(`/v.php?${query}&page=${pg}`);
  const items = parseList(html);
  return {
    ...buildPageMeta(pg, items.length),
    list: items.map(toVodCard),
  };
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  const rawId =
    params.id !== undefined
      ? params.id
      : params.ids !== undefined
      ? params.ids
      : params.vod_id !== undefined
      ? params.vod_id
      : params.url || '';
  const firstId = Array.isArray(rawId) ? rawId[0] : rawId;
  let vid = String(firstId || '').trim();
  const vkMatch = vid.match(/viewkey=([a-z0-9]+)/i);
  if (vkMatch) vid = vkMatch[1];

  if (!sessionEntered) {
    await ensureEntered();
  }
  const detailPath = vid ? `/view_video.php?viewkey=${encodeURIComponent(vid)}` : '';
  const html = await fetchVideoDetailHtml(vid);
  const pic = extractDetailPic(html, vid);
  const streamUrl = await resolvePlayStreamFromHtml(html, `${activeDomain}${detailPath}`, vid);

  if (streamUrl) {
    setCachedPlay(vid, { url: streamUrl, referer: `${activeDomain}/` });
  }

  let title = pickTitle(html, vid);
  if (!title) title = knownTitle(vid);
  if (!title) title = '超清正片';
  rememberTitle(vid, title);

  const playTarget = streamUrl || vid;
  const vod = {
    vod_id: vid,
    vod_name: title,
    vod_pic: pic,
    vod_bg: pic,
    vod_background: pic,
    vod_banner: pic,
    vod_actor: BRAND_ACTOR,
    vod_director: BRAND_DIRECTOR,
    vod_content: BRAND_DESC,
    vod_remarks: formatRemarks(BRAND_DIRECTOR, '超清正片'),
    vod_play_from: BRAND_LINE,
    vod_play_url: `正片$${playTarget}`,
  };
  return { list: [vod] };
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const key = String(params.wd || params.key || params.keyword || '').trim();
  let pg = parseInt(params.page || params.pg || '1', 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;
  if (!key) {
    return { page: pg, pagecount: pg, limit: 24, total: 0, list: [] };
  }

  if (!sessionEntered) {
    await ensureEntered();
  }
  const html = await fetchHtml(`/search_result.php?search_id=${encodeURIComponent(key)}&page=${pg}`);
  const items = parseList(html);
  return {
    ...buildPageMeta(pg, items.length),
    list: items.map(toVodCard),
  };
}

async function play(inReq) {
  const params = unwrapParams(inReq);
  const rawPid =
    params.id !== undefined
      ? params.id
      : params.url !== undefined
      ? params.url
      : params.pid || '';
  const target = sanitizePlayTarget(rawPid);
  const { header, headers } = buildPlayHeaders(`${activeDomain}/`);

  if (!target) {
    return { parse: 0, jx: 0, url: '', header, headers };
  }

  // Case 1: Already a direct media URL (.mp4 / .m3u8)
  const unwrappedTarget = unwrapNestedMediaUrl(target);
  if (isDirectMediaUrl(unwrappedTarget)) {
    return {
      parse: 0,
      jx: 0,
      url: unwrappedTarget,
      header,
      headers,
    };
  }

  // Case 2: Check PLAY_CACHE by viewkey
  const vkMatch = target.match(/viewkey=([a-z0-9]+)/i);
  const vid = vkMatch ? vkMatch[1] : /^[a-z0-9_-]{6,64}$/i.test(target) ? target : '';
  if (vid) {
    const cached = getCachedPlay(vid);
    if (cached && isDirectMediaUrl(cached.url)) {
      return {
        parse: 0,
        jx: 0,
        url: cached.url,
        ...buildPlayHeaders(cached.referer || `${activeDomain}/`),
      };
    }
  }

  // Case 3: Fetch detail/play page and resolve stream
  if (!sessionEntered) {
    await ensureEntered();
  }
  const html = vid ? await fetchVideoDetailHtml(vid) : await fetchHtml(target);
  if (vid) extractDetailPic(html, vid);
  const resolved = await resolvePlayStreamFromHtml(html, `${activeDomain}/`, vid);
  if (resolved && isDirectMediaUrl(resolved)) {
    if (vid) setCachedPlay(vid, { url: resolved, referer: `${activeDomain}/` });
    return {
      parse: 0,
      jx: 0,
      url: resolved,
      ...buildPlayHeaders(`${activeDomain}/`),
    };
  }

  // Stage 6 fallback: client sniffing on the video page
  const fallbackUrl = vid
    ? `${activeDomain}/view_video.php?viewkey=${encodeURIComponent(vid)}`
    : target.startsWith('/')
    ? `${activeDomain}${target}`
    : target;
  return {
    parse: 1,
    jx: 0,
    url: fallbackUrl,
    ...buildPlayHeaders(`${activeDomain}/`),
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = String(query.url || query.pic || '').trim();
  if (!picUrl) {
    return { mime: 'text/plain; charset=utf-8', data: 'Missing url' };
  }
  try {
    const resp = await req.get(picUrl, {
      headers: {
        'User-Agent': UA,
        Referer: `${activeDomain}/`,
      },
      timeout: 8000,
      responseType: 'arraybuffer',
    });
    const data = resp && resp.data !== undefined ? resp.data : resp;
    const mime =
      (resp && resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) ||
      'image/jpeg';
    return {
      mime,
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
    };
  } catch {
    return { mime: 'text/plain; charset=utf-8', data: 'Proxy fetch failed' };
  }
}

export default {
  meta: { key: 'porn91', name: '91Porn', type: 3 },
  api: async (fastify) => {
    fastify.post('/init', async (inReq) => init(inReq));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/porn91_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
    fastify.get('/91porn_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};