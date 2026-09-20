import { NextRequest, NextResponse } from "next/server";
import { callPaidBinaryEndpoint, callPaidEndpoint } from "@/app/lib/pay-client";
import { AI_MODELS, GEMINI_MODELS, getModelInfo } from "@/app/lib/tools";

export const maxDuration = 60;

function providerError(data: unknown) {
  if (!data || typeof data !== "object" || !("error" in data)) return null;
  const error = (data as { error?: unknown }).error;
  if (error == null) return null;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return "The provider returned an error";
}

function readAiText(data: unknown) {
  if (!data || typeof data !== "object") return "";
  if ("choices" in data && Array.isArray((data as { choices?: unknown }).choices)) {
    const choice = (data as { choices: Array<{ message?: { content?: string }; text?: string }> }).choices[0];
    return choice?.message?.content?.trim() || choice?.text?.trim() || "";
  }
  if ("output" in data && Array.isArray((data as { output?: unknown }).output)) {
    return ((data as { output: Array<{ content?: Array<{ text?: string }> }> }).output)
      .flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("\n").trim();
  }
  if ("candidates" in data && Array.isArray((data as { candidates?: unknown }).candidates)) {
    const candidate = (data as { candidates: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates[0];
    return candidate?.content?.parts?.map((part) => part.text ?? "").join("\n").trim() || "";
  }
  return "";
}

function findString(data: unknown, keys: RegExp): string | null {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return null;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && keys.test(key)) return value;
    const nested = findString(value, keys);
    if (nested) return nested;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const logs: string[] = ["[CALL] Voice turn started"];
    const body = await request.json();
    const model = typeof body.model === "string" ? body.model : GEMINI_MODELS[0];
    const audio = typeof body.audio === "string" ? body.audio : "";
    if (!audio) return NextResponse.json({ error: "Audio is required" }, { status: 400 });
    if (!AI_MODELS.includes(model as (typeof AI_MODELS)[number])) return NextResponse.json({ error: "Unsupported AI model" }, { status: 400 });

    const speech = await callPaidEndpoint("https://speech.google.gateway-402.com/v1/speech:recognize", "POST", {
      config: { encoding: "WEBM_OPUS", sampleRateHertz: 48000, languageCode: "en-US", enableAutomaticPunctuation: true },
      audio: { content: audio },
    });
    const speechData = speech.data as { results?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    const transcript = speechData.results?.map((result) => result.alternatives?.[0]?.transcript || "").filter(Boolean).join(" ") || "";
    logs.push(`[CALL ASR] Google Speech transcription ${transcript ? "succeeded" : "returned no transcript"}`);
    if (!transcript) return NextResponse.json({ error: "No speech was detected" }, { status: 422 });
    logs.push(`[CALL ASR] Transcript received: ${transcript}`);

    const modelMetadata = getModelInfo(model);
    const isX402Engine = modelMetadata.provider === "x402engine";
    const isBlockrunModel = modelMetadata.provider === "blockrun";
    const aiUrl = isBlockrunModel || isX402Engine
      ? modelMetadata.endpoint!
      : `https://generativelanguage.google.gateway-402.com/v1beta/models/${model}:generateContent`;
    const aiBody = isBlockrunModel
      ? { model, messages: [{ role: "user", content: `Reply conversationally in 300 characters or fewer: ${transcript}` }], stream: false }
      : isX402Engine
        ? { messages: [{ role: "user", content: `Reply conversationally in 300 characters or fewer: ${transcript}` }] }
        : { contents: [{ parts: [{ text: `Reply conversationally in 300 characters or fewer: ${transcript}` }] }] };
    let ai = await callPaidEndpoint(aiUrl, "POST", aiBody);
      logs.push(`[CALL AI] ${model} response requested`);
        let aiError = providerError(ai.data);
        const modelPaused = isX402Engine && aiError?.toLowerCase().includes("pricing is unavailable");
        if (modelPaused) {
          const fallbackModel = GEMINI_MODELS[0];
          logs.push(`[CALL AI] ${model} is paused; falling back to free ${fallbackModel}`);
          ai = await callPaidEndpoint(`https://generativelanguage.google.gateway-402.com/v1beta/models/${fallbackModel}:generateContent`, "POST", {
            contents: [{ parts: [{ text: `Reply conversationally in 300 characters or fewer: ${transcript}` }] }],
          });
          aiError = providerError(ai.data);
        }
        if (ai.status < 200 || ai.status >= 300 || aiError) return NextResponse.json({ error: aiError || "AI response failed", transcript, logs }, { status: 502 });
    const reply = readAiText(ai.data).slice(0, 300) || "I didn't catch that.";
  logs.push(`[CALL AI] Response ready (${reply.length} characters)`);

    const ttsUrl = "https://x402engine.app/api/tts/elevenlabs";
    const tts = await callPaidBinaryEndpoint(ttsUrl, "POST", JSON.stringify({ text: reply }), "application/json");
      logs.push("[CALL TTS] x402engine ElevenLabs synthesis requested");
    const ttsError = providerError(tts.data);
    const audioContent = tts.status >= 200 && tts.status < 300 && !ttsError ? (typeof tts.data === "string" ? tts.data : findString(tts.data, /audio|content|base64|data/i)) : null;
    if (!audioContent) logs.push(`[CALL TTS] x402engine unavailable: ${ttsError || `HTTP ${tts.status}`}; browser speech fallback available`);
    else logs.push("[CALL TTS] Audio ready");
    const paidCosts = [speech.headers.xLlmPrice, ai.headers.xLlmPrice, tts.headers.xLlmPrice]
      .map((price) => price ? Number.parseFloat(price.replace(/[^0-9.]/g, "")) : 0)
      .reduce((total, price) => total + (Number.isFinite(price) ? price : 0), 0);
    return NextResponse.json({ transcript, reply, audio: audioContent, ttsError: audioContent ? null : (ttsError || `HTTP ${tts.status}`), cost: paidCosts || 0.02, logs, asr: speech.data, tts: tts.data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Call failed" }, { status: 500 });
  }
}