export interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  url: string;
  method: "GET" | "POST";
  estimatedCostUsdc: number;
  exampleParams?: unknown;
  network?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  priceFromUsdc: number;
  provider: "gemini" | "perplexity" | "x402engine" | "blockrun";
  endpoint?: string;
}

export const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-image",
] as const;

export const BLOCKRUN_MODELS = [
  "openai/gpt-6-astra",
  "anthropic/claude-fable-5.1",
  "deepseek/deepseek-v4-pro",
] as const;

export const X402ENGINE_MODELS = [
  "x402engine/kimi",
] as const;

export const MODEL_CATALOG: ModelInfo[] = [
  ...GEMINI_MODELS.map((id) => ({ id, name: id, priceFromUsdc: 0, provider: "gemini" as const })),
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", priceFromUsdc: 0.03, provider: "blockrun", endpoint: "https://sol.blockrun.ai/api/v1/chat/completions" },
  { id: BLOCKRUN_MODELS[0], name: "GPT-6 Astra", priceFromUsdc: 0.03, provider: "blockrun", endpoint: "https://sol.blockrun.ai/api/v1/chat/completions" },
  { id: BLOCKRUN_MODELS[1], name: "Claude Fable 5.1", priceFromUsdc: 0.03, provider: "blockrun", endpoint: "https://sol.blockrun.ai/api/v1/chat/completions" },
  { id: X402ENGINE_MODELS[0], name: "Kimi K3", priceFromUsdc: 0.022022, provider: "x402engine", endpoint: "https://x402engine.app/api/llm/kimi" },
];

export const AI_MODELS = [...GEMINI_MODELS, ...BLOCKRUN_MODELS, "deepseek/deepseek-v4-pro", ...X402ENGINE_MODELS] as const;

export function getModelInfo(model: string) {
  return MODEL_CATALOG.find((entry) => entry.id === model) ?? MODEL_CATALOG[0];
}

export function inferToolIdsForPrompt(prompt: string, selectedToolIds: string[] = []) {
  const normalized = prompt.trim();
  if (!normalized) return [...selectedToolIds];

  const lower = normalized.toLowerCase();
  const mentionsCrypto = /(solana|sol|bitcoin|btc|ethereum|eth|crypto|token|coin)/i.test(lower);
  const asksForPrice = /(price|trading at|quote|current value|what.s.*(price|trading)|market price|spot price)/i.test(lower);
  const asksForTrend = /(trending|volume|market|up or down|today.s news)/i.test(lower);

  const inferred = new Set<string>();
  if ((mentionsCrypto && asksForPrice) || /what.?s.*solana.*trading/i.test(lower)) {
    inferred.add("birdeye-price");
  }
  if (asksForTrend && mentionsCrypto) {
    inferred.add("birdeye-trending");
  }

  for (const id of selectedToolIds) inferred.add(id);
  return [...inferred];
}

// Top-level tools that appear in the main dropdown
export const TOP_LEVEL_TOOLS: Tool[] = [
  {
    id: "exa-search",
    name: "Search (Exa)",
    description: "Semantic web search with ranked live sources",
    category: "Search",
    url: "https://api.exa.ai/search",
    method: "POST",
    estimatedCostUsdc: 0.007,
  },
  {
    id: "wolfram-query",
    name: "Math (Wolfram)",
    description: "Computational answers for math, science, finance, and units",
    category: "Data",
    url: "https://wolframalpha.x402.paysponge.com/v2/query",
    method: "GET",
    estimatedCostUsdc: 0.02,
  },
  {
    id: "birdeye-price",
    name: "Birdeye – Token Price",
    description: "Real-time token price on Solana",
    category: "Crypto Data",
    url: "https://public-api.birdeye.so/x402/defi/price?address=So11111111111111111111111111111111111111112",
    method: "GET",
    estimatedCostUsdc: 0.003,
  },
  {
    id: "birdeye-trending",
    name: "Birdeye – Trending Tokens",
    description: "Currently trending tokens by volume",
    category: "Crypto Data",
    url: "https://public-api.birdeye.so/x402/defi/token_trending",
    method: "GET",
    estimatedCostUsdc: 0.003,
  },
];
