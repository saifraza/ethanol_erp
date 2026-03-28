import puppeteer, { Browser } from 'puppeteer';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;
  browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

export async function renderPdf(html: string, options?: {
  format?: 'A4' | 'Letter';
  landscape?: boolean;
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
}): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pdfBuffer = await page.pdf({
      format: options?.format || 'A4',
      landscape: options?.landscape || false,
      printBackground: true,
      margin: options?.margin || { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Graceful shutdown
process.on('SIGINT', closeBrowser);
process.on('SIGTERM', closeBrowser);
