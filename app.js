Const http = require(‘http’);
Const fs = require(‘fs’);
Const path = require(‘path’);
Const { URL } = require(‘url’);

Const PORT = process.env.PORT || 8080;
Const ROOT = __dirname;
Const WATCHLIST_FILE = path.join(ROOT, ‘watchlist.json’);
Const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || ‘’;

Const MARKET_MAP = [
  {
    Symbol: ‘SPX500’,
    Stooq: ‘^spx’,
    Twelvedata: ‘GSPC:INDX’,
    Market: ‘US’,
    Name: ‘S&P 500 Index’,
    Region: ‘United States’
  },
  {
    Symbol: ‘US30’,
    Stooq: ‘^dji’,
    Twelvedata: ‘DJI:INDX’,
    Market: ‘US’,
    Name: ‘Dow Jones 30 Index’,
    Region: ‘United States’
  },
  {
    Symbol: ‘UK100’,
    Stooq: ‘^ukx’,
    Twelvedata: ‘FTSE:INDX’,
    Market: ‘UK’,
    Name: ‘FTSE 100 Index’,
    Region: ‘United Kingdom’
  },
  {
    Symbol: ‘GER40’,
    Stooq: ‘^dax’,
    Twelvedata: ‘DAX:INDX’,
    Market: ‘EU’,
    Name: ‘DAX 40 Index’,
    Region: ‘Germany’
  },
  {
    Symbol: ‘NAS100’,
    Stooq: ‘^ndq’,
    Twelvedata: ‘NDX:INDX’,
    Market: ‘US’,
    Name: ‘Nasdaq 100 Index’,
    Region: ‘United States’
  },
  {
    Symbol: ‘STRAIX’,
    Stooq: null,
    Twelvedata: null,
    Market: ‘Global’,
    Name: ‘Custom Strategy Basket’,
    Region: ‘Multi-region’
  }
];

Const DEFAULT_COMPANY_WATCHLIST = [
  ‘Amazon’,
  ‘Apple’,
  ‘Nike’,
  ‘Walmart’,
  ‘Target’,
  ‘Best Buy’,
  ‘Samsung’,
  ‘Adidas’,
  ‘Booking.com’,
  ‘Expedia’
];

Const MIME_TYPES = {
  ‘.html’: ‘text/html; charset=utf-8’,
  ‘.css’: ‘text/css; charset=utf-8’,
  ‘.js’: ‘application/javascript; charset=utf-8’,
  ‘.json’: ‘application/json; charset=utf-8’,
  ‘.md’: ‘text/markdown; charset=utf-8’,
  ‘.webmanifest’: ‘application/manifest+json; charset=utf-8’,
  ‘.svg’: ‘image/svg+xml; charset=utf-8’
};

Function uniqueList(values) {
  Return […new Set(values)];
}

Function sanitizeCompany(raw) {
  Return String(raw || ‘’)
    .trim()
    .replace(/\s+/g, ‘ ‘)
    .slice(0, 80);
}

Function loadWatchlist() {
  Try {
    If (!fs.existsSync(WATCHLIST_FILE)) {
      Fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(DEFAULT_COMPANY_WATCHLIST, null, 2));
      Return […DEFAULT_COMPANY_WATCHLIST];
    }

    Const parsed = JSON.parse(fs.readFileSync(WATCHLIST_FILE, ‘utf8’));
    If (!Array.isArray(parsed)) {
      Throw new Error(‘Invalid watchlist format’);
    }

    Const cleaned = uniqueList(parsed.map(sanitizeCompany).filter(Boolean));
    If (!cleaned.length) {
      Return […DEFAULT_COMPANY_WATCHLIST];
    }

    Return cleaned;
  } catch (_error) {
    Return […DEFAULT_COMPANY_WATCHLIST];
  }
}

Function saveWatchlist(list) {
  Const cleaned = uniqueList(list.map(sanitizeCompany).filter(Boolean));
  Fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(cleaned, null, 2));
  Return cleaned;
}

Let companyWatchlist = loadWatchlist();

