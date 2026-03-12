import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

const SUINS_NAME_OBJECT = '0x37bef7ac855aa1ff3d33cf59bb7dd4ca30d8aad557866d7075ad907fd8ca4f07';
const NEW_SITE_OBJECT = '0x7e58a763a8270673f0a45cbc857858dbc0ab4ecaf0158c97b7edd3f5b7c87e3b';
const SUINS_REGISTRY = '0x6e0ddefc0ad98889c04bab9639e512c21766c5e6366f89e696956d9be6952871';
const SUINS_V2_PACKAGE = '0x71af035413ed499710980ed8adb010bbf2cc5cacf4ab37c7710a4bb87eb58ba5';
const SUI_CLOCK = '0x6';

async function main() {
  const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const privateKey = process.env.ADMIN_PRIVATE_KEY!;
  let keypair: Ed25519Keypair;
  try {
    const { secretKey } = decodeSuiPrivateKey(privateKey);
    keypair = Ed25519Keypair.fromSecretKey(secretKey);
  } catch {
    const cleanKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    keypair = Ed25519Keypair.fromSecretKey(Buffer.from(cleanKey, 'hex'));
  }
  
  const tx = new Transaction();
  tx.setGasBudget(50_000_000);
  tx.moveCall({
    target: `${SUINS_V2_PACKAGE}::controller::set_target_address`,
    arguments: [
      tx.object(SUINS_REGISTRY),
      tx.object(SUINS_NAME_OBJECT),
      tx.pure.option('address', NEW_SITE_OBJECT),
      tx.object(SUI_CLOCK),
    ],
  });
  
  const result = await client.signAndExecuteTransaction({
    signer: keypair, transaction: tx, options: { showEffects: true }
  });
  
  console.log('TX:', result.digest, 'Status:', result.effects?.status?.status);
  
  // Wait and verify
  await new Promise(r => setTimeout(r, 3000));
  const resolved = await client.resolveNameServiceAddress({ name: 'suibets.sui' });
  console.log('suibets.sui ->', resolved);
  console.log('Match:', resolved === NEW_SITE_OBJECT);
  
  // Now test if the new blobs are accessible
  const dynFields = await client.getDynamicFields({ parentId: NEW_SITE_OBJECT, limit: 20 });
  const indexField = dynFields.data.find(f => (f.name as any).value?.path === '/index.html');
  if (indexField) {
    const indexObj = await client.getObject({ id: indexField.objectId, options: { showContent: true } });
    if (indexObj.data?.content && 'fields' in indexObj.data.content) {
      const resource = (indexObj.data.content.fields as any).value.fields;
      const blobIdBigInt = BigInt(resource.blob_id);
      const bytes = [];
      let n = blobIdBigInt;
      while (n > 0n) { bytes.unshift(Number(n & 0xFFn)); n >>= 8n; }
      while (bytes.length < 32) bytes.unshift(0);
      const b64 = Buffer.from(bytes).toString('base64url');
      console.log('\nindex.html blob:', b64);
      
      const resp = await fetch(`https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${b64}`, {
        signal: AbortSignal.timeout(15000)
      });
      console.log('Blob aggregator:', resp.status, resp.statusText);
      if (resp.ok) {
        const text = await resp.text();
        console.log('Content:', text.substring(0, 100));
      }
    }
  }
  
  // Test wal.app portal
  console.log('\nTesting suibets.wal.app...');
  const resp = await fetch('https://suibets.wal.app', { signal: AbortSignal.timeout(15000) });
  console.log('Portal:', resp.status);
  if (resp.ok) {
    const text = await resp.text();
    console.log('Content:', text.substring(0, 100));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
