/**
 * Seeds initial liquidity into the SBETS/SUI Bluefin CLMM pool.
 *
 * Run AFTER create-bluefin-sbets-pool.ts, e.g.:
 *   POOL_ID=0x<pool_object_id> npx tsx scripts/add-bluefin-sbets-liquidity.ts
 *
 * Requires:
 *   - ADMIN_PRIVATE_KEY  env var (admin wallet private key, hex)
 *   - POOL_ID            env var (the Pool Object ID from the create script)
 *
 * What this script does:
 *   1. Opens a position in the SBETS/SUI pool with a wide price range
 *      (60,000 – 276,240 ticks = ~403 to ~14.25M SBETS per SUI)
 *   2. Seeds it with exactly 1,000,000 SBETS and up to 1 SUI
 *   3. Transfers the resulting position NFT to the admin wallet
 *
 * Token amounts:
 *   - SBETS : 1,000,000  (fixed, 9 decimals → 1_000_000_000_000_000 raw)
 *   - SUI   : up to 1.0  (capped,  9 decimals → 1_000_000_000 raw)
 */

import { Transaction } from "@mysten/sui/transactions";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

// ── Bluefin Spot CLMM contract ───────────────────────────────────────────────
const BLUEFIN_SPOT_PKG =
  "0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267";
const GLOBAL_CONFIG =
  "0x03db251ba509a8d5d8777b6338836082335d93eecbdd09a11e190a1cff51c352";
const CLOCK = "0x0000000000000000000000000000000000000000000000000000000000000006";

// ── Token types ───────────────────────────────────────────────────────────────
const SUI_TYPE = "0x2::sui::SUI";
const SBETS_TYPE =
  "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285::sbets::SBETS";
const SBETS_TOKEN_ADDRESS =
  "0x6a4d9c0eab7ac40371a7453d1aa6c89b130950e8af6868ba975fdd81371a7285";

// ── Liquidity position parameters ────────────────────────────────────────────
//   Current pool tick  ≈ 138,162  (at initial price of 1,000,000 SBETS/SUI)
//   We use a wide range that spans this tick on both sides:
//     tick_lower = 60,000   → price ≈     403 SBETS / SUI
//     tick_upper = 276,240  → price ≈ 14,250,000 SBETS / SUI
//   Both are multiples of tick_spacing (60).
const TICK_LOWER = 60000; // u32 on-chain (positive i32 → same value)
const TICK_UPPER = 276240; // u32 on-chain (positive i32 → same value)

// ── Seed amounts ──────────────────────────────────────────────────────────────
const SBETS_AMOUNT_RAW = BigInt("1000000000000000"); // 1,000,000 SBETS (9 dec)
const SUI_MAX_RAW = BigInt("1000000000"); //         1 SUI max (9 dec)

