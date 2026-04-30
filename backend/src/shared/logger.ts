const LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LEVELS: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold = LEVELS[LEVEL] ?? 1;

function ts(): string {
  return new Date().toISOString();
}

function fmt(level: string, tag: string, msg: string, data?: Record<string, unknown>): string {
  const base = `${ts()} [${level.toUpperCase()}] [${tag}] ${msg}`;
  return data ? `${base} ${JSON.stringify(data)}` : base;
}

export const logger = {
  debug: (tag: string, msg: string, data?: Record<string, unknown>) => {
    if (threshold <= 0) process.stdout.write(fmt('debug', tag, msg, data) + '\n');
  },
  info: (tag: string, msg: string, data?: Record<string, unknown>) => {
    if (threshold <= 1) process.stdout.write(fmt('info', tag, msg, data) + '\n');
  },
  warn: (tag: string, msg: string, data?: Record<string, unknown>) => {
    if (threshold <= 2) process.stderr.write(fmt('warn', tag, msg, data) + '\n');
  },
  error: (tag: string, msg: string, data?: Record<string, unknown>) => {
    process.stderr.write(fmt('error', tag, msg, data) + '\n');
  },
};