Function parseStooqCsvRow(line) {
  Const values = line.trim().split(‘,’);
  If (values.length < 9) {
    Return null;
  }

  Return {
    Symbol: values[0],
    Date: values[1],
    Time: values[2],
    Open: Number(values[3]),
    High: Number(values[4]),
    Low: Number(values[5]),
    Close: Number(values[6]),
    Volume: Number(values[7])
  };
}

Function parseGoogleNewsItems(xml) {
  Const items = [];
  Const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  For (const block of matches) {
    Const title = decodeXml((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ‘’);
    Const link = decodeXml((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ‘’);
    Const pubDate = decodeXml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || ‘’);
    Const source = decodeXml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || ‘’);

    If (!title || !link) {
      Continue;
    }

    Items.push({ title, link, pubDate, source });
  }

  Return items;
}

Function decodeXml(value) {
  Return value
    .replace(/&amp;/g, ‘&’)
    .replace(/&quot;/g, ‘”’)
    .replace(/&#39;/g, “’”)
    .replace(/&lt;/g, ‘<’)
    .replace(/&gt;/g, ‘>’);
}

Function extractDiscountFromTitle(title) {
  Const percent = title.match(/(\d{1,2})%\s*off/i);
  If (percent) {
    Return `${percent[1]}% off`;
  }

  Const money = title.match(/\$(\d{1,4})\s*off/i);
  If (money) {
    Return `$${money[1]} off`;
  }

  Const upTo = title.match(/save\s+up\s+to\s+(\d{1,2})%/i);
  If (upTo) {
    Return `Up to ${upTo[1]}% off`;
  }

  Return ‘Deal live’;
}

Function makeCodeFromTitle(title) {
  Const explicitCode = title.match(/(?:code|coupon)\s*[:\-]?\s*([A-Z0-9]{4,12})/i);
  If (explicitCode) {
    Return explicitCode[1].toUpperCase();
  }

  Return ‘CHECK-LINK’;
}

Function emptyMarketItem(item, status, provider) {
  Return {
    Symbol: item.symbol,
    Market: item.market,
    Name: item.name,
    Region: item.region,
    Status,
    Provider,
    Price: null,
    changePct: null,
    updated: new Date().toISOString()
  };
}

Async function fetchMarketsFromStooq() {
  Const tracked = MARKET_MAP.filter((item) => item.stooq);
  Const responses = await Promise.allSettled(
    Tracked.map(async (item) => {
      Const url = `https://stooq.com/q/l/?s=${item.stooq}&i=d`;
      Const response = await fetch(url, {
        Headers: {
          ‘User-Agent’: ‘market-discount-tracker/1.0’
        }
      });

      If (!response.ok) {
        Throw new Error(`Stooq request failed: ${response.status}`);
      }

      Const line = (await response.text()).trim();
      Return parseStooqCsvRow(line);
    })
  );

  Const rows = responses
    .filter((result) => result.status === ‘fulfilled’)
    .map((result) => result.value)
    .filter(Boolean);

  Const byStooq = new Map(rows.map((row) => [row.symbol.toLowerCase(), row]));

  Return MARKET_MAP.map((item) => {
    If (!item.stooq) {
      Return emptyMarketItem(item, ‘Monitoring’, ‘Custom’);
    }

    Const key = item.stooq.toLowerCase();
    Const row = byStooq.get(key);

    If (!row || Number.isNaN(row.close) || Number.isNaN(row.open)) {
      Return emptyMarketItem(item, ‘Unavailable’, ‘Stooq’);
    }

    Const changePct = row.open === 0 ? 0 : ((row.close – row.open) / row.open) * 100;

    Return {
      Symbol: item.symbol,
      Market: item.market,
      Name: item.name,
      Region: item.region,
      Status: ‘Live’,
      Provider: ‘Stooq’,
      Price: row.close,
      changePct: Number(changePct.toFixed(2)),
      updated: `${row.date} ${row.time} UTC`
    };
  });
}

Async function fetchMarketsFromTwelveData() {
  If (!TWELVEDATA_API_KEY) {
    Return null;
  }

  Const tracked = MARKET_MAP.filter((item) => item.twelvedata);
  Const responses = await Promise.allSettled(
    Tracked.map(async (item) => {
      Const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(item.twelvedata)}&apikey=${encodeURIComponent(TWELVEDATA_API_KEY)}`;
      Const response = await fetch(url, {
        Headers: {
          ‘User-Agent’: ‘market-discount-tracker/1.0’
        }
      });

      If (!response.ok) {
        Throw new Error(`TwelveData request failed: ${response.status}`);
      }

      Const payload = await response.json();
      If (payload.status === ‘error’ || payload.code >= 400 || !payload.close) {
        Throw new Error(payload.message || ‘Invalid TwelveData response’);
      }

      Return {
        Symbol: item.symbol,
        Market: item.market,
        Name: item.name,
        Region: item.region,
        Status: ‘Live’,
        Provider: ‘TwelveData’,
        Price: Number(payload.close),
        changePct: Number(payload.percent_change || 0),
        updated: payload.datetime || new Date().toISOString()
      };
    })
  );

  Const bySymbol = new Map(
    Responses
      .filter((result) => result.status === ‘fulfilled’)
      .map((result) => [result.value.symbol, result.value])
  );

  If (!bySymbol.size) {
    Return null;
  }

  Return MARKET_MAP.map((item) => {
    If (item.symbol === ‘STRAIX’) {
      Return emptyMarketItem(item, ‘Monitoring’, ‘Custom’);
    }

    Const found = bySymbol.get(item.symbol);
    If (found) {
      Return found;
    }

    Return emptyMarketItem(item, ‘Unavailable’, ‘TwelveData’);
  });
}

Async function fetchLiveMarkets() {
  Const brokerData = await fetchMarketsFromTwelveData();
  If (brokerData) {
    Const fallback = await fetchMarketsFromStooq();
    Const fallbackBySymbol = new Map(fallback.map((item) => [item.symbol, item]));

    Return brokerData.map((item) => {
      If (item.status !== ‘Unavailable’) {
        Return item;
      }

      Const fallbackItem = fallbackBySymbol.get(item.symbol);
      Return fallbackItem || item;
    });
  }

  Return fetchMarketsFromStooq();
}

Async function fetchCompanyCoupons(company) {
  Const query = encodeURIComponent(`${company} coupon code OR promo code OR discount`);
  Const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  Const response = await fetch(url, {
    Headers: {
      ‘User-Agent’: ‘market-discount-tracker/1.0’
    }
  });

  If (!response.ok) {
    Throw new Error(`Google News RSS failed for ${company}: ${response.status}`);
  }

  Const xml = await response.text();
  Const items = parseGoogleNewsItems(xml).slice(0, 3);

  Return items.map((item) => ({
    Company,
    Category: ‘Live Feed’,
    Code: makeCodeFromTitle(item.title),
    Discount: extractDiscountFromTitle(item.title),
    Expires: ‘Check source’,
    Tags: [‘live’, ‘news’, ‘coupon’],
    Source: item.source || ‘Google News’,
    Title: item.title,
    url: item.link,
    publishedAt: item.pubDate
  }));
}

Async function fetchLiveCodes() {
  Const results = await Promise.allSettled(companyWatchlist.map(fetchCompanyCoupons));
  Const list = [];

  For (const result of results) {
    If (result.status === ‘fulfilled’) {
      List.push(…result.value);
    }
  }

  If (list.length) {
    Return list;
  }

  Return [
    {
      Company: ‘Amazon’,
      Category: ‘Fallback’,
      Code: ‘CHECK-LINK’,
      Discount: ‘Live source temporarily unavailable’,
      Expires: ‘Check source’,
      Tags: [‘fallback’],
      Source: ‘Local fallback’,
      Title: ‘No live feed currently available’,
      url: ‘’,
      publishedAt: new Date().toUTCString()
    }
  ];
}

Function sendJson(res, statusCode, payload) {
  Const body = JSON.stringify(payload);
  Res.writeHead(statusCode, {
    ‘Content-Type’: ‘application/json; charset=utf-8’,
    ‘Cache-Control’: ‘no-store’
  });
  Res.end(body);
}

Function readJsonBody(req) {
  Return new Promise((resolve, reject) => {
    Let raw = ‘’;

    Req.on(‘data’, (chunk) => {
      Raw += chunk;
      If (raw.length > 1024 * 1024) {
        Reject(new Error(‘Payload too large’));
      }
    });

    Req.on(‘end’, () => {
      Try {
        Resolve(raw ? JSON.parse(raw) : {});
      } catch (_error) {
        Reject(new Error(‘Invalid JSON body’));
      }
    });

    Req.on(‘error’, () => {
      Reject(new Error(‘Request stream error’));
    });
  });
}

Async function handleApi(req, res, pathname) {
  Try {
    If (pathname === ‘/api/markets’ && req.method === ‘GET’) {
      Const data = await fetchLiveMarkets();
      Return sendJson(res, 200, { updatedAt: new Date().toISOString(), data });
    }

    If (pathname === ‘/api/codes’ && req.method === ‘GET’) {
      Const data = await fetchLiveCodes();
      Return sendJson(res, 200, { updatedAt: new Date().toISOString(), data });
    }

    If (pathname === ‘/api/watchlist’ && req.method === ‘GET’) {
      Return sendJson(res, 200, { data: companyWatchlist });
    }

    If (pathname === ‘/api/watchlist’ && req.method === ‘POST’) {
      Const body = await readJsonBody(req);
      Const company = sanitizeCompany(body.company);

      If (!company) {
        Return sendJson(res, 400, { error: ‘Company is required’ });
      }

      Const exists = companyWatchlist.some((item) => item.toLowerCase() === company.toLowerCase());
      If (!exists) {
        companyWatchlist = saveWatchlist([…companyWatchlist, company]);
      }

      Return sendJson(res, 200, { data: companyWatchlist });
    }

    If (pathname === ‘/api/watchlist’ && req.method === ‘DELETE’) {
      Const body = await readJsonBody(req);
      Const company = sanitizeCompany(body.company);

      If (!company) {
        Return sendJson(res, 400, { error: ‘Company is required’ });
      }

      companyWatchlist = saveWatchlist(
        companyWatchlist.filter((item) => item.toLowerCase() !== company.toLowerCase())
      );
      Return sendJson(res, 200, { data: companyWatchlist });
    }

    Return sendJson(res, 404, { error: ‘Not found’ });
  } catch (error) {
    Return sendJson(res, 500, { error: error.message || ‘Unexpected server error’ });
  }
}

Function serveStatic(req, res, pathname) {
  Const localPath = pathname === ‘/’ ? ‘/index.html’ : pathname;
  Const safePath = path.normalize(localPath).replace(/^\.\.(\/|\\|$)+/, ‘’);
  Const filePath = path.join(ROOT, safePath);

  If (!filePath.startsWith(ROOT)) {
    Res.writeHead(403);
    Res.end(‘Forbidden’);
    Return;
  }

  Fs.readFile(filePath, (err, data) => {
    If (err) {
      Res.writeHead(404, { ‘Content-Type’: ‘text/plain; charset=utf-8’ });
      Res.end(‘Not found’);
      Return;
    }

    Const ext = path.extname(filePath).toLowerCase();
    Const headers = {
      ‘Content-Type’: MIME_TYPES[ext] || ‘application/octet-stream’
    };

    If (pathname === ‘/sw.js’) {
      Headers[‘Cache-Control’] = ‘no-cache’;
    }

    Res.writeHead(200, headers);
    Res.end(data);
  });
}

Const server = http.createServer(async (req, res) => {
  Const parsed = new URL(req.url, `http://${req.headers.host}`);
  Const pathname = parsed.pathname;

  If (pathname.startsWith(‘/api/’)) {
    Await handleApi(req, res, pathname);
    Return;
  }

  serveStatic(req, res, pathname);
});

Server.listen(PORT, () => {
  Const provider = TWELVEDATA_API_KEY ? ‘TwelveData + Stooq fallback’ : ‘Stooq’;
  Console.log(`Tracker app running at http://localhost:${PORT} (market provider: ${provider})`);
});const http = require(‘http’);
Const fs = require(‘fs’);
Const path = require(‘path’);
Const { URL } = require(‘url’);

Const PORT = process.env.PORT || 8080;
Const ROOT = __dirname;
Const WATCHLIST_FILE = path.join(ROOT, ‘watchlist.json’);
Const TWELVEDATA_API_KEY = process.env.TWELVEDATA_API_KEY || ‘’;

Const MARKET_MAP = [
  {
    Symbol: ‘SPX500’,
    Stooq: ‘^spx’,
    Twelvedata: ‘GSPC:INDX’,
    Market: ‘US’,
    Name: ‘S&P 500 Index’,
    Region: ‘United States’
  },
  {
    Symbol: ‘US30’,
    Stooq: ‘^dji’,
    Twelvedata: ‘DJI:INDX’,
    Market: ‘US’,
    Name: ‘Dow Jones 30 Index’,
    Region: ‘United States’
  },
  {
    Symbol: ‘UK100’,
    Stooq: ‘^ukx’,
    Twelvedata: ‘FTSE:INDX’,
    Market: ‘UK’,
    Name: ‘FTSE 100 Index’,
    Region: ‘United Kingdom’
  },
  {
    Symbol: ‘GER40’,
    Stooq: ‘^dax’,
    Twelvedata: ‘DAX:INDX’,
    Market: ‘EU’,
    Name: ‘DAX 40 Index’,
    Region: ‘Germany’
  },
  {
    Symbol: ‘NAS100’,
    Stooq: ‘^ndq’,
    Twelvedata: ‘NDX:INDX’,
    Market: ‘US’,
    Name: ‘Nasdaq 100 Index’,
    Region: ‘United States’
  },
  {
    Symbol: ‘STRAIX’,
    Stooq: null,
    Twelvedata: null,
    Market: ‘Global’,
    Name: ‘Custom Strategy Basket’,
    Region: ‘Multi-region’
  }
];

Const DEFAULT_COMPANY_WATCHLIST = [
  ‘Amazon’,
  ‘Apple’,
  ‘Nike’,
  ‘Walmart’,
  ‘Target’,
  ‘Best Buy’,
  ‘Samsung’,
  ‘Adidas’,
  ‘Booking.com’,
  ‘Expedia’
];

Const MIME_TYPES = {
  ‘.html’: ‘text/html; charset=utf-8’,
  ‘.css’: ‘text/css; charset=utf-8’,
  ‘.js’: ‘application/javascript; charset=utf-8’,
  ‘.json’: ‘application/json; charset=utf-8’,
  ‘.md’: ‘text/markdown; charset=utf-8’,
  ‘.webmanifest’: ‘application/manifest+json; charset=utf-8’,
  ‘.svg’: ‘image/svg+xml; charset=utf-8’
};

Function uniqueList(values) {
  Return […new Set(values)];
}

Function sanitizeCompany(raw) {
  Return String(raw || ‘’)
    .trim()
    .replace(/\s+/g, ‘ ‘)
    .slice(0, 80);
}

Function loadWatchlist() {
  Try {
    If (!fs.existsSync(WATCHLIST_FILE)) {
      Fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(DEFAULT_COMPANY_WATCHLIST, null, 2));
      Return […DEFAULT_COMPANY_WATCHLIST];
    }

    Const parsed = JSON.parse(fs.readFileSync(WATCHLIST_FILE, ‘utf8’));
    If (!Array.isArray(parsed)) {
      Throw new Error(‘Invalid watchlist format’);
    }

    Const cleaned = uniqueList(parsed.map(sanitizeCompany).filter(Boolean));
    If (!cleaned.length) {
      Return […DEFAULT_COMPANY_WATCHLIST];
    }

    Return cleaned;
  } catch (_error) {
    Return […DEFAULT_COMPANY_WATCHLIST];
  }
}

Function saveWatchlist(list) {
  Const cleaned = uniqueList(list.map(sanitizeCompany).filter(Boolean));
  Fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(cleaned, null, 2));
  Return cleaned;
}

