import { NextRequest, NextResponse } from "next/server";
import { callPaidEndpoint } from "@/app/lib/pay-client";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.audio !== "string" || !body.audio) {
      return NextResponse.json({ error: "Audio is required" }, { status: 400 });
    }

    const result = await callPaidEndpoint(
      "https://speech.google.gateway-402.com/v1/speech:recognize",
      "POST",
      {
        config: {
          encoding: "WEBM_OPUS",
          sampleRateHertz: 48000,
          languageCode: "en-US",
          enableAutomaticPunctuation: true,
        },
        audio: { content: body.audio },
      },
    );

    if (result.status < 200 || result.status >= 300) {
      return NextResponse.json({ error: "Speech recognition failed", data: result.data }, { status: result.status });
    }

    const data = result.data as { results?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    const transcript = data.results?.map((result) => result.alternatives?.[0]?.transcript || "").filter(Boolean).join(" ") || "";
    return NextResponse.json({ transcript, data: result.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Speech recognition failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}