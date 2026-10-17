import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, BookOpen, Check, FileText, Loader2, Lock, Pencil, RefreshCw, X, ZoomIn, ZoomOut, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { generateFormattedPage, updateFormattedPage } from "@/lib/notebook.functions";
import { canReadFormatted, LOCKED_NOTEBOOK_MESSAGE, notebookDocumentSchema, type NotebookDocument } from "@/lib/notebook";
import { NotebookDiagram } from "@/components/NotebookDiagram";

type Page = {id:string;title:string;image_path:string;subject:string};
export function BoundNotebookReader({pages, initialId, roles, onClose}: {pages:Page[];initialId:string|null;roles:string[];onClose:()=>void}) {
  const [index,setIndex] = useState(0);
  const [mode,setMode] = useState("original");
  const [busy,setBusy] = useState(false);
  const [failure,setFailure] = useState<string|null>(null);
  const [scale,setScale] = useState(1);
  const [editing,setEditing] = useState(false);
  const [draft,setDraft] = useState<NotebookDocument|null>(null);
  const [saving,setSaving] = useState(false);
  const generate = useServerFn(generateFormattedPage);
  const update = useServerFn(updateFormattedPage);
  const allowed = canReadFormatted(roles);
  const canEdit = roles.includes("admin") || roles.includes("writer");
  const pinch = useRef<{d:number;scale:number}|null>(null);
  const [downloading,setDownloading] = useState(false);
  const [lightbox,setLightbox] = useState(false);
  async function downloadImage() {
    if(!image.data || !page || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(image.data);
      if(!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${page.title}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 30000);
    } catch { toast.error("تعذّر تحميل الصورة"); } finally { setDownloading(false); }
  }
  useEffect(()=>{setIndex(Math.max(0,pages.findIndex(p=>p.id===initialId)));setMode("original");setFailure(null);setEditing(false);setDraft(null);},[initialId]);
  const page=initialId ? pages[index] : undefined;
  useEffect(()=>{setScale(1);setEditing(false);setDraft(null);},[page?.id]);
  const image = useQuery({queryKey:["bound-image",page?.image_path],enabled:!!page,queryFn:async()=>{
    if(!page) return null;
    const {data,error}=await supabase.storage.from("lessons-images").createSignedUrl(page.image_path,120);
    if(error) throw error; return data.signedUrl;
  }});
  const formatted = useQuery({queryKey:["formatted-page",page?.id],enabled:!!page && mode==="formatted" && allowed,retry:false,queryFn:async()=>{
    if(!page) return null;
    const {data,error}=await supabase.from("formatted_pages").select("document,status,error_message").eq("lesson_id",page.id).maybeSingle();
    if(error) throw error;return data;
  }});
  const parsed=notebookDocumentSchema.safeParse(formatted.data?.document);
  async function prepare(resume = false, rebuild = false) {
    if(!page || busy) return;
    setBusy(true);setFailure(null);
    try { const result=await generate({data:{lessonId:page.id,resume,rebuild}}); if(result.status==="error")setFailure(result.message); await formatted.refetch(); }
    catch {setFailure("تعذّر تنسيق الصفحة.");} finally {setBusy(false);}
  }
  function startEdit() {
    if(!parsed.success) return;
    setDraft(structuredClone(parsed.data));
    setEditing(true);
  }
  async function saveEdit() {
    if(!page || !draft || saving) return;
    setSaving(true);
    try {
      await update({data:{lessonId:page.id,document:draft}});
      toast.success("تم حفظ التعديلات");
      setEditing(false);setDraft(null);
      await formatted.refetch();
    } catch { toast.error("تعذّر حفظ التعديلات"); } finally { setSaving(false); }
  }
  function setRunText(bi:number, ri:number, text:string) {
    setDraft(d=>{ if(!d) return d; const next=structuredClone(d); const run=next.blocks[bi]?.runs[ri]; if(run) run.text=text; return next; });
  }
  function onTouchMove(e:React.TouchEvent) {
    if(e.touches.length!==2) return;
    const a=e.touches[0], b=e.touches[1];
    if(!a || !b) return;
    const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
    if(!pinch.current){pinch.current={d,scale};return;}
    setScale(Math.min(3,Math.max(0.5,pinch.current.scale*(d/pinch.current.d))));
  }
  const showSideBySide = mode==="formatted" && allowed && parsed.success && formatted.data?.status==="ready" && image.data && !editing;
  return <Dialog open={!!initialId} onOpenChange={open=>{if(!open)onClose();}}>
    <DialogContent className="w-[96vw] sm:max-w-5xl max-h-[94vh] overflow-hidden p-0 gap-0">
      <DialogTitle className="sr-only">{page?.title || "الكراس"}</DialogTitle>
      <div className="flex flex-wrap gap-2 items-center border-b p-4 px-12">
        <div className="min-w-0 w-full sm:w-auto sm:flex-1"><h2 className="font-bold break-words">{page?.title}</h2><p className="text-xs text-muted-foreground">صفحة {index+1} من {pages.length}</p></div>
        <Button size="sm" variant={mode==="original"?"default":"outline"} onClick={()=>setMode("original")}><BookOpen className="size-4"/>الأصل</Button>
        <Button size="sm" variant={mode==="formatted"?"default":"outline"} onClick={()=>setMode("formatted")}>{allowed?<FileText className="size-4"/>:<Lock className="size-4"/>}الكراس المنسّق</Button>
      </div>
      {mode === "original" && <div className="flex justify-center gap-2 border-b p-2">
        <Button variant="ghost" size="icon" aria-label="تكبير" onClick={()=>setScale(s=>Math.min(3,s+0.25))}><ZoomIn className="size-4"/></Button>
        <Button variant="ghost" size="icon" aria-label="تصغير" onClick={()=>setScale(s=>Math.max(0.5,s-0.25))}><ZoomOut className="size-4"/></Button>
        {image.data && <Button variant="ghost" size="icon" disabled={downloading} onClick={downloadImage} aria-label="تحميل">{downloading?<Loader2 className="size-4 animate-spin"/>:<Download className="size-4"/>}</Button>}
        {image.data && <Button variant="ghost" size="icon" asChild><a href={image.data} target="_blank" rel="noreferrer" aria-label="فتح بالحجم الكامل"><ExternalLink className="size-4"/></a></Button>}
      </div>}
      {editing && <div className="flex justify-center gap-2 border-b p-2">
        <Button size="sm" onClick={saveEdit} disabled={saving}>{saving?<Loader2 className="size-4 animate-spin"/>:<Check className="size-4"/>}حفظ التعديلات</Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={()=>{setEditing(false);setDraft(null);}}><X className="size-4"/>إلغاء</Button>
      </div>}
      <div className="overflow-y-auto bg-muted p-3 sm:p-6 min-h-64 max-h-[70vh]">
        {mode==="original" ? image.data ? <div className="overflow-auto" style={{touchAction:"pan-x pan-y"}} onTouchMove={onTouchMove} onTouchEnd={()=>{pinch.current=null;}}>
            <img className="mx-auto max-w-full h-auto select-none cursor-zoom-in" onClick={()=>setLightbox(true)} style={{transform:`scale(${scale})`,transformOrigin:"center top"}} src={image.data} alt={page?.title}/>
          </div> : <p className="text-center py-16">{image.isError?"تعذّر تحميل الصورة.":"جارٍ تحميل الصفحة…"}</p>
        : !allowed ? <div className="text-center py-16 space-y-4"><Lock className="size-9 mx-auto text-primary"/><p>{LOCKED_NOTEBOOK_MESSAGE}</p></div>
        : editing && draft ? <article className="digital-sheet mx-auto" dir={draft.direction}>
            <p className="text-xs text-muted-foreground mb-4">عدّل النص مباشرة ثم احفظ. تُحفظ الألوان والتنسيق كما هي.</p>
            {draft.blocks.map((block,i)=><div key={i} className={`document-block document-${block.kind}`}>
              {block.kind === "diagram" && <NotebookDiagram diagram={block.diagram}/>}
              {block.runs.map((run,j)=><span key={j} contentEditable suppressContentEditableWarning
                onBlur={e=>setRunText(i,j,e.currentTarget.textContent ?? "")}
                className="outline-none focus:bg-secondary/60 rounded-sm px-0.5"
                style={{color:run.color,backgroundColor:run.highlight ?? "transparent",fontWeight:run.bold?700:400,textDecoration:run.underline?"underline":"none"}}>{run.text}</span>)}
            </div>)}
          </article>
        : parsed.success && formatted.data?.status==="ready" ? <>
          {parsed.data.uncertain && <p className="text-sm text-destructive mb-3">توجد أجزاء غير واضحة؛ راجع الصورة الأصلية.</p>}
          {failure && <p role="alert" className="text-sm text-destructive mb-3">{failure}</p>}
          {canEdit && <div className="flex flex-wrap justify-end gap-2 mb-3">
            {roles.includes("admin") && <Button size="sm" variant="outline" disabled={busy} onClick={()=>prepare(false,true)}>{busy?<Loader2 className="size-4 animate-spin"/>:<RefreshCw className="size-4"/>}إعادة تنسيق الرسومات</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={startEdit}><Pencil className="size-4"/>تعديل النص</Button>
          </div>}
          <div className={showSideBySide ? "grid gap-4 lg:grid-cols-2 items-start" : ""}>
            {showSideBySide && <figure className="hidden lg:block sticky top-0">
              <img className="w-full h-auto rounded-md border" src={image.data ?? undefined} alt="الصفحة الأصلية"/>
              <figcaption className="text-xs text-muted-foreground text-center mt-1">الصورة الأصلية</figcaption>
            </figure>}
            <article className="digital-sheet mx-auto" dir={parsed.data.direction}>
              {parsed.data.blocks.map((block,i)=><div key={i} className={`document-block document-${block.kind}`}>
                {block.kind === "diagram" && <NotebookDiagram diagram={block.diagram}/>}
                {block.runs.map((run,j)=><span key={j} style={{color:run.color,backgroundColor:run.highlight ?? "transparent",fontWeight:run.bold?700:400,textDecoration:run.underline?"underline":"none"}}>{run.text}</span>)}
              </div>)}
              <footer className="document-footer">{index+1}</footer>
            </article>
          </div>
        </> : <div className="text-center py-16 space-y-4">
          <FileText className="size-9 mx-auto text-primary"/>
          <p>{failure || formatted.data?.error_message || (formatted.isError?"تعذّر فتح الكراس المنسّق.":"الصفحة المنسّقة ليست جاهزة بعد.")}</p>
          <Button onClick={()=>prepare()} disabled={busy || formatted.isLoading}>{busy?<Loader2 className="size-4 animate-spin"/>:<RefreshCw className="size-4"/>}{busy?"جارٍ التنسيق…":"تنسيق الصفحة"}</Button>
          {roles.includes("admin") && (failure || formatted.data?.status === "error") && <Button variant="outline" disabled={busy} onClick={()=>prepare(true)}>إعادة تفعيل التحويل</Button>}
        </div>}
      </div>
      <div className="flex items-center justify-between border-t p-3">
        <Button variant="outline" size="sm" disabled={index===0 || busy} onClick={()=>{setIndex(i=>i-1);setFailure(null);}}><ArrowRight className="size-4"/>السابقة</Button>
        <span className="text-sm text-muted-foreground">{index+1} / {pages.length}</span>
        <Button variant="outline" size="sm" disabled={index>=pages.length-1 || busy} onClick={()=>{setIndex(i=>i+1);setFailure(null);}}>التالية<ArrowLeft className="size-4"/></Button>
      </div>
      {lightbox && image.data && <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 cursor-zoom-out" onClick={()=>setLightbox(false)}>
        <img src={image.data} alt={page?.title} className="max-w-full max-h-full object-contain rounded-md"/>
        <Button variant="ghost" size="icon" className="absolute top-4 end-4 text-white hover:bg-white/20" aria-label="إغلاق" onClick={()=>setLightbox(false)}><X className="size-5"/></Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
