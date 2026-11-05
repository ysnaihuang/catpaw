import req from '../../util/req.js'

const DEFAULT_HOSTS = ['https://app-1.pornavav.shop']
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const DB_KEY = '/pornav'

const BRAND_NAME = '🦋 蝴蝶影视'
const BRAND_ACTOR = '🦋 TG群: @tvshare23'
const BRAND_DIRECTOR = '🦋 蝴蝶影视'

let _db = null
let _hosts = DEFAULT_HOSTS.slice()
let _baseHost = _hosts[0]
let _hostIdx = 0

// ===================== 工具 =====================
function trim(s) {
  return s == null ? '' : String(s).replace(/^\s+|\s+$/g, '')
}

function cleanHtmlText(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\r\n\t\s]+/g, ' ')
    .trim()
}

function formatRemarks(brand = BRAND_NAME, meta = '') {
  const cleanMeta = trim(meta).replace(/[\r\n\t]+/g, ' ').trim()
  return cleanMeta ? `${brand} · ${cleanMeta}` : brand
}

function isVideoFormat(url) {
  const low = String(url || '').toLowerCase()
  const badList = ['preview.mp4', 'sample.mp4', 'trailer.mp4', 'top_banner', 'adc', 'stat.php']
  if (badList.some((bad) => low.includes(bad))) return false
  const exts = ['.m3u8', '.mp4', '.flv', '.mkv', '.avi', '.ts', '.mpd', 'index.png']
  return exts.some((k) => low.includes(k))
}

