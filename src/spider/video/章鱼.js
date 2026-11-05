import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://www.zhangyuys.com',
  'https://zhangyuys.com',
];

let activeDomain = SITE_DOMAINS[0];

const PLAY_BASE_HOST = 'https://www.zhangyu.bar';
const UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const TIMEOUT = 8000;
const PER = 20;

const CATS = [
  { type_id: 'all', type_name: '最新' },
  { type_id: 'hot', type_name: '今日热门' },
  { type_id: '43', type_name: '真人' },
  { type_id: '1', type_name: '动画' },
  { type_id: 'col', type_name: '合集' },
];

const STYLE = { type: 'rect', ratio: 1.78 };

const CACHE_TTL_MS = 10 * 60 * 1000;
const PLAY_CACHE = new Map();
const VIDEO_META_CACHE = new Map();
const COL_META_CACHE = new Map();

function setCache(map, key, value) {
  if (!key || value === undefined || value === null) return;
  map.set(String(key), { value, ts: Date.now() });
}

function getCache(map, key) {
  if (!key) return null;
  const entry = map.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    map.delete(String(key));
    return null;
  }
  return entry.value;
}

function buildPlayUrl(vid) {
  const clean = String(vid ?? '').trim();
  return `${PLAY_BASE_HOST}/h/${clean}/index.m3u8`;
}

function buildPicUrl(vid) {
  const clean = String(vid ?? '').trim();
  return `${PLAY_BASE_HOST}/p/${clean}.jpg`;
}

function buildHeaders(refererOrigin) {
  const ref = refererOrigin
    ? refererOrigin.endsWith('/')
      ? refererOrigin
      : `${refererOrigin}/`
    : `${activeDomain}/`;
  return {
    'User-Agent': UA,
    Referer: ref,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
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
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(merged, parsed);
          }
          continue;
        } catch {
          // fall through to URLSearchParams
        }
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) {
          merged[k] = v;
        }
      } catch {
        // ignore invalid query string
      }
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
    } catch {
      // ignore
    }
  }
  return hosts;
}

function expandCandidateUrls(urlOrPath) {
  const raw = String(urlOrPath || '').trim();
  if (!raw) return [];
  const orderedDomains = [
    activeDomain,
    ...SITE_DOMAINS.filter((d) => d !== activeDomain),
  ];

  if (raw.startsWith('/')) {
    return orderedDomains.map((d) => `${d.replace(/\/+$/, '')}${raw}`);
  }

  try {
    const u = new URL(raw);
    const knownHosts = getKnownHosts();
    if (knownHosts.has(u.hostname.toLowerCase())) {
      const pathAndQuery = `${u.pathname}${u.search}${u.hash}`;
      return orderedDomains.map((d) => `${d.replace(/\/+$/, '')}${pathAndQuery}`);
    }
    return [raw];
  } catch {
    const cleanPath = raw.startsWith('/') ? raw : `/${raw}`;
    return orderedDomains.map((d) => `${d.replace(/\/+$/, '')}${cleanPath}`);
  }
}

function decodeBuffer(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let rawBuf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (rawBuf.length >= 2 && rawBuf[0] === 0x1f && rawBuf[1] === 0x8b) {
    try {
      rawBuf = zlib.gunzipSync(rawBuf);
    } catch {
      // keep original buffer if gunzip fails
    }
  }
  const utf8Text = rawBuf.toString('utf8');
  if (utf8Text.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(rawBuf);
    } catch {
      return utf8Text;
    }
  }
  return utf8Text;
}

function isValidSitePayload(text, url) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('domain for sale') ||
    lower.includes('parkingcrew') ||
    lower.includes('sedoparking')
  ) {
    return false;
  }
  if (url.includes('/api/')) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed !== null && typeof parsed === 'object';
    } catch {
      return false;
    }
  }
  return (
    trimmed.includes('<title>') ||
    trimmed.includes('rec-card') ||
    trimmed.includes('player_') ||
    trimmed.includes('.m3u8') ||
    trimmed.includes('.mp4') ||
    trimmed.includes('<video') ||
    trimmed.includes('<iframe') ||
    trimmed.includes('<html') ||
    trimmed.startsWith('{')
  );
}

