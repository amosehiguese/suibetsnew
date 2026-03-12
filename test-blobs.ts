import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Get resources from the new site
  const dynFields = await client.getDynamicFields({
    parentId: '0x0905734df8e94345dedb0ed9f5e2915e4f4529a30f14d7f8aa96f2dcb354b0e0',
    limit: 20,
  });
  
  console.log('New site resources:', dynFields.data.length);
  
  // Get the index.html resource
  const indexField = dynFields.data.find(f => {
    const name = f.name as any;
    return name.value?.path === '/index.html';
  });
  
  if (indexField) {
    const indexObj = await client.getObject({ 
      id: indexField.objectId, 
      options: { showContent: true }
    });
    
    if (indexObj.data?.content && 'fields' in indexObj.data.content) {
      const resource = (indexObj.data.content.fields as any).value.fields;
      console.log('\nindex.html blob_id:', resource.blob_id);
      
      // Convert to base64url
      const blobIdBigInt = BigInt(resource.blob_id);
      const bytes = [];
      let n = blobIdBigInt;
      while (n > 0n) {
        bytes.unshift(Number(n & 0xFFn));
        n >>= 8n;
      }
      while (bytes.length < 32) bytes.unshift(0);
      const b64 = Buffer.from(bytes).toString('base64url');
      console.log('Blob ID (base64url):', b64);
      
      // Test if blob is accessible
      console.log('\nFetching from Walrus aggregator...');
      try {
        const resp = await fetch(`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${b64}`, {
          signal: AbortSignal.timeout(15000)
        });
        console.log('Status:', resp.status, resp.statusText);
        if (resp.ok) {
          const text = await resp.text();
          console.log('Content preview (first 300):', text.substring(0, 300));
        }
      } catch (e: any) {
        console.log('Error:', e.message);
      }
    }
  }
  
  // Also try the wal.app with cache bypass
  console.log('\nTrying wal.app with cache bypass...');
  try {
    const resp = await fetch('https://suibets.wal.app/', {
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      signal: AbortSignal.timeout(15000)
    });
    console.log('wal.app status:', resp.status);
    const text = await resp.text();
    console.log('wal.app content (first 200):', text.substring(0, 200));
  } catch (e: any) {
    console.log('wal.app error:', e.message);
  }
}

main().catch(e => console.error(e.message));
