import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, BookOpen, FileText, Loader2, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { generateFormattedPage } from "@/lib/notebook.functions";
import { canReadFormatted, LOCKED_NOTEBOOK_MESSAGE, notebookDocumentSchema } from "@/lib/notebook";

type Page = {id:string;title:string;image_path:string;subject:string};
export function BoundNotebookReader({pages, initialId, roles, onClose}: {pages:Page[];initialId:string|null;roles:string[];onClose:()=>void}) {
  const [index,setIndex] = useState(0);
  const [mode,setMode] = useState("original");
  const [busy,setBusy] = useState(false);
  const [failure,setFailure] = useState<string|null>(null);
  const generate = useServerFn(generateFormattedPage);
  const allowed = canReadFormatted(roles);
  useEffect(()=>{setIndex(Math.max(0,pages.findIndex(p=>p.id===initialId)));setMode("original");setFailure(null);},[initialId]);
  const page=initialId ? pages[index] : undefined;
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
  async function prepare(resume = false) {
    if(!page || busy) return;
    setBusy(true);setFailure(null);
    try { const result=await generate({data:{lessonId:page.id,resume}}); if(result.status==="error")setFailure(result.message); await formatted.refetch(); }
    catch {setFailure("تعذّر تنسيق الصفحة.");} finally {setBusy(false);}
  }
  return <Dialog open={!!initialId} onOpenChange={open=>{if(!open)onClose();}}>
    <DialogContent className="w-[96vw] sm:max-w-5xl max-h-[94vh] overflow-hidden p-0 gap-0">
      <DialogTitle className="sr-only">{page?.title || "الكراس"}</DialogTitle>
      <div className="flex flex-wrap gap-2 items-center border-b p-4 pe-12">
        <div className="min-w-0 flex-1"><h2 className="font-bold break-words">{page?.title}</h2><p className="text-xs text-muted-foreground">صفحة {index+1} من {pages.length}</p></div>
        <Button size="sm" variant={mode==="original"?"default":"outline"} onClick={()=>setMode("original")}><BookOpen className="size-4"/>الأصل</Button>
        <Button size="sm" variant={mode==="formatted"?"default":"outline"} onClick={()=>setMode("formatted")}>{allowed?<FileText className="size-4"/>:<Lock className="size-4"/>}الكراس المنسّق</Button>
      </div>
      <div className="overflow-y-auto bg-muted p-3 sm:p-6 min-h-64 max-h-[70vh]">
        {mode==="original" ? image.data ? <img className="mx-auto max-w-full h-auto" src={image.data} alt={page?.title}/> : <p className="text-center py-16">{image.isError?"تعذّر تحميل الصورة.":"جارٍ تحميل الصفحة…"}</p>
        : !allowed ? <div className="text-center py-16 space-y-4"><Lock className="size-9 mx-auto text-primary"/><p>{LOCKED_NOTEBOOK_MESSAGE}</p></div>
        : parsed.success && formatted.data?.status==="ready" ? <>
          {parsed.data.uncertain && <p className="text-sm text-destructive mb-3">توجد أجزاء غير واضحة؛ راجع الصورة الأصلية.</p>}
          <article className="digital-sheet mx-auto" dir={parsed.data.direction}>
            {parsed.data.blocks.map((block,i)=><div key={i} className={`document-block document-${block.kind}`}>
              {block.runs.map((run,j)=><span key={j} style={{color:run.color,backgroundColor:run.highlight ?? "transparent",fontWeight:run.bold?700:400,textDecoration:run.underline?"underline":"none"}}>{run.text}</span>)}
            </div>)}
            <footer className="document-footer">{index+1}</footer>
          </article>
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
    </DialogContent>
  </Dialog>;
}