import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Weighbridge IP cameras — digest auth
const CAMERAS = [
  { id: 'cam1', ip: '192.168.0.233', name: 'Camera 1' },
  { id: 'cam2', ip: '192.168.0.239', name: 'Camera 2' },
];
const CAM_USER = 'admin';
const CAM_PASS = 'admin123';
const SNAPSHOT_PATH = '/cgi-bin/snapshot.cgi';
const SNAPSHOT_DIR = path.join(__dirname, '..', '..', 'data', 'snapshots');

/** Parse digest auth challenge from 401 response */
function parseDigestChallenge(header: string): Record<string, string> {
  const parts: Record<string, string> = {};
  const matches = header.matchAll(/(\w+)=(?:"([^"]+)"|([^\s,]+))/g);
  for (const m of matches) {
    parts[m[1]] = m[2] || m[3];
  }
  return parts;
}

/** Build digest auth header */
function buildDigestAuth(method: string, uri: string, challenge: Record<string, string>): string {
  const nc = '00000001';
  const cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = crypto.createHash('md5').update(`${CAM_USER}:${challenge.realm}:${CAM_PASS}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
  const response = crypto.createHash('md5').update(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop || 'auth'}:${ha2}`).digest('hex');
  return `Digest username="${CAM_USER}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", qop=${challenge.qop || 'auth'}, nc=${nc}, cnonce="${cnonce}", response="${response}"`;
}

/** Fetch JPEG snapshot from IP camera using digest auth */
async function fetchSnapshot(ip: string): Promise<Buffer | null> {
  const url = `http://${ip}${SNAPSHOT_PATH}`;
  try {
    // Step 1: Get 401 challenge
    const challengeRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (challengeRes.status !== 401) {
      // Some cameras return image without auth
      if (challengeRes.ok) {
        const buf = Buffer.from(await challengeRes.arrayBuffer());
        return buf.length > 1000 ? buf : null;
      }
      return null;
    }
    const wwwAuth = challengeRes.headers.get('www-authenticate');
    if (!wwwAuth) return null;

    // Step 2: Respond with digest auth
    const challenge = parseDigestChallenge(wwwAuth);
    const authHeader = buildDigestAuth('GET', SNAPSHOT_PATH, challenge);
    const imageRes = await fetch(url, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(5000),
    });
    if (!imageRes.ok) return null;
    const buf = Buffer.from(await imageRes.arrayBuffer());
    return buf.length > 1000 ? buf : null; // Sanity check — real JPEG > 1KB
  } catch (err) {
    console.error(`[CAMERA] Snapshot failed for ${ip}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Capture snapshots from all cameras. Fire-and-forget — never throws.
 * Saves to data/snapshots/{weighmentId}/{type}_cam1.jpg etc.
 * Returns paths of saved files (relative to snapshots dir).
 */
export async function captureSnapshots(weighmentId: string, type: 'gross' | 'tare'): Promise<string[]> {
  const saved: string[] = [];
  try {
    const dir = path.join(SNAPSHOT_DIR, weighmentId);
    fs.mkdirSync(dir, { recursive: true });

    const results = await Promise.allSettled(
      CAMERAS.map(async (cam) => {
        const buf = await fetchSnapshot(cam.ip);
        if (buf) {
          const filename = `${type}_${cam.id}.jpg`;
          const filepath = path.join(dir, filename);
          fs.writeFileSync(filepath, buf);
          saved.push(`${weighmentId}/${filename}`);
          console.log(`[CAMERA] Saved ${filename} (${Math.round(buf.length / 1024)}KB) for ${weighmentId}`);
        }
      })
    );
    // Log any failures
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[CAMERA] ${CAMERAS[i].id} failed:`, r.reason);
      }
    });
  } catch (err) {
    console.error('[CAMERA] captureSnapshots error:', err instanceof Error ? err.message : err);
  }
  return saved;
}

/** Get camera status — check if cameras are reachable */
export async function getCameraStatus(): Promise<Array<{ id: string; ip: string; name: string; alive: boolean }>> {
  const results = await Promise.allSettled(
    CAMERAS.map(async (cam) => {
      try {
        const res = await fetch(`http://${cam.ip}/`, { signal: AbortSignal.timeout(2000) });
        return { ...cam, alive: res.status === 200 || res.status === 401 }; // 401 = alive but needs auth
      } catch {
        return { ...cam, alive: false };
      }
    })
  );
  return results.map((r, i) => r.status === 'fulfilled' ? r.value : { ...CAMERAS[i], alive: false });
}
