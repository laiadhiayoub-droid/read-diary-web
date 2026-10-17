import { z } from "zod";
import { notebookDiagramSchema } from "./notebook-diagram";

export type NotebookRole = "student" | "writer" | "subscriber" | "admin";
export const canReadFormatted = (roles: readonly string[]) => roles.includes("subscriber") || roles.includes("admin");
export const canManageSubscribers = (roles: readonly string[]) => roles.includes("admin");
export const LOCKED_NOTEBOOK_MESSAGE = "هذا الخيار مخصص للمشتركين فقط. يرجى التواصل مع الإدارة للتفعيل.";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const notebookDocumentSchema = z.object({
  direction: z.enum(["rtl", "ltr"]),
  blocks: z.array(z.union([z.object({
    kind: z.enum(["heading", "subheading", "paragraph", "list", "quote"]),
    runs: z.array(z.object({ text: z.string(), color, highlight: color.nullable(), bold: z.boolean(), underline: z.boolean() })),
    diagram: z.null().optional(),
  }).strict(), z.object({
    kind: z.literal("diagram"),
    runs: z.array(z.object({ text: z.string(), color, highlight: color.nullable(), bold: z.boolean(), underline: z.boolean() })),
    diagram: notebookDiagramSchema,
  }).strict()])),
  uncertain: z.boolean(),
}).strict();
export type NotebookDocument = z.infer<typeof notebookDocumentSchema>;

export type BoundPage = { id: string; parent_lesson_id: string | null; page_number: number; order_index: number; created_at: string };
export function orderedBookPages<T extends BoundPage>(pages: T[]): T[] {
  return [...pages].sort((a, b) => a.order_index - b.order_index || a.page_number - b.page_number || a.created_at.localeCompare(b.created_at));
}
export function nextPageNumber(pages: BoundPage[], rootId: string | null) {
  if (!rootId) return 1;
  return Math.max(0, ...pages.filter(p => p.id === rootId || p.parent_lesson_id === rootId).map(p => p.page_number)) + 1;
}