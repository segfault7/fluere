import { NextRequest, NextResponse } from "next/server";
// These modules are provided by the application at build time.
import { callPaidEndpoint } from "@/app/lib/pay-client";
import {
  AI_MODELS,
  GEMINI_MODELS,
  getModelInfo,
  TOP_LEVEL_TOOLS,
  type Tool as CatalogTool,
} from "@/app/lib/tools";

type Tool = {
  id: string;
  name: string;
  method: "GET" | "POST";
  url: string;
  exampleParams?: unknown;
  estimatedCostUsdc: number;
  network?: string;
};

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

const tools: Tool[] = [
  ...(TOP_LEVEL_TOOLS as CatalogTool[]),
];

export const maxDuration = 60;

function getProviderError(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("error" in data)) {
    return null;
  }

  const error = (data as { error?: unknown }).error;
  if (error == null) {
    return null;
  }
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "The provider returned an error";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const model = typeof body.model === "string" ? body.model : GEMINI_MODELS[0];
    const toolIds = Array.isArray(body.toolIds)
      ? body.toolIds.filter((id: unknown): id is string => typeof id === "string")
      : [];
    const history = Array.isArray(body.history)
      ? body.history.filter((message: unknown): message is HistoryMessage =>
          !!message && typeof message === "object"
          && "role" in message
          && "content" in message
          && (message.role === "user" || message.role === "assistant")
          && typeof message.content === "string")
      : [];
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    if (!AI_MODELS.includes(model as (typeof AI_MODELS)[number])) {
      return NextResponse.json({ error: "Unsupported AI model" }, { status: 400 });
    }

    const logs: string[] = [];
    const context: Array<{ tool: string; data: unknown }> = [];

    for (const toolId of toolIds) {
      const tool = tools.find((candidate) => candidate.id === toolId);
      if (!tool) return NextResponse.json({ error: `Tool not found: ${toolId}` }, { status: 404 });
      logs.push(`[TOOL] ${tool.name}`);
      logs.push(`[HTTP] ${tool.method} ${tool.url}`);

      const requestBody = tool.id === "exa-search"
        ? { query: prompt, type: "auto", contents: { text: true, highlights: true } }
        : tool.exampleParams;
      const toolUrl = tool.id === "wolfram-query"
        ? `${tool.url}?input=${encodeURIComponent(prompt)}`
        : tool.url;
      if (tool.id === "wolfram-query") {
        logs[logs.length - 1] = `[HTTP] ${tool.method} ${toolUrl}`;
      }
      const result = await callPaidEndpoint(toolUrl, tool.method, requestBody);
      const providerError = getProviderError(result.data);
      if (result.status < 200 || result.status >= 300 || providerError) {
        const message = providerError || `Provider returned HTTP ${result.status}`;
        logs.push(`[ERROR] ${message}`);
        return NextResponse.json({ success: false, error: message, data: result.data, logs }, { status: result.status >= 400 ? result.status : 502 });
      }
      const paymentReceipt = result.headers.paymentResponse || result.headers.xPaymentResponse;
      if (paymentReceipt) logs.push(`[RECEIPT] ${paymentReceipt}`);
      logs.push(`[${result.status} OK] ${tool.name} data received`);
      context.push({ tool: tool.name, data: result.data });
    }

    const modelMetadata = getModelInfo(model);
    const isX402Engine = modelMetadata.provider === "x402engine";
    const isBlockrunModel = modelMetadata.provider === "blockrun";
    const contextText = context.length
      ? `\n\nFresh tool results (use these as current context):\n${JSON.stringify(context, null, 2)}`
      : "";
    const conversationHistoryText = history.length
      ? `\n\nConversation history:\n${history.map((message: HistoryMessage) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n")}`
      : "";
    const directAnswerInstruction = "Answer the user directly using the provided tool context and conversation history when helpful. Maintain continuity across the current chat. Never emit a function call, tool call, or any JSON/tool-call syntax. Do not mention tool invocation. Return plain readable text. If the tool results are incomplete, explain that and answer from the information you have.";
    const userContent = `${conversationHistoryText}\n\nCurrent user message: ${prompt}${contextText}\n\n${directAnswerInstruction}`;
    const aiUrl = isBlockrunModel || isX402Engine
      ? modelMetadata.endpoint!
      : `https://generativelanguage.google.gateway-402.com/v1beta/models/${model}:generateContent`;
    const aiBody = isBlockrunModel
      ? { model, messages: [{ role: "user", content: userContent }], stream: false }
      : isX402Engine
        ? { messages: [{ role: "user", content: userContent }] }
        : {
            system_instruction: {
              parts: [{ text: directAnswerInstruction }],
            },
            contents: [{ role: "user", parts: [{ text: `${conversationHistoryText}\n\nCurrent user message: ${prompt}${contextText}` }] }],
          };
    logs.push(`[AI] POST ${isBlockrunModel || isX402Engine ? aiUrl : `${model}:generateContent`}`);

    const aiResult = await callPaidEndpoint(aiUrl, "POST", aiBody);
    const aiError = getProviderError(aiResult.data);
    const malformedFunctionCall = (() => {
      if (!aiResult.data || typeof aiResult.data !== "object" || !("candidates" in aiResult.data)) return false;
      const candidates = (aiResult.data as { candidates?: unknown }).candidates;
      if (!Array.isArray(candidates)) return false;
      return candidates.some((candidate) => {
        if (!candidate || typeof candidate !== "object") return false;
        const finishReason = (candidate as { finishReason?: unknown }).finishReason;
        return typeof finishReason === "string" && finishReason.toUpperCase().includes("MALFORMED");
      });
    })();
    if (aiResult.status < 200 || aiResult.status >= 300 || aiError || malformedFunctionCall) {
      const message = aiError || (malformedFunctionCall ? "The model attempted a malformed function call; retry without tool-calling enabled." : `AI provider returned HTTP ${aiResult.status}`);
      logs.push(`[ERROR] ${message}`);
      return NextResponse.json({ success: false, error: message, data: aiResult.data, logs }, { status: aiResult.status >= 400 ? aiResult.status : 502 });
    }
    const aiReceipt = aiResult.headers.paymentResponse || aiResult.headers.xPaymentResponse;
    if (aiReceipt) logs.push(`[RECEIPT] ${aiReceipt}`);
    logs.push(`[${aiResult.status} OK] ${isBlockrunModel ? "blockrun" : isX402Engine ? "x402engine" : "Gemini"} response received`);

    return NextResponse.json({
      success: true,
      model,
      data: aiResult.data,
      logs,
      toolCount: context.length,
      toolResults: context,
      paymentHeaders: aiResult.headers,
    });
  } catch (error: unknown) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Execution failed";
    return NextResponse.json(
      {
        error: message,
        logs: [`[ERROR] ${message}`],
      },
      { status: 500 }
    );
  }
}