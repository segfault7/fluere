"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import katex from "katex";
import {
  ArrowUp, Check, ChevronDown, Layers3, Mic,
  Phone, PhoneOff, ShieldCheck, Sparkles, Square, Wallet, X, Zap,
} from "lucide-react";
import { GEMINI_MODELS, MODEL_CATALOG, TOP_LEVEL_TOOLS, getModelInfo, type Tool } from "./lib/tools";

type GeneratedImage = { mimeType: string; data: string };
type ToolReference = { tool: string; data: unknown };
type Message = { id: string; role: "user" | "assistant"; content: string; image?: GeneratedImage; references?: ToolReference[]; referencePhase?: "pill" | "circle"; referencesOpen?: boolean; createdAt?: number };

const MAX_MESSAGES = 40;
const MAX_ACTIVITY_ENTRIES = 200;
const CURRENT_CHAT_STORAGE_KEY = "fluere-current-chat";

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function displayModel(model: string) {
  return getModelInfo(model).name;
}

function FluereMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true" role="img">
      <defs>
        <linearGradient id="fluere-mark-gradient" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#f6d8ff" />
          <stop offset="22%" stopColor="#8de7ff" />
          <stop offset="55%" stopColor="#7ef7cf" />
          <stop offset="100%" stopColor="#9b8cff" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="15" fill="#eafcff" opacity="0.9" />
      <path d="M60 7L67 38L99 45L72 60L92 92L60 72L28 92L48 60L21 45L53 38L60 7Z" fill="url(#fluere-mark-gradient)" opacity="0.95" />
      <path d="M55 22L60 40L79 27L69 46L87 60L68 63L73 84L60 69L47 84L52 63L33 60L51 46L41 27L60 40L55 22Z" fill="#f7ffff" opacity="0.78" />
      <path d="M18 59L37 58L27 68L34 87L54 77L47 95L60 83L73 95L66 77L86 87L93 68L83 58L102 59L87 50L95 35L76 42L72 21L60 34L48 21L44 42L25 35L33 50L18 59Z" fill="url(#fluere-mark-gradient)" opacity="0.85" />
    </svg>
  );
}

function formatPrice(price: number) {
  return price === 0 ? "free" : `$${price.toFixed(6)}`;
}

function renderMath(expression: string, displayMode: boolean, key: string) {
  try {
    return <span className={displayMode ? "math-display" : "math-inline"} key={key} dangerouslySetInnerHTML={{ __html: katex.renderToString(expression.trim(), { displayMode, throwOnError: false, strict: "ignore" }) }} />;
  } catch {
    return <code key={key}>{expression}</code>;
  }
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  return text.split(/(\[[^\]]+\]\(https?:\/\/[^)]+\)|\\\([^\n]+?\\\)|\$[^$\n]+\$|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) return <a key={`${keyPrefix}-${index}`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (part.startsWith("\\(") && part.endsWith("\\)")) return renderMath(part.slice(2, -2), false, `${keyPrefix}-${index}`);
    if (part.startsWith("$") && part.endsWith("$") && !part.startsWith("$$")) return renderMath(part.slice(1, -1), false, `${keyPrefix}-${index}`);
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${keyPrefix}-${index}`}>{renderInlineMarkdown(part.slice(2, -2), `${keyPrefix}-strong-${index}`)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={`${keyPrefix}-${index}`}>{renderInlineMarkdown(part.slice(1, -1), `${keyPrefix}-em-${index}`)}</em>;
    return <span key={`${keyPrefix}-${index}`}>{part}</span>;
  });
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const rendered: React.ReactNode[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let tableRows: string[][] = [];
  let inMath = false;
  let mathLines: string[] = [];

  const flushLists = () => {
    if (listItems.length) {
      rendered.push(<ul className="markdown-list" key={`ul-${rendered.length}`}>{listItems.map((item, index) => <li key={`ul-${index}`}>{renderInlineMarkdown(item, `ul-${index}`)}</li>)}</ul>);
      listItems = [];
    }
    if (orderedItems.length) {
      rendered.push(<ol className="markdown-list" key={`ol-${rendered.length}`}>{orderedItems.map((item, index) => <li key={`ol-${index}`}>{renderInlineMarkdown(item, `ol-${index}`)}</li>)}</ol>);
      orderedItems = [];
    }
  };

  const flushTable = () => {
    if (tableRows.length < 2) { tableRows = []; return; }
    const [headers, ...rows] = tableRows;
    rendered.push(<div className="markdown-table-wrap" key={`table-${rendered.length}`}><table className="markdown-table"><thead><tr>{headers.map((cell, index) => <th key={`head-${index}`}>{renderInlineMarkdown(cell, `head-${index}`)}</th>)}</tr></thead><tbody>{rows.filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell))).map((row, rowIndex) => <tr key={`row-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(cell, `cell-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody></table></div>);
    tableRows = [];
  };

  for (const [index, line] of lines.entries()) {
    if (line.startsWith("```")) {
      if (inCode) rendered.push(<pre className="markdown-code" key={`code-${index}`}><code>{codeLines.join("\n")}</code></pre>);
      inCode = !inCode;
      codeLines = [];
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    const trimmed = line.trim();
    if (inMath) {
      if (trimmed === "$$" || trimmed === "\\]") {
        rendered.push(renderMath(mathLines.join("\n"), true, `math-${index}`));
        inMath = false;
        mathLines = [];
      } else mathLines.push(line);
      continue;
    }
    if (trimmed === "$$" || trimmed === "\\[") {
      flushLists();
      flushTable();
      inMath = true;
      mathLines = [];
      continue;
    }
    if ((trimmed.startsWith("$$") && trimmed.endsWith("$$")) || (trimmed.startsWith("\\[") && trimmed.endsWith("\\]"))) {
      flushLists();
      flushTable();
      const delimiterLength = trimmed.startsWith("$$") ? 2 : 2;
      rendered.push(renderMath(trimmed.slice(delimiterLength, -delimiterLength), true, `math-${index}`));
      continue;
    }
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushLists();
      tableRows.push(trimmed.slice(1, -1).split("|").map((cell) => cell.trim()));
      continue;
    }
    flushTable();
    if (!trimmed) { flushLists(); rendered.push(<div className="markdown-spacer" key={`line-${index}`} />); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushLists(); rendered.push(<hr key={`line-${index}`} />); continue; }
    if (trimmed.startsWith("> ")) { flushLists(); rendered.push(<blockquote key={`line-${index}`}>{renderInlineMarkdown(trimmed.slice(2), `quote-${index}`)}</blockquote>); continue; }
    if (/^\d+\.\s/.test(trimmed)) { orderedItems.push(trimmed.replace(/^\d+\.\s/, "")); continue; }
    if (/^[-*+]\s/.test(trimmed)) { listItems.push(trimmed.replace(/^[-*+]\s/, "")); continue; }
    flushLists();
    if (trimmed.startsWith("### ")) { rendered.push(<h4 key={`line-${index}`}>{renderInlineMarkdown(trimmed.slice(4), `line-${index}`)}</h4>); continue; }
    if (trimmed.startsWith("## ")) { rendered.push(<h3 key={`line-${index}`}>{renderInlineMarkdown(trimmed.slice(3), `line-${index}`)}</h3>); continue; }
    if (trimmed.startsWith("# ")) { rendered.push(<h2 key={`line-${index}`}>{renderInlineMarkdown(trimmed.slice(2), `line-${index}`)}</h2>); continue; }
    rendered.push(<p key={`line-${index}`}>{renderInlineMarkdown(line, `line-${index}`)}</p>);
  }
  flushLists();
  flushTable();
  return rendered;
}

