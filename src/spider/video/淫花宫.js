import req from '../../util/req.js'

const SITE_URL = 'https://breplc.yhg5.help'
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CLASSES = [
    { type_name: '熟母少妇', type_id: '20' },
    { type_name: '网红直播', type_id: '21' },
    { type_name: '自拍偷拍', type_id: '22' },
    { type_name: '强奸乱伦', type_id: '23' },
    { type_name: '高清国产', type_id: '24' },
    { type_name: '韩国专区', type_id: '25' },
    { type_name: '日本有码', type_id: '26' },
    { type_name: '日本无码', type_id: '27' },
    { type_name: '欧美情色', type_id: '28' },
    { type_name: '动漫卡通', type_id: '29' },
    { type_name: '三级伦理', type_id: '30' },
]

async function fetchHtml(url) {
    try {
        const resp = await req.get(url, {
            headers: {
                'User-Agent': UA,
            },
            timeout: 15000,
            responseType: 'text',
            validateStatus: () => true,
        })
        return typeof resp.data === 'string' ? resp.data : String(resp.data || '')
    } catch {
        return ''
    }
}

function parseCards(html, limit = 0) {
    const linkMatches = []
    const linkRegex = /<a[^>]*href="\/(\d+\.html)"[^>]*title="([^"]*)"/gis
    let lm
    while ((lm = linkRegex.exec(html)) !== null) {
        linkMatches.push({ url: lm[1], title: lm[2] })
    }

    const imgMatches = []
    const imgRegex = /<img[^>]*(?:data-original|src)="([^"]*)"/gis
    let im
    while ((im = imgRegex.exec(html)) !== null) {
        imgMatches.push(im[1])
    }

    const videos = []
    const total = limit > 0 ? Math.min(linkMatches.length, limit) : linkMatches.length

    for (let i = 0; i < total; i++) {
        const item = linkMatches[i]
        const vidM = item.url.match(/(\d+)\.html/)
        if (vidM) {
            videos.push({
                vod_id: vidM[1],
                vod_name: item.title,
                vod_pic: imgMatches[i] || '',
                vod_remarks: '',
            })
        }
    }
    return videos
}

async function home() {
    const html = await fetchHtml(`${SITE_URL}/cn/home/web/`)
    const list = parseCards(html, 20)
    return {
        class: CLASSES,
        filters: {},
        list,
    }
}

async function category(inReq) {
    const tid = String(inReq.body?.id || '20')
    let pg = parseInt(inReq.body?.page, 10) || 1
    if (pg < 1) pg = 1

    const url = pg > 1 ? `${SITE_URL}/vodtype/${tid}/page/${pg}.html` : `${SITE_URL}/vodtype/${tid}.html`
    const html = await fetchHtml(url)
    const list = parseCards(html)

    return {
        page: pg,
        pagecount: 100,
        limit: 30,
        total: 3000,
        list,
    }
}

async function detail(inReq) {
    const vid = String(inReq.body?.id || '').trim()
    if (!vid) return { list: [] }

    const url = `${SITE_URL}/${vid}.html`
    const html = await fetchHtml(url)

    const titleMatch = html.match(/<title>([^<]*)<\/title>/i)
    let title = titleMatch ? titleMatch[1].split('_')[0].trim() : ''

    const m3u8Match = html.match(/['"]([^'"]*\.m3u8[^'"]*)['"]/)
    const m3u8Url = m3u8Match ? m3u8Match[1].replace(/\\\//g, '/') : ''

    return {
        list: [
            {
                vod_id: vid,
                vod_name: title,
                vod_pic: '',
                vod_year: '',
                vod_area: '',
                vod_remarks: '',
                vod_content: '',
                vod_play_from: '直链',
                vod_play_url: m3u8Url,
            },
        ],
    }
}

async function search(inReq) {
    const kw = String(inReq.body?.wd || '').trim()
    if (!kw) return { page: 1, pagecount: 1, limit: 30, total: 0, list: [] }

    const url = `${SITE_URL}/s/${encodeURIComponent(kw)}.html`
    const html = await fetchHtml(url)

    const videos = []
    const itemRegex =
        /<a[^>]*href="\/(\d+\.html)"[^>]*title="([^"]*)"[^>]*>.*?<img[^>]*(?:data-original|src)="([^"]*)"/gis
    let im
    while ((im = itemRegex.exec(html)) !== null) {
        const vid = im[1].replace('.html', '')
        videos.push({
            vod_id: vid,
            vod_name: im[2],
            vod_pic: im[3],
            vod_remarks: '',
        })
    }

    return {
        page: 1,
        pagecount: 1,
        limit: 30,
        total: videos.length,
        list: videos,
    }
}

async function play(inReq) {
    const id = String(inReq.body?.id || '').trim()
    return {
        parse: 0,
        jx: 0,
        url: id,
        header: {
            'User-Agent': UA,
            Referer: SITE_URL + '/',
        },
    }
}

export default {
    meta: { key: 'yin_hua_gong', name: '淫花宫', type: 3 },
    api: async (fastify) => {
        fastify.post('/init', async () => ({}))
        fastify.post('/home', home)
        fastify.post('/category', category)
        fastify.post('/detail', detail)
        fastify.post('/play', play)
        fastify.post('/search', search)
    },
}