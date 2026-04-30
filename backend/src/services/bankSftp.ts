/**
 * UBI H2H SFTP Service — Upload payment files, download ACK/NACK and reports.
 *
 * MOCK MODE: If UBI_SFTP_HOST is not set, files are saved to/read from
 * backend/data/bank-files/ directory instead of SFTP. This allows full
 * end-to-end testing without bank connectivity.
 *
 * PRODUCTION MODE: Connects to UBI's SFTP server via ssh2-sftp-client.
 *
 * Directory structure on UBI SFTP:
 * /MAHAKAUSHAL/H2HPROD/Payments/Inward/IN/          ← upload payment files
 * /MAHAKAUSHAL/H2HPROD/Payments/Ack_Nack/OUT/       ← download ACK/NACK
 * /MAHAKAUSHAL/H2HPROD/Payments/Ack_Nack/Archive/   ← move read ACK/NACKs
 * /MAHAKAUSHAL/H2HPROD/Payments/Reports/Scheduled/OUT/     ← download statements
 * /MAHAKAUSHAL/H2HPROD/Payments/Reports/Scheduled/Archive/ ← move read reports
 */

import path from 'path';
import fs from 'fs';

// Directory paths relative to base
const PATHS = {
  PAYMENT_INWARD: 'Payments/Inward/IN',
  PAYMENT_ARCHIVE: 'Payments/Inward/Archive',
  ACK_NACK_OUT: 'Payments/Ack_Nack/OUT',
  ACK_NACK_ARCHIVE: 'Payments/Ack_Nack/Archive',
  REPORTS_OUT: 'Payments/Reports/Scheduled/OUT',
  REPORTS_ARCHIVE: 'Payments/Reports/Scheduled/Archive',
};

interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  basePath: string;
}

function getConfig(): SftpConfig | null {
  const host = process.env.UBI_SFTP_HOST;
  if (!host) return null;
  return {
    host,
    port: parseInt(process.env.UBI_SFTP_PORT || '22'),
    username: process.env.UBI_SFTP_USER || '',
    password: process.env.UBI_SFTP_PASS || '',
    basePath: process.env.UBI_SFTP_BASE_PATH || '/MAHAKAUSHAL/H2HPROD',
  };
}

