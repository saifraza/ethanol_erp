/**
 * Test Saral GSP API connectivity
 * Run: node backend/test-saral-api.js
 *
 * This script ONLY tests auth and endpoint reachability.
 * It does NOT generate any real e-Way Bills or e-Invoices.
 */

const SARAL_URL = 'https://saralgsp.com';

// Use Railway env vars — fill these in or set as env
const CLIENT_ID = process.env.EWAY_NIC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.EWAY_NIC_CLIENT_SECRET || '';
const EWB_USERNAME = process.env.EWAY_EWB_USERNAME || '';
const EWB_PASSWORD = process.env.EWAY_EWB_PASSWORD || '';
const GSTIN = process.env.EWAY_GSTIN || '23AAECM3666P1Z1';

async function testSaralAuth() {
  console.log('\n=== Step 1: Saral GSP Authentication ===');
  console.log(`URL: ${SARAL_URL}/authentication/Authenticate`);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.log('❌ SKIP: EWAY_NIC_CLIENT_ID and EWAY_NIC_CLIENT_SECRET not set');
    return null;
  }

  try {
    const resp = await fetch(`${SARAL_URL}/authentication/Authenticate`, {
      method: 'GET',
      headers: { 'ClientId': CLIENT_ID, 'ClientSecret': CLIENT_SECRET },
    });
    const data = await resp.json();
    const token = data.authenticationToken || data.AuthenticationToken;
    const subId = data.subscriptionId || data.SubscriptionId;

    if (token) {
      console.log(`✅ Saral auth SUCCESS`);
      console.log(`   Token: ${token.slice(0, 20)}...`);
      console.log(`   SubscriptionId: ${subId}`);
      return { token, subId };
    } else {
      console.log('❌ Saral auth FAILED:', JSON.stringify(data).slice(0, 300));
      return null;
    }
  } catch (err) {
    console.log('❌ Saral auth ERROR:', err.message, err.cause ? `(${err.cause.code || err.cause.message})` : '');
    return null;
  }
}

async function testIrpAuth(saralAuth) {
  console.log('\n=== Step 2: IRP Authentication (e-Invoice/EWB) ===');
  console.log(`URL: ${SARAL_URL}/eivital/v1.04/auth`);

  if (!saralAuth || !EWB_USERNAME || !EWB_PASSWORD) {
    console.log('❌ SKIP: Need Saral auth + EWAY_EWB_USERNAME + EWAY_EWB_PASSWORD');
    return null;
  }

  try {
    const resp = await fetch(`${SARAL_URL}/eivital/v1.04/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AuthenticationToken': saralAuth.token,
        'SubscriptionId': saralAuth.subId,
        'Gstin': GSTIN,
        'UserName': EWB_USERNAME,
        'Password': EWB_PASSWORD,
      },
    });
    const text = await resp.text();
    console.log(`   Status: ${resp.status}`);

    const data = JSON.parse(text);
    if (data.status === 1 || data.status === '1') {
      const d = data.data || data;
      console.log(`✅ IRP auth SUCCESS`);
      console.log(`   AuthToken: ${(d.authToken || d.AuthToken || '').slice(0, 20)}...`);
      console.log(`   SEK: ${(d.sek || d.Sek || '').slice(0, 20)}...`);
      console.log(`   Expiry: ${d.tokenExpiry}`);
      return {
        authToken: d.authToken || d.AuthToken,
        sek: d.sek || d.Sek,
      };
    } else {
      console.log('❌ IRP auth FAILED:', text.slice(0, 300));
      return null;
    }
  } catch (err) {
    console.log('❌ IRP auth ERROR:', err.message, err.cause ? `(${err.cause.code || err.cause.message})` : '');
    return null;
  }
}

async function testEndpointReachability(saralAuth, irpAuth) {
  console.log('\n=== Step 3: Test Endpoint Reachability ===');

  const endpoints = [
    { path: '/eiewb/v1.03/ewaybill', method: 'POST', name: 'Generate EWB from IRN (production)', body: '{}' },
    { path: '/eicore/v1.03/Invoice', method: 'POST', name: 'Generate IRN (e-Invoice)', body: '{}' },
    { path: '/v1.03/ewayapi', method: 'POST', name: 'Cancel EWB', body: '{}' },
  ];

  for (const ep of endpoints) {
    console.log(`\n   Testing: ${ep.name} [${ep.method} ${ep.path}]`);

    const headers = { 'Content-Type': 'application/json' };
    if (saralAuth) {
      headers['AuthenticationToken'] = saralAuth.token;
      headers['SubscriptionId'] = saralAuth.subId;
      headers['Gstin'] = GSTIN;
      headers['UserName'] = EWB_USERNAME;
    }
    if (irpAuth) {
      headers['AuthToken'] = irpAuth.authToken;
      headers['sek'] = irpAuth.sek;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const resp = await fetch(`${SARAL_URL}${ep.path}`, {
        method: ep.method,
        headers,
        body: ep.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const text = await resp.text();
      console.log(`   ✅ Reachable — HTTP ${resp.status}`);
      console.log(`   Response: ${text.slice(0, 200)}`);
    } catch (err) {
      clearTimeout(timeout);
      const cause = err.cause ? `${err.cause.code || err.cause.message || err.cause}` : '';
      if (err.name === 'AbortError') {
        console.log(`   ❌ TIMEOUT (15s) — endpoint may not exist or is hanging`);
      } else {
        console.log(`   ❌ FAILED: ${err.message} ${cause ? `(${cause})` : ''}`);
      }
    }
  }
}

async function main() {
  console.log('========================================');
  console.log('  Saral GSP API Connectivity Test');
  console.log('========================================');
  console.log(`Base URL: ${SARAL_URL}`);
  console.log(`GSTIN: ${GSTIN}`);
  console.log(`Client ID: ${CLIENT_ID ? CLIENT_ID.slice(0, 10) + '...' : 'NOT SET'}`);
  console.log(`EWB Username: ${EWB_USERNAME || 'NOT SET'}`);

  const saralAuth = await testSaralAuth();
  const irpAuth = await testIrpAuth(saralAuth);
  await testEndpointReachability(saralAuth, irpAuth);

  console.log('\n========================================');
  console.log('  Summary');
  console.log('========================================');
  console.log(`Saral Auth: ${saralAuth ? '✅' : '❌'}`);
  console.log(`IRP Auth:   ${irpAuth ? '✅' : '❌'}`);

  if (saralAuth && irpAuth) {
    console.log('\n💡 Auth works! The "fetch failed" error you saw was because:');
    console.log('   /eiewb/v1.03/ewaybill is the "Generate EWB from IRN" endpoint.');
    console.log('   It requires an e-Invoice IRN first. Standalone EWB is not');
    console.log('   available in Saral production — only in sandbox.');
    console.log('\n   SOLUTION: Generate e-Invoice (IRN) first, then generate');
    console.log('   EWB from that IRN using /eiewb/v1.03/ewaybill.');
  }
}

main().catch(console.error);
