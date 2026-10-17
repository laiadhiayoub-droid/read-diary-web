import { z } from "zod";

const point = { x: z.number(), y: z.number() };
const paint = { stroke: z.string(), fill: z.string().nullable(), strokeWidth: z.number() };
// The provider schema stays unconstrained; strict local validation is applied before storage.
export const diagramWireSchema = z.object({
  width: z.number(), height: z.number(), description: z.string(),
  elements: z.array(z.union([
    z.object({ kind: z.enum(["line", "arrow"]), ...point, x2: z.number(), y2: z.number(), ...paint }).strict(),
    z.object({ kind: z.enum(["rect"]), ...point, width: z.number(), height: z.number(), radius: z.number(), ...paint }).strict(),
    z.object({ kind: z.enum(["ellipse"]), ...point, rx: z.number(), ry: z.number(), ...paint }).strict(),
    z.object({ kind: z.enum(["path"]), d: z.string(), ...paint }).strict(),
    z.object({ kind: z.enum(["label"]), ...point, text: z.string(), color: z.string(), fontSize: z.number(), direction: z.enum(["rtl", "ltr"]) }).strict(),
    z.object({ kind: z.enum(["charge"]), ...point, sign: z.enum(["+", "-"]), radius: z.number() }).strict(),
  ])),
}).strict();

const hex = /^#[0-9a-fA-F]{6}$/;
const pathData = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/;
export const notebookDiagramSchema = diagramWireSchema.superRefine((diagram, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (diagram.width < 100 || diagram.width > 2400 || diagram.height < 100 || diagram.height > 2400) invalid("Invalid diagram viewport");
  if (!diagram.description.trim() || diagram.description.length > 2000 || diagram.elements.length < 1 || diagram.elements.length > 500) invalid("Invalid diagram content");
  for (const element of diagram.elements) {
    for (const value of Object.values(element)) {
      if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > 10000)) invalid("Invalid diagram coordinate");
    }
    if ("x" in element && (element.x < 0 || element.x > diagram.width || element.y < 0 || element.y > diagram.height)) invalid("Element outside viewport");
    if ("stroke" in element && (!hex.test(element.stroke) || (element.fill !== null && !hex.test(element.fill)) || element.strokeWidth < 0 || element.strokeWidth > 16)) invalid("Invalid diagram paint");
    if (element.kind === "label" && (!hex.test(element.color) || element.text.length > 500 || element.fontSize < 10 || element.fontSize > 64)) invalid("Invalid diagram label");
    if (element.kind === "path" && (!pathData.test(element.d) || element.d.length > 12000)) invalid("Invalid SVG path data");
    if (element.kind === "charge" && (element.radius < 6 || element.radius > 40)) invalid("Invalid charge radius");
    if (element.kind === "rect" && (element.width <= 0 || element.height <= 0 || element.radius < 0)) invalid("Invalid rectangle");
    if (element.kind === "ellipse" && (element.rx <= 0 || element.ry <= 0)) invalid("Invalid ellipse");
  }
});
export type NotebookDiagram = z.infer<typeof notebookDiagramSchema>;