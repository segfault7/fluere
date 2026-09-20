import { Connection, PublicKey } from "@solana/web3.js";
import { AccountLayout } from "@solana/spl-token";

export const USDC_MINTS = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "EPjFWdd5AufqSSqeMgo3bU4vA5o6zvJQUb5FjB4G9NZn",
];
export const USDC_MINT = new PublicKey(USDC_MINTS[0]);

export function normalizeBalance(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveWalletAddress(requestedAddress?: string | null, fallbackAddress?: string | null) {
  const candidate = (requestedAddress ?? fallbackAddress ?? "").trim();
  return candidate || fallbackAddress || "";
}

export async function getUsdcBalanceForWallet(connection: Connection, walletAddress: PublicKey) {
  const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const accounts = await connection.getProgramAccounts(tokenProgramId, {
    filters: [
      { memcmp: { offset: 32, bytes: walletAddress.toBase58() } },
      { dataSize: 165 },
    ],
  });

  return accounts.reduce((total, { account }) => {
    const decoded = AccountLayout.decode(Buffer.from(account.data));
    const mint = new PublicKey(decoded.mint).toBase58();
    if (!USDC_MINTS.includes(mint)) return total;

    const rawAmount = Number(decoded.amount ?? 0);
    return total + (Number.isFinite(rawAmount) ? rawAmount / 1_000_000 : 0);
  }, 0);
}

export function getUsdcBalanceFromTokenAccounts(
  tokenAccounts: Array<{
    account: {
      data: {
        parsed?: {
          info?: {
            tokenAmount?: {
              uiAmount?: number | string | null;
            };
          };
        };
      };
    };
  }> = [],
) {
  return tokenAccounts.reduce((total, item) => {
    const uiAmount = item?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    return total + normalizeBalance(uiAmount);
  }, 0);
}
