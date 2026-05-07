import dotenv from 'dotenv';
dotenv.config();

// All secrets MUST come from env vars in production.
// Fallbacks are for local dev only — will log warnings.
function requireEnv(key: string, fallback: string): string {
  const val = process.env[key];
  if (!val) {
    console.warn(`[CONFIG] WARNING: ${key} not set — using dev fallback. Set in production!`);
    return fallback;
  }
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '5000'),
  cloudErpUrl: process.env.CLOUD_ERP_URL || 'https://app.mspil.in/api',
  cloudApiKey: requireEnv('CLOUD_API_KEY', 'mspil-wb-2026'),
  cloudDatabaseUrl: process.env.CLOUD_DATABASE_URL || '',
  wbApiKey: requireEnv('WB_API_KEY', 'mspil-wb-2026'),
  jwtSecret: requireEnv('JWT_SECRET', 'mspil-factory-jwt-2026'),
  // Local Python bridge (biometric-bridge) on the same factory PC.
  // Empty key = biometric scheduler stays disabled (factory not in biometric mode).
  biometricBridgeUrl: process.env.BIOMETRIC_BRIDGE_URL || 'http://127.0.0.1:5005',
  biometricBridgeKey: process.env.BIOMETRIC_BRIDGE_KEY || '',
};
