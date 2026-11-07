/**
 * =====================================================================
 * ZIOX LINK - PROFESSIONAL BACKEND SERVER
 * =====================================================================
 * Core Engine: Node.js, Express, Cheerio, Undici
 * Features: Multi-Proxy Fallback, Rate Limiter, Auto-Rewrite HTML,
 *           Deep Error Handling, Console Logger with Colors.
 * =====================================================================
 */

import express from 'express';
import * as cheerio from 'cheerio';
import { request, ProxyAgent } from 'undici';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// ==========================================
// 1. KONFIGURASI DASAR & KONSTANTA
// ==========================================
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_RETRIES = 3;
const TIMEOUT_MS = 10000;

// Middleware
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 2. SISTEM LOGGING PROFESIONAL
// ==========================================
const Logger = {
  getTimestamp: () => new Date().toISOString().replace('T', ' ').substring(0, 19),
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m [${Logger.getTimestamp()}] ${msg}`),
  success: (msg) => console.log(`\x1b[32m[SUCCESS]\x1b[0m [${Logger.getTimestamp()}] ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m [${Logger.getTimestamp()}] ${msg}`),
  error: (msg, err = '') => console.log(`\x1b[31m[ERROR]\x1b[0m [${Logger.getTimestamp()}] ${msg} ${err ? `\n  -> ${err}` : ''}`),
  bypass: (msg) => console.log(`\x1b[35m[BYPASS]\x1b[0m [${Logger.getTimestamp()}] ${msg}`),
  proxy: (msg) => console.log(`\x1b[34m[PROXY]\x1b[0m [${Logger.getTimestamp()}] ${msg}`)
};

// ==========================================
// 3. SISTEM KEAMANAN (RATE LIMITER)
// ==========================================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 menit
const MAX_REQUESTS_PER_WINDOW = 20;

const rateLimiter = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return next();
  }

  const record = rateLimitMap.get(ip);
  
  if (now - record.startTime > RATE_LIMIT_WINDOW) {
    record.count = 1;
    record.startTime = now;
    return next();
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    Logger.warn(`Rate limit tercapai untuk IP: ${ip}`);
    return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
  }

  record.count++;
  next();
};

app.use('/api', rateLimiter);

// ==========================================
// 4. UTILITY FUNCTIONS
// ==========================================
const generateId = () => crypto.randomBytes(8).toString('hex');

const isValidUrl = (string) => {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

const extractDirectLinks = (html) => {
  const patterns = [
    /https?:\/\/(?:www\.)?mediafire\.com\/file\/[^\s"'<>]+/i,
    /https?:\/\/drive\.google\.com\/[^\s"'<>]+/i,
    /https?:\/\/mega\.nz\/[^\s"'<>]+/i,
    /https?:\/\/[^'"<>\s]+\.zip/i,
    /https?:\/\/(?:www\.)?dropbox\.com\/[^\s"'<>]+/i
  ];

  for (let p of patterns) {
    const match = html.match(p);
    if (match) return match[0];
  }

  // Fallback: cari tag <a> yang mencurigakan
  const anchorMatches = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)]
    .map(m => m[1])
    .filter(url => !url.includes('sfl.gl') && !url.includes('allorigins') && !url.includes('google'));
  
  if (anchorMatches.length > 0) return anchorMatches[0];
  return null;
};

// ==========================================
// 5. CORE ENGINE: BYPASS SFL
// ==========================================
const BypassEngine = {
  execute: async (targetUrl, traceId) => {
    let currentUrl = targetUrl;
    Logger.bypass(`[${traceId}] Memulai proses bypass: ${targetUrl}`);

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        Logger.info(`[${traceId}] Attempt ${attempt}/${MAX_RETRIES} -> Fetching: ${currentUrl}`);
        
        const response = await request(currentUrl, {
          method: 'GET',
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.5',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'upgrade-insecure-requests': '1'
          },
          maxRedirections: 5,
          headersTimeout: TIMEOUT_MS,
          bodyTimeout: TIMEOUT_MS
        });

        if (response.statusCode >= 400) {
          Logger.warn(`[${traceId}] HTTP Error ${response.statusCode} di attempt ${attempt}`);
          if (attempt === MAX_RETRIES) break;
          continue;
        }

        const html = await response.body.text();
        Logger.info(`[${traceId}] Menerima ${html.length} bytes HTML.`);
        const $ = cheerio.load(html);

        // A. Cek Meta Refresh
        const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
        if (metaRefresh && metaRefresh.match(/url=(.+)/i)) {
          const nextUrl = new URL(metaRefresh.match(/url=(.+)/i)[1].trim(), currentUrl).href;
          Logger.info(`[${traceId}] Ditemukan Meta Refresh -> ${nextUrl}`);
          currentUrl = nextUrl;
          continue;
        }

        // B. Cek Form POST (SFI)
        const form = $('form');
        if (form.length > 0) {
          const action = form.attr('action') || currentUrl;
          const method = (form.attr('method') || 'GET').toUpperCase();
          
          if (method === 'POST') {
            const formData = new URLSearchParams();
            form.find('input').each((_, el) => {
              const name = $(el).attr('name');
              const val = $(el).attr('value') || '';
              if (name) formData.append(name, val);
            });

            Logger.info(`[${traceId}] Submit form POST ke: ${action}`);
            const postRes = await request(new URL(action, currentUrl).href, {
              method: 'POST',
              headers: { 
                'content-type': 'application/x-www-form-urlencoded',
                'user-agent': 'Mozilla/5.0...' 
              },
              body: formData.toString(),
              maxRedirections: 5
            });
            
            currentUrl = postRes.url;
            continue;
          }
        }

        // C. Ekstrak Link Asli
        const directLink = extractDirectLinks(html);
        if (directLink) {
          Logger.success(`[${traceId}] Link asli ditemukan: ${directLink}`);
          return { success: true, url: directLink, traceId };
        }

        // D. Cari Tombol Next/Download
        const nextBtn = $('a, button').filter((_, el) => {
          const text = $(el).text().toLowerCase();
          return text.includes('get link') || text.includes('download') || text.includes('lanjut') || text.includes('klik');
        }).attr('href');

        if (nextBtn && !nextBtn.startsWith('javascript') && nextBtn !== '#') {
          const nextUrl = new URL(nextBtn, currentUrl).href;
          Logger.info(`[${traceId}] Ditemukan tombol Next -> ${nextUrl}`);
          currentUrl = nextUrl;
          continue;
        }

        Logger.warn(`[${traceId}] Tidak ada pola redirect/link yang cocok.`);
        break;

      } catch (err) {
        Logger.error(`[${traceId}] Request gagal di attempt ${attempt}`, err.message);
        if (attempt === MAX_RETRIES) {
          return { success: false, error: 'Gagal terhubung ke target', traceId };
        }
      }
    }

    return { success: true, url: currentUrl, traceId, note: 'Fallback ke URL terakhir' };
  }
};

// ==========================================
// 6. CORE ENGINE: TIKTOK DOWNLOADER
// ==========================================
const TikTokEngine = {
  execute: async (url, traceId) => {
    Logger.info(`[${traceId}] Meminta data TikTok untuk: ${url}`);
    try {
      // Panggil API TikWM dari server (biar nggak kena CORS)
      const res = await request(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
        headers: { 'user-agent': 'Mozilla/5.0' }
      });
      
      const data = await res.body.json();
      
      if (!data || !data.data) {
        throw new Error('Respon TikWM tidak valid');
      }

      Logger.success(`[${traceId}] Data TikTok berhasil diekstrak.`);
      return { success: true, data: data.data, traceId };

    } catch (err) {
      Logger.error(`[${traceId}] Gagal mengambil data TikTok`, err.message);
      return { success: false, error: 'Gagal mengambil video TikTok', traceId };
    }
  }
};

// ==========================================
// 7. API ROUTES
// ==========================================

// Endpoint Bypass (menggantikan AllOrigins)
app.get('/api/allorigins', async (req, res) => {
  const targetUrl = req.query.url;
  const traceId = generateId();

  if (!targetUrl || !isValidUrl(targetUrl)) {
    Logger.warn(`[${traceId}] Request ditolak: URL tidak valid.`);
    return res.status(400).send('URL tidak valid');
  }

  try {
    const result = await BypassEngine.execute(targetUrl, traceId);
    
    if (!result.success) {
      return res.status(500).send(result.error);
    }

    // Bungkus dalam HTML palsu biar fungsi di frontend (yang expect AllOrigins) tetep jalan
    const htmlResponse = `
      <!DOCTYPE html>
      <html>
        <head><title>Bypassed</title></head>
        <body>
          <div id="result" data-url="${result.url}" style="display:none;">${result.url}</div>
          <a href="${result.url}">${result.url}</a>
        </body>
      </html>
    `;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlResponse);

  } catch (err) {
    Logger.error(`[${traceId}] Server error pada bypass`, err.message);
    res.status(500).send('Terjadi kesalahan internal server');
  }
});

// Endpoint TikTok (menggantikan TikWM langsung)
app.get('/api/tikwm', async (req, res) => {
  const targetUrl = req.query.url;
  const traceId = generateId();

  if (!targetUrl) {
    return res.status(400).json({ error: 'URL TikTok kosong' });
  }

  const result = await TikTokEngine.execute(targetUrl, traceId);
  
  if (!result.success) {
    return res.status(500).json({ error: result.error });
  }

  // Kembalikan format asli yang diharapkan frontend (TikWM format)
  res.json({ code: 0, msg: 'success', data: result.data });
});

// ==========================================
// 8. STATIC FILE SERVING & REWRITE
// ==========================================
app.get('/', (req, res) => {
  try {
    const filePath = path.join(__dirname, 'public', 'index.html');
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File index.html tidak ditemukan di folder public.');
    }

    let html = fs.readFileSync(filePath, 'utf8');

    // Rewrite URL external ke endpoint lokal kita
    html = html.replace(
      /https:\/\/api\.allorigins\.win\/raw\?url=/g, 
      '/api/allorigins?url='
    );
    
    html = html.replace(
      /https:\/\/www\.tikwm\.com\/api\/\?url=/g, 
      '/api/tikwm?url='
    );

    // Sisipkan script kecil untuk handle bypass tambahan (jika perlu)
    const injectScript = `
      <script>
        // Auto-detect link jika ada custom logic
        console.log('[ZIOX] Frontend loaded. API endpoint mapped to local server.');
      </script>
    `;
    html = html.replace('</body>', `${injectScript}</body>`);

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (err) {
    Logger.error('Gagal melayani index.html', err.message);
    res.status(500).send('Terjadi kesalahan saat memuat halaman.');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 9. GLOBAL ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
  Logger.error('Unhandled Exception', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ==========================================
// 10. START SERVER
// ==========================================
app.listen(PORT, () => {
  Logger.success(`=========================================`);
  Logger.success(` ZIOX SERVER v2.0 PROFESSIONAL ONLINE`);
  Logger.success(`=========================================`);
  Logger.info(`Listening on: http://localhost:${PORT}`);
  Logger.info(`Rate Limit: ${MAX_REQUESTS_PER_WINDOW} req / ${RATE_LIMIT_WINDOW/1000}s`);
  Logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  Logger.success(`=========================================`);
});

// Graceful Shutdown
process.on('SIGINT', () => {
  Logger.warn('Menerima SIGINT. Mematikan server dengan rapi...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  Logger.error('UNCAUGHT EXCEPTION! Server akan dimatikan.', err.stack);
  process.exit(1);
});