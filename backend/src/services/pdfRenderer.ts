import puppeteer, { Browser } from 'puppeteer';
import * as fs from 'fs';

let browser: Browser | null = null;

function findChromium(): string | undefined {
  // If explicitly set and actually works, use it
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    // Skip snap stubs that just print "install chromium snap"
    try {
      const stat = fs.statSync(envPath);
      if (stat.size > 1000) return envPath; // real binary, not a stub
    } catch { /* skip */ }
  }

  // Otherwise let Puppeteer use its bundled Chromium
  return undefined;
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) return browser;

  const executablePath = findChromium();
  console.log(`[PDF] Launching browser${executablePath ? ` at ${executablePath}` : ' (bundled Chromium)'}`);

  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
      '--single-process',
    ],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  browser = await puppeteer.launch(launchOptions);
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

process.on('SIGINT', closeBrowser);
process.on('SIGTERM', closeBrowser);