/** Get mock directory for local testing */
function getMockDir(subPath: string): string {
  const dir = path.join(process.cwd(), 'data', 'bank-files', subPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isSftpConfigured(): boolean {
  return getConfig() !== null;
}

/**
 * Upload an encrypted payment file to bank's SFTP.
 * In mock mode, saves to data/bank-files/Payments/Inward/IN/
 */
export async function uploadPaymentFile(fileName: string, fileBuffer: Buffer): Promise<{ success: boolean; path: string; error?: string }> {
  const config = getConfig();

  if (!config) {
    // MOCK MODE — save locally
    const mockDir = getMockDir(PATHS.PAYMENT_INWARD);
    const filePath = path.join(mockDir, fileName);
    fs.writeFileSync(filePath, fileBuffer);
    console.log(`[BankSFTP] MOCK: Payment file saved to ${filePath} (${fileBuffer.length} bytes)`);
    return { success: true, path: filePath };
  }

  // PRODUCTION MODE — upload via SFTP
  try {
    const SftpClient = (await import('ssh2-sftp-client')).default;
    const sftp = new SftpClient();
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: 30000,
      retries: 2,
    });

    const remotePath = `${config.basePath}/${PATHS.PAYMENT_INWARD}/${fileName}`;
    await sftp.put(fileBuffer, remotePath);
    await sftp.end();

    console.log(`[BankSFTP] PROD: Payment file uploaded to ${remotePath} (${fileBuffer.length} bytes)`);
    return { success: true, path: remotePath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : 'SFTP upload failed';
    console.error(`[BankSFTP] PROD: Upload failed — ${msg}`);
    return { success: false, path: '', error: msg };
  }
}

/**
 * List and download ACK/NACK files from bank's SFTP.
 * In mock mode, reads from data/bank-files/Payments/Ack_Nack/OUT/
 */
export async function checkAckNack(): Promise<Array<{ fileName: string; content: Buffer; type: 'ACK' | 'NACK' }>> {
  const results: Array<{ fileName: string; content: Buffer; type: 'ACK' | 'NACK' }> = [];
  const config = getConfig();

  if (!config) {
    // MOCK MODE — read local files
    const mockDir = getMockDir(PATHS.ACK_NACK_OUT);
    const archiveDir = getMockDir(PATHS.ACK_NACK_ARCHIVE);
    const files = fs.readdirSync(mockDir).filter(f => f.endsWith('_ACK.csv') || f.endsWith('_ACK.xls') || f.endsWith('_NACK.csv') || f.endsWith('_NACK.xls'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(mockDir, file));
      const type = file.includes('_ACK') ? 'ACK' as const : 'NACK' as const;
      results.push({ fileName: file, content, type });
      // Move to archive
      fs.renameSync(path.join(mockDir, file), path.join(archiveDir, file));
    }
    if (results.length > 0) {
      console.log(`[BankSFTP] MOCK: Found ${results.length} ACK/NACK file(s)`);
    }
    return results;
  }

  // PRODUCTION MODE
  try {
    const SftpClient = (await import('ssh2-sftp-client')).default;
    const sftp = new SftpClient();
    await sftp.connect({
      host: config.host, port: config.port,
      username: config.username, password: config.password,
      readyTimeout: 30000,
    });

    const remotePath = `${config.basePath}/${PATHS.ACK_NACK_OUT}`;
    const archivePath = `${config.basePath}/${PATHS.ACK_NACK_ARCHIVE}`;
    const fileList = await sftp.list(remotePath);

    for (const file of fileList) {
      if (file.type !== '-') continue; // skip directories
      if (!file.name.includes('_ACK') && !file.name.includes('_NACK')) continue;

      const content = await sftp.get(`${remotePath}/${file.name}`) as Buffer;
      const type = file.name.includes('_ACK') ? 'ACK' as const : 'NACK' as const;
      results.push({ fileName: file.name, content, type });

      // Move to archive
      await sftp.rename(`${remotePath}/${file.name}`, `${archivePath}/${file.name}`);
    }

    await sftp.end();
    if (results.length > 0) {
      console.log(`[BankSFTP] PROD: Found ${results.length} ACK/NACK file(s)`);
    }
    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : 'SFTP read failed';
    console.error(`[BankSFTP] PROD: ACK/NACK check failed — ${msg}`);
    return [];
  }
}

/**
 * List and download bank statement/report files.
 * In mock mode, reads from data/bank-files/Payments/Reports/Scheduled/OUT/
 */
export async function downloadReports(): Promise<Array<{ fileName: string; content: Buffer }>> {
  const results: Array<{ fileName: string; content: Buffer }> = [];
  const config = getConfig();

  if (!config) {
    const mockDir = getMockDir(PATHS.REPORTS_OUT);
    const archiveDir = getMockDir(PATHS.REPORTS_ARCHIVE);
    const files = fs.readdirSync(mockDir).filter(f => !f.startsWith('.'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(mockDir, file));
      results.push({ fileName: file, content });
      fs.renameSync(path.join(mockDir, file), path.join(archiveDir, file));
    }
    if (results.length > 0) {
      console.log(`[BankSFTP] MOCK: Found ${results.length} report file(s)`);
    }
    return results;
  }

  try {
    const SftpClient = (await import('ssh2-sftp-client')).default;
    const sftp = new SftpClient();
    await sftp.connect({
      host: config.host, port: config.port,
      username: config.username, password: config.password,
      readyTimeout: 30000,
    });

    const remotePath = `${config.basePath}/${PATHS.REPORTS_OUT}`;
    const archivePath = `${config.basePath}/${PATHS.REPORTS_ARCHIVE}`;
    const fileList = await sftp.list(remotePath);

    for (const file of fileList) {
      if (file.type !== '-') continue;
      const content = await sftp.get(`${remotePath}/${file.name}`) as Buffer;
      results.push({ fileName: file.name, content });
      await sftp.rename(`${remotePath}/${file.name}`, `${archivePath}/${file.name}`);
    }

    await sftp.end();
    if (results.length > 0) {
      console.log(`[BankSFTP] PROD: Found ${results.length} report file(s)`);
    }
    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : 'SFTP read failed';
    console.error(`[BankSFTP] PROD: Reports download failed — ${msg}`);
    return [];
  }
}