async function fetchText(urlOrPath, options = {}) {
  const candidates = expandCandidateUrls(urlOrPath);
  const knownHosts = getKnownHosts();

  for (const targetUrl of candidates) {
    let origin = activeDomain;
    let isKnownSite = false;
    try {
      const parsed = new URL(targetUrl);
      origin = parsed.origin;
      isKnownSite = knownHosts.has(parsed.hostname.toLowerCase());
    } catch {
      // ignore
    }

    const reqHeaders = {
      ...buildHeaders(options.referer || origin),
      ...(options.headers || {}),
    };
    if (isKnownSite && !options.preserveReferer) {
      reqHeaders.Referer = `${origin}/`;
    }

    try {
      const res = await req.get(targetUrl, {
        headers: reqHeaders,
        timeout: options.timeout || TIMEOUT,
        responseType: options.responseType || 'text',
      });

      const status = res?.status ?? 200;
      if (status >= 400) continue;

      const rawData = res?.data ?? res?.body ?? res;
      let text = '';
      if (typeof rawData === 'string') {
        text = rawData;
      } else if (Buffer.isBuffer(rawData) || rawData instanceof Uint8Array) {
        text = decodeBuffer(rawData);
      } else if (rawData && typeof rawData === 'object') {
        text = JSON.stringify(rawData);
      }

      if (!isValidSitePayload(text, targetUrl)) {
        continue;
      }

      if (isKnownSite) {
        activeDomain = origin;
      }
      return { text, url: targetUrl, origin };
    } catch {
      // try next candidate mirror
    }
  }
  return { text: '', url: String(urlOrPath || ''), origin: activeDomain };
}