function cleanM3u8Url(rawStr) {
  if (!rawStr) return ''
  const m = String(rawStr).match(
    /(https?:\/\/(?:(?!localhost|127\.0\.0\.1)[^\s"'$<>])+\.m3u8[^\s"'$<>]*)/i
  )
  if (m) {
    return m[1].replace(/\\u002F/gi, '/').replace(/\\\//g, '/')
  }
  return ''
}

function clientBaseOf(inReq) {
  try {
    const proto = inReq.headers?.['x-forwarded-proto'] || 'http'
    const host =
      inReq.headers?.host || `127.0.0.1:${inReq.server?.server?.address?.()?.port || 9988}`
    return `${proto}://${host}`
  } catch {
    return 'http://127.0.0.1:9988'
  }
}

function imageUrl(inReq, pic) {
  const params = new URLSearchParams({
    url: pic,
    cache: '86400',
    customHeaders: JSON.stringify({ Referer: _baseHost + '/', 'User-Agent': UA }),
  })
  return `${clientBaseOf(inReq)}/imageProxy?${params}`
}

function formatPoster(inReq, rawUrl) {
  if (!rawUrl) return ''
  let pic = trim(rawUrl)
  if (pic.startsWith('//')) pic = 'https:' + pic
  else if (pic.startsWith('/')) pic = _baseHost + pic
  return imageUrl(inReq, pic)
}

async function loadCachedHost() {
  if (!_db) return
  try {
    const stored = await _db.getData(DB_KEY)
    const cached = stored && typeof stored.liveHost === 'string' ? stored.liveHost : ''
    if (cached.startsWith('http')) {
      if (!_hosts.includes(cached)) _hosts.unshift(cached)
      _baseHost = _hosts[0]
      _hostIdx = 0
    }
  } catch {
    /* ignore */
  }
}

function htmlHeaders(host, referer = '') {
  return {
    'User-Agent': UA,
    Referer: referer || host + '/',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Connection: 'keep-alive',
  }
}

async function fetchHtml(targetUrl, referer = '', timeout = 12000) {
  if (!targetUrl) return ''
  const n = _hosts.length
  for (let i = 0; i < n; i++) {
    const idx = (_hostIdx + i) % n
    const curHost = _hosts[idx]
    let url = String(targetUrl)
    if (url.startsWith('//')) {
      url = 'https:' + url
    } else if (url.startsWith('/')) {
      url = curHost + url
    } else if (!/^https?:\/\//i.test(url)) {
      url = curHost + '/' + url.replace(/^\/+/, '')
    }
    const headers = htmlHeaders(curHost, referer)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await req.get(url, {
          headers,
          timeout,
          validateStatus: () => true,
        })
        if (resp.status < 200 || resp.status >= 400) {
          throw new Error('HTTP ' + resp.status)
        }
        const text = typeof resp.data === 'string' ? resp.data : String(resp.data || '')
        if (text) {
          _hostIdx = idx
          _baseHost = curHost
          return text
        }
      } catch {
        /* 換 host / 重試 */
      }
    }
  }
  return ''
}

// ===================== 列表解析 =====================
const BAD_HREF_KEYWORDS = [
  'fenlei=',
  'categories=',
  'tags-ch',
  'share',
  'logins',
  'history',
  'liked',
  'collect',
  'watchlater',
  'logout',
]

function parseCardsFromHtml(inReq, htmlText) {
  const rawHtml = String(htmlText || '')
  const cleanHtml = rawHtml.replace(
    /<(?:nav|header|footer)[^>]*>[\s\S]*?<\/(?:nav|header|footer)>/gi,
    ''
  )

  const cardRegex =
    /(<a[^>]+href=["']([^"']*(?:\.html|\?play=|\/v\/|\/view\/)[^"']*)["'][^>]*>[\s\S]*?<\/a>)/gi
  const list = []
  let match
  while ((match = cardRegex.exec(cleanHtml)) !== null) {
    const block = match[1]
    const href = match[2]

    if (BAD_HREF_KEYWORDS.some((bad) => href.includes(bad))) continue

    const imgM = block.match(
      /(?:src|data-src|data-original|data-thumb)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i
    )
    if (!imgM) continue

    const pic = formatPoster(inReq, imgM[1])

    let titleM = block.match(/title=["']([^"']+)["']/i)
    if (!titleM) titleM = block.match(/<img[^>]+alt=["']([^"']+)["']/i)
    let title = titleM ? cleanHtmlText(titleM[1]) : ''
    if (!title) {
      const textClean = trim(block.replace(/<[^>]+>/g, ''))
      title = cleanHtmlText(textClean.split(/\r?\n/)[0])
    }

    const metaM = block.match(
      /class=["'][^"']*(?:duration|time|score|hd|views)[^"']*["'][^>]*>([\s\S]*?)</i
    )
    const metaVal = metaM ? cleanHtmlText(metaM[1]) : ''

    list.push({
      vod_id: href,
      vod_name: title || '未命名视频',
      vod_pic: pic,
      vod_remarks: formatRemarks(BRAND_NAME, metaVal),
      style: { type: 'rect', ratio: 1.78 },
    })
  }

  let maxPage = 1
  const pageRegex = /video=(\d+)\.html/gi
  let pMatch
  while ((pMatch = pageRegex.exec(rawHtml)) !== null) {
    const num = parseInt(pMatch[1], 10)
    if (Number.isFinite(num) && num > maxPage) maxPage = num
  }

  return { list, maxPage }
}

// ===================== 分類 / 篩選（/home） =====================
const CATEGORIES = [
  '精品推荐',
  '国产精品',
  '主播秀色',
  '日本有码',
  '日本无码',
  '中文字幕',
  '童颜巨乳',
  '性感人妻',
  '强奸乱伦',
  '欧美情色',
  '三级伦理',
  '卡通动漫',
  '丝袜OL',
  '自拍偷拍',
  '日本片商',
  '剧情介绍',
  '网曝系列',
  '麻豆传媒',
  '明星换脸',
  '国产乱伦',
  '国产丝袜',
  '国产SM',
  '国产人妻',
  '探花嫖娼',
  '同性恋',
]

const SORT_VALUES = [
  { n: '最新视频', v: '' },
  { n: '最新点播', v: 'db' },
  { n: '最多点击', v: 'h' },
  { n: '最多弹幕', v: 'd' },
  { n: '最新弹幕', v: 'dt' },
  { n: '最多评论', v: 'p' },
  { n: '最新评论', v: 'pt' },
  { n: '最多收藏', v: 's' },
  { n: '最新收藏', v: 'st' },
  { n: '最多点赞', v: 'z' },
  { n: '最新点赞', v: 'zt' },
]

const CLASSES = CATEGORIES.map((cName) => ({
  type_id: cName,
  type_name: cName,
}))

const HOME_FILTERS = Object.fromEntries(
  CATEGORIES.map((cName) => [
    cName,
    [
      {
        key: 'rq',
        name: '排序',
        init: '',
        value: SORT_VALUES,
      },
    ],
  ])
)

async function home(inReq) {
  let list = []
  try {
    const r = await categoryCore(inReq, CATEGORIES[0], 1, {})
    list = r.list || []
  } catch (e) {
    console.error('[pornav] home list error:', e.message)
  }
  return { class: CLASSES, filters: HOME_FILTERS, list }
}

// ===================== /category =====================
async function categoryCore(inReq, tid, page, filters) {
  let pg = Number(page) || 1
  if (pg <= 0) pg = 1
  const flt = filters || {}

  const slug = trim(tid).replace(/^\/+|\/+$/g, '')
  const rqVal = trim(flt.rq)
  const targetCategory = CATEGORIES.includes(slug) ? slug : '精品推荐'
  const encodedFenlei = encodeURIComponent(targetCategory)

  let reqPath =
    pg > 1 ? `/?fenlei=${encodedFenlei}&video=${pg}.html` : `/?fenlei=${encodedFenlei}`
  if (rqVal) {
    reqPath += `&rq=${encodeURIComponent(rqVal)}`
  }

  const htmlText = await fetchHtml(_baseHost + reqPath)
  const { list, maxPage } = parseCardsFromHtml(inReq, htmlText)
  const pagecount = maxPage > 0 ? maxPage : 1

  return {
    page: pg,
    pagecount,
    limit: 20,
    total: pagecount * 20,
    list,
  }
}

async function category(inReq) {
  const tid = String(inReq.body?.id || '')
  try {
    return await categoryCore(inReq, tid, inReq.body?.page, inReq.body?.filters || {})
  } catch (e) {
    console.error('[pornav] category error:', e.message)
    const pg = Number(inReq.body?.page) || 1
    return { page: pg, pagecount: pg, list: [] }
  }
}

// ===================== /detail =====================
async function detail(inReq) {
  const rawInput = inReq.body?.id
  const rawId = trim(Array.isArray(rawInput) ? rawInput[0] : rawInput)
  if (!rawId) return { list: [] }

  let detailPath = rawId
  if (!/^https?:\/\//i.test(detailPath)) {
    detailPath = _baseHost + '/' + detailPath.replace(/^\/+/, '')
  }

  try {
    const detailHtml = await fetchHtml(detailPath)

    const titleM = detailHtml.match(/<title>([\s\S]*?)<\/title>/i)
    const rawTitle = titleM ? cleanHtmlText(titleM[1].split('-')[0]) : '正片'

    const descM = detailHtml.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
    )
    const rawDesc = descM ? cleanHtmlText(descM[1]) : ''
    const vodContent = rawDesc
      ? `🦋 蝴蝶影视专线直连 | ${rawDesc} | 官方交流群: @tvshare23`
      : '🦋 蝴蝶影视专线加速播放 | 官方TG交流群：@tvshare23 | 4K高清原生极速画质'

    let finalPlayUrl = ''
    const m3u8Matches = [...detailHtml.matchAll(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi)].map(
      (m) => m[1]
    )
    if (m3u8Matches.length) {
      const cleaned = cleanM3u8Url(m3u8Matches[0])
      finalPlayUrl = cleaned || m3u8Matches[0]
    } else {
      const mp4Matches = [...detailHtml.matchAll(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi)].map(
        (m) => m[1]
      )
      if (mp4Matches.length) {
        finalPlayUrl = mp4Matches[0]
      } else {
        const playVars = [
          ...detailHtml.matchAll(
            /(?:var|let|const)?\s*(?:url|videoUrl|playUrl|m3u8|src|file)\s*=\s*["']([^"']+)["']/gi
          ),
        ].map((m) => m[1])
        for (const cand of playVars) {
          const low = cand.toLowerCase()
          if ((low.includes('.m3u8') || low.includes('.mp4')) && isVideoFormat(cand)) {
            finalPlayUrl = cleanM3u8Url(cand) || cand
            break
          }
        }
      }
    }

    const playUrlEntry = `超清正片$${finalPlayUrl || detailPath}`

    return {
      list: [
        {
          vod_id: rawId,
          vod_name: rawTitle || '正片',
          vod_pic: '',
          vod_actor: BRAND_ACTOR,
          vod_director: BRAND_DIRECTOR,
          vod_remarks: formatRemarks(BRAND_NAME, '超清'),
          vod_content: vodContent,
          vod_play_from: '蝴蝶专线',
          vod_play_url: playUrlEntry,
        },
      ],
    }
  } catch (e) {
    console.error('[pornav] detail error:', e.message)
    return { list: [] }
  }
}

// ===================== /play =====================
async function play(inReq) {
  const id = trim(inReq.body?.id)
  const headers = {
    'User-Agent': UA,
    Referer: _baseHost + '/',
  }
  if (!id) return { parse: 0, url: '', header: headers }
  const low = id.toLowerCase()
  const isDirect = low.includes('.m3u8') || low.includes('.mp4')
  return {
    parse: isDirect ? 0 : 1,
    playUrl: '',
    url: id,
    header: headers,
  }
}

// ===================== /search =====================
async function search(inReq) {
  let pg = Number(inReq.body?.page) || 1
  if (pg <= 0) pg = 1
  const kw = trim(inReq.body?.wd)
  if (!kw) return { page: pg, pagecount: pg, list: [] }

  try {
    const cleanKey = encodeURIComponent(kw)
    const reqPath = pg > 1 ? `/?wd=${cleanKey}&video=${pg}.html` : `/?wd=${cleanKey}`
    const htmlText = await fetchHtml(_baseHost + reqPath)
    const { list, maxPage } = parseCardsFromHtml(inReq, htmlText)
    const pagecount = maxPage > 0 ? maxPage : 1

    return {
      page: pg,
      pagecount,
      limit: 20,
      total: pagecount * 20,
      list,
    }
  } catch (e) {
    console.error('[pornav] search error:', e.message)
    return { page: pg, pagecount: pg, list: [] }
  }
}

function initPornav(db) {
  _db = db || null
  _hosts = DEFAULT_HOSTS.slice()
  _hostIdx = 0
  _baseHost = _hosts[0]
  loadCachedHost().catch(() => {})
}

export default {
  meta: { key: 'pornav', name: '蝴蝶影视', type: 3 },
  api: async (fastify, { db } = {}) => {
    initPornav(db)
    fastify.post('/init', async () => ({}))
    fastify.post('/home', home)
    fastify.post('/category', category)
    fastify.post('/detail', detail)
    fastify.post('/play', play)
    fastify.post('/search', search)
  },
}