import Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import QRCode from 'qrcode';

const TEMPLATES_DIR = path.join(__dirname, '../templates');
const LOGO_PATH = path.join(__dirname, '../../assets/MSPIL_logo_transparent.png');

let logoBase64: string | null = null;

function getLogoBase64(): string {
  if (!logoBase64) {
    try {
      const buf = fs.readFileSync(LOGO_PATH);
      logoBase64 = `data:image/png;base64,${buf.toString('base64')}`;
    } catch {
      logoBase64 = '';
    }
  }
  return logoBase64;
}

// ── Handlebars Helpers ──

Handlebars.registerHelper('formatINR', (n: number) => {
  if (n == null || isNaN(n)) return '--';
  return 'Rs.' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

Handlebars.registerHelper('formatNum', (n: number) => {
  if (n == null || isNaN(n)) return '--';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

Handlebars.registerHelper('formatDate', (d: Date | string) => {
  if (!d) return '--';
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
});

Handlebars.registerHelper('padPO', (n: number) => `PO-${String(n).padStart(4, '0')}`);
Handlebars.registerHelper('padNum', (prefix: string, n: number, len: number) =>
  `${prefix}-${String(n).padStart(len || 4, '0')}`);

Handlebars.registerHelper('numberToWords', (num: number) => {
  if (!num || num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function convert(n: number): string {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let result = 'Rupees ' + convert(rupees);
  if (paise > 0) result += ' and ' + convert(paise) + ' Paise';
  return result + ' Only';
});

Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper('neq', (a: unknown, b: unknown) => a !== b);
Handlebars.registerHelper('gt', (a: number, b: number) => a > b);
Handlebars.registerHelper('or', (...args: unknown[]) => {
  args.pop(); // remove Handlebars options
  return args.some(Boolean);
});
Handlebars.registerHelper('and', (...args: unknown[]) => {
  args.pop();
  return args.every(Boolean);
});
Handlebars.registerHelper('add', (a: number, b: number) => (a || 0) + (b || 0));
Handlebars.registerHelper('multiply', (a: number, b: number) => (a || 0) * (b || 0));
Handlebars.registerHelper('inc', (n: number) => (n || 0) + 1);
Handlebars.registerHelper('even', (n: number) => n % 2 === 0);
Handlebars.registerHelper('ifCond', function (this: unknown, v1: unknown, operator: string, v2: unknown, options: Handlebars.HelperOptions) {
  switch (operator) {
    case '===': return v1 === v2 ? options.fn(this) : options.inverse(this);
    case '!==': return v1 !== v2 ? options.fn(this) : options.inverse(this);
    case '>': return (v1 as number) > (v2 as number) ? options.fn(this) : options.inverse(this);
    case '<': return (v1 as number) < (v2 as number) ? options.fn(this) : options.inverse(this);
    default: return options.inverse(this);
  }
});
Handlebars.registerHelper('join', (arr: string[], sep: string) => {
  if (!Array.isArray(arr)) return '';
  return arr.filter(Boolean).join(typeof sep === 'string' ? sep : ', ');
});
Handlebars.registerHelper('default', (val: unknown, fallback: unknown) => val || fallback);
Handlebars.registerHelper('list', (...args: unknown[]) => {
  args.pop(); // remove Handlebars options
  return args;
});

// ── Register Partials ──

function loadPartials(): void {
  const partialsDir = path.join(TEMPLATES_DIR, 'partials');
  if (!fs.existsSync(partialsDir)) return;
  const files = fs.readdirSync(partialsDir).filter(f => f.endsWith('.hbs'));
  for (const file of files) {
    const name = path.basename(file, '.hbs');
    const content = fs.readFileSync(path.join(partialsDir, file), 'utf-8');
    Handlebars.registerPartial(name, content);
  }
}

// ── Template Compilation Cache ──

const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

function getCompiledTemplate(templateName: string): HandlebarsTemplateDelegate {
  if (compiledCache.has(templateName)) {
    return compiledCache.get(templateName)!;
  }
  // Try documents/ subdirectory first, then root
  let templatePath = path.join(TEMPLATES_DIR, 'documents', `${templateName}.hbs`);
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(TEMPLATES_DIR, `${templateName}.hbs`);
  }
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templateName}`);
  }
  const source = fs.readFileSync(templatePath, 'utf-8');
  const compiled = Handlebars.compile(source);
  compiledCache.set(templateName, compiled);
  return compiled;
}

// ── Public API ──

let initialized = false;

function ensureInit(): void {
  if (initialized) return;
  loadPartials();
  initialized = true;
}

export async function generateQRCode(url: string): Promise<string> {
  return QRCode.toDataURL(url, { width: 100, margin: 1, errorCorrectionLevel: 'M' });
}

export async function renderTemplate(templateName: string, data: Record<string, unknown>): Promise<string> {
  ensureInit();
  const template = getCompiledTemplate(templateName);
  const logoSrc = getLogoBase64();
  const html = template({ ...data, logoSrc });
  return html;
}

export function clearCache(): void {
  compiledCache.clear();
  initialized = false;
}
