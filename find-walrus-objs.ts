import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // The staking object from the sites config
  const stakingId = '0x10b9d30c28448939ce6c4d6c6e0ffce4a7f8a4ada8248bdad09ef8b70e4a3904';
  const staking = await client.getObject({ id: stakingId, options: { showType: true, showContent: true } });
  console.log('Staking object type:', staking.data?.type);
  
  // Extract the walrus package from the staking object type
  const typeStr = staking.data?.type || '';
  const walrusPkg = typeStr.split('::')[0];
  console.log('Walrus package from staking:', walrusPkg);
  
  // Now we need the system object. Let's check some known IDs
  // The walrus system object is usually created from the same package
  const walrusPackage = '0xfa65cb2d62f4d39e60346fb7d501c12538ca2bbc646eaa37ece2aec5f897814e';
  
  // Let's look for the System object by querying created objects
  // First check a few well-known addresses
  const candidates = [
    '0x4403bec10a5cfa959af59afca3c3b4e64a85c597b6c83ade7847c94c327c28bf',
    '0x98ebc47370603fe81d9e15491b2f1a4191e04a0e36dea023720ba2a65c263a70',
  ];
  
  for (const id of candidates) {
    try {
      const obj = await client.getObject({ id, options: { showType: true } });
      console.log(`${id}: ${obj.data?.type}`);
    } catch (e: any) {
      console.log(`${id}: ${e.message?.substring(0, 80)}`);
    }
  }
  
  // Let's query events from the walrus package to find the system object
  // Or use the staking object's dynamic fields
  if (staking.data?.content && 'fields' in staking.data.content) {
    const fields = staking.data.content.fields as any;
    // Look for system reference in the staking object
    const keys = Object.keys(fields);
    console.log('\nStaking object fields:', keys);
  }
}

main().catch(e => console.error(e.message));
