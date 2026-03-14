/**
 * Creates a SBETS/SUI Concentrated Liquidity Market Maker (CLMM) pool on Bluefin Spot DEX.
 *
 * Run with:  npx tsx scripts/create-bluefin-sbets-pool.ts
 *
 * Requires ADMIN_PRIVATE_KEY env var (the admin wallet private key, hex encoded).
 *
 * Pool parameters:
 *   - CoinA : SUI   (0x2::sui::SUI, 9 decimals)
 *   - CoinB : SBETS (9 decimals)
 *   - Fee   : 0.3%  (3000 in 1e6 format, standard for volatile/new tokens)
 *   - Tick spacing : 60  (matches 0.3% fee tier)
 *   - Initial price: 1,000,000 SBETS per 1 SUI
 *
 * After running this script, note the Pool Object ID from the output
 * and pass it to add-bluefin-sbets-liquidity.ts to seed initial liquidity.
 */

import { Transaction } from "@mysten/sui/transactions";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

// ── Bluefin Spot CLMM contract ───────────────────────────────────────────────
const BLUEFIN_SPOT_PKG =
  "0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267";
const CLOCK = "0x0000000000000000000000000000000000000000000000000000000000000006";

// ── Token types ───────────────────────────────────────────────────────────────
const SUI_TYPE = "0x2::sui::SUI";
const SBETS_TYPE =
  "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS";

// ── Pool configuration ────────────────────────────────────────────────────────
//   CoinA = SUI (address 0x2  < SBETS address, so SUI is always CoinA)
//   CoinB = SBETS
//   Initial price: 1,000,000 SBETS per 1 SUI
//     P        = 1_000_000  (SBETS per SUI, both 9 decimals → raw ratio identical)
//     sqrt(P)  = 1_000
//     sqrtPriceX64 = 1_000 * 2^64 = 18_446_744_073_709_551_616_000
const POOL_NAME = "SUI-SBETS";
const POOL_ICON_URL = ""; // optional: point to an image
const COIN_A_SYMBOL = "SUI";
const COIN_A_DECIMALS = 9;
const COIN_A_URL = "";
const COIN_B_SYMBOL = "SBETS";
const COIN_B_DECIMALS = 9;
const COIN_B_URL = "https://suibets.io"; // optional metadata URL
const TICK_SPACING = 60; // standard for 0.3 % pools
const FEE_BASIS_POINTS = BigInt(3000); // 3000 / 1_000_000 = 0.003 = 0.3 %
const SQRT_PRICE_X64 = BigInt("18446744073709551616000"); // sqrt(1e6) * 2^64

async function main() {
  const privateKeyHex = process.env.ADMIN_PRIVATE_KEY;
  if (!privateKeyHex) {
    console.error(
      "❌  ADMIN_PRIVATE_KEY environment variable is not set.\n" +
        "    Add it via Replit Secrets (Settings → Secrets) then re-run."
    );
    process.exit(1);
  }

  const keypair = Ed25519Keypair.fromSecretKey(
    Buffer.from(privateKeyHex.replace(/^0x/, ""), "hex")
  );
  const walletAddress = keypair.toSuiAddress();
  console.log("🔑  Admin wallet:", walletAddress);

  const client = new SuiClient({ url: getFullnodeUrl("mainnet") });

  // Build the transaction
  const tx = new Transaction();
  tx.setSender(walletAddress);

  tx.moveCall({
    target: `${BLUEFIN_SPOT_PKG}::gateway::create_pool`,
    typeArguments: [SUI_TYPE, SBETS_TYPE],
    arguments: [
      tx.object(CLOCK),
      tx.pure.vector("u8", Array.from(Buffer.from(POOL_NAME))),
      tx.pure.vector("u8", Array.from(Buffer.from(POOL_ICON_URL))),
      tx.pure.vector("u8", Array.from(Buffer.from(COIN_A_SYMBOL))),
      tx.pure.u8(COIN_A_DECIMALS),
      tx.pure.vector("u8", Array.from(Buffer.from(COIN_A_URL))),
      tx.pure.vector("u8", Array.from(Buffer.from(COIN_B_SYMBOL))),
      tx.pure.u8(COIN_B_DECIMALS),
      tx.pure.vector("u8", Array.from(Buffer.from(COIN_B_URL))),
      tx.pure.u32(TICK_SPACING),
      tx.pure.u64(FEE_BASIS_POINTS),
      tx.pure.u128(SQRT_PRICE_X64),
    ],
  });

  console.log("\n⏳  Submitting create_pool transaction to Sui mainnet …");

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showObjectChanges: true,
      showEffects: true,
    },
  });

  console.log("\n✅  Transaction digest:", result.digest);

  // Find the newly created Pool object
  const poolObject = result.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      change.objectType?.includes("::pool::Pool<")
  );

  if (poolObject && poolObject.type === "created") {
    console.log("\n🎉  Pool created successfully!");
    console.log("    Pool Object ID :", poolObject.objectId);
    console.log(
      "\n    ➡️  Save this Pool Object ID and run add-bluefin-sbets-liquidity.ts"
    );
    console.log(
      `    POOL_ID=${poolObject.objectId}`
    );
  } else {
    console.log("\n⚠️  Could not find Pool object in transaction output.");
    console.log(
      "    Check the transaction on Suiscan:",
      `https://suiscan.xyz/mainnet/tx/${result.digest}`
    );
    console.log("    Full object changes:", JSON.stringify(result.objectChanges, null, 2));
  }
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
