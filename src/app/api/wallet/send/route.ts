import { NextResponse } from "next/server";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { USDC_MINT, getUsdcBalanceForWallet } from "../../../lib/wallet";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const USDC_DECIMALS = 6;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { amount?: number | string; to?: string };
    const rawAmount = Number(body.amount ?? 0);
    const recipientAddress = String(body.to ?? "").trim();

    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number of USDC." }, { status: 400 });
    }

    if (!recipientAddress) {
      return NextResponse.json({ error: "Recipient wallet address is required." }, { status: 400 });
    }

    try {
      new PublicKey(recipientAddress);
    } catch {
      return NextResponse.json({ error: "Recipient must be a valid Solana wallet address." }, { status: 400 });
    }

    const privateKey = process.env.SERVER_PRIVATE_KEY;
    if (!privateKey) {
      return NextResponse.json({ error: "SERVER_PRIVATE_KEY is not configured" }, { status: 500 });
    }

    const signer = Keypair.fromSecretKey(bs58.decode(privateKey));
    const publicKey = signer.publicKey;
    const connection = new Connection(RPC_URL, "confirmed");
    const mint = USDC_MINT;
    const tokenAccount = getAssociatedTokenAddressSync(mint, publicKey);
    const recipientTokenAccount = getAssociatedTokenAddressSync(mint, new PublicKey(recipientAddress));
    const senderTokenAccountInfo = await connection.getAccountInfo(tokenAccount);

    if (!senderTokenAccountInfo) {
      return NextResponse.json({ error: "No USDC token account was found for the sender wallet." }, { status: 400 });
    }

    const transferAmount = Math.round(rawAmount * 10 ** USDC_DECIMALS);
    const transaction = new Transaction();
    const recipientAccountInfo = await connection.getAccountInfo(recipientTokenAccount);

    if (!recipientAccountInfo) {
      transaction.add(createAssociatedTokenAccountInstruction(
        publicKey,
        recipientTokenAccount,
        new PublicKey(recipientAddress),
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ));
    }

    transaction.add(
      createTransferCheckedInstruction(
        tokenAccount,
        mint,
        recipientTokenAccount,
        publicKey,
        transferAmount,
        USDC_DECIMALS,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = publicKey;
    transaction.sign(signer);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    const balance = await getUsdcBalanceForWallet(connection, publicKey);

    return NextResponse.json({
      success: true,
      signature,
      balance,
      amount: rawAmount,
      to: recipientAddress,
      walletAddress: publicKey.toBase58(),
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to send USDC.",
    }, { status: 500 });
  }
}
