import puppeteer, { Browser } from 'puppeteer';
import * as fs from 'fs';

let browser: Browser | null = null;

function findChromium(): string | undefined {
  // Try common Chromium paths
  const paths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/nix/var/nix/profiles/default/bin/chromium',
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  // Let Puppeteer use its bundled Chromium (if downloaded during npm install)
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
