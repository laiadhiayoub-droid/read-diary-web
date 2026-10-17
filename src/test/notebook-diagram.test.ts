import { describe, expect, it } from "vitest";
import { notebookDocumentSchema } from "@/lib/notebook";
import { notebookDiagramSchema } from "@/lib/notebook-diagram";

const diagram = {
  width: 800, height: 360, description: "قضيب وكشاف كهربائي وبندول، مراحل 1 و2 و3",
  elements: [
    { kind: "rect", x: 40, y: 80, width: 180, height: 20, radius: 4, stroke: "#202124", fill: null, strokeWidth: 2 },
    { kind: "ellipse", x: 340, y: 70, rx: 24, ry: 12, stroke: "#202124", fill: null, strokeWidth: 2 },
    { kind: "path", d: "M 340 82 L 340 190 M 340 190 L 315 235 M 340 190 L 365 235", stroke: "#202124", fill: null, strokeWidth: 2 },
    { kind: "line", x: 580, y: 60, x2: 620, y2: 210, stroke: "#202124", fill: null, strokeWidth: 2 },
    { kind: "ellipse", x: 620, y: 226, rx: 16, ry: 16, stroke: "#202124", fill: null, strokeWidth: 2 },
    { kind: "charge", x: 80, y: 90, sign: "+", radius: 10 },
    { kind: "charge", x: 340, y: 70, sign: "-", radius: 10 },
    ...[1, 2, 3].map((n) => ({ kind: "label", x: n * 200, y: 310, text: String(n), color: "#202124", fontSize: 22, direction: "ltr" })),
  ],
};

describe("faithful vector diagrams", () => {
  it("preserves rods, electroscope geometry and pendulum geometry", () => {
    expect(notebookDiagramSchema.parse(diagram).elements.slice(0, 5)).toEqual(diagram.elements.slice(0, 5));
  });
  it("retains exact plus/minus signs and physical positions", () => {
    expect(notebookDiagramSchema.parse(diagram).elements.filter(e => e.kind === "charge")).toEqual([
      { kind: "charge", x: 80, y: 90, sign: "+", radius: 10 },
      { kind: "charge", x: 340, y: 70, sign: "-", radius: 10 },
    ]);
  });
  it("preserves stages 1, 2 and 3 without mirroring RTL geometry", () => {
    const parsed = notebookDocumentSchema.parse({direction: "rtl", blocks: [{kind: "diagram", runs: [], diagram}], uncertain: false});
    const block = parsed.blocks[0];
    if (block?.kind !== "diagram") throw new Error("Expected diagram");
    expect(block.diagram.elements.filter(e => e.kind === "label").map(e => [e.text, e.x])).toEqual([["1", 200], ["2", 400], ["3", 600]]);
  });
  it("rejects scripts, external resources, invalid paths and out-of-bounds positions", () => {
    for (const element of [
      {kind: "script", text: "alert(1)"},
      {...diagram.elements[0], stroke: "url(https://example.com)"},
      {...diagram.elements[2], d: '<svg onload="alert(1)">'},
      {...diagram.elements[5], x: 801},
    ]) expect(notebookDiagramSchema.safeParse({...diagram, elements: [element]}).success).toBe(false);
  });
  it("keeps legacy notebooks readable and text edits preserve diagram data", () => {
    const doc = notebookDocumentSchema.parse({direction: "rtl", blocks: [
      {kind: "paragraph", runs: [{text: "تجربة", color: "#202124", highlight: null, bold: false, underline: false}]},
      {kind: "diagram", runs: [], diagram},
    ], uncertain: false});
    const draft = structuredClone(doc);
    const text = draft.blocks[0]?.runs[0];
    if (text) text.text = "تجربة مصححة";
    expect(notebookDocumentSchema.parse(draft).blocks[1]).toEqual(doc.blocks[1]);
  });
});