Let companyWatchlist = loadWatchlist();

Function parseStooqCsvRow(line) {
  Const values = line.trim().split(‘,’);
  If (values.length < 9) {
    Return null;
  }

  Return {
    Symbol: values[0],
    Date: values[1],
    Time: values[2],
    Open: Number(values[3]),
    High: Number(values[4]),
    Low: Number(values[5]),
    Close: Number(values[6]),
    Volume: Number(values[7])
  };
}

Function parseGoogleNewsItems(xml) {
  Const items = [];
  Const matches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  For (const block of matches) {
    Const title = decodeXml((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ‘’);
    Const link = decodeXml((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ‘’);
    Const pubDate = decodeXml((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || ‘’);
    Const source = decodeXml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || ‘’);

    If (!title || !link) {
      Continue;
    }

    Items.push({ title, link, pubDate, source });
  }

  Return items;
}

Function decodeXml(value) {
  Return value
    .replace(/&amp;/g, ‘&’)
    .replace(/&quot;/g, ‘”’)
    .replace(/&#39;/g, “’”)
    .replace(/&lt;/g, ‘<’)
    .replace(/&gt;/g, ‘>’);
}

Function extractDiscountFromTitle(title) {
  Const percent = title.match(/(\d{1,2})%\s*off/i);
  If (percent) {
    Return `${percent[1]}% off`;
  }

  Const money = title.match(/\$(\d{1,4})\s*off/i);
  If (money) {
    Return `$${money[1]} off`;
  }

  Const upTo = title.match(/save\s+up\s+to\s+(\d{1,2})%/i);
  If (upTo) {
    Return `Up to ${upTo[1]}% off`;
  }

  Return ‘Deal live’;
}

Function makeCodeFromTitle(title) {
  Const explicitCode = title.match(/(?:code|coupon)\s*[:\-]?\s*([A-Z0-9]{4,12})/i);
  If (explicitCode) {
    Return explicitCode[1].toUpperCase();
  }

  Return ‘CHECK-LINK’;
}

Function emptyMarketItem(item, status, provider) {
  Return {
    Symbol: item.symbol,
    Market: item.market,
    Name: item.name,
    Region: item.region,
    Status,
    Provider,
    Price: null,
    changePct: null,
    updated: new Date().toISOString()
  };
}

Async function fetchMarketsFromStooq() {
  Const tracked = MARKET_MAP.filter((item) => item.stooq);
  Const responses = await Promise.allSettled(
    Tracked.map(async (item) => {
      Const url = `https://stooq.com/q/l/?s=${item.stooq}&i=d`;
      Const response = await fetch(url, {
        Headers: {
          ‘User-Agent’: ‘market-discount-tracker/1.0’
        }
      });

      If (!response.ok) {
        Throw new Error(`Stooq request failed: ${response.status}`);
      }

      Const line = (await response.text()).trim();
      Return parseStooqCsvRow(line);
    })
  );

  Const rows = responses
    .filter((result) => result.status === ‘fulfilled’)
    .map((result) => result.value)
    .filter(Boolean);

  Const byStooq = new Map(rows.map((row) => [row.symbol.toLowerCase(), row]));

  Return MARKET_MAP.map((item) => {
    If (!item.stooq) {
      Return emptyMarketItem(item, ‘Monitoring’, ‘Custom’);
    }

    Const key = item.stooq.toLowerCase();
    Const row = byStooq.get(key);

    If (!row || Number.isNaN(row.close) || Number.isNaN(row.open)) {
      Return emptyMarketItem(item, ‘Unavailable’, ‘Stooq’);
    }

    Const changePct = row.open === 0 ? 0 : ((row.close – row.open) / row.open) * 100;

    Return {
      Symbol: item.symbol,
      Market: item.market,
      Name: item.name,
      Region: item.region,
      Status: ‘Live’,
      Provider: ‘Stooq’,
      Price: row.close,
      changePct: Number(changePct.toFixed(2)),
      updated: `${row.date} ${row.time} UTC`
    };
  });
}

Async function fetchMarketsFromTwelveData() {
  If (!TWELVEDATA_API_KEY) {
    Return null;
  }

  Const tracked = MARKET_MAP.filter((item) => item.twelvedata);
  Const responses = await Promise.allSettled(
    Tracked.map(async (item) => {
      Const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(item.twelvedata)}&apikey=${encodeURIComponent(TWELVEDATA_API_KEY)}`;
      Const response = await fetch(url, {
        Headers: {
          ‘User-Agent’: ‘market-discount-tracker/1.0’
        }
      });

      If (!response.ok) {
        Throw new Error(`TwelveData request failed: ${response.status}`);
      }

      Const payload = await response.json();
      If (payload.status === ‘error’ || payload.code >= 400 || !payload.close) {
        Throw new Error(payload.message || ‘Invalid TwelveData response’);
      }

      Return {
        Symbol: item.symbol,
        Market: item.market,
        Name: item.name,
        Region: item.region,
        Status: ‘Live’,
        Provider: ‘TwelveData’,
        Price: Number(payload.close),
        changePct: Number(payload.percent_change || 0),
        updated: payload.datetime || new Date().toISOString()
      };
    })
  );

  Const bySymbol = new Map(
    Responses
      .filter((result) => result.status === ‘fulfilled’)
      .map((result) => [result.value.symbol, result.value])
  );

  If (!bySymbol.size) {
    Return null;
  }

  Return MARKET_MAP.map((item) => {
    If (item.symbol === ‘STRAIX’) {
      Return emptyMarketItem(item, ‘Monitoring’, ‘Custom’);
    }

    Const found = bySymbol.get(item.symbol);
    If (found) {
      Return found;
    }

    Return emptyMarketItem(item, ‘Unavailable’, ‘TwelveData’);
  });
}

Async function fetchLiveMarkets() {
  Const brokerData = await fetchMarketsFromTwelveData();
  If (brokerData) {
    Const fallback = await fetchMarketsFromStooq();
    Const fallbackBySymbol = new Map(fallback.map((item) => [item.symbol, item]));

    Return brokerData.map((item) => {
      If (item.status !== ‘Unavailable’) {
        Return item;
      }

      Const fallbackItem = fallbackBySymbol.get(item.symbol);
      Return fallbackItem || item;
    });
  }

  Return fetchMarketsFromStooq();
}

Async function fetchCompanyCoupons(company) {
  Const query = encodeURIComponent(`${company} coupon code OR promo code OR discount`);
  Const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  Const response = await fetch(url, {
    Headers: {
      ‘User-Agent’: ‘market-discount-tracker/1.0’
    }
  });

  If (!response.ok) {
    Throw new Error(`Google News RSS failed for ${company}: ${response.status}`);
  }

  Const xml = await response.text();
  Const items = parseGoogleNewsItems(xml).slice(0, 3);

  Return items.map((item) => ({
    Company,
    Category: ‘Live Feed’,
    Code: makeCodeFromTitle(item.title),
    Discount: extractDiscountFromTitle(item.title),
    Expires: ‘Check source’,
    Tags: [‘live’, ‘news’, ‘coupon’],
    Source: item.source || ‘Google News’,
    Title: item.title,
    url: item.link,
    publishedAt: item.pubDate
  }));
}

Async function fetchLiveCodes() {
  Const results = await Promise.allSettled(companyWatchlist.map(fetchCompanyCoupons));
  Const list = [];

  For (const result of results) {
    If (result.status === ‘fulfilled’) {
      List.push(…result.value);
    }
  }

  If (list.length) {
    Return list;
  }

  Return [
    {
      Company: ‘Amazon’,
      Category: ‘Fallback’,
      Code: ‘CHECK-LINK’,
      Discount: ‘Live source temporarily unavailable’,
      Expires: ‘Check source’,
      Tags: [‘fallback’],
      Source: ‘Local fallback’,
      Title: ‘No live feed currently available’,
      url: ‘’,
      publishedAt: new Date().toUTCString()
    }
  ];
}

Function sendJson(res, statusCode, payload) {
  Const body = JSON.stringify(payload);
  Res.writeHead(statusCode, {
    ‘Content-Type’: ‘application/json; charset=utf-8’,
    ‘Cache-Control’: ‘no-store’
  });
  Res.end(body);
}

Function readJsonBody(req) {
  Return new Promise((resolve, reject) => {
    Let raw = ‘’;

    Req.on(‘data’, (chunk) => {
      Raw += chunk;
      If (raw.length > 1024 * 1024) {
        Reject(new Error(‘Payload too large’));
      }
    });

    Req.on(‘end’, () => {
      Try {
        Resolve(raw ? JSON.parse(raw) : {});
      } catch (_error) {
        Reject(new Error(‘Invalid JSON body’));
      }
    });

    Req.on(‘error’, () => {
      Reject(new Error(‘Request stream error’));
    });
  });
}

Async function handleApi(req, res, pathname) {
  Try {
    If (pathname === ‘/api/markets’ && req.method === ‘GET’) {
      Const data = await fetchLiveMarkets();
      Return sendJson(res, 200, { updatedAt: new Date().toISOString(), data });
    }

    If (pathname === ‘/api/codes’ && req.method === ‘GET’) {
      Const data = await fetchLiveCodes();
      Return sendJson(res, 200, { updatedAt: new Date().toISOString(), data });
    }

    If (pathname === ‘/api/watchlist’ && req.method === ‘GET’) {
      Return sendJson(res, 200, { data: companyWatchlist });
    }

    If (pathname === ‘/api/watchlist’ && req.method === ‘POST’) {
      Const body = await readJsonBody(req);
      Const company = sanitizeCompany(body.company);

      If (!company) {
        Return sendJson(res, 400, { error: ‘Company is required’ });
      }

      Const exists = companyWatchlist.some((item) => item.toLowerCase() === company.toLowerCase());
      If (!exists) {
        companyWatchlist = saveWatchlist([…companyWatchlist, company]);
      }

      Return sendJson(res, 200, { data: companyWatchlist });
    }

    If (pathname === ‘/api/watchlist’ && req.method === ‘DELETE’) {
      Const body = await readJsonBody(req);
      Const company = sanitizeCompany(body.company);

      If (!company) {
        Return sendJson(res, 400, { error: ‘Company is required’ });
      }

      companyWatchlist = saveWatchlist(
        companyWatchlist.filter((item) => item.toLowerCase() !== company.toLowerCase())
      );
      Return sendJson(res, 200, { data: companyWatchlist });
    }

    Return sendJson(res, 404, { error: ‘Not found’ });
  } catch (error) {
    Return sendJson(res, 500, { error: error.message || ‘Unexpected server error’ });
  }
}

Function serveStatic(req, res, pathname) {
  Const localPath = pathname === ‘/’ ? ‘/index.html’ : pathname;
  Const safePath = path.normalize(localPath).replace(/^\.\.(\/|\\|$)+/, ‘’);
  Const filePath = path.join(ROOT, safePath);

  If (!filePath.startsWith(ROOT)) {
    Res.writeHead(403);
    Res.end(‘Forbidden’);
    Return;
  }

  Fs.readFile(filePath, (err, data) => {
    If (err) {
      Res.writeHead(404, { ‘Content-Type’: ‘text/plain; charset=utf-8’ });
      Res.end(‘Not found’);
      Return;
    }

    Const ext = path.extname(filePath).toLowerCase();
    Const headers = {
      ‘Content-Type’: MIME_TYPES[ext] || ‘application/octet-stream’
    };

    If (pathname === ‘/sw.js’) {
      Headers[‘Cache-Control’] = ‘no-cache’;
    }

    Res.writeHead(200, headers);
    Res.end(data);
  });
}

Const server = http.createServer(async (req, res) => {
  Const parsed = new URL(req.url, `http://${req.headers.host}`);
  Const pathname = parsed.pathname;

  If (pathname.startsWith(‘/api/’)) {
    Await handleApi(req, res, pathname);
    Return;
  }

  serveStatic(req, res, pathname);
});

Server.listen(PORT, () => {
  Const provider = TWELVEDATA_API_KEY ? ‘TwelveData + Stooq fallback’ : ‘Stooq’;
  Console.log(`Tracker app running at http://localhost:${PORT} (market provider: ${provider})`);
});
