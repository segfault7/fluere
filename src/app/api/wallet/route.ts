import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getUsdcBalanceForWallet, resolveWalletAddress } from "../../lib/wallet";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export async function GET(request: Request) {
  try {
    const privateKey = process.env.SERVER_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: "SERVER_PRIVATE_KEY is not configured" }, { status: 500 });
    }

    const signer = Keypair.fromSecretKey(bs58.decode(privateKey));
    const connection = new Connection(RPC_URL, "confirmed");
    const url = new URL(request.url);
    const requestedWalletAddress = url.searchParams.get("address");
    const walletAddress = resolveWalletAddress(requestedWalletAddress, signer.publicKey.toBase58());
    const publicKey = new PublicKey(walletAddress);
    const solBalanceLamports = await connection.getBalance(publicKey);
    const usdcBalance = await getUsdcBalanceForWallet(connection, publicKey);

    return NextResponse.json({
      walletAddress: publicKey.toBase58(),
      solBalance: Number(solBalanceLamports) / 1_000_000_000,
      usdcBalance,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to read wallet status",
    }, { status: 500 });
  }
}