async function main() {
  const privateKeyHex = process.env.ADMIN_PRIVATE_KEY;
  if (!privateKeyHex) {
    console.error(
      "❌  ADMIN_PRIVATE_KEY environment variable is not set.\n" +
        "    Add it via Replit Secrets (Settings → Secrets) then re-run."
    );
    process.exit(1);
  }

  const poolId = process.env.POOL_ID;
  if (!poolId) {
    console.error(
      "❌  POOL_ID environment variable is not set.\n" +
        "    Run create-bluefin-sbets-pool.ts first, then:\n" +
        "    POOL_ID=0x... npx tsx scripts/add-bluefin-sbets-liquidity.ts"
    );
    process.exit(1);
  }

  const keypair = Ed25519Keypair.fromSecretKey(
    Buffer.from(privateKeyHex.replace(/^0x/, ""), "hex")
  );
  const walletAddress = keypair.toSuiAddress();
  console.log("🔑  Admin wallet:", walletAddress);
  console.log("🏊  Pool ID     :", poolId);

  const client = new SuiClient({ url: getFullnodeUrl("mainnet") });

  // ── Find a SBETS coin in the wallet ─────────────────────────────────────────
  console.log("\n🔍  Looking for SBETS coins in wallet …");
  const sbetsCoins = await client.getCoins({
    owner: walletAddress,
    coinType: SBETS_TYPE,
  });

  if (sbetsCoins.data.length === 0) {
    console.error(
      `❌  No SBETS coins found in wallet ${walletAddress}.\n` +
        `    Send at least 1,000,000 SBETS to this address first.`
    );
    process.exit(1);
  }

  // Pick the coin with the largest balance
  const sbetstCoin = sbetsCoins.data.sort(
    (a, b) => Number(BigInt(b.balance) - BigInt(a.balance))
  )[0];
  console.log(
    `    Found SBETS coin: ${sbetstCoin.coinObjectId} (balance: ${BigInt(sbetstCoin.balance) / BigInt(10 ** 9)} SBETS)`
  );

  if (BigInt(sbetstCoin.balance) < SBETS_AMOUNT_RAW) {
    console.error(
      `❌  Insufficient SBETS balance.\n` +
        `    Need:  1,000,000 SBETS\n` +
        `    Have:  ${BigInt(sbetstCoin.balance) / BigInt(10 ** 9)} SBETS`
    );
    process.exit(1);
  }

  // ── Build the Programmable Transaction Block ──────────────────────────────
  const tx = new Transaction();
  tx.setSender(walletAddress);

  // Step 1: Open a position (returns position NFT + leftover)
  const [position] = tx.moveCall({
    target: `${BLUEFIN_SPOT_PKG}::pool::open_position`,
    typeArguments: [SUI_TYPE, SBETS_TYPE],
    arguments: [
      tx.object(GLOBAL_CONFIG),
      tx.object(poolId),
      tx.pure.u32(TICK_LOWER),
      tx.pure.u32(TICK_UPPER),
    ],
  });

  // Step 2: Split SUI from gas coin (1 SUI)
  const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(SUI_MAX_RAW)]);

  // Step 3: Split SBETS (1,000,000 SBETS)
  const [sbetsCoin] = tx.splitCoins(tx.object(sbetstCoin.coinObjectId), [
    tx.pure.u64(SBETS_AMOUNT_RAW),
  ]);

  // Step 4: Provide liquidity — fixing SBETS amount, SUI is computed by the protocol
  tx.moveCall({
    target: `${BLUEFIN_SPOT_PKG}::gateway::provide_liquidity_with_fixed_amount`,
    typeArguments: [SUI_TYPE, SBETS_TYPE],
    arguments: [
      tx.object(CLOCK),
      tx.object(GLOBAL_CONFIG),
      tx.object(poolId),
      position,
      suiCoin,     // coin_a (SUI)
      sbetsCoin,   // coin_b (SBETS)
      tx.pure.u64(SBETS_AMOUNT_RAW), // amount = 1M SBETS (fixed)
      tx.pure.u64(SUI_MAX_RAW),      // coin_a_max = 1 SUI
      tx.pure.u64(SBETS_AMOUNT_RAW), // coin_b_max = 1M SBETS
      tx.pure.bool(false),           // is_fixed_a = false → fix coin_b (SBETS)
    ],
  });

  // Step 5: Transfer the position NFT back to admin wallet
  tx.transferObjects([position], tx.pure.address(walletAddress));

  console.log(
    "\n⏳  Submitting add-liquidity transaction to Sui mainnet …\n" +
      "    - Opening position (tick range 60,000 – 276,240)\n" +
      "    - Seeding: 1,000,000 SBETS + up to 1 SUI"
  );

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: {
      showObjectChanges: true,
      showEffects: true,
      showBalanceChanges: true,
    },
  });

  if (result.effects?.status?.status !== "success") {
    console.error(
      "❌  Transaction failed!\n",
      JSON.stringify(result.effects?.status, null, 2)
    );
    process.exit(1);
  }

  console.log("\n✅  Transaction digest:", result.digest);

  // Find the position NFT
  const positionObj = result.objectChanges?.find(
    (c) => c.type === "created" && c.objectType?.includes("::position::Position")
  );

  console.log("\n🎉  Liquidity added successfully!");
  if (positionObj && positionObj.type === "created") {
    console.log("    Position NFT ID:", positionObj.objectId);
  }

  const balChanges = result.balanceChanges || [];
  const suiChange = balChanges.find((b) => b.coinType === SUI_TYPE);
  const sbetsChange = balChanges.find((b) => b.coinType === SBETS_TYPE);

  if (suiChange)
    console.log(
      `    SUI deposited  : ${Math.abs(Number(suiChange.amount)) / 1e9} SUI`
    );
  if (sbetsChange)
    console.log(
      `    SBETS deposited: ${Math.abs(Number(sbetsChange.amount)) / 1e9} SBETS`
    );

  console.log(
    `\n    View on Suiscan: https://suiscan.xyz/mainnet/tx/${result.digest}`
  );
  console.log(
    `    View pool      : https://trade.bluefin.io/liquidity-pools`
  );
}

main().catch((err) => {
  console.error("❌  Error:", err);
  process.exit(1);
});
