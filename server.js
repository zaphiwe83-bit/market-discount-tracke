const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const WATCHLIST_FILE = path.join(ROOT, 'watchlist.json');
const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || '';

const MARKET_MAP = [
  {
    symbol: 'SPX500',
    stooq: '^spx',
    twelvedata: 'GSPC:INDX',
    market: 'US',
    name: 'S&P 500 Index',
    region: 'United States'
  },
  {
    symbol: 'US30',
    stooq: '^dji',
    twelvedata: 'DJI:INDX',
    market: 'US',
    name: 'Dow Jones 30 Index',
    region: 'United States'
  },
  {
    symbol: 'UK100',
    stooq: '^ukx',
    twelvedata: 'FTSE:INDX',
    market: 'UK',
    name: 'FTSE 100 Index',
    region: 'United Kingdom'
  },
  {
    symbol: 'GER40',
    stooq: '^dax',
    twelvedata: 'DAX:INDX',
    market: 'EU',
    name: 'DAX 40 Index',
    region: 'Germany'
  },
  {
    symbol: 'NAS100',
    stooq: '^ndq',
    twelvedata: 'NDX:INDX',
    market: 'US',
    name: 'Nasdaq 100 Index',
    region: 'United States'
  },
  {
    symbol: 'STRAIX',
    stooq: null,
    twelvedata: null,
    market: 'Global',
    name: 'Custom Strategy Basket',
    region: 'Multi-region'
  }
];

const DEFAULT_COMPANY_WATCHLIST = [
  'Amazon',
  'Apple',
  'Nike',
  'Walmart',
  'Target',
  'Best Buy',
  'Samsung',
  'Adidas',
  'Booking.com',
  'Expedia'
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function uniqueList(values) {
  return [...new Set(values)];
}

function sanitizeCompany(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function loadWatchlist() {
  try {
    if (!fs.existsSync(WATCHLIST_FILE)) {
      fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(DEFAULT_COMPANY_WATCHLIST, null, 2));
      return [...DEFAULT_COMPANY_WATCHLIST];
    }

    const parsed = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid watchlist format');
    }

    const cleaned = uniqueList(parsed.map(sanitizeCompany).filter(Boolean));
    if (!cleaned.length) {
      return [...DEFAULT_COMPANY_WATCHLIST];
    }

    return cleaned;
  } catch (_error) {
    return [...DEFAULT_COMPANY_WATCHLIST];
  }
}

function saveWatchlist(list) {
  const cleaned = uniqueList(list.map(sanitizeCompany).filter(Boolean));
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(cleaned, null, 2));
  return cleaned;
}

let companyWatchlist = loadWatchlist();

function parseStooqCsvRow(line) {
  const values = line.trim().split(',');
  if (values.length < 9) {
    return null;
  }

  return {
    symbol: values[0],
    date: values[1],
    time: values[2],
    open: Number(values[3]),
    high: Number(values[4]),
    low: Number(values[5]),
    close: Number(values[6]),
    volume: Number(values[7])
  };
}

