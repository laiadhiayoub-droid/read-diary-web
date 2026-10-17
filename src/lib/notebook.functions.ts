import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canReadFormatted, notebookDocumentSchema } from "./notebook";

export const updateFormattedPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({lessonId:z.string().uuid(), document:notebookDocumentSchema}).parse(input))
  .handler(async ({data, context}) => {
    const {data:roles, error:roleError} = await context.supabase.from("user_roles").select("role").eq("user_id",context.userId);
    if (roleError) throw roleError;
    const memberships = (roles ?? []).map(r=>r.role);
    const admin = memberships.includes("admin");
    const {data:lesson} = await context.supabase.from("lessons").select("id,user_id").eq("id",data.lessonId).single();
    if (!lesson) throw new Error("الصفحة غير موجودة");
    if (!admin && !(memberships.includes("writer") && lesson.user_id === context.userId)) throw new Error("غير مسموح");
    const {supabaseAdmin} = await import("@/integrations/supabase/client.server");
    const {error} = await supabaseAdmin.from("formatted_pages")
      .update({document:data.document,updated_at:new Date().toISOString()}).eq("lesson_id",data.lessonId).eq("status","ready");
    if (error) throw error;
    return {status:"saved" as const};
  });

export const generateFormattedPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({lessonId:z.string().uuid(), resume:z.boolean().optional(), rebuild:z.boolean().optional()}).parse(input))
  .handler(async ({data, context}) => {
    const {data:roles, error:roleError} = await context.supabase.from("user_roles").select("role").eq("user_id",context.userId);
    if (roleError) throw roleError;
    const memberships = (roles ?? []).map(r=>r.role);
    const {data:banned} = await context.supabase.rpc("current_user_banned");
    if (banned !== false) throw new Error("غير مسموح");
    const {data:lesson, error} = await context.supabase.from("lessons").select("id,user_id,image_path").eq("id",data.lessonId).single();
    if(error || !lesson) throw new Error("الصفحة غير موجودة");
    const admin = memberships.includes("admin");
    if(data.rebuild && !admin) throw new Error("إعادة تنسيق الرسومات مخصصة للإدارة.");
    if (!canReadFormatted(memberships) && !(memberships.includes("writer") && lesson.user_id === context.userId)) throw new Error("غير مسموح");
    // Privileged writes only after authenticating and authorizing the caller.
    const {supabaseAdmin} = await import("@/integrations/supabase/client.server");
    if(data.resume && admin) await supabaseAdmin.from("notebook_generation_state").upsert({id:1,paused:false,reason:null});
    const {data:state} = await supabaseAdmin.from("notebook_generation_state").select("paused,reason").eq("id",1).maybeSingle();
    if(state?.paused) return {status:"error",message:state.reason || "تم إيقاف التحويل مؤقتاً؛ يرجى التواصل مع الإدارة."};
    const {data:existing} = await supabaseAdmin.from("formatted_pages").select("status,updated_at").eq("lesson_id",lesson.id).maybeSingle();
    if(existing?.status === "ready" && !data.rebuild) return {status:"ready",message:null};
    if(existing?.status === "processing" && Date.now()-Date.parse(existing.updated_at)<5*60*1000) return {status:"processing",message:null};
    const claim = await supabaseAdmin.from("formatted_pages").upsert({lesson_id:lesson.id,status:"processing",error_message:null,updated_at:new Date().toISOString()});
    if(claim.error) throw claim.error;
    try {
      const apiKey = process.env["LOVABLE_API_KEY"];
      if(!apiKey) throw new Error("خدمة التحويل غير مفعّلة.");
      const image = await context.supabase.storage.from("lessons-images").download(lesson.image_path);
      if(image.error || !image.data) throw new Error("تعذّر قراءة صورة الصفحة.");
      const {transcribeNotebook} = await import("./notebook-ai.server");
      const document = await transcribeNotebook(new Uint8Array(await image.data.arrayBuffer()),image.data.type || "image/jpeg",apiKey);
      const saved = await supabaseAdmin.from("formatted_pages").upsert({lesson_id:lesson.id,document,status:"ready",error_message:null,updated_at:new Date().toISOString()});
      if(saved.error) throw saved.error;
      // Never send subscriber content back to a publishing writer.
      return {status:"ready",message:null};
    } catch(cause) {
      const status = cause && typeof cause === "object" && "statusCode" in cause ? Number(cause.statusCode) : 0;
      const message = status === 402 || status === 403 ? "خدمة التحويل متوقفة بسبب رصيد أو صلاحيات خدمة الذكاء الاصطناعي. على الإدارة إعادة تفعيلها." : "تعذّر تنسيق الصفحة؛ يمكنك المحاولة مجدداً أو قراءة الصورة الأصلية.";
      if(status===402 || status===403 || status===401 || status===404) await supabaseAdmin.from("notebook_generation_state").upsert({id:1,paused:true,reason:message});
      await supabaseAdmin.from("formatted_pages").update({status:existing?.status === "ready" ? "ready" : "error",error_message:message,updated_at:new Date().toISOString()}).eq("lesson_id",lesson.id);
      return {status:"error",message};
    }
  });