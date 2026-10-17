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
    system: "You are a specialist reader of handwritten school notebook pages, especially Arabic handwriting, on ruled/lined paper with low-contrast ink, pencil, and photographed pages with shadows or skew. Transcribe the page faithfully into structured document blocks. Do not summarize, translate, correct grammar, or invent text. Ignore printed notebook rulings, margins, and page decorations; read only the handwriting. Before marking anything [غير واضح], deduce the word from sentence context, subject vocabulary, and letter shapes — use [غير واضح] only when a word is truly impossible to read even with context, and never flag a readable handwritten word. Preserve all headings, subheadings, paragraphs, list markers, order, line breaks, bold, underline, original ink colors and highlight colors as six-digit hex RGB. Use separate runs for color changes. Preserve figures, diagrams and tables as their actual readable text structure (labels, arrows as text, table rows). Flag uncertain=true only if at least one [غير واضح] marker or a layout you could not represent faithfully exists. Direction follows the original language. Return only the source content, not extra titles or explanations.",
    messages: [{ role: "user", content: [{ type: "text", text: "Transcribe this source page exactly." }, {type:"image", image, mediaType}] }],
    output: Output.object({schema:wireSchema}),
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "medium", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
  });
  return notebookDocumentSchema.parse(await result.output);
}