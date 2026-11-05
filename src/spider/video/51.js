import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const META = {
  key: '51chigua',
  name: '🌈 51吸瓜',
  type: 3,
};

const PAGE_SIZE = 90;
const CARD_STYLE = { type: 'rect', ratio: 1.33 };

const SITE_DOMAINS = [
  'https://artist.vgwtswi.xyz',
  'https://ability.vgwtswi.xyz',
  'https://am.vgwtswi.xyz',
  'https://51cg1.com',
  'https://cg51.com',
  'https://chigua.com',
];

let activeDomain = 'https://51cg1.com';

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

const AES_KEY = Buffer.from('f5d965df75336270', 'utf8');
const AES_IV = Buffer.from('97b60394abc2fbe1', 'utf8');

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

function buildHeaders(originOrUrl = activeDomain, extra = {}) {
  let origin = activeDomain;
  try {
    const parsed = new URL(originOrUrl);
    origin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    origin = activeDomain;
  }
  return {
    'User-Agent': DEFAULT_UA,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
    Origin: origin,
    Referer: `${origin}/`,
    ...extra,
  };
}

function safeLabel(value) {
  return String(value || '')
    .replace(/\$/g, '＄')
    .replace(/#/g, '＃')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(html = '') {
  return decodeHtmlEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapRequestParams(inReq = {}) {
  const merged = {};
  const sources = [inReq.query, inReq.body, inReq.params];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
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

function isKnownSiteHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return SITE_DOMAINS.some((d) => new URL(d).host === u.host);
  } catch {
    return false;
  }
}

function expandCandidateUrls(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  const orderedDomains = [
    activeDomain,
    ...SITE_DOMAINS.filter((d) => d !== activeDomain),
  ];

  if (!raw || raw === '/') {
    return orderedDomains.map((d) => `${d.replace(/\/$/, '')}/`);
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    if (isKnownSiteHost(raw)) {
      const parsed = new URL(raw);
      const rel = `${parsed.pathname}${parsed.search}`;
      const list = orderedDomains.map((d) => `${d.replace(/\/$/, '')}${rel}`);
      if (!list.includes(raw)) list.unshift(raw);
      return list;
    }
    return [raw];
  }

  const normalizedRel = raw.startsWith('/') ? raw : `/${raw}`;
  return orderedDomains.map((d) => `${d.replace(/\/$/, '')}${normalizedRel}`);
}

function decodeBufferToString(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = zlib.gunzipSync(data);
    } catch {}
  }
  const utf8 = data.toString('utf8');
  if (utf8.includes('\ufffd')) {
    try {
      return new TextDecoder('gbk').decode(data);
    } catch {}
  }
  return utf8;
}

function hasValidSiteFingerprint(html = '') {
  if (!html || html.length < 40) return false;
  return (
    html.includes('<article') ||
    html.includes('post-title') ||
    html.includes('dplayer') ||
    html.includes('data-config') ||
    html.includes('loadBannerDirect') ||
    html.includes('post-content') ||
    html.includes('player_aaaa') ||
    html.includes('.m3u8') ||
    html.includes('.mp4')
  );
}

async function fetchHtmlWithFailover(pathOrUrl, options = {}) {
  const candidates = expandCandidateUrls(pathOrUrl);
  let lastHtml = '';
  let lastUrl = candidates[0] || '';

  for (const targetUrl of candidates) {
    try {
      const headers = buildHeaders(targetUrl, options.headers || {});
      const resp = await req.get(targetUrl, {
        headers,
        timeout: options.timeout || 8000,
        responseType: 'arraybuffer',
      });
      const status = resp?.status ?? 200;
      if (status >= 200 && status < 400 && resp?.data !== undefined) {
        const html = decodeBufferToString(resp.data);
        lastHtml = html;
        lastUrl = targetUrl;
        if (options.skipFingerprint || hasValidSiteFingerprint(html)) {
          try {
            const u = new URL(targetUrl);
            const origin = `${u.protocol}//${u.host}`;
            if (SITE_DOMAINS.includes(origin)) {
              activeDomain = origin;
            }
          } catch {}
          return { ok: true, html, url: targetUrl, status };
        }
      }
    } catch {}
  }

  return { ok: Boolean(lastHtml), html: lastHtml, url: lastUrl, status: lastHtml ? 200 : 500 };
}

