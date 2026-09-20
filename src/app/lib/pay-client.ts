import {
  addSignersToTransactionMessage,
  decompileTransactionMessage,
  getBase64Encoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  partiallySignTransactionMessageWithSigners,
} from "@solana/kit";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { UptoSvmScheme } from "@x402/svm/upto/client";
import bs58 from "bs58";

let client: x402HTTPClient | null = null;

const X402_CLOCK_SKEW_SECONDS = 5;
const PAYMENT_CHANNELS_PROGRAM = "CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";

async function readResponseData(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readResponseBase64(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return Buffer.from(binary, "binary").toString("base64");
}

class ClockSkewTolerantUptoSvmScheme extends UptoSvmScheme {
  private readonly payerSigner: ConstructorParameters<typeof UptoSvmScheme>[0];

  constructor(payerSigner: ConstructorParameters<typeof UptoSvmScheme>[0]) {
    super(payerSigner);
    this.payerSigner = payerSigner;
  }

  async createPaymentPayload(...args: Parameters<UptoSvmScheme["createPaymentPayload"]>) {
    const result = await super.createPaymentPayload(...args);
    const payload = result.payload as {
      validAfter: number;
      openTransaction: string;
    } & Record<string, unknown>;
    const transaction = getTransactionDecoder().decode(
      getBase64Encoder().encode(payload.openTransaction),
    );
    const compiledMessage = getCompiledTransactionMessageDecoder().decode(
      transaction.messageBytes,
    );
    const message = decompileTransactionMessage(compiledMessage);
    const openOnlyMessage = addSignersToTransactionMessage([this.payerSigner], {
      ...message,
      instructions: message.instructions.filter(
        (instruction) => String(instruction.programAddress) === PAYMENT_CHANNELS_PROGRAM,
      ),
    });
    const signedOpenOnlyTransaction = await partiallySignTransactionMessageWithSigners(
      openOnlyMessage,
    );

    return {
      ...result,
      payload: {
        ...payload,
        openTransaction: getBase64EncodedWireTransaction(signedOpenOnlyTransaction),
        validAfter: payload.validAfter - X402_CLOCK_SKEW_SECONDS,
      },
    };
  }
}

export async function getPayClient() {
  if (client) return client;

  const privateKey = process.env.SERVER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SERVER_PRIVATE_KEY is missing or invalid");
  }

  const signer = await createKeyPairSignerFromBytes(bs58.decode(privateKey));
  const x402 = new x402Client();
  x402.setSpendControls({ maxAmountPerPayment: "$5" });

  registerExactSvmScheme(x402, { signer });
  x402.register("solana:*", new ClockSkewTolerantUptoSvmScheme(signer));
  x402.registerExtension({
    key: "payment-identifier",
    enrichPaymentPayload: async (paymentPayload, paymentRequired) => {
      if (!paymentRequired.extensions?.["payment-identifier"]) {
        return paymentPayload;
      }

      return {
        ...paymentPayload,
        extensions: {
          ...paymentPayload.extensions,
          "payment-identifier": {
            info: { id: `pay_${crypto.randomUUID()}` },
          },
        },
      };
    },
  });

  client = new x402HTTPClient(x402);

  return client;
}

export async function callPaidEndpoint(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
) {
  const pay = await getPayClient();

  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };

  if (body && method === "POST") {
    options.body = JSON.stringify(body);
  }

  const initialResponse = await fetch(url, options);
  if (initialResponse.status === 402) {
    const paymentRequired = pay.getPaymentRequiredResponse((name) =>
      initialResponse.headers.get(name)
    );
    const paymentPayload = await pay.createPaymentPayload(paymentRequired);
    const headers = new Headers(options.headers);
    for (const [name, value] of Object.entries(
      pay.encodePaymentSignatureHeader(paymentPayload)
    )) {
      headers.set(name, value);
    }

    const response = await fetch(url, { ...options, headers });
    return {
      status: response.status,
      data: await readResponseData(response),
      headers: {
        paymentResponse: response.headers.get("payment-response"),
        xPaymentResponse: response.headers.get("x-payment-response"),
        xLlmPrice: response.headers.get("x-llm-price"),
      },
    };
  }

  const data = await readResponseData(initialResponse);

  return {
    status: initialResponse.status,
    data,
    headers: {
      paymentResponse: initialResponse.headers.get("payment-response"),
      xPaymentResponse: initialResponse.headers.get("x-payment-response"),
      xLlmPrice: initialResponse.headers.get("x-llm-price"),
    },
  };
}


export async function callPaidBinaryEndpoint(
  url: string,
  method: "GET" | "POST" = "POST",
  body?: Uint8Array | string,
  contentType = "application/octet-stream",
) {
  const pay = await getPayClient();
  const options: RequestInit = {
    method,
    headers: { "Content-Type": contentType, Accept: "application/json, audio/mpeg, audio/wav, application/octet-stream" },
    ...(body && method === "POST" ? { body: body as BodyInit } : {}),
  };
  const initialResponse = await fetch(url, options);
  const getHeaders = (response: Response) => ({
    paymentResponse: response.headers.get("payment-response"),
    xPaymentResponse: response.headers.get("x-payment-response"),
    xLlmPrice: response.headers.get("x-llm-price"),
  });
  if (initialResponse.status !== 402) {
    return { status: initialResponse.status, data: initialResponse.headers.get("content-type")?.includes("audio") ? await readResponseBase64(initialResponse) : await readResponseData(initialResponse), headers: getHeaders(initialResponse) };
  }
  const paymentRequired = pay.getPaymentRequiredResponse((name) => initialResponse.headers.get(name));
  const paymentPayload = await pay.createPaymentPayload(paymentRequired);
  const headers = new Headers(options.headers);
  for (const [name, value] of Object.entries(pay.encodePaymentSignatureHeader(paymentPayload))) headers.set(name, value);
  const response = await fetch(url, { ...options, headers });
  return {
    status: response.status,
    data: response.headers.get("content-type")?.includes("audio") ? await readResponseBase64(response) : await readResponseData(response),
    headers: getHeaders(response),
  };
}