function getAiResponse(data: unknown): { text: string | null; image?: GeneratedImage } {
  if (!data || typeof data !== "object") return { text: null };
  if (!("candidates" in data) && !("choices" in data) && !("output" in data)) return { text: null };
  if ("choices" in data) {
    const choices = (data as { choices?: unknown }).choices;
    if (Array.isArray(choices)) {
      const message = choices[0] && typeof choices[0] === "object" && "message" in choices[0] ? (choices[0] as { message?: unknown }).message : null;
      if (message && typeof message === "object" && typeof (message as { content?: unknown }).content === "string") return { text: (message as { content: string }).content };
    }
  }
  if ("output" in data) {
    const output = (data as { output?: unknown }).output;
    if (typeof output === "string") return { text: output };
    if (Array.isArray(output)) {
      const text = output.flatMap((item) => {
        if (!item || typeof item !== "object" || !("content" in item)) return [];
        const content = (item as { content?: unknown }).content;
        if (!Array.isArray(content)) return [];
        return content.filter((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string").map((part) => (part as { text: string }).text);
      }).join("\n\n");
      if (text) return { text };
    }
  }
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return { text: null };
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const finishReason = (candidate as { finishReason?: unknown }).finishReason;
    const finishMessage = (candidate as { finishMessage?: unknown }).finishMessage;
    if (!("content" in candidate)) {
      if (typeof finishMessage === "string" && finishMessage.trim()) {
        return { text: finishMessage.trim() };
      }
      if (typeof finishReason === "string" && finishReason.toUpperCase().includes("MALFORMED")) {
        return { text: "The model attempted a malformed function call. Please retry without tool-calling enabled." };
      }
      continue;
    }
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object" || !("parts" in content)) {
      if (typeof finishMessage === "string" && finishMessage.trim()) {
        return { text: finishMessage.trim() };
      }
      continue;
    }
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) {
      if (typeof finishMessage === "string" && finishMessage.trim()) {
        return { text: finishMessage.trim() };
      }
      continue;
    }
    const textPart = parts.find((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string");
    const imagePart = parts.find((part) => {
      const inlineData = part && typeof part === "object" && "inlineData" in part ? (part as { inlineData?: unknown }).inlineData : null;
      return inlineData && typeof inlineData === "object" && typeof (inlineData as { mimeType?: unknown }).mimeType === "string" && typeof (inlineData as { data?: unknown }).data === "string";
    });
    const inlineData = imagePart && "inlineData" in imagePart ? (imagePart as { inlineData: GeneratedImage }).inlineData : undefined;
    const text = textPart ? (textPart as { text: string }).text : null;
    if (text && text.trim()) return { text: text.trim(), image: inlineData };
    if (typeof finishMessage === "string" && finishMessage.trim()) return { text: finishMessage.trim(), image: inlineData };
    if (typeof finishReason === "string" && finishReason.toUpperCase().includes("MALFORMED")) {
      return { text: "The model attempted a malformed function call. Please retry without tool-calling enabled.", image: inlineData };
    }
    return { text: null, image: inlineData };
  }
  return { text: null };
}

function compactData(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length > 4000) return `[large text omitted: ${value.length} characters]`;
    if (value.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(value)) return `[binary data omitted: ${value.length} characters]`;
    return value;
  }
  if (depth >= 5) return "[nested data omitted]";
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => compactData(item, depth + 1));
    return value.length > 20 ? [...items, `[${value.length - 20} more items omitted]`] : items;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const compacted = Object.fromEntries(entries.slice(0, 40).map(([key, item]) => [key, compactData(item, depth + 1)]));
    if (entries.length > 40) compacted._omitted = `${entries.length - 40} fields omitted`;
    return compacted;
  }
  return value;
}

function getActivityData(data: unknown) {
  return JSON.stringify(compactData(data), null, 2);
}

function decodeJwtPayload(value: string): Record<string, unknown> | null {
  try {
    const parts = value.split(".");
    const payloadPart = parts.length >= 2 ? parts[1] : parts[0];
    if (!payloadPart) return null;
    const payload = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = decodeURIComponent(
      atob(padded).split("").map((char) => `%${(`00${char.charCodeAt(0).toString(16)}`).slice(-2)}`).join(""),
    );
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getSolscanTxUrl(transaction: string, network?: string) {
  const normalized = network?.toLowerCase() ?? "";
  const cluster = normalized.includes("devnet") ? "devnet" : normalized.includes("testnet") ? "testnet" : "mainnet";
  const suffix = cluster === "mainnet" ? "" : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${transaction}${suffix}`;
}

function getAudioSource(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return value.startsWith("data:") ? value : `data:audio/mpeg;base64,${value}`;
}

function parseWalletCommand(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^\/balance\b/i.test(trimmed)) {
    return { type: "balance" as const };
  }

  if (/^\/receive\b/i.test(trimmed)) {
    return { type: "receive" as const };
  }

  const sendMatch = trimmed.match(/^\/send\s+(?:usdc\s+)?([0-9]+(?:\.[0-9]+)?)\s+(?:to\s+)?([A-Za-z0-9]+)/i);
  if (!sendMatch) return null;

  const amount = Number(sendMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return { type: "send" as const, amount, recipient: sendMatch[2] };
}

export default function Fluere() {
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<{ raw: string; payload: Record<string, unknown> } | null>(null);
  const [referencePopoverAnchor, setReferencePopoverAnchor] = useState<{ id: string; top: number; left: number } | null>(null);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [smartMode, setSmartMode] = useState(false);
  const [smartReview, setSmartReview] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(GEMINI_MODELS[0]);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem(CURRENT_CHAT_STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      const restored = parsed.filter((item): item is Message => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<Message>;
        return typeof candidate.id === "string"
          && (candidate.role === "user" || candidate.role === "assistant")
          && typeof candidate.content === "string";
      });
      return restored.slice(-MAX_MESSAGES);
    } catch {
      window.localStorage.removeItem(CURRENT_CHAT_STORAGE_KEY);
      return [];
    }
  });
  const [hasHydratedChat, setHasHydratedChat] = useState(false);
  const [walletStatus, setWalletStatus] = useState<{ walletAddress: string; usdcBalance: number; solBalance: number }>({ walletAddress: "", usdcBalance: 0, solBalance: 0 });
  const [profile, setProfile] = useState<{ username: string; password: string; walletAddress: string; walletBalanceUsdc: number; walletPrivateKey?: string } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem("fluere-profile");
      if (!saved) return null;
      const parsed = JSON.parse(saved) as { username?: string; password?: string; walletAddress?: string; walletBalanceUsdc?: number; walletPrivateKey?: string };
      if (!parsed.username || !parsed.password) return null;
      return {
        username: parsed.username,
        password: parsed.password,
        walletAddress: typeof parsed.walletAddress === "string" ? parsed.walletAddress : "",
        walletBalanceUsdc: typeof parsed.walletBalanceUsdc === "number" ? parsed.walletBalanceUsdc : 0,
        walletPrivateKey: parsed.walletPrivateKey,
      };
    } catch {
      window.localStorage.removeItem("fluere-profile");
      return null;
    }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [signupForm, setSignupForm] = useState({ username: "", password: "" });
  const [logs, setLogs] = useState<string[]>([
  ]);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [callMode, setCallMode] = useState(false);
  const [callBusy, setCallBusy] = useState(false);
  const [callSpeaking, setCallSpeaking] = useState(false);
  const [callTranscript, setCallTranscript] = useState("");
  const [callCost, setCallCost] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const callAudioRef = useRef<HTMLAudioElement | null>(null);
  const discardCallTurnRef = useRef(false);
  const callAbortRef = useRef<AbortController | null>(null);
  const callModeRef = useRef(false);
  const toolsMenuRef = useRef<HTMLDivElement | null>(null);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const appendMessages = (...items: Message[]) => {
    setMessages((previous) => [...previous, ...items.map((item) => ({ ...item, createdAt: item.createdAt ?? Date.now() }))].slice(-MAX_MESSAGES));
  };
  const clearCurrentChat = () => {
    setMessages([]);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CURRENT_CHAT_STORAGE_KEY);
    }
  };
  const appendLogs = (...entries: string[]) => {
    setLogs((previous) => [...previous, ...entries].slice(-MAX_ACTIVITY_ENTRIES));
  };


  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setHasHydratedChat(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hasHydratedChat || typeof window === "undefined") return;
    if (messages.length === 0) {
      window.localStorage.removeItem(CURRENT_CHAT_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(CURRENT_CHAT_STORAGE_KEY, JSON.stringify(messages));
  }, [messages, hasHydratedChat]);

  useEffect(() => {
    const timers = messages.filter((message) => message.references?.length && message.referencePhase === "pill").map((message) => window.setTimeout(() => {
      setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, referencePhase: "circle" } : item));
    }, 1500));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [messages]);

  useEffect(() => {
    const closeToolsMenu = (event: PointerEvent) => {
      if (showToolsMenu && toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) setShowToolsMenu(false);
    };
    document.addEventListener("pointerdown", closeToolsMenu);
    return () => document.removeEventListener("pointerdown", closeToolsMenu);
  }, [showToolsMenu]);

  useEffect(() => {
    const closeModelMenu = (event: PointerEvent) => {
      if (showModelMenu && modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) setShowModelMenu(false);
    };
    document.addEventListener("pointerdown", closeModelMenu);
    return () => document.removeEventListener("pointerdown", closeModelMenu);
  }, [showModelMenu]);

  const persistProfile = (nextProfile: { username: string; password: string; walletAddress: string; walletBalanceUsdc: number; walletPrivateKey?: string }) => {
    setProfile(nextProfile);
    if (typeof window !== "undefined") window.localStorage.setItem("fluere-profile", JSON.stringify(nextProfile));
  };

  useEffect(() => {
    let cancelled = false;

    const hydrateWallet = async () => {
      try {
        const response = await fetch("/api/wallet");
        const data = await response.json();
        if (cancelled || !response.ok || !data?.walletAddress) return;

        const nextWalletAddress = String(data.walletAddress);
        const nextUsdcBalance = Number(data.usdcBalance || 0);
        const nextSolBalance = Number(data.solBalance || 0);
        const nextWalletStatus = {
          walletAddress: nextWalletAddress,
          usdcBalance: nextUsdcBalance,
          solBalance: nextSolBalance,
        };

        setWalletStatus((previous) => previous.walletAddress === nextWalletAddress && previous.usdcBalance === nextUsdcBalance && previous.solBalance === nextSolBalance ? previous : nextWalletStatus);

        setProfile((previous) => {
          if (!previous) return previous;
          if (previous.walletAddress === nextWalletAddress && previous.walletBalanceUsdc === nextUsdcBalance) return previous;
          return {
            ...previous,
            walletAddress: nextWalletAddress,
            walletBalanceUsdc: nextUsdcBalance,
          };
        });
      } catch {
        // no-op; wallet status remains local fallback
      }
    };

    void hydrateWallet();
    const walletRefresh = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void hydrateWallet();
      }
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(walletRefresh);
    };
  }, []);

  const ensureSignedIn = (mode: "send" | "history" | "account", draftPrompt?: string) => {
    if (profile) return true;
    if (draftPrompt) setPendingPrompt(draftPrompt);
    else if (mode === "send") setPendingPrompt(prompt || null);
    setAuthOpen(true);
    return false;
  };

  const historyEntries = useMemo(
    () => messages.filter((message) => message.role === "user").slice(-8).reverse(),
    [messages],
  );
  const walletBalanceUsdc = walletStatus.usdcBalance;
  const toolCatalog = useMemo(
    () => TOP_LEVEL_TOOLS,
    [],
  );
  const selectedTools = useMemo(
    () => selectedToolIds.map((id) => toolCatalog.find((tool) => tool.id === id)).filter((tool): tool is Tool => Boolean(tool)),
    [selectedToolIds, toolCatalog],
  );
  const selectedModelInfo = getModelInfo(selectedModel);
  const toolCost = selectedTools.reduce((total, tool) => total + tool.estimatedCostUsdc, 0);
  const promptCost = selectedModelInfo.priceFromUsdc + toolCost;
  const promptCostLabel = selectedModelInfo.priceFromUsdc === 0
    ? (toolCost > 0 ? `$${toolCost.toFixed(6)} USDC in tools` : "Free")
    : `$${promptCost.toFixed(6)} USDC`;
  const execute = async (promptOverride?: string, activeProfile = profile, forcedToolIds?: string[]) => {
    const currentPrompt = (promptOverride ?? prompt).trim();
    const walletCommand = parseWalletCommand(currentPrompt);
    const resolvedToolIds = forcedToolIds ?? selectedToolIds;
    if (!currentPrompt || loading) return;

    if (walletCommand) {
      if (walletCommand.type === "balance") {
        appendMessages({ id: crypto.randomUUID(), role: "user", content: currentPrompt });
        setLoading(true);
        try {
          const response = await fetch("/api/wallet");
          const data = await response.json();
          const balanceValue = Number(response.ok && Number.isFinite(Number(data?.usdcBalance)) ? data.usdcBalance : 0);
          const balance = balanceValue.toFixed(6);
          appendMessages({ id: crypto.randomUUID(), role: "assistant", content: `Current USDC balance is ${balance}` });
          setWalletStatus((previous) => ({
            ...previous,
            usdcBalance: balanceValue,
          }));
        } catch {
          appendMessages({ id: crypto.randomUUID(), role: "assistant", content: "Current USDC balance is 0.000000" });
        } finally {
          setLoading(false);
        }
        setPrompt("");
        return;
      }

      if (walletCommand.type === "receive") {
        appendMessages({ id: crypto.randomUUID(), role: "user", content: currentPrompt });
        const walletAddress = walletStatus.walletAddress || activeProfile?.walletAddress || "";
        appendMessages({ id: crypto.randomUUID(), role: "assistant", content: walletAddress ? `Your Solana receive address is ${walletAddress}` : "Your Solana receive address is unknown" });
        setPrompt("");
        return;
      }

      if (walletCommand.type === "send") {
        const amount = walletCommand.amount;
        const recipient = walletCommand.recipient;
        appendMessages({ id: crypto.randomUUID(), role: "user", content: currentPrompt });
        setLoading(true);
        try {
          const response = await fetch("/api/wallet/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount, to: recipient }),
          });
          const json = await response.json();
          if (!response.ok || json?.error) {
            throw new Error(typeof json?.error === "string" ? json.error : "Failed to send USDC");
          }

          const txSignature = typeof json.signature === "string" ? json.signature : "pending";
          const solscanTxUrl = txSignature !== "pending" ? getSolscanTxUrl(txSignature, "mainnet") : "";
          const message = solscanTxUrl ? `Sent ${amount.toFixed(6)} USDC to ${recipient}. Signature: [${txSignature}](https://solscan.io/tx/${txSignature})` : `Sent ${amount.toFixed(6)} USDC to ${recipient}. Signature: ${txSignature}`;
          appendMessages({ id: crypto.randomUUID(), role: "assistant", content: message });
          appendLogs(`[USDC_SEND] ${amount.toFixed(6)} USDC -> ${recipient}`, `[TX] ${txSignature}`);
          setWalletStatus((previous) => ({ ...previous, usdcBalance: Number.isFinite(json.balance) ? Number(json.balance) : previous.usdcBalance }));
          setPrompt("");
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to send USDC";
          appendMessages({ id: crypto.randomUUID(), role: "assistant", content: `USDC send failed: ${message}` });
          appendLogs(`ERROR ${message}`);
          setPrompt("");
          return;
        } finally {
          setLoading(false);
        }
      }
    }

    const isGuestMode = !activeProfile;
    if (isGuestMode) {
      appendLogs("[GUEST] No account attached; continuing in local chat mode");
    }
    const isSmartSuggestionStep = smartMode && !smartReview && !forcedToolIds;
    if (isSmartSuggestionStep) {
      setLoading(true);
      try {
        const response = await fetch("/api/suggest-tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: currentPrompt, selectedToolIds: resolvedToolIds }),
        });
        const json = await response.json();
        if (!response.ok) {
          appendLogs(`[SMART] Smart Mode request failed (${response.status})`);
          return;
        }
        const nextToolIds = Array.isArray(json.toolIds) ? json.toolIds : [];
        setSelectedToolIds(nextToolIds);
        setSmartReview(true);
        if (json.logs) appendLogs(...json.logs);
      } catch (error) {
        appendLogs(`[SMART] Smart Mode unavailable: ${error instanceof Error ? error.message : "Request failed"}`);
      } finally { setLoading(false); }
      return;
    }
    setLoading(true);
    appendMessages({ id: crypto.randomUUID(), role: "user", content: currentPrompt });
    appendLogs(`USER ${currentPrompt}`, `MODEL ${selectedModel}`);
    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          toolIds: resolvedToolIds,
          prompt: currentPrompt,
          history: messages.slice(-20).map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      const json = await response.json();
      if (json.logs) appendLogs(...json.logs);
      if (json.success) {
        const geminiResponse = getAiResponse(json.data);
        appendMessages({
          id: crypto.randomUUID(),
          role: "assistant",
          content: geminiResponse.text || (geminiResponse.image ? "Generated image" : `${displayModel(selectedModel)} returned a response without visible text.`),
          image: geminiResponse.image,
          references: json.toolResults?.length ? json.toolResults.map((reference: ToolReference) => ({ ...reference, data: compactData(reference.data) })) : undefined,
          referencePhase: json.toolResults?.length ? "pill" : undefined,
        });
        appendLogs(`[RESPONSE_DATA] ${getActivityData(json.data)}`);
        setSelectedToolIds([]);
      }
      else appendMessages({ id: crypto.randomUUID(), role: "assistant", content: `Error: ${json.error}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      appendLogs(`ERROR ${message}`);
      appendMessages({ id: crypto.randomUUID(), role: "assistant", content: `Failed: ${message}` });
    } finally { setLoading(false); setPrompt(""); setSmartReview(false); }
  };

  const handleCreateAccount = async () => {
    const username = signupForm.username.trim();
    const password = signupForm.password.trim();
    if (!username || !password) return;

    let walletAddress = "";
    let walletBalanceUsdc = 0;
    let solBalance = 0;

    try {
      const response = await fetch("/api/wallet");
      const data = await response.json();
      if (response.ok && data?.walletAddress) {
        walletAddress = data.walletAddress;
        walletBalanceUsdc = Number(data.usdcBalance ?? 0);
        solBalance = Number(data.solBalance ?? 0);
      }
    } catch {
      // Fall back to local metadata only. The server wallet remains the source of truth.
    }

    const nextProfile = {
      username,
      password,
      walletAddress,
      walletBalanceUsdc,
    };

    persistProfile(nextProfile);
    setWalletStatus({ walletAddress, usdcBalance: walletBalanceUsdc, solBalance });
    setSignupForm({ username: "", password: "" });
    setAuthOpen(false);
    setAccountOpen(false);
    if (pendingPrompt) {
      const queuedPrompt = pendingPrompt;
      setPendingPrompt(null);
      void execute(queuedPrompt, nextProfile);
    }
  };

  const handleAccountPasswordUpdate = () => {
    if (!profile) return;
    const trimmed = profile.password.trim();
    if (!trimmed) return;
    persistProfile({ ...profile, password: trimmed });
  };

  const toggleRecording = async () => {
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      appendMessages({ id: crypto.randomUUID(), role: "assistant", content: "Microphone access is not supported in this browser." });
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    audioChunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const base64 = await blobToBase64(blob);
      const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: base64 }) });
      const result = await response.json();
      if (result.logs) appendLogs(...result.logs);
      if (result.ttsError) appendLogs(`[CALL TTS FALLBACK] ${result.ttsError}`);
      if (!response.ok || !result.transcript) {
        appendMessages({ id: crypto.randomUUID(), role: "assistant", content: result.error || "No speech was detected." });
        return;
      }
      void execute(result.transcript);
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  };

  const toggleCallRecording = async () => {
    if (recording && mediaRecorderRef.current) { mediaRecorderRef.current.stop(); return; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let heardSpeech = false;
    let quietSince = 0;
    let silenceFrame = 0;
    audioChunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
    recorder.onstop = async () => {
      cancelAnimationFrame(silenceFrame);
      await audioContext.close();
      stream.getTracks().forEach((track) => track.stop()); setRecording(false); setCallBusy(true);
      if (discardCallTurnRef.current) {
        discardCallTurnRef.current = false;
        setCallBusy(false);
        return;
      }
      const controller = new AbortController();
      callAbortRef.current = controller;
      let response: Response;
      try {
        response = await fetch("/api/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: selectedModel, audio: await blobToBase64(new Blob(audioChunksRef.current, { type: "audio/webm" })) }), signal: controller.signal });
      } catch (error) {
        callAbortRef.current = null;
        setCallBusy(false);
        if (error instanceof DOMException && error.name === "AbortError") return;
        throw error;
      }
      callAbortRef.current = null;
      const result = await response.json();
      if (!callMode) { setCallBusy(false); return; }
      if (result.logs) appendLogs(...result.logs);
      if (typeof result.cost === "number" && result.cost > 0) setCallCost((previous) => previous + result.cost);
      if (result.transcript) {
        setCallTranscript(result.transcript);
        appendMessages({ id: crypto.randomUUID(), role: "user", content: result.transcript });
      }
      if (result.reply) appendMessages({ id: crypto.randomUUID(), role: "assistant", content: result.reply });
      const audioSource = getAudioSource(result.audio);
      const speakReply = () => {
        if (!result.reply || !("speechSynthesis" in window)) return false;
        const utterance = new SpeechSynthesisUtterance(result.reply);
        utterance.onstart = () => setCallSpeaking(true);
        utterance.onend = () => { setCallSpeaking(false); if (callModeRef.current) void toggleCallRecording(); };
        utterance.onerror = () => { setCallSpeaking(false); setCallBusy(false); };
        speechSynthesis.speak(utterance);
        return true;
      };
      if (audioSource) {
        const audio = new Audio(audioSource);
        audio.preload = "auto";
        callAudioRef.current = audio;
        audio.onended = () => { callAudioRef.current = null; setCallSpeaking(false); if (callModeRef.current) void toggleCallRecording(); };
        try {
          await audio.play();
          setCallSpeaking(true);
        } catch (error) {
          callAudioRef.current = null;
          appendLogs(`[CALL TTS FALLBACK] Audio playback was blocked; using browser speech`);
          if (!speakReply()) appendMessages({ id: crypto.randomUUID(), role: "assistant", content: `Voice playback failed: ${error instanceof Error ? error.message : "audio playback is unavailable"}` });
        }
      } else if (!speakReply() && result.reply) {
        appendMessages({ id: crypto.randomUUID(), role: "assistant", content: "TTS is unavailable in this browser, but the response is ready to read." });
      }
      setCallBusy(false);
    };
    const monitorSilence = () => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) { const normalized = (sample - 128) / 128; energy += normalized * normalized; }
      const speakingNow = Math.sqrt(energy / samples.length) > 0.035;
      if (speakingNow) { heardSpeech = true; quietSince = 0; }
      else if (heardSpeech) { quietSince ||= performance.now(); if (performance.now() - quietSince > 2000) { recorder.stop(); return; } }
      silenceFrame = requestAnimationFrame(monitorSilence);
    };
    mediaRecorderRef.current = recorder; recorder.start(); setRecording(true);
    silenceFrame = requestAnimationFrame(monitorSilence);
  };

  const openCallMode = () => { setSelectedToolIds([]); setShowToolsMenu(false); setShowModelMenu(false); setCallTranscript(""); setCallCost(0); callModeRef.current = true; setCallMode(true); };
  const hangUpCall = () => {
    discardCallTurnRef.current = true;
    callModeRef.current = false;
    callAbortRef.current?.abort();
    callAudioRef.current?.pause();
    callAudioRef.current = null;
    window.speechSynthesis?.cancel();
    if (recording && mediaRecorderRef.current) mediaRecorderRef.current.stop();
    setCallSpeaking(false);
    setCallBusy(false);
    setCallMode(false);
  };
  const interruptCallAudio = () => {
    callAudioRef.current?.pause();
    callAudioRef.current = null;
    window.speechSynthesis?.cancel();
    setCallSpeaking(false);
    setCallBusy(false);
  };

  const toggleTool = (tool: Tool) => {
    setSelectedToolIds((previous) => previous.includes(tool.id)
      ? previous.filter((id) => id !== tool.id)
      : [...previous, tool.id]);
  };

  const toggleReferencePanel = (messageId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 360;
    const left = Math.min(Math.max(12, rect.right - width + 10), window.innerWidth - width - 12);
    const top = Math.min(Math.max(12, rect.bottom + 8), window.innerHeight - 220);

    setReferencePopoverAnchor((current) => current?.id === messageId ? null : { id: messageId, top, left });
    setMessages((previous) => previous.map((item) => item.id === messageId ? { ...item, referencesOpen: !item.referencesOpen } : item));
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (smartMode && !smartReview) {
        void execute();
        return;
      }
      void execute();
    }
  };

  const activityEntries = logs.map((log, index) => {
    if (log.startsWith("[RESPONSE_DATA]")) {
      return <details className="response-log" key={`${log}-${index}`}><summary><span className="log-time">JSON</span><span>Raw model response</span></summary><pre>{log.slice("[RESPONSE_DATA] ".length)}</pre></details>;
    }

    if (log.startsWith("[RECEIPT]")) {
      const rawReceipt = log.slice("[RECEIPT] ".length);
      const payload = decodeJwtPayload(rawReceipt) ?? { raw: rawReceipt };
      return <div className="log-entry success" key={`${log}-${index}`}><span className="log-time">{String(index + 1).padStart(2, "0")}</span><button type="button" className="receipt-button" onClick={() => setReceiptPreview({ raw: rawReceipt, payload })}><span>Receipt</span><small>{payload.success === true ? "decoded" : "view"}</small></button></div>;
    }

    return <div className={`log-entry ${log.includes("ERROR") ? "error" : log.includes("SETTLED") ? "success" : ""}`} key={`${log}-${index}`}><span className="log-time">{String(index + 1).padStart(2, "0")}</span><span>{log}</span></div>;
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup header-controls">
          <button
            className="create-chat-button"
            type="button"
            onClick={() => {
              clearCurrentChat();
              setPrompt("");
              setSelectedToolIds([]);
              setSmartMode(false);
              setSmartReview(false);
              setHistoryOpen(false);
              setAccountOpen(false);
            }}
            aria-label="Create new chat"
            title="Create new chat"
          >
            +
          </button>
        </div>
        <div className="topbar-status header-controls">
          <span className="balance-pill">$: {walletBalanceUsdc.toFixed(2)}</span>
          <button className="wallet-pill" type="button" onClick={() => {
            if (!ensureSignedIn("account")) return;
            setAccountOpen((value) => !value);
            setHistoryOpen(false);
          }} aria-label="Open account wallet">
            <Wallet size={14} />
          </button>
        </div>
        {historyOpen && profile && <div className="history-popover"><div className="menu-title">Chat history</div>{historyEntries.length ? historyEntries.map((entry, index) => <button key={`${entry.id}-${index}`} type="button" className="history-item" onClick={() => { setPrompt(entry.content); setHistoryOpen(false); }}><span>{entry.content}</span><small>{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "recent"}</small></button>) : <div className="history-empty">No prompts yet.</div>}</div>}
        {accountOpen && profile && <div className="account-popover"><div className="account-qr"><Image src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(profile.walletAddress)}`} alt="Wallet QR code" width={160} height={160} unoptimized /></div><button type="button" className="address-copy" onClick={() => navigator.clipboard?.writeText(profile.walletAddress)}>{profile.walletAddress}</button><div className="account-field"><span>Username</span><input value={profile.username} readOnly /></div><div className="account-field"><span>Password</span><input type="password" value={profile.password} onChange={(event) => setProfile((current) => current ? { ...current, password: event.target.value } : current)} /></div><button type="button" className="account-save" onClick={handleAccountPasswordUpdate}>Update password</button></div>}
      </header>

      <div className="workspace">
        <section className="console-panel">
          <div className="hero-header"><h1><FluereMark className="fluere-banner-mark" /> Fluere</h1></div>
          <div className="conversation-area">{!hasHydratedChat || messages.length === 0 ? <div className="empty-state" /> : <div className="message-list">{messages.map((message) => <div className={`message-row ${message.role}`} key={message.id}><div className="message-label">{message.role === "user" ? "You" : "Fluere"}</div><div className="message-bubble">{message.role === "assistant" ? renderMarkdown(message.content) : message.content}{message.image && <Image className="generated-image" src={`data:${message.image.mimeType};base64,${message.image.data}`} alt="Generated by Gemini" width={1024} height={1024} unoptimized />}</div>{message.role === "assistant" && message.references?.length ? <div className="references-wrap"><button className={`references-button ${message.referencePhase === "circle" ? "circle" : ""}`} onClick={(event) => toggleReferencePanel(message.id, event)}><span className="references-label">References</span><span className="references-icon">⌁</span></button>{message.referencesOpen && <div className="references-popover" style={{ left: referencePopoverAnchor?.id === message.id ? referencePopoverAnchor.left : undefined, top: referencePopoverAnchor?.id === message.id ? referencePopoverAnchor.top : undefined }}>{message.references.map((reference) => <details key={reference.tool}><summary>{reference.tool}</summary><pre>{getActivityData(reference.data)}</pre></details>)}</div>}</div> : null}</div>)}</div>}{loading && <div className="assistant-loading-placeholder" aria-live="polite" aria-busy="true"><div className="assistant-loading-bubble"><div className="assistant-loading-header"><span className="assistant-loading-dot" /><span className="assistant-loading-dot" /><span className="assistant-loading-dot" /></div><div className="assistant-loading-line short" /><div className="assistant-loading-line" /><div className="assistant-loading-line medium" /></div></div>}</div>
          <div className="composer-wrap">
            {selectedTools.length > 0 && <div className="attached-tools">{selectedTools.map((tool) => <span className="tool-chip" key={tool.id}><Layers3 size={12} />{tool.name}<small>${tool.estimatedCostUsdc.toFixed(6)}</small><button onClick={() => toggleTool(tool)} aria-label={`Remove ${tool.name}`}><X size={12} /></button></span>)}</div>}
            <div className="composer">
              <div className="composer-input">
                <textarea value={prompt} onChange={(event) => { setPrompt(event.target.value); if (smartReview) setSmartReview(false); }} onKeyDown={handleComposerKeyDown} placeholder="Ask Fluere" disabled={loading} rows={2} />
              </div>
              <div className="composer-actions">
                <div className="composer-toolbar-row">
                  <div className="composer-menu-wrap" ref={toolsMenuRef}><button className={`plus-button ${showToolsMenu ? "active" : ""}`} onClick={() => { setShowToolsMenu((value) => !value); setShowModelMenu(false); }} aria-label="Add tools">+</button>{showToolsMenu && <div className="tools-menu"><div className="menu-title">Tools</div>{TOP_LEVEL_TOOLS.map((tool) => <button className={`tool-menu-option ${selectedToolIds.includes(tool.id) ? "selected" : ""}`} key={tool.id} onClick={() => toggleTool(tool)}><span><strong>{tool.name} <em>${tool.estimatedCostUsdc.toFixed(6)}</em></strong><small>{tool.description}</small></span>{selectedToolIds.includes(tool.id) && <Check size={15} />}</button>)}</div>}</div>
                  <div className="model-menu-wrap" ref={modelMenuRef}><button className="model-button" onClick={() => { setShowModelMenu((value) => !value); setShowToolsMenu(false); }}><span className="model-dot" /><span>{displayModel(selectedModel)}</span><small>{formatPrice(selectedModelInfo.priceFromUsdc)}</small><ChevronDown size={14} /></button>{showModelMenu && <div className="model-menu"><div className="menu-title">Choose model</div>{MODEL_CATALOG.map((model) => <button className={`model-option ${selectedModel === model.id ? "selected" : ""}`} key={model.id} onClick={() => { setSelectedModel(model.id); setShowModelMenu(false); }}><span>{model.name}<small>{formatPrice(model.priceFromUsdc)}</small></span>{selectedModel === model.id && <Check size={15} />}</button>)}</div>}</div>
                  <button className="call-button" onClick={openCallMode} disabled={loading} aria-label="Start call mode"><Phone size={16} /></button>
                </div>
                <div className="composer-toolbar-row composer-toolbar-row-right">
                  <button className={`mic-button ${recording ? "recording" : ""}`} onClick={() => void toggleRecording()} disabled={loading} aria-label={recording ? "Stop recording" : "Record voice"}>{recording ? <Square size={15} /> : <Mic size={17} />}</button>
                  <button className={`smart-toggle ${smartMode ? "active" : ""}`} onClick={() => { setSmartMode((value) => !value); setSmartReview(false); }} aria-pressed={smartMode}><Sparkles size={13} /><span>Smart</span></button>
                  <div className="prompt-cost" title="Estimated total for this model and its selected tools"><span className="cost-symbol">$</span><strong>{promptCostLabel === "Free" ? "Free" : promptCostLabel.replace(/^\$\s*/, "")}</strong></div>
                  <button className={`execute-button ${smartReview ? "ready" : ""}`} onClick={() => void execute()} disabled={loading || !prompt.trim()} aria-label={smartReview ? "Send with selected tools" : smartMode ? "Suggest tools" : "Execute request"}>{loading ? <span className="spinner" /> : smartReview || !smartMode ? <ArrowUp size={19} /> : <Sparkles size={19} />}</button>
                </div>
              </div>
            </div>
          </div>
        </section>

          <button className="activity-tab" onClick={() => setActivityOpen(true)} aria-label="Open activity"><Zap size={14} /><span>Activity</span><span className="status-dot" /><strong>{logs.length}</strong></button>
      </div>

      {activityOpen && <div className="activity-backdrop" onClick={() => setActivityOpen(false)}><section className="activity-modal" onClick={(event) => event.stopPropagation()}><div className="activity-modal-header"><div><h2>Activity</h2></div><button className="icon-button" onClick={() => setActivityOpen(false)} aria-label="Close activity"><X size={18} /></button></div><div className="log-list">{activityEntries}</div></section></div>}
      {receiptPreview && <div className="receipt-preview-backdrop" onClick={() => setReceiptPreview(null)}><section className="receipt-preview-card" onClick={(event) => event.stopPropagation()}><div className="receipt-preview-header"><div><p className="eyebrow"><ShieldCheck size={13} /> Receipt</p><h3>Decoded payment payload</h3></div><button className="icon-button" onClick={() => setReceiptPreview(null)} aria-label="Close receipt preview"><X size={18} /></button></div><div className="receipt-preview-body">{Object.entries(receiptPreview.payload).map(([key, value]) => { const isTransaction = key === "transaction" && typeof value === "string"; const displayValue = typeof value === "string" ? value : typeof value === "boolean" || typeof value === "number" ? String(value) : JSON.stringify(value, null, 2); return <div className="receipt-row" key={key}><span className="receipt-key">{key}</span>{isTransaction ? <a className="receipt-link" href={getSolscanTxUrl(value, typeof receiptPreview.payload.network === "string" ? receiptPreview.payload.network : undefined)} target="_blank" rel="noreferrer">{value}</a> : <code className="receipt-value">{displayValue}</code>}</div>; })}</div></section></div>}
      {authOpen && !profile && <div className="auth-backdrop" onClick={() => setAuthOpen(false)}><div className="auth-card" onClick={(event) => event.stopPropagation()}><p className="eyebrow">Create account</p><h2>Welcome to Fluere</h2><p className="auth-copy">Create a username and password to start chatting, view account details, and fund your Solana wallet.</p><div className="auth-fields"><label><span>Username</span><input type="text" value={signupForm.username} onChange={(event) => setSignupForm((current) => ({ ...current, username: event.target.value }))} placeholder="yourname" /></label><label><span>Password</span><input type="password" value={signupForm.password} onChange={(event) => setSignupForm((current) => ({ ...current, password: event.target.value }))} placeholder="••••••••" /></label></div><button type="button" className="auth-submit" onClick={handleCreateAccount}>Create account</button></div></div>}
      {receiveOpen && (walletStatus.walletAddress || profile?.walletAddress) && <div className="receive-backdrop" onClick={() => setReceiveOpen(false)}><div className="receive-card" onClick={(event) => event.stopPropagation()}><div className="receive-header"><div><p className="eyebrow"><ShieldCheck size={13} /> Receive</p><h3>USDC wallet address</h3></div><button className="icon-button" onClick={() => setReceiveOpen(false)} aria-label="Close receive panel"><X size={18} /></button></div><div className="receive-body"><button type="button" className="address-copy" onClick={() => navigator.clipboard?.writeText(walletStatus.walletAddress || profile?.walletAddress || "")}>{walletStatus.walletAddress || profile?.walletAddress}</button></div></div></div>}
      {callMode && <div className="call-overlay"><div className="call-card"><button className="call-close" onClick={hangUpCall} aria-label="End call"><X size={20} /></button><div className={`call-orb ${recording ? "listening" : callSpeaking ? "speaking" : ""}`}><Phone size={34} /></div><h2>{callBusy ? "Thinking…" : callSpeaking ? "Speaking…" : recording ? "Listening…" : "Ready to talk"}</h2>{callTranscript && <p className="call-status">{callTranscript}</p>}<div className="call-usage">Call usage <strong>${callCost.toFixed(6)} USDC</strong></div><div className="call-controls">{!callSpeaking && <button className={`call-main-button ${recording ? "recording" : ""}`} onClick={() => void toggleCallRecording()} disabled={callBusy} aria-label={recording ? "Stop listening" : "Start listening"}>{recording ? <Square size={20} /> : <Mic size={20} />}<span>{recording ? "Listening" : "Talk"}</span></button>}{callSpeaking && <button className="call-interrupt-button" onClick={interruptCallAudio} aria-label="Interrupt response"><Square size={15} /><span>Interrupt</span></button>}<button className="call-hangup-button" onClick={hangUpCall} aria-label="Hang up"><PhoneOff size={18} /><span>End call</span></button></div></div></div>}
    </main>
  );
}