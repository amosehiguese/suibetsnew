import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Check the Walrus site object
  const siteObj = await client.getObject({ 
    id: '0x222038af8d8af92796691f4d0f31ea5e460622f16e8ec484faf1473144a8bd07', 
    options: { showContent: true, showType: true, showOwner: true }
  });
  
  console.log('Site object type:', siteObj.data?.type);
  console.log('Site object owner:', JSON.stringify(siteObj.data?.owner));
  
  if (siteObj.data?.content && 'fields' in siteObj.data.content) {
    const fields = siteObj.data.content.fields as any;
    console.log('\nSite fields:', JSON.stringify(fields, null, 2));
  }
  
  // Check dynamic fields (pages/resources)
  const dynFields = await client.getDynamicFields({
    parentId: '0x222038af8d8af92796691f4d0f31ea5e460622f16e8ec484faf1473144a8bd07',
    limit: 10,
  });
  console.log('\nDynamic fields (pages):', dynFields.data.length);
  dynFields.data.forEach(f => {
    console.log(`  ${JSON.stringify(f.name)} -> ${f.objectId}`);
  });
  
  // Also check how the wal.app portal resolves names
  // The portal uses the format: <name>.wal.app
  // It resolves the SuiNS name and looks for a Site object at that address
  
  // Let's also check if there are any name service names pointing to this address
  const names = await client.resolveNameServiceNames({ 
    address: '0x222038af8d8af92796691f4d0f31ea5e460622f16e8ec484faf1473144a8bd07' 
  });
  console.log('\nReverse lookup names for site object:', JSON.stringify(names));
}

main().catch(e => console.error(e.message));
