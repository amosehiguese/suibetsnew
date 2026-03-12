import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Wait a bit and re-check
  await new Promise(r => setTimeout(r, 3000));
  
  const resolved = await client.resolveNameServiceAddress({ name: 'suibets.sui' });
  console.log('suibets.sui resolves to:', resolved);
  console.log('Expected new site:', '0x0905734df8e94345dedb0ed9f5e2915e4f4529a30f14d7f8aa96f2dcb354b0e0');
  console.log('Match:', resolved === '0x0905734df8e94345dedb0ed9f5e2915e4f4529a30f14d7f8aa96f2dcb354b0e0');
  
  // Verify via TX
  const tx = await client.getTransactionBlock({
    digest: '3hq83T4izWEnnpRw3KqiBPqSuHT4y9gFgokjaZEJDLsq',
    options: { showEffects: true, showObjectChanges: true }
  });
  console.log('\nTX status:', tx.effects?.status?.status);
  console.log('Mutated objects:', tx.effects?.mutated?.length);
  
  // Check if there's a cached NameRecord in the registry
  // The old target might be cached at the RPC level
  // Let me look at the name object directly
  const nameObj = await client.getObject({ 
    id: '0x37bef7ac855aa1ff3d33cf59bb7dd4ca30d8aad557866d7075ad907fd8ca4f07', 
    options: { showContent: true }
  });
  
  // The set_target_address modifies the NameRecord in the registry, not the name object itself
  // The resolver uses the registry to look up the target
  // Let me check if the TX actually updated the right thing
  if (tx.objectChanges) {
    for (const change of tx.objectChanges) {
      console.log('Object change:', JSON.stringify(change).substring(0, 200));
    }
  }
  
  // Try testing the portal
  console.log('\nTesting portal...');
  try {
    const resp = await fetch('https://suibets.wal.app', {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
    console.log('Portal response:', resp.status, resp.statusText);
  } catch (e: any) {
    console.log('Portal error:', e.message);
  }
  
  // Try the base36 URL directly
  const newSiteId = '0x0905734df8e94345dedb0ed9f5e2915e4f4529a30f14d7f8aa96f2dcb354b0e0';
  const hex = newSiteId.slice(2);
  const bigNum = BigInt('0x' + hex);
  const base36 = bigNum.toString(36);
  console.log('\nNew base36 site ID:', base36);
  
  try {
    const resp2 = await fetch(`https://${base36}.wal.app`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
    console.log('Direct base36 response:', resp2.status, resp2.statusText);
  } catch (e: any) {
    console.log('Direct base36 error:', e.message);
  }
}

main().catch(e => console.error(e.message));