function getRoutePrefix(inReq) {
  if (inReq?.server?.prefix) {
    return String(inReq.server.prefix).replace(/\/$/, '');
  }
  const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
  const cleaned = rawUrl.replace(/\/(init|home|category|detail|play|search|proxy|51chigua_pic)\/?$/i, '');
  return cleaned.replace(/\/$/, '');
}

function getServerBaseUrl(inReq) {
  const host =
    inReq?.headers?.['x-forwarded-host'] ||
    inReq?.headers?.host ||
    inReq?.hostname ||
    '127.0.0.1';
  const proto = inReq?.headers?.['x-forwarded-proto'] || inReq?.protocol || 'http';
  const prefix = getRoutePrefix(inReq);
  return `${proto}://${host}${prefix}`;
}

function buildPicProxyUrl(rawImgUrl, inReq) {
  if (!rawImgUrl) return '';
  const trimmed = String(rawImgUrl).trim();
  if (!trimmed) return '';
  const fullUrl = trimmed.startsWith('http')
    ? trimmed
    : `${activeDomain.replace(/\/$/, '')}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  const base = getServerBaseUrl(inReq);
  return `${base}/51chigua_pic?url=${encodeURIComponent(fullUrl)}&type=img`;
}

function extractBannerUrl(scriptOrHtml = '', inReq) {
  const m = String(scriptOrHtml).match(/loadBannerDirect\(\s*['"]([^'"]+)['"]/i);
  if (m && m[1]) {
    return buildPicProxyUrl(m[1], inReq);
  }
  const dataAttr = String(scriptOrHtml).match(/data-xkrkllgl\s*=\s*['"]([^'"]+)['"]/i);
  if (dataAttr && dataAttr[1]) {
    return buildPicProxyUrl(dataAttr[1], inReq);
  }
  const imgSrc = String(scriptOrHtml).match(/<img[^>]+src\s*=\s*['"]([^'"]+)['"]/i);
  if (imgSrc && imgSrc[1]) {
    return imgSrc[1];
  }
  return '';
}

function decryptAesImg(buf) {
  try {
    const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (!data.length) return data;
    const decipher = crypto.createDecipheriv('aes-128-cbc', AES_KEY, AES_IV);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf || '');
  }
}

function parseCategories(html = '') {
  const classes = [];
  const seen = new Set();

  const blockPatterns = [
    /<div[^>]*class=["'][^"']*category-list[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<ul[^>]*class=["'][^"']*(?:nav-menu|menu)[^"']*["'][^>]*>([\s\S]*?)<\/ul>/gi,
    /<nav[^>]*>([\s\S]*?)<\/nav>/gi,
  ];

  for (const blockRe of blockPatterns) {
    let bm;
    while ((bm = blockRe.exec(html)) !== null) {
      const block = bm[1];
      const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let lm;
      while ((lm = linkRe.exec(block)) !== null) {
        let href = decodeHtmlEntities(lm[1]).trim();
        const name = stripTags(lm[2]);
        if (!href || href === '#' || href.startsWith('javascript:') || !name) continue;
        if (href.startsWith('http')) {
          if (!isKnownSiteHost(href)) continue;
          try {
            const u = new URL(href);
            href = `${u.pathname}${u.search}`;
          } catch {}
        }
        if (seen.has(href)) continue;
        seen.add(href);
        classes.push({ type_name: name, type_id: href });
      }
      if (classes.length > 0) break;
    }
    if (classes.length > 0) break;
  }

  if (classes.length === 0) {
    return [
      { type_name: '今日吃瓜', type_id: '/category/jrcg/' },
      { type_name: '每日大赛', type_id: '/category/mrdg/' },
      { type_name: '热门大瓜', type_id: '/category/rmdg/' },
      { type_name: '必看大瓜', type_id: '/category/bkdg/' },
      { type_name: '网红黑料', type_id: '/category/whhl/' },
      { type_name: '学生校园', type_id: '/category/xsxy/' },
    ];
  }

  return classes;
}

function parseArticleCards(html = '', tid = '', inReq = null) {
  const videos = [];
  const seen = new Set();
  const isFolder = String(tid || '').includes('/mrdg');

  // Scope to #index or #archive when present, fallback to whole HTML
  let scopedHtml = html;
  const containerMatch = html.match(
    /<(?:div|main|section)[^>]*id=["'](?:index|archive)["'][^>]*>([\s\S]*)/i
  );
  if (containerMatch) {
    scopedHtml = containerMatch[1];
  }

  const articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let am;
  while ((am = articleRe.exec(scopedHtml)) !== null) {
    const articleHtml = am[1];
    const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let lm;
    while ((lm = anchorRe.exec(articleHtml)) !== null) {
      let href = decodeHtmlEntities(lm[1]).trim();
      const inner = lm[2];
      if (!href || href === '#' || href.startsWith('javascript:')) continue;

      const h2Match =
        inner.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) ||
        articleHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
      const title = h2Match ? stripTags(h2Match[1]) : '';
      if (!title) continue;

      if (href.startsWith('http') && isKnownSiteHost(href)) {
        try {
          const u = new URL(href);
          href = `${u.pathname}${u.search}`;
        } catch {}
      }

      const vodId = `${href}${isFolder ? '@folder' : ''}`;
      if (seen.has(vodId)) continue;
      seen.add(vodId);

      const dateMatch =
        inner.match(/<span[^>]*itemprop=["']datePublished["'][^>]*>([\s\S]*?)<\/span>/i) ||
        inner.match(/<(?:div|span|p)[^>]*class=["'][^"']*(?:post-meta|entry-meta)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p)>/i) ||
        inner.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i) ||
        articleHtml.match(/<span[^>]*itemprop=["']datePublished["'][^>]*>([\s\S]*?)<\/span>/i);

      const remarks = dateMatch ? safeLabel(stripTags(dateMatch[1])) : '';
      const pic = extractBannerUrl(inner, inReq) || extractBannerUrl(articleHtml, inReq);

      const item = {
        vod_id: vodId,
        vod_name: safeLabel(title),
        vod_pic: pic,
        vod_remarks: remarks,
        style: CARD_STYLE,
      };
      if (isFolder) {
        item.vod_tag = 'folder';
      }
      videos.push(item);
    }
  }

  return videos;
}

function parseMaxPage(html = '', currentPage = 1) {
  let maxPage = currentPage;
  const navBlocks =
    html.match(
      /<(?:div|ul|nav|ol)[^>]*class=["'][^"']*(?:pagination|page-nav|pager|nav-links|pages)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|ul|nav|ol)>/gi
    ) || [];

  for (const block of navBlocks) {
    const linkRe = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRe.exec(block)) !== null) {
      const txt = stripTags(m[1]);
      if (/^\d+$/.test(txt)) {
        const num = parseInt(txt, 10);
        if (num > maxPage) maxPage = num;
      }
    }
  }

  if (maxPage === 1 && /(?:下一页|Next)/i.test(html)) {
    maxPage = currentPage + 1;
  }

  return Math.max(1, maxPage);
}

function extractBalancedDivInner(html = '', openTagRegex) {
  const match = openTagRegex.exec(html);
  if (!match) return '';

  const contentStart = match.index + match[0].length;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = contentStart;

  let depth = 1;
  let tm;
  while ((tm = tagRe.exec(html)) !== null) {
    const token = tm[0].toLowerCase();
    if (token.startsWith('</div')) {
      depth--;
      if (depth === 0) {
        return html.slice(contentStart, tm.index);
      }
    } else if (!token.endsWith('/>')) {
      depth++;
    }
  }
  return html.slice(contentStart);
}

async function parseFolderVideos(folderId, inReq) {
  const cleanId = String(folderId || '').replace(/@folder/g, '').trim();
  if (!cleanId) return [];

  const { ok, html } = await fetchHtmlWithFailover(cleanId);
  if (!ok || !html) return [];

  let bodyHtml =
    extractBalancedDivInner(
      html,
      /<div\b[^>]*class=["'][^"']*post-content[^"']*["'][^>]*>/i
    ) || html;

  // Strip noise blocks matching Python spider: .txt-apps, .line, blockquote, .tags, .content-tabs
  bodyHtml = bodyHtml
    .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, '')
    .replace(
      /<div\b[^>]*class=["'][^"']*(?:txt-apps|line|tags|content-tabs)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
      ''
    );

  const h2List = [];
  const h2Re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  let hm;
  while ((hm = h2Re.exec(bodyHtml)) !== null) {
    h2List.push(stripTags(hm[1]));
  }

  const pList = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = pRe.exec(bodyHtml)) !== null) {
    pList.push(pm[1]);
  }

  const videos = [];
  for (let i = 0; i < h2List.length; i++) {
    const c = i * 2;
    const pLinkHtml = pList[c] || '';
    const pImgHtml = pList[c + 1] || '';

    const hrefMatch = pLinkHtml.match(/<a\b[^>]*href=["']([^"']+)["']/i);
    let href = hrefMatch ? decodeHtmlEntities(hrefMatch[1]).trim() : '';
    if (href.startsWith('http') && isKnownSiteHost(href)) {
      try {
        const u = new URL(href);
        href = `${u.pathname}${u.search}`;
      } catch {}
    }

    const name = safeLabel(stripTags(pLinkHtml));
    const picAttr = pImgHtml.match(/data-xkrkllgl\s*=\s*['"]([^'"]+)['"]/i);
    const picUrl = picAttr && picAttr[1] ? buildPicProxyUrl(picAttr[1], inReq) : '';

    if (href || name) {
      videos.push({
        vod_id: href,
        vod_name: name || safeLabel(h2List[i]),
        vod_pic: picUrl,
        vod_remarks: safeLabel(h2List[i]),
        style: CARD_STYLE,
      });
    }
  }

  return videos;
}

function isDirectMediaUrl(urlStr = '') {
  const raw = String(urlStr || '').trim();
  if (!raw || (!raw.startsWith('http://') && !raw.startsWith('https://'))) return false;
  try {
    const u = new URL(raw);
    const pathname = u.pathname.toLowerCase();
    if (['.m3u8', '.mp4', '.ts', '.flv', '.mkv'].some((ext) => pathname.endsWith(ext))) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function unwrapNestedPlayerUrl(urlStr = '') {
  let current = String(urlStr || '').trim();
  if (!current) return '';

  for (let pass = 0; pass < 2; pass++) {
    try {
      const parsed = new URL(current);
      const pathname = parsed.pathname.toLowerCase();
      if (['.m3u8', '.mp4', '.ts', '.flv', '.mkv'].some((ext) => pathname.endsWith(ext))) {
        return current;
      }
      for (const key of ['url', 'v', 'vid', 'src', 'file', 'play']) {
        const inner = parsed.searchParams.get(key);
        if (inner) {
          let decoded = inner;
          for (let i = 0; i < 2; i++) {
            try {
              const next = decodeURIComponent(decoded);
              if (next === decoded) break;
              decoded = next;
            } catch {
              break;
            }
          }
          if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
            current = decoded;
            break;
          }
        }
      }
    } catch {
      break;
    }
  }
  return current;
}

function extractBalancedJsonObject(text, varPattern) {
  const regex = new RegExp(`${varPattern}\\s*=\\s*\\{`, 'g');
  const match = regex.exec(text);
  if (!match) return null;

  const startIdx = match.index + match[0].length - 1;
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
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
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }
  return null;
}

function customUnescape(str = '') {
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeCmsPlayerUrl(rawUrl, encrypt = 0) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const encMode = Number(encrypt || 0);
  if (encMode === 1) {
    u = customUnescape(u);
  } else if (encMode === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      u = customUnescape(b64Decoded);
    } catch {}
  }
  u = decodeHtmlEntities(
    u
      .replace(/\\\//g, '/')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  );
  return unwrapNestedPlayerUrl(u);
}

function unpackDeanEdwards(html = '') {
  const unpackedBlocks = [];
  const packerRe =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = packerRe.exec(html)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const symtab = m[6].split('|');
    if (!radix || !count || !symtab.length) continue;

    const encodeBase = (num) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < radix) {
        return num < 36 ? num.toString(36) : chars[num] || String(num);
      }
      return encodeBase(Math.floor(num / radix)) + encodeBase(num % radix);
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i);
      dict.set(key, symtab[i] || key);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpackedBlocks.push(unpacked);
  }
  return unpackedBlocks;
}

function extractDplayerEpisodes(html = '') {
  const episodes = [];
  const usedNames = new Set();

  // Match all elements with class containing dplayer and data-config attribute
  const dplayerTagRe = /<div\b[^>]*class=["'][^"']*dplayer[^"']*["'][^>]*>/gi;
  let dm;
  let index = 1;
  let prevDplayerEnd = 0;
  while ((dm = dplayerTagRe.exec(html)) !== null) {
    const tag = dm[0];
    const configMatch =
      tag.match(/data-config=(['"])([\s\S]*?)\1/i) ||
      tag.match(/data-config=([^\s>]+)/i);
    if (!configMatch) continue;

    const rawConfig = decodeHtmlEntities(configMatch[2] || configMatch[1] || '');
    let videoUrl = '';
    try {
      const cfg = JSON.parse(rawConfig);
      videoUrl = String(cfg?.video?.url || '').trim();
    } catch {
      const urlField = rawConfig.match(/"url"\s*:\s*"([^"]+)"/i);
      if (urlField) {
        videoUrl = urlField[1].replace(/\\\//g, '/').trim();
      }
    }
    if (!videoUrl) continue;
    videoUrl = decodeCmsPlayerUrl(videoUrl, 0);

    // Look backwards between the previous .dplayer and this .dplayer (up to 600 chars) for a heading
    let epName = '';
    const sliceStart = Math.max(prevDplayerEnd, dm.index - 600);
    const beforeSlice = html.slice(sliceStart, dm.index);
    const headingRe = /<h[234]\b[^>]*>([\s\S]*?)<\/h[234]>/gi;
    let hm;
    while ((hm = headingRe.exec(beforeSlice)) !== null) {
      const candidate = stripTags(hm[1]);
      if (candidate) epName = candidate;
    }
    prevDplayerEnd = dm.index + tag.length;

    const baseName = epName || `视频${index}`;
    let finalName = baseName;
    let count = 2;
    while (usedNames.has(finalName)) {
      finalName = `${baseName} ${count}`;
      count++;
    }
    usedNames.add(finalName);

    episodes.push({
      name: safeLabel(finalName),
      url: videoUrl,
    });
    index++;
  }

  return episodes;
}

function extractFallbackStreamsFromHtml(html = '') {
  if (!html) return [];
  const found = [];

  // 1. Check CMS player objects (player_aaaa, player_data, player_config)
  for (const varName of ['player_aaaa', 'player_data', 'player_config']) {
    const rawJson = extractBalancedJsonObject(html, varName);
    if (rawJson) {
      try {
        const obj = JSON.parse(rawJson);
        if (obj?.url) {
          const decoded = decodeCmsPlayerUrl(obj.url, obj.encrypt);
          if (decoded) found.push(decoded);
        }
      } catch {}
    }
  }

  // 2. Unpack Dean Edwards packed scripts
  const unpackedList = unpackDeanEdwards(html);
  const combinedSource = [html, ...unpackedList].join('\n');

  for (const block of unpackedList) {
    for (const varName of ['player_aaaa', 'player_data', 'player_config']) {
      const rawJson = extractBalancedJsonObject(block, varName);
      if (rawJson) {
        try {
          const obj = JSON.parse(rawJson);
          if (obj?.url) {
            const decoded = decodeCmsPlayerUrl(obj.url, obj.encrypt);
            if (decoded) found.push(decoded);
          }
        } catch {}
      }
    }
  }

  // 3. Scan normalized text for direct .m3u8 / .mp4 stream URLs (excluding decoys/previews)
  const normalized = decodeHtmlEntities(
    combinedSource
      .replace(/\\\//g, '/')
      .replace(/\\u002[fF]/g, '/')
      .replace(/\\u0026/g, '&')
  );

  const directRe = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let m;
  while ((m = directRe.exec(normalized)) !== null) {
    const candidate = unwrapNestedPlayerUrl(m[0]);
    if (
      /\/(?:preview|sample|trailer)\.mp4/i.test(candidate) ||
      /(?:top_banner|native-ad|stat\.php)/i.test(candidate)
    ) {
      continue;
    }
    if (isDirectMediaUrl(candidate) && !found.includes(candidate)) {
      found.push(candidate);
    }
  }

  return found;
}

async function resolveStreamFromPage(pageUrl) {
  const cached = getPlayCache(pageUrl);
  if (cached) return cached;

  const { ok, html, url: finalPageUrl } = await fetchHtmlWithFailover(pageUrl);
  if (!ok || !html) return '';

  const dplayers = extractDplayerEpisodes(html);
  if (dplayers.length > 0 && dplayers[0].url) {
    setPlayCache(pageUrl, dplayers[0].url);
    return dplayers[0].url;
  }

  const fallbacks = extractFallbackStreamsFromHtml(html);
  if (fallbacks.length > 0) {
    setPlayCache(pageUrl, fallbacks[0]);
    return fallbacks[0];
  }

  // Stage 4: Check embedded <iframe src="...">
  const iframeMatch = html.match(/<iframe\b[^>]*\b(?:src|data-src)=["']([^"']+)["']/i);
  if (iframeMatch && iframeMatch[1]) {
    let iframeUrl = decodeHtmlEntities(iframeMatch[1]).trim();
    if (!iframeUrl.startsWith('http')) {
      try {
        iframeUrl = new URL(iframeUrl, finalPageUrl || activeDomain).href;
      } catch {}
    }
    const unwrapped = unwrapNestedPlayerUrl(iframeUrl);
    if (isDirectMediaUrl(unwrapped)) {
      setPlayCache(pageUrl, unwrapped);
      return unwrapped;
    }
    const { ok: iOk, html: iHtml } = await fetchHtmlWithFailover(iframeUrl, {
      headers: { Referer: finalPageUrl || `${activeDomain}/` },
      skipFingerprint: true,
    });
    if (iOk && iHtml) {
      const iframeStreams = extractFallbackStreamsFromHtml(iHtml);
      if (iframeStreams.length > 0) {
        setPlayCache(pageUrl, iframeStreams[0]);
        return iframeStreams[0];
      }
    }
  }

  return '';
}

function sanitizePlayId(rawId = '') {
  let id = String(rawId || '').trim();
  if (!id) return '';

  // Strip custom metadata suffix @@@...
  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }

  // Strip leading episode label like "视频1$https://..." or "正片$/archives/123/"
  const dollarIdx = id.indexOf('$');
  if (dollarIdx > 0) {
    const prefix = id.slice(0, dollarIdx).trim();
    if (!prefix.startsWith('http://') && !prefix.startsWith('https://') && !prefix.startsWith('/')) {
      id = id.slice(dollarIdx + 1).trim();
    }
  }

  return unwrapNestedPlayerUrl(id);
}

async function init(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  if (params.domain && typeof params.domain === 'string' && params.domain.startsWith('http')) {
    activeDomain = params.domain.replace(/\/$/, '');
  }
  return {};
}

async function home(inReq, _outResp) {
  const { ok, html } = await fetchHtmlWithFailover('/');
  if (!ok || !html) {
    return {
      class: parseCategories(''),
      filters: {},
      list: [],
      style: CARD_STYLE,
    };
  }

  const classes = parseCategories(html);
  const list = parseArticleCards(html, '', inReq);
  return {
    class: classes,
    filters: {},
    list,
    style: CARD_STYLE,
  };
}

async function category(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const tid = String(params.id || params.tid || params.type_id || '/').trim();
  const pgRaw = params.page || params.pg || 1;
  const pageNum = Math.max(1, /^\d+$/.test(String(pgRaw)) ? parseInt(String(pgRaw), 10) : 1);

  if (tid.includes('@folder')) {
    const folderVideos = await parseFolderVideos(tid, inReq);
    return {
      list: folderVideos,
      page: pageNum,
      pagecount: 1,
      limit: folderVideos.length || PAGE_SIZE,
      total: folderVideos.length,
      style: CARD_STYLE,
    };
  }

  let relPath = tid.startsWith('http')
    ? (() => {
        try {
          const u = new URL(tid);
          return u.pathname;
        } catch {
          return tid;
        }
      })()
    : tid;
  if (!relPath.startsWith('/')) relPath = `/${relPath}`;
  relPath = relPath.replace(/\/+$/, '');
  const targetPath = pageNum > 1 ? `${relPath}/${pageNum}/` : `${relPath}/`;

  const { ok, html } = await fetchHtmlWithFailover(targetPath);
  if (!ok || !html) {
    return {
      list: [],
      page: pageNum,
      pagecount: 1,
      limit: PAGE_SIZE,
      total: 0,
      style: CARD_STYLE,
    };
  }

  const videos = parseArticleCards(html, tid, inReq);
  const pagecount = parseMaxPage(html, pageNum);

  return {
    list: videos,
    page: pageNum,
    pagecount: Math.max(1, pagecount),
    limit: PAGE_SIZE,
    total: Math.max(videos.length, pageNum * PAGE_SIZE),
    style: CARD_STYLE,
  };
}

async function detail(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  let reqId = '';
  if (Array.isArray(params.ids) && params.ids.length > 0) {
    reqId = String(params.ids[0]);
  } else if (Array.isArray(params.id) && params.id.length > 0) {
    reqId = String(params.id[0]);
  } else {
    reqId = String(params.id || params.ids || params.url || '').trim();
  }

  if (!reqId) {
    return { list: [] };
  }

  const { ok, html, url: resolvedPageUrl } = await fetchHtmlWithFailover(reqId);
  if (!ok || !html) {
    return { list: [] };
  }

  const titleMatch =
    html.match(/<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const vodName = safeLabel(titleMatch ? stripTags(titleMatch[1]) : '51吸瓜视频');

  // Parse tags (.tags .keywords a) into CatVod cr-links
  const tagLinks = [];
  const tagsBlockMatch = html.match(
    /<div[^>]*class=["'][^"']*(?:tags|keywords)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  );
  const tagSource = tagsBlockMatch ? tagsBlockMatch.join('\n') : '';
  if (tagSource) {
    const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let am;
    while ((am = aRe.exec(tagSource)) !== null) {
      let href = decodeHtmlEntities(am[1]).trim();
      const tName = stripTags(am[2]);
      if (!href || !tName) continue;
      if (href.startsWith('http') && isKnownSiteHost(href)) {
        try {
          const u = new URL(href);
          href = `${u.pathname}${u.search}`;
        } catch {}
      }
      const payload = JSON.stringify({ id: href, name: tName, type_flag: '1' });
      tagLinks.push(`[a=cr:${payload}/]${tName}[/a]`);
    }
  }

  let episodes = extractDplayerEpisodes(html);
  if (episodes.length === 0) {
    const fallbacks = extractFallbackStreamsFromHtml(html);
    episodes = fallbacks.map((u, idx) => ({
      name: `视频${idx + 1}`,
      url: u,
    }));
  }

  if (episodes.length === 0) {
    const stream = await resolveStreamFromPage(resolvedPageUrl || reqId);
    if (stream) {
      episodes = [{ name: '视频1', url: stream }];
    }
  }

  if (episodes.length === 0) {
    return { list: [] };
  }

  // Warm PLAY_CACHE with first episode stream keyed by reqId and resolvedPageUrl
  setPlayCache(reqId, episodes[0].url);
  if (resolvedPageUrl) setPlayCache(resolvedPageUrl, episodes[0].url);
  for (const ep of episodes) {
    setPlayCache(`${reqId}#${ep.name}`, ep.url);
  }

  const playUrlStr = episodes.map((ep) => `${ep.name}$${ep.url}`).join('#');
  const vodPic = extractBannerUrl(html, inReq);

  const vod = {
    vod_id: reqId,
    vod_name: vodName,
    vod_pic: vodPic,
    vod_content: tagLinks.length > 0 ? tagLinks.join(' ') : vodName,
    vod_play_from: '51吸瓜',
    vod_play_url: playUrlStr,
  };

  return { list: [vod] };
}