function parseGoogleNewsItems(xml) {
  const items = [];
  const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const block of matches) {
    const title = decodeXml((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decodeXml((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const pubDate = decodeXml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '');
    const source = decodeXml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');

    if (!title || !link) {
      continue;
    }

    items.push({ title, link, pubDate, source });
  }

  return items;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractDiscountFromTitle(title) {
  const percent = title.match(/(\d{1,2})%\s*off/i);
  if (percent) {
    return `${percent[1]}% off`;
  }

  const money = title.match(/\$(\d{1,4})\s*off/i);
  if (money) {
    return `$${money[1]} off`;
  }

  const upTo = title.match(/save\s+up\s+to\s+(\d{1,2})%/i);
  if (upTo) {
    return `Up to ${upTo[1]}% off`;
  }

  return 'Deal live';
}

function makeCodeFromTitle(title) {
  const explicitCode = title.match(/(?:code|coupon)\s*[:\-]?\s*([A-Z0-9]{4,12})/i);
  if (explicitCode) {
    return explicitCode[1].toUpperCase();
  }

  return 'CHECK-LINK';
}

function emptyMarketItem(item, status, provider) {
  return {
    symbol: item.symbol,
    market: item.market,
    name: item.name,
    region: item.region,
    status,
    provider,
    price: null,
    changePct: null,
    updated: new Date().toISOString()
  };
}

async function fetchMarketsFromStooq() {
  const tracked = MARKET_MAP.filter((item) => item.stooq);
  const responses = await Promise.allSettled(
    tracked.map(async (item) => {
      const url = `https://stooq.com/q/l/?s=${item.stooq}&i=d`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'market-discount-tracker/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Stooq request failed: ${response.status}`);
      }

      const line = (await response.text()).trim();
      return parseStooqCsvRow(line);
    })
  );

  const rows = responses
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter(Boolean);

  const byStooq = new Map(rows.map((row) => [row.symbol.toLowerCase(), row]));

  return MARKET_MAP.map((item) => {
    if (!item.stooq) {
      return emptyMarketItem(item, 'Monitoring', 'Custom');
    }

    const key = item.stooq.toLowerCase();
    const row = byStooq.get(key);

    if (!row || Number.isNaN(row.close) || Number.isNaN(row.open)) {
      return emptyMarketItem(item, 'Unavailable', 'Stooq');
    }

    const changePct = row.open === 0 ? 0 : ((row.close - row.open) / row.open) * 100;

    return {
      symbol: item.symbol,
      market: item.market,
      name: item.name,
      region: item.region,
      status: 'Live',
      provider: 'Stooq',
      price: row.close,
      changePct: Number(changePct.toFixed(2)),
      updated: `${row.date} ${row.time} UTC`
    };
  });
}

async function fetchMarketsFromTwelveData() {
  if (!TWELVEDATA_API_KEY) {
    return null;
  }

  const tracked = MARKET_MAP.filter((item) => item.twelvedata);
  const responses = await Promise.allSettled(
    tracked.map(async (item) => {
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(item.twelvedata)}&apikey=${encodeURIComponent(TWELVEDATA_API_KEY)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'market-discount-tracker/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`TwelveData request failed: ${response.status}`);
      }

      const payload = await response.json();
      if (payload.status === 'error' || payload.code >= 400 || !payload.close) {
        throw new Error(payload.message || 'Invalid TwelveData response');
      }

      return {
        symbol: item.symbol,
        market: item.market,
        name: item.name,
        region: item.region,
        status: 'Live',
        provider: 'TwelveData',
        price: Number(payload.close),
        changePct: Number(payload.percent_change || 0),
        updated: payload.datetime || new Date().toISOString()
      };
    })
  );

  const bySymbol = new Map(
    responses
      .filter((result) => result.status === 'fulfilled')
      .map((result) => [result.value.symbol, result.value])
  );

  if (!bySymbol.size) {
    return null;
  }

  return MARKET_MAP.map((item) => {
    if (item.symbol === 'STRAIX') {
      return emptyMarketItem(item, 'Monitoring', 'Custom');
    }

    const found = bySymbol.get(item.symbol);
    if (found) {
      return found;
    }

    return emptyMarketItem(item, 'Unavailable', 'TwelveData');
  });
}

async function fetchLiveMarkets() {
  const brokerData = await fetchMarketsFromTwelveData();
  if (brokerData) {
    const fallback = await fetchMarketsFromStooq();
    const fallbackBySymbol = new Map(fallback.map((item) => [item.symbol, item]));

    return brokerData.map((item) => {
      if (item.status !== 'Unavailable') {
        return item;
      }

      const fallbackItem = fallbackBySymbol.get(item.symbol);
      return fallbackItem || item;
    });
  }

  return fetchMarketsFromStooq();
}

async function fetchCompanyCoupons(company) {
  const query = encodeURIComponent(`${company} coupon code OR promo code OR discount`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'market-discount-tracker/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Google News RSS failed for ${company}: ${response.status}`);
  }

  const xml = await response.text();
  const items = parseGoogleNewsItems(xml).slice(0, 3);

  return items.map((item) => ({
    company,
    category: 'Live Feed',
    code: makeCodeFromTitle(item.title),
    discount: extractDiscountFromTitle(item.title),
    expires: 'Check source',
    tags: ['live', 'news', 'coupon'],
    source: item.source || 'Google News',
    title: item.title,
    url: item.link,
    publishedAt: item.pubDate
  }));
}

async function fetchLiveCodes() {
  const results = await Promise.allSettled(companyWatchlist.map(fetchCompanyCoupons));
  const list = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      list.push(...result.value);
    }
  }

  if (list.length) {
    return list;
  }

  return [
    {
      company: 'Amazon',
      category: 'Fallback',
      code: 'CHECK-LINK',
      discount: 'Live source temporarily unavailable',
      expires: 'Check source',
      tags: ['fallback'],
      source: 'Local fallback',
      title: 'No live feed currently available',
      url: '',
      publishedAt: new Date().toUTCString()
    }
  ];
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_error) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', () => {
      reject(new Error('Request stream error'));
    });
  });
}

async function handleApi(req, res, pathname) {
  try {
    if (pathname === '/api/markets' && req.method === 'GET') {
      const data = await fetchLiveMarkets();
      return sendJson(res, 200, { updatedAt: new Date().toISOString(), data });
    }

    if (pathname === '/api/codes' && req.method === 'GET') {
      const data = await fetchLiveCodes();
      return sendJson(res, 200, { updatedAt: new Date().toISOString(), data });
    }

    if (pathname === '/api/watchlist' && req.method === 'GET') {
      return sendJson(res, 200, { data: companyWatchlist });
    }

    if (pathname === '/api/watchlist' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const company = sanitizeCompany(body.company);

      if (!company) {
        return sendJson(res, 400, { error: 'Company is required' });
      }

      const exists = companyWatchlist.some((item) => item.toLowerCase() === company.toLowerCase());
      if (!exists) {
        companyWatchlist = saveWatchlist([...companyWatchlist, company]);
      }

      return sendJson(res, 200, { data: companyWatchlist });
    }

    if (pathname === '/api/watchlist' && req.method === 'DELETE') {
      const body = await readJsonBody(req);
      const company = sanitizeCompany(body.company);

      if (!company) {
        return sendJson(res, 400, { error: 'Company is required' });
      }

      companyWatchlist = saveWatchlist(
        companyWatchlist.filter((item) => item.toLowerCase() !== company.toLowerCase())
      );
      return sendJson(res, 200, { data: companyWatchlist });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Unexpected server error' });
  }
}

function serveStatic(req, res, pathname) {
  const localPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(localPath).replace(/^\.\.(\/|\\|$)+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    };

    if (pathname === '/sw.js') {
      headers['Cache-Control'] = 'no-cache';
    }

    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  const provider = TWELVEDATA_API_KEY ? 'TwelveData + Stooq fallback' : 'Stooq';
  console.log(`Tracker app running at http://localhost:${PORT} (market provider: ${provider})`);
});