async function fetchJson(urlOrPath, options = {}) {
  const { text } = await fetchText(urlOrPath, options);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

function formatDuration(sec) {
  if (sec === undefined || sec === null || sec === '') return '';
  const n = parseInt(sec, 10);
  if (Number.isNaN(n) || n < 0) return '';
  let s = n % 60;
  let m = Math.floor(n / 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    m = m % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCard(v) {
  if (!v || typeof v !== 'object') return null;
  const vid = String(v.video_id || v.id || '').trim();
  if (!vid) return null;
  const col = v.collection || {};
  let rem = formatDuration(v.duration) || 'HD';
  if (col.title) {
    rem += ` ${col.episode_label || ''}`;
  }
  const card = {
    vod_id: vid,
    vod_name: unescapeHtml(v.title || vid),
    vod_pic: v.cover_url || buildPicUrl(vid),
    vod_remarks: rem,
    vod_content: unescapeHtml((v.description || '') || (col.title || '')),
  };
  setCache(VIDEO_META_CACHE, vid, card);
  setCache(PLAY_CACHE, vid, buildPlayUrl(vid));
  return card;
}

function parseCards(j) {
  const videos = j?.data?.videos;
  if (!Array.isArray(videos)) return [];
  const out = [];
  for (const v of videos) {
    const c = formatCard(v);
    if (c) out.push(c);
  }
  return out;
}

function calcPages(j) {
  const total = Number(j?.data?.total) || 0;
  return Math.max(1, Math.ceil(total / PER));
}

// ------------------------------------------------------------- Stream Extraction & Hardening

const DECOY_PATTERNS = [
  /preview\.mp4/i,
  /sample\.mp4/i,
  /trailer\.mp4/i,
  /top_banner/i,
  /native-ad/i,
  /stat\.php/i,
];

function isDecoyMediaUrl(url) {
  const s = String(url || '').trim();
  if (!s) return true;
  return DECOY_PATTERNS.some((re) => re.test(s));
}

function isDirectMediaUrl(url) {
  const s = String(url || '').trim();
  if (!s || !/^https?:\/\//i.test(s)) return false;
  if (isDecoyMediaUrl(s)) return false;
  try {
    const parsed = new URL(s);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(m3u8|mp4|flv|mpd|mkv)(\b|$)/i.test(pathname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function customUnescape(str) {
  return String(str || '')
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function normalizeEscapedText(str) {
  if (!str) return '';
  return unescapeHtml(
    String(str)
      .replace(/\\\//g, '/')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
  );
}

function unwrapNestedMediaUrl(rawUrl, baseOrigin = activeDomain) {
  let current = normalizeEscapedText(rawUrl).trim();
  if (!current) return '';

  for (let pass = 0; pass < 2; pass++) {
    try {
      const resolved = new URL(current, baseOrigin);
      const pathname = resolved.pathname.toLowerCase();
      if (/\.(m3u8|mp4|flv|mpd|mkv)$/i.test(pathname)) {
        return resolved.href;
      }
      const paramKeys = ['url', 'v', 'vid', 'play', 'src', 'file', 'm3u8'];
      let extracted = '';
      for (const key of paramKeys) {
        const val = resolved.searchParams.get(key);
        if (val && (/https?:\/\/|\/|\.m3u8|\.mp4|%2f|%3a/i.test(val))) {
          extracted = val;
          break;
        }
      }
      if (!extracted) {
        const rawMatch = resolved.search.match(
          /[?&](?:url|v|play|src)=([^&]+)/i
        );
        if (rawMatch) extracted = rawMatch[1];
      }
      if (!extracted) break;

      let decoded = extracted;
      for (let i = 0; i < 2; i++) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch {
          const next = customUnescape(decoded);
          if (next === decoded) break;
          decoded = next;
        }
      }
      current = new URL(normalizeEscapedText(decoded), resolved.origin).href;
    } catch {
      break;
    }
  }
  return current;
}

function extractBalancedJsonObject(text, varName) {
  const regex = new RegExp(`${varName}\\s*=\\s*\\{`, 'g');
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const braceStart = match.index + match[0].length - 1;
    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;

    for (let i = braceStart; i < text.length; i++) {
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
          results.push(text.slice(braceStart, i + 1));
          break;
        }
      }
    }
  }
  return results;
}

function decodeCmsPlayerUrl(rawUrl, encryptType) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const enc = Number(encryptType) || 0;
  if (enc === 1) {
    u = customUnescape(u);
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      try {
        u = decodeURIComponent(b64Decoded);
      } catch {
        u = customUnescape(b64Decoded);
      }
    } catch {
      // ignore invalid base64
    }
  }
  return normalizeEscapedText(u).trim();
}

function unpackDeanEdwards(html) {
  const unpackedBlocks = [];
  const packerRegex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let m;
  while ((m = packerRegex.exec(html)) !== null) {
    const payload = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    const radix = parseInt(m[3], 10) || 36;
    const count = parseInt(m[4], 10) || 0;
    const symtab = m[6].split('|');

    const encodeBase = (num, base) => {
      const chars =
        '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) {
        return num < 36
          ? num.toString(36)
          : chars[num] || String.fromCharCode(num + 29);
      }
      return (
        encodeBase(Math.floor(num / base), base) + encodeBase(num % base, base)
      );
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      dict.set(key, symtab[i] || key);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (token) =>
      dict.has(token) ? dict.get(token) : token
    );
    unpackedBlocks.push(unpacked);
  }
  return unpackedBlocks;
}

function extractStreamFromTextBlock(text, baseOrigin = activeDomain) {
  if (!text) return '';

  const playerVars = ['player_aaaa', 'player_data', 'player_config'];
  for (const varName of playerVars) {
    const jsonBlocks = extractBalancedJsonObject(text, varName);
    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (parsed && parsed.url) {
          const decoded = decodeCmsPlayerUrl(parsed.url, parsed.encrypt);
          const unwrapped = unwrapNestedMediaUrl(decoded, baseOrigin);
          if (isDirectMediaUrl(unwrapped)) return unwrapped;
          if (/^https?:\/\//i.test(unwrapped) && !isDecoyMediaUrl(unwrapped)) {
            return unwrapped;
          }
        }
      } catch {
        const urlMatch = block.match(/"url"\s*:\s*"([^"]+)"/);
        const encMatch = block.match(/"encrypt"\s*:\s*(\d+)/);
        if (urlMatch) {
          const decoded = decodeCmsPlayerUrl(
            urlMatch[1],
            encMatch ? encMatch[1] : 0
          );
          const unwrapped = unwrapNestedMediaUrl(decoded, baseOrigin);
          if (isDirectMediaUrl(unwrapped)) return unwrapped;
        }
      }
    }
  }

  const normalized = normalizeEscapedText(text);

  // Check priority stream variables, requiring verified media URLs
  const varRegex =
    /\b(?:playUrl|videoUrl|m3u8Url|hlsUrl|streamUrl|freePlayUrl|normalPlayUrl)\s*[:=]\s*(['"])([^'"]+)\1/gi;
  let vm;
  while ((vm = varRegex.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(vm[2], baseOrigin);
    if (isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  // Match direct http(s) m3u8/mp4 URLs
  const directRegex =
    /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
  let dm;
  while ((dm = directRegex.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(dm[0], baseOrigin);
    if (isDirectMediaUrl(candidate)) {
      return candidate;
    }
  }

  return '';
}

function extractPlayStreamFromHtml(html, baseOrigin = activeDomain) {
  if (!html) return { streamUrl: '', iframeUrls: [] };

  // Stage 1 & 3: Direct player config & normalized regex scan
  const direct = extractStreamFromTextBlock(html, baseOrigin);
  if (direct) {
    return { streamUrl: direct, iframeUrls: [] };
  }

  // Stage 2: Unpack Dean Edwards packed JS blocks and scan
  const unpackedBlocks = unpackDeanEdwards(html);
  for (const block of unpackedBlocks) {
    const fromPacker = extractStreamFromTextBlock(block, baseOrigin);
    if (fromPacker) {
      return { streamUrl: fromPacker, iframeUrls: [] };
    }
  }

  // Stage 4: Collect candidate iframe URLs
  const iframeUrls = [];
  const iframeRegex =
    /<iframe[^>]+(?:src|data-src)\s*=\s*(['"])([^'"]+)\1/gi;
  let im;
  while ((im = iframeRegex.exec(html)) !== null) {
    const rawSrc = normalizeEscapedText(im[2]).trim();
    if (!rawSrc || /^javascript:|about:blank/i.test(rawSrc)) continue;
    try {
      const fullIframe = new URL(rawSrc, baseOrigin).href;
      const unwrapped = unwrapNestedMediaUrl(fullIframe, baseOrigin);
      if (isDirectMediaUrl(unwrapped)) {
        return { streamUrl: unwrapped, iframeUrls: [] };
      }
      iframeUrls.push(fullIframe);
    } catch {
      // ignore invalid iframe src
    }
  }

  return { streamUrl: '', iframeUrls };
}

async function resolvePlayStream(urlOrId, refererOrigin = activeDomain) {
  const raw = String(urlOrId || '').trim();
  if (!raw) return '';

  const cached = getCache(PLAY_CACHE, raw);
  if (cached && isDirectMediaUrl(cached)) {
    return cached;
  }

  // Check if raw is already a direct stream or nested wrapper URL
  if (/^https?:\/\//i.test(raw)) {
    const unwrapped = unwrapNestedMediaUrl(raw, refererOrigin);
    if (isDirectMediaUrl(unwrapped)) {
      setCache(PLAY_CACHE, raw, unwrapped);
      return unwrapped;
    }
  }

  // Bare Zhangyu video_id (e.g., "1gsMDzF8LUFO")
  if (
    /^[A-Za-z0-9_-]{6,32}$/.test(raw) &&
    !raw.startsWith('col_') &&
    !raw.includes('/')
  ) {
    const built = buildPlayUrl(raw);
    setCache(PLAY_CACHE, raw, built);
    return built;
  }

  // Fetch play/detail HTML page and run multi-stage extraction
  const { text: html, url: fetchedUrl, origin } = await fetchText(raw, {
    referer: refererOrigin,
  });

  if (html) {
    const { streamUrl, iframeUrls } = extractPlayStreamFromHtml(html, origin);
    if (streamUrl && isDirectMediaUrl(streamUrl)) {
      setCache(PLAY_CACHE, raw, streamUrl);
      return streamUrl;
    }

    // Follow embedded iframes with parent page as Referer
    for (const iframeUrl of iframeUrls) {
      const unwrappedIframe = unwrapNestedMediaUrl(iframeUrl, origin);
      if (isDirectMediaUrl(unwrappedIframe)) {
        setCache(PLAY_CACHE, raw, unwrappedIframe);
        return unwrappedIframe;
      }
      const { text: iframeHtml, origin: iframeOrigin } = await fetchText(
        iframeUrl,
        {
          referer: fetchedUrl || origin,
          preserveReferer: true,
        }
      );
      if (iframeHtml) {
        const sub = extractPlayStreamFromHtml(iframeHtml, iframeOrigin);
        if (sub.streamUrl && isDirectMediaUrl(sub.streamUrl)) {
          setCache(PLAY_CACHE, raw, sub.streamUrl);
          return sub.streamUrl;
        }
      }
    }

    // Stage 5: Alternate play route discovery (e.g. sid/1/nid/1 -> sid/2/nid/1)
    const altRouteMatch = html.match(
      /href\s*=\s*(['"])([^'"]*\/(?:vodplay|play)\/[^'"]+)\1/gi
    );
    if (altRouteMatch) {
      for (const tag of altRouteMatch) {
        const hm = tag.match(/href\s*=\s*(['"])([^'"]+)\1/i);
        if (!hm) continue;
        const altPath = hm[2];
        if (fetchedUrl && fetchedUrl.endsWith(altPath)) continue;
        const { text: altHtml, origin: altOrigin } = await fetchText(altPath, {
          referer: fetchedUrl || origin,
        });
        if (altHtml) {
          const altRes = extractPlayStreamFromHtml(altHtml, altOrigin);
          if (altRes.streamUrl && isDirectMediaUrl(altRes.streamUrl)) {
            setCache(PLAY_CACHE, raw, altRes.streamUrl);
            return altRes.streamUrl;
          }
        }
      }
    }
  }

  // Check if path matches Zhangyu video detail URL `/<vid>.html`
  const zyMatch = raw.match(/\/([A-Za-z0-9]{8,})\.html(?:$|\?)/);
  if (zyMatch) {
    const fallbackZy = buildPlayUrl(zyMatch[1]);
    setCache(PLAY_CACHE, raw, fallbackZy);
    return fallbackZy;
  }

  return '';
}

function sanitizeEpisodeInput(rawInput) {
  let s = String(rawInput || '').trim();
  if (!s) return '';

  // 1. Strip custom metadata suffix @@@
  if (s.includes('@@@')) {
    s = s.split('@@@')[0].trim();
  }

  // 2. Strip leading episode label prefix (<label>$<url_or_id>)
  const dollarIdx = s.indexOf('$');
  if (dollarIdx !== -1) {
    const prefix = s.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      s = s.slice(dollarIdx + 1).trim();
    }
  }

  // 3. Strip again if nested label or trailing @@@ remains
  if (s.includes('@@@')) {
    s = s.split('@@@')[0].trim();
  }

  return s;
}

// ------------------------------------------------------------- Route Handlers

async function init(inReq) {
  const params = unwrapParams(inReq);
  const ext = params.extend;
  if (ext && typeof ext === 'string') {
    try {
      const cfg = JSON.parse(ext);
      if (cfg?.domain && /^https?:\/\//i.test(cfg.domain)) {
        activeDomain = cfg.domain.replace(/\/+$/, '');
      }
    } catch {
      // ignore non-JSON extend
    }
  }
  return {};
}

async function home() {
  const url = `/api/v1/videos.php?sort=views_day&order=desc&per_page=${PER}&status=ready`;
  const j = await fetchJson(url);
  const list = j ? parseCards(j) : [];
  return {
    class: CATS,
    filters: {},
    list,
    style: STYLE,
  };
}

async function fetchCollectionsList() {
  const j = await fetchJson('/api/v1/collections.php');
  if (!j || !Array.isArray(j.data)) {
    return { page: 1, pagecount: 1, limit: 0, total: 0, list: [], style: STYLE };
  }
  const out = [];
  for (const c of j.data) {
    const cid = c?.id;
    if (cid === undefined || cid === null) continue;
    setCache(COL_META_CACHE, String(cid), c);
    out.push({
      vod_id: `col_${cid}`,
      vod_name: unescapeHtml(c.title || c.slug || String(cid)),
      vod_pic: c.cover_url || buildPicUrl(''),
      vod_remarks: `${c.episode_count ?? 0}集`,
      vod_content: unescapeHtml(c.description || ''),
    });
  }
  return {
    page: 1,
    pagecount: 1,
    limit: out.length,
    total: out.length,
    list: out,
    style: STYLE,
  };
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const tid = String(
    params.id ?? params.tid ?? params.type_id ?? 'all'
  ).trim();
  let pg = parseInt(params.page ?? params.pg ?? 1, 10);
  if (Number.isNaN(pg) || pg < 1) pg = 1;

  if (tid === 'col') {
    return fetchCollectionsList();
  }

  let q = '';
  if (tid === 'all') {
    q = 'sort=upload';
  } else if (tid === 'hot') {
    q = 'sort=views_day';
  } else if (/^\d+$/.test(tid)) {
    q = `sort=upload&category_id=${tid}`;
  } else {
    return { page: pg, pagecount: 1, limit: PER, total: 0, list: [], style: STYLE };
  }

  const url = `/api/v1/videos.php?${q}&order=desc&per_page=${PER}&status=ready&page=${pg}`;
  const j = await fetchJson(url);
  if (!j) {
    return { page: pg, pagecount: 1, limit: PER, total: 0, list: [], style: STYLE };
  }

  return {
    page: pg,
    pagecount: calcPages(j),
    limit: PER,
    total: Number(j?.data?.total) || 0,
    list: parseCards(j),
    style: STYLE,
  };
}

async function fetchTitleAndWarmStream(vid) {
  const pagePath = `/${vid}.html`;
  const { text: html, origin } = await fetchText(pagePath);
  let title = null;
  let streamUrl = '';

  if (html) {
    const mt = html.match(/<title>([^<]*)<\/title>/i);
    if (mt && mt[1]) {
      const cleaned = unescapeHtml(mt[1])
        .replace(/\s*[-|]\s*章鱼Play.*$/i, '')
        .trim();
      if (cleaned) {
        title = cleaned;
      }
    }
    const extracted = extractPlayStreamFromHtml(html, origin);
    if (extracted.streamUrl && isDirectMediaUrl(extracted.streamUrl)) {
      streamUrl = extracted.streamUrl;
    }
  }

  if (!streamUrl) {
    streamUrl = buildPlayUrl(vid);
  }
  setCache(PLAY_CACHE, vid, streamUrl);
  setCache(PLAY_CACHE, pagePath, streamUrl);

  return { title, streamUrl };
}

async function fetchCollectionDetail(cid) {
  const cleanCid = String(cid ?? '').trim();
  const url = `/api/v1/videos.php?collection_id=${encodeURIComponent(
    cleanCid
  )}&sort=upload&order=asc&per_page=100&status=ready`;
  const j = await fetchJson(url);
  if (!j) return { list: [] };

  const eps = [];
  const videos = j?.data?.videos || [];
  for (const v of videos) {
    const vid = String(v?.video_id || '').trim();
    if (!vid) continue;
    const col = v.collection || {};
    const rawLabel = col.episode_label || v.title || vid;
    const cleanLabel = unescapeHtml(String(rawLabel))
      .replace(/[#$]/g, ' ')
      .trim();
    const order = Number(col.episode_order) || 0;
    const playUrl = buildPlayUrl(vid);
    setCache(PLAY_CACHE, vid, playUrl);
    eps.push({ order, label: cleanLabel || vid, url: playUrl });
  }

  eps.sort((a, b) => a.order - b.order);

  let colMeta = getCache(COL_META_CACHE, cleanCid);
  if (!colMeta) {
    const cj = await fetchJson('/api/v1/collections.php');
    if (cj && Array.isArray(cj.data)) {
      for (const c of cj.data) {
        if (c?.id !== undefined && c?.id !== null) {
          setCache(COL_META_CACHE, String(c.id), c);
          if (String(c.id) === cleanCid) {
            colMeta = c;
          }
        }
      }
    }
  }

  const cname = colMeta ? colMeta.title || colMeta.slug : null;
  const title = unescapeHtml(cname || `合集${cleanCid}`);
  const coverPic = (colMeta && colMeta.cover_url) || buildPicUrl('');
  const playUrlStr = eps.map((e) => `${e.label}$${e.url}`).join('#');

  return {
    list: [
      {
        vod_id: `col_${cleanCid}`,
        vod_name: title,
        vod_pic: coverPic,
        type_name: '章鱼Play',
        vod_play_from: '章鱼Play',
        vod_play_url: playUrlStr,
        vod_content: `共${eps.length}集`,
      },
    ],
  };
}

function normalizeDetailId(rawInput) {
  let raw = rawInput;
  if (Array.isArray(raw)) {
    raw = raw[0];
  }
  const s = String(raw ?? '').trim();
  if (!s) return { vid: '', rawPath: '' };

  if (s.startsWith('col_')) {
    return { vid: s, rawPath: '' };
  }

  // If full URL or path ending in /<vid>.html
  const htmlMatch = s.match(/\/([A-Za-z0-9_-]{6,32})\.html(?:$|\?)/i);
  if (htmlMatch && !s.includes('/vodplay/') && !s.includes('/play/')) {
    return { vid: htmlMatch[1], rawPath: s };
  }

  return { vid: s, rawPath: s.startsWith('http') || s.startsWith('/') ? s : '' };
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  const rawId = params.id ?? params.ids ?? params.vod_id ?? params.url ?? '';
  const { vid, rawPath } = normalizeDetailId(rawId);
  if (!vid) {
    return { list: [] };
  }

  if (vid.startsWith('col_')) {
    return fetchCollectionDetail(vid.slice(4));
  }

  // If rawPath is a custom play/detail path (like /vodplay/100-1-1.html)
  if (rawPath && (rawPath.includes('/vodplay/') || rawPath.includes('/play/'))) {
    const resolved = await resolvePlayStream(rawPath, activeDomain);
    const finalPlay = resolved || rawPath;
    setCache(PLAY_CACHE, vid, finalPlay);
    return {
      list: [
        {
          vod_id: vid,
          vod_name: vid,
          vod_pic: buildPicUrl(vid),
          type_name: '章鱼Play',
          vod_play_from: '章鱼Play',
          vod_play_url: `播放$${finalPlay}`,
        },
      ],
    };
  }

  const cachedCard = getCache(VIDEO_META_CACHE, vid);
  const { title, streamUrl } = await fetchTitleAndWarmStream(vid);
  const finalName = title || cachedCard?.vod_name || vid;

  return {
    list: [
      {
        vod_id: vid,
        vod_name: finalName,
        vod_pic: cachedCard?.vod_pic || buildPicUrl(vid),
        vod_remarks: cachedCard?.vod_remarks || '',
        vod_content: cachedCard?.vod_content || '',
        type_name: '章鱼Play',
        vod_play_from: '章鱼Play',
        vod_play_url: `播放$${streamUrl}`,
      },
    ],
  };
}

async function play(inReq) {
  const params = unwrapParams(inReq);
  const rawInput = params.id ?? params.url ?? params.playUrl ?? '';
  const cleaned = sanitizeEpisodeInput(rawInput);
  const playHeaders = {
    'User-Agent': UA,
    Referer: `${activeDomain}/`,
  };

  if (!cleaned) {
    return {
      parse: 1,
      jx: 0,
      url: `${activeDomain}/`,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const resolved = await resolvePlayStream(cleaned, activeDomain);
  if (resolved && isDirectMediaUrl(resolved)) {
    return {
      parse: 0,
      jx: 0,
      url: resolved,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  if (/^https?:\/\//i.test(cleaned)) {
    const unwrapped = unwrapNestedMediaUrl(cleaned, activeDomain);
    if (isDirectMediaUrl(unwrapped)) {
      return {
        parse: 0,
        jx: 0,
        url: unwrapped,
        header: playHeaders,
        headers: playHeaders,
      };
    }
  }

  // Fallback to client sniffing if not a direct media stream
  const fallbackUrl = /^https?:\/\//i.test(cleaned)
    ? cleaned
    : cleaned.startsWith('/')
    ? `${activeDomain}${cleaned}`
    : `${activeDomain}/`;

  return {
    parse: 1,
    jx: 0,
    url: fallbackUrl,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const key = String(
    params.wd ?? params.key ?? params.keyword ?? params.q ?? ''
  ).trim();
  let pg = parseInt(params.page ?? params.pg ?? 1, 10);
  if (Number.isNaN(pg) || pg < 1) pg = 1;

  if (!key) {
    return { page: pg, pagecount: 1, list: [], style: STYLE };
  }

  const searchPath =
    pg > 1
      ? `/search.html?q=${encodeURIComponent(key)}&page=${pg}`
      : `/search.html?q=${encodeURIComponent(key)}`;
  const { text: html } = await fetchText(searchPath);
  if (!html) {
    return { page: pg, pagecount: 1, list: [], style: STYLE };
  }

  const out = [];
  const seen = new Set();

  // Primary pattern from 章鱼.py plus flexible attribute order support
  const anchorRegex = /<a\b[^>]*class=["'][^"']*\brec-card\b[^"']*["'][^>]*>/gi;
  let am;
  while ((am = anchorRegex.exec(html)) !== null) {
    const tag = am[0];
    const hrefMatch = tag.match(/href=["']\/([A-Za-z0-9]{8,})\.html["']/i);
    if (!hrefMatch) continue;
    const vid = hrefMatch[1];
    if (seen.has(vid)) continue;
    seen.add(vid);

    const titleMatch = tag.match(/title=["']([^"']*)["']/i);
    const name = titleMatch ? unescapeHtml(titleMatch[1]) : vid;
    const card = {
      vod_id: vid,
      vod_name: name || vid,
      vod_pic: buildPicUrl(vid),
      vod_remarks: 'HD',
      vod_content: '',
    };
    setCache(VIDEO_META_CACHE, vid, card);
    setCache(PLAY_CACHE, vid, buildPlayUrl(vid));
    out.push(card);
  }

  return {
    page: pg,
    pagecount: 1,
    list: out,
    style: STYLE,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = String(query.url || query.pic || '').trim();
  if (!picUrl || !/^https?:\/\//i.test(picUrl)) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
  try {
    const res = await req.get(picUrl, {
      headers: buildHeaders(activeDomain),
      timeout: TIMEOUT,
      responseType: 'arraybuffer',
    });
    const raw = res?.data ?? res?.body ?? Buffer.alloc(0);
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const mime =
      res?.headers?.['content-type'] ||
      (picUrl.endsWith('.png') ? 'image/png' : 'image/jpeg');
    return { mime, data: buf };
  } catch {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'zhangyu',
    name: '章鱼Play',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/zhangyu_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};