async function search(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const wd = String(params.wd || params.key || params.keyword || '').trim();
  const pgRaw = params.page || params.pg || 1;
  const pageNum = Math.max(1, /^\d+$/.test(String(pgRaw)) ? parseInt(String(pgRaw), 10) : 1);

  if (!wd) {
    return { list: [], page: pageNum, pagecount: 1, limit: PAGE_SIZE, total: 0 };
  }

  const encodedKey = encodeURIComponent(wd);
  const searchPath =
    pageNum > 1 ? `/search/${encodedKey}/${pageNum}/` : `/search/${encodedKey}/`;

  const { ok, html } = await fetchHtmlWithFailover(searchPath);
  if (!ok || !html) {
    return { list: [], page: pageNum, pagecount: 1, limit: PAGE_SIZE, total: 0 };
  }

  const videos = parseArticleCards(html, '', inReq);
  const pagecount = parseMaxPage(html, pageNum);

  return {
    list: videos,
    page: pageNum,
    pagecount: Math.max(1, pagecount),
    limit: PAGE_SIZE,
    total: Math.max(videos.length, pageNum * PAGE_SIZE),
    style: CARD_STYLE,
  };
}

async function play(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const rawInput = String(params.id || params.url || '').trim();
  const useProxy = params.proxy === '1' || params.proxy === true || params.proxy === 1;

  const cleaned = sanitizePlayId(rawInput);
  const headers = buildHeaders(activeDomain);

  if (!cleaned) {
    return { parse: 0, jx: 0, url: '', header: headers, headers };
  }

  let streamUrl = '';
  if (isDirectMediaUrl(cleaned)) {
    streamUrl = cleaned;
  } else {
    const cached = getPlayCache(cleaned) || getPlayCache(rawInput);
    if (cached && isDirectMediaUrl(cached)) {
      streamUrl = cached;
    } else {
      const resolved = await resolveStreamFromPage(cleaned);
      if (resolved && isDirectMediaUrl(resolved)) {
        streamUrl = resolved;
      }
    }
  }

  if (streamUrl) {
    let finalUrl = streamUrl;
    if (useProxy && streamUrl.includes('.m3u8')) {
      const base = getServerBaseUrl(inReq);
      finalUrl = `${base}/proxy?type=m3u8&url=${encodeURIComponent(streamUrl)}`;
    }
    return {
      parse: 0,
      jx: 0,
      url: finalUrl,
      header: headers,
      headers,
    };
  }

  // Fallback to sniffing if cleaned is a webpage URL
  const sniffUrl = cleaned.startsWith('http')
    ? cleaned
    : `${activeDomain.replace(/\/$/, '')}${cleaned.startsWith('/') ? '' : '/'}${cleaned}`;

  return {
    parse: 1,
    jx: 0,
    url: sniffUrl,
    header: headers,
    headers,
  };
}

async function proxyPicHandler(query = {}) {
  const rawUrl = String(query.url || '').trim();
  if (!rawUrl) {
    return { status: 400, mime: 'text/plain', data: 'Missing url' };
  }

  try {
    const resp = await req.get(rawUrl, {
      headers: buildHeaders(rawUrl),
      timeout: 10000,
      responseType: 'arraybuffer',
    });
    const contentType =
      resp?.headers?.['content-type'] || resp?.headers?.['Content-Type'] || 'image/jpeg';
    const rawBuf = Buffer.isBuffer(resp?.data) ? resp.data : Buffer.from(resp?.data || '');
    const decrypted = decryptAesImg(rawBuf);
    return { status: 200, mime: contentType, data: decrypted };
  } catch {
    return { status: 502, mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

async function proxyStreamHandler(query = {}, inReq = {}) {
  const reqType = String(query.type || 'm3u8').toLowerCase();
  const rawUrl = String(query.url || '').trim();
  if (!rawUrl) {
    return { status: 400, mime: 'text/plain', data: 'Missing url' };
  }

  if (reqType === 'img') {
    return proxyPicHandler(query);
  }

  try {
    const resp = await req.get(rawUrl, {
      headers: buildHeaders(rawUrl),
      timeout: 12000,
      responseType: 'arraybuffer',
    });
    const rawBuf = Buffer.isBuffer(resp?.data) ? resp.data : Buffer.from(resp?.data || '');

    if (reqType === 'm3u8') {
      const text = decodeBufferToString(rawBuf);
      const parsed = new URL(rawUrl);
      const origin = `${parsed.protocol}//${parsed.host}`;
      const baseDir = rawUrl.slice(0, rawUrl.lastIndexOf('/'));
      const serverBase = getServerBaseUrl(inReq);

      let isFirstKey = true;
      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (isFirstKey && trimmed.includes('URI="')) {
            isFirstKey = false;
            return trimmed.replace(/URI="([^"]+)"/, (_, keyUri) => {
              const absKey = keyUri.startsWith('http')
                ? keyUri
                : keyUri.startsWith('/')
                ? `${origin}${keyUri}`
                : `${baseDir}/${keyUri}`;
              return `URI="${serverBase}/proxy?type=mkey&url=${encodeURIComponent(absKey)}"`;
            });
          }
          if (!trimmed.startsWith('#EXT')) {
            const absSeg = trimmed.startsWith('http')
              ? trimmed
              : trimmed.startsWith('/')
              ? `${origin}${trimmed}`
              : `${baseDir}/${trimmed}`;
            return `${serverBase}/proxy?type=ts&url=${encodeURIComponent(absSeg)}`;
          }
          return line;
        })
        .join('\n');

      return {
        status: 200,
        mime: 'application/vnd.apple.mpegurl',
        data: rewritten,
      };
    }

    const mime =
      reqType === 'ts'
        ? 'video/mp2t'
        : resp?.headers?.['content-type'] || 'application/octet-stream';
    return { status: 200, mime, data: rawBuf };
  } catch {
    return { status: 502, mime: 'text/plain', data: 'Proxy error' };
  }
}

export default {
  meta: META,
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/51chigua_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.code(res.status || 200).type(res.mime).send(res.data);
    });
    fastify.get('/proxy', async (request, reply) => {
      const res = await proxyStreamHandler(request.query || {}, request);
      return reply.code(res.status || 200).type(res.mime).send(res.data);
    });
  },
};