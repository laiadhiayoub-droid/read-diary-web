import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayRunIdFetch } from "./ai/run-id.server";
import { notebookDocumentSchema } from "./notebook";

const wireSchema = z.object({ direction: z.enum(["rtl", "ltr"]), blocks: z.array(z.object({
  kind: z.enum(["heading", "subheading", "paragraph", "list", "quote"]),
  runs: z.array(z.object({text:z.string(),color:z.string(),highlight:z.string().nullable(),bold:z.boolean(),underline:z.boolean()})),
})), uncertain: z.boolean() });

export async function transcribeNotebook(image: Uint8Array, mediaType: string, apiKey: string) {
  const run = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }, fetch: run.fetch });
  const result = streamText({ model: provider.responses("openai/gpt-6-astra"), maxRetries: 0,
    system: "Transcribe this notebook page faithfully into structured document blocks. Do not summarize, translate, correct, or invent text. Preserve all headings, paragraphs, list markers, order, line breaks, bold, underline, original ink colors and highlight colors as six-digit hex RGB. Use separate runs for color changes. Preserve diagrams/tables as their actual readable text structure; flag uncertain=true for any illegible word or layout not faithfully representable. Use [غير واضح] for illegible text, never guess. Direction follows the original language. Return only the source content, not extra titles or explanations.",
    messages: [{ role: "user", content: [{ type: "text", text: "Transcribe this source page exactly." }, {type:"image", image, mediaType}] }],
    output: Output.object({schema:wireSchema}),
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "medium", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
  });
  return notebookDocumentSchema.parse(await result.output);
}