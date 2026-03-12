import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Get the index.html resource from the site
  const indexRes = await client.getObject({ 
    id: '0xb68cb180f73f916166615a1170a6123e23127ab1e4446c6bb116ef1740ea2cdc', 
    options: { showContent: true }
  });
  
  if (indexRes.data?.content && 'fields' in indexRes.data.content) {
    const fields = indexRes.data.content.fields as any;
    const resource = fields.value.fields;
    console.log('index.html blob_id:', resource.blob_id);
    console.log('index.html blob_hash:', resource.blob_hash);
    
    // Convert blob_id (decimal) to walrus format (base64url)
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
    
    // Try to fetch the blob from Walrus aggregator
    console.log('\nFetching from Walrus aggregator...');
    try {
      const resp = await fetch(`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${b64}`, {
        signal: AbortSignal.timeout(15000)
      });
      console.log('Aggregator response:', resp.status, resp.statusText);
      if (resp.ok) {
        const text = await resp.text();
        console.log('Content (first 200 chars):', text.substring(0, 200));
      }
    } catch (e: any) {
      console.log('Aggregator error:', e.message);
    }
  }
  
  // Also check if the site resources have updated (look at quilt patches)
  const dynFields = await client.getDynamicFields({
    parentId: '0x222038af8d8af92796691f4d0f31ea5e460622f16e8ec484faf1473144a8bd07',
    limit: 20,
  });
  console.log('\nSite resources:', dynFields.data.length);
  for (const f of dynFields.data) {
    const name = f.name as any;
    console.log(`  ${name.value?.path || JSON.stringify(name)}`);
  }
}

main().catch(e => console.error(e.message));
