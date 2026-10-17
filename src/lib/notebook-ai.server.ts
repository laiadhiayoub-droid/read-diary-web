import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayRunIdFetch } from "./ai/run-id.server";
import { notebookDocumentSchema } from "./notebook";
import { diagramWireSchema } from "./notebook-diagram";

const wireSchema = z.object({ direction: z.enum(["rtl", "ltr"]), blocks: z.array(z.object({
  kind: z.enum(["heading", "subheading", "paragraph", "list", "quote", "diagram"]),
  runs: z.array(z.object({text:z.string(),color:z.string(),highlight:z.string().nullable(),bold:z.boolean(),underline:z.boolean()}).strict()),
  diagram: diagramWireSchema.nullable(),
}).strict()), uncertain: z.boolean() }).strict();

export async function transcribeNotebook(image: Uint8Array, mediaType: string, apiKey: string) {
  const run = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" }, fetch: run.fetch });
  const result = streamText({ model: provider.responses("openai/gpt-6-astra"), maxRetries: 0,
    system: `You are a specialist in Arabic handwritten science notebooks, low-contrast ink, ruled paper, shadows and skew. Transcribe text faithfully: never summarize, translate, correct grammar, or invent content. Ignore printed rulings. Use sentence context, subject vocabulary and letter shapes before marking a truly unreadable word [غير واضح]. Preserve headings, paragraphs, lists, order, line breaks, bold, underline, source ink and highlight colors as six-digit hex RGB.
DIAGRAM RECONSTRUCTION: Detect every physical experiment, apparatus or diagram. NEVER transcribe a drawing as prose or ASCII art. Reconstruct the entire drawing electronically as a diagram block containing structured SVG primitives. Keep the diagram at its original position among the text blocks. Text blocks have diagram=null. Diagram blocks have runs=[] (or only a source caption) and a non-null diagram. Use line/arrow, rect, ellipse and path primitives for rods, supports, electroscope knobs/stems/leaves, glass containers, pendulum strings and bobs. Use separate charge primitives with sign + or - at each EXACT source position; do not infer or add charges from textbook knowledge. Charges render red for positive and blue for negative. Preserve spacing, contact/gaps, orientation, leaf deflection, stage grouping and labels 1, 2, 3 exactly; never mirror geometry to match RTL. Label primitives contain actual source labels, not invented explanations. Arabic labels use direction=rtl; numbers/symbols use ltr. Reconstruct readable tables as vector lines with source labels, not flattened prose.
Use a tight but padded viewBox width/height between 100 and 2400, typically width 800, scaled proportionally from the source. All elements and labels must fit the viewport with enough margins for their full extent. Use fontSize 18-28 (allowed 10-64), strokeWidth 1.5-3 (allowed 0-16), charge radius 10-16 (allowed 6-40), simple valid SVG path d commands only, no markup, scripts, URLs, external images, foreignObject or HTML. Coordinates are numeric SVG units. All stroke/fill/label colors are six-digit hex; fill=null means no fill. Use restrained source colors and clean rounded line geometry. Keep apparatus proportions and do not introduce decorative graphics. Give each diagram a concise factual Arabic accessibility description, not an extra visible heading. Maximum 500 primitives per diagram. Flag uncertain=true only for genuinely unreadable source text or diagram details you cannot faithfully reconstruct; never silently guess. Return only source content.`,
    messages: [{ role: "user", content: [{ type: "text", text: "Transcribe this source page and reconstruct its experiments as faithful vector diagrams." }, {type:"image", image, mediaType, providerOptions: { openai: { imageDetail: "high" } }}] }],
    output: Output.object({schema:wireSchema}),
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "medium", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
  });
  return notebookDocumentSchema.parse(await result.output);
}