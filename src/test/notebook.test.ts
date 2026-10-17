import { describe, expect, it } from "vitest";
import { canReadFormatted, canManageSubscribers, nextPageNumber, orderedBookPages, notebookDocumentSchema } from "@/lib/notebook";
describe("subscriber notebook rules", () => {
  it("only subscribers and admins can read formatted documents", () => {
    expect(["student", "writer", "subscriber", "admin"].map(r => canReadFormatted([r]))).toEqual([false, false, true, true]);
    expect(canReadFormatted([])).toBe(false);
  });
  it("only admins can grant and revoke membership", () => {
    expect(["student", "writer", "subscriber", "admin"].map(r => canManageSubscribers([r]))).toEqual([false, false, false, true]);
  });
  it("binds consecutive continuation pages after the highest existing page", () => {
    const pages = [{id:"root",parent_lesson_id:null,page_number:1,order_index:0,created_at:"2026-01-01"}, {id:"p3",parent_lesson_id:"root",page_number:3,order_index:2,created_at:"2026-01-01"}];
    expect(nextPageNumber(pages, "root")).toBe(4);
    expect(nextPageNumber(pages, null)).toBe(1);
    expect(orderedBookPages([...pages].reverse()).map(p=>p.id)).toEqual(["root", "p3"]);
  });
  it("keeps source colors, highlights and text without modification", () => {
    const doc = {direction:"rtl", blocks:[{kind:"heading",runs:[{text:"عنوان أصلي",color:"#ff0000",highlight:"#ffff00",bold:true,underline:true}]}],uncertain:false};
    expect(notebookDocumentSchema.parse(doc)).toEqual(doc);
    expect(notebookDocumentSchema.safeParse({...doc, blocks:[{kind:"heading",runs:[{text:"عنوان أصلي",color:"url(evil)",highlight:null,bold:false,underline:false}]}]}).success).toBe(false);
  });
});