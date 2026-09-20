import { NextRequest, NextResponse } from "next/server";
import { callPaidEndpoint } from "@/app/lib/pay-client";
import { GEMINI_MODELS, TOP_LEVEL_TOOLS, inferToolIdsForPrompt, type Tool } from "@/app/lib/tools";

export const maxDuration = 30;

const toolCatalog = TOP_LEVEL_TOOLS.map((tool: Tool) => ({
  id: tool.id,
  name: tool.name,
  description: tool.description,
  category: tool.category,
}));

function readText(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  const parts = candidates[0] && typeof candidates[0] === "object" && "content" in candidates[0]
    ? (candidates[0] as { content?: { parts?: unknown } }).content?.parts
    : null;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("").trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const manuallySelected = Array.isArray(body.selectedToolIds) ? body.selectedToolIds.filter((id: unknown): id is string => typeof id === "string") : [];
    if (!prompt) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

    const inferredToolIds = inferToolIdsForPrompt(prompt, manuallySelected);
    if (inferredToolIds.length) {
      return NextResponse.json({
        success: true,
        toolIds: inferredToolIds,
        logs: [`[SMART] Price query detected; attached ${inferredToolIds.join(", ")}`],
      });
    }

    const availableTools = toolCatalog.map((tool) => `${tool.id}: ${tool.name} - ${tool.description}`).join("\n");
    const instruction = [
      "You are Fluere Smart Mode, a conservative tool router.",
      "Choose exactly which available tools would materially improve the answer to the user's prompt.",
      "Use a tool for fresh, external, computational, market, or blockchain data when needed.",
      "Do not choose tools merely because they are available. Choose none when the model can answer directly.",
      "Return ONLY valid JSON in this exact shape: {\"toolIds\":[\"id\"]}.",
      `Available tools:\n${availableTools}`,
      `User-selected tools are also candidates and may be kept or removed: ${JSON.stringify(manuallySelected)}`,
      `User prompt: ${prompt}`,
    ].join("\n\n");
    const result = await callPaidEndpoint(
      `https://generativelanguage.google.gateway-402.com/v1beta/models/${GEMINI_MODELS[0]}:generateContent`,
      "POST",
      { contents: [{ parts: [{ text: instruction }] }] },
    );
    if (result.status === 402 || result.status < 200 || result.status >= 300) {
      return NextResponse.json({
        success: true,
        toolIds: manuallySelected,
        logs: ["[SMART] Smart Mode unavailable; continuing with manual selections."],
      });
    }

    const raw = readText(result.data).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    if (!raw) {
      return NextResponse.json({
        success: true,
        toolIds: manuallySelected,
        logs: ["[SMART] Smart Mode returned no tool recommendation; continuing with manual selections."],
      });
    }

    try {
      const parsed = JSON.parse(raw) as { toolIds?: unknown };
      const validIds = new Set(toolCatalog.map((tool) => tool.id));
      const toolIds = Array.isArray(parsed.toolIds)
        ? [...new Set(parsed.toolIds.filter((id: unknown): id is string => typeof id === "string" && validIds.has(id)))]
        : [];
      return NextResponse.json({ success: true, toolIds, logs: [`[SMART] Suggested ${toolIds.length} tool${toolIds.length === 1 ? "" : "s"}`] });
    } catch {
      return NextResponse.json({
        success: true,
        toolIds: manuallySelected,
        logs: ["[SMART] Smart Mode parsing failed; continuing with manual selections."],
      });
    }
  } catch {
    return NextResponse.json({
      success: true,
      toolIds: [],
      logs: ["[SMART] Smart Mode unavailable; continuing without automatic tool suggestions."],
    }, { status: 200 });
  }
}