import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Get the index.html resource to check its blob status
  const indexResource = await client.getObject({ 
    id: '0xb68cb180f73f916166615a1170a6123e23127ab1e4446c6bb116ef1740ea2cdc', 
    options: { showContent: true }
  });
  
  if (indexResource.data?.content && 'fields' in indexResource.data.content) {
    const fields = indexResource.data.content.fields as any;
    console.log('index.html resource:', JSON.stringify(fields, null, 2));
  }
  
  // Also check the site-builder package being used
  // The site uses package 0x26eb7ee8688da02c5f671679524e379f0b837a12f1d1d799f255b7eea260ad27
  // Let's check if the portal expects a specific package version
  
  // Check if our base36-encoded site URL works
  // base36 of site object ID
  const siteId = '0x222038af8d8af92796691f4d0f31ea5e460622f16e8ec484faf1473144a8bd07';
  const hex = siteId.slice(2);
  const bigNum = BigInt('0x' + hex);
  const base36 = bigNum.toString(36);
  console.log('\nBase36 site ID:', base36);
  console.log('Direct URL:', `https://${base36}.walrus.site`);
  
  // Try fetching directly from walrus.site
  console.log('\nTrying direct walrus.site URL...');
  try {
    const resp = await fetch(`https://${base36}.walrus.site`, { 
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
    console.log('walrus.site response:', resp.status, resp.statusText);
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => headers[k] = v);
    console.log('Headers:', JSON.stringify(headers, null, 2));
  } catch (e: any) {
    console.log('walrus.site error:', e.message);
  }
  
  // Try wal.app
  console.log('\nTrying suibets.wal.app...');
  try {
    const resp2 = await fetch('https://suibets.wal.app', {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
    console.log('wal.app response:', resp2.status, resp2.statusText);
  } catch (e: any) {
    console.log('wal.app error:', e.message);
  }
}

main().catch(e => console.error(e.message));
