import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen, LogOut, Plus, Search, ArrowUp, ArrowDown, Link2, Loader2, ImagePlus, X,
  NotebookPen, ShieldCheck, Lock as LockIcon, BookMarked, FileText, ArrowRight,
  ZoomIn, ZoomOut, Download,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Timetable } from "@/components/Timetable";
import { DhikrPill } from "@/components/DhikrPill";
import { SUBJECTS, CONTENT_TYPES, subjectLabel, contentTypeLabel, compressImage } from "@/lib/library";
import { BoundNotebookReader } from "@/components/BoundNotebookReader";
import { nextPageNumber, orderedBookPages } from "@/lib/notebook";
import { generateFormattedPage } from "@/lib/notebook.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "المكتبة الرقمية المدرسية — 2 ثانوي لغات أجنبية" },
      { name: "description", content: "تصفّح كراريس زملائك في الإسبانية وباقي المواد، وابحث عن الدروس التي غبت عنها." },
      { property: "og:title", content: "المكتبة الرقمية المدرسية" },
      { property: "og:description", content: "كراريس دروس وملخصات تلاميذ 2AS لغات أجنبية — شعبة الإسبانية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Lesson = {
  id: string; user_id: string; title: string; subject: string; content_type: string;
  domain: string | null; unit: string | null; page_number: number;
  parent_lesson_id: string | null; image_path: string; order_index: number; created_at: string;
};
type Profile = { id: string; full_name: string | null };
type Book = { userId: string; subject: string; count: number };

function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return { user, ready };
}

function Index() {
  const { user, ready } = useUser();
  const qc = useQueryClient();

  const profiles = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name");
      if (error) throw error;
      return data as Profile[];
    },
  });
  const lessons = useQuery({
    queryKey: ["lessons"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lessons").select("*")
        .order("order_index").order("created_at");
      if (error) throw error;
      return data as Lesson[];
    },
  });

  const myProfile = profiles.data?.find((p) => p.id === user?.id);
  const roles = useQuery({
    queryKey: ["my-roles", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      if (error) throw error;
      return data.map((r) => r.role);
    },
  });
  const isAdmin = !!roles.data?.includes("admin");
  const canPublish = isAdmin || !!roles.data?.includes("writer");
  const needsName = !!user && profiles.isSuccess && !myProfile?.full_name;

  const [studentId, setStudentId] = useState<string>("all");
  const [subject, setSubject] = useState<string>("spanish");
  const [q, setQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [zoom, setZoom] = useState<Lesson | null>(null);
  const [openBook, setOpenBook] = useState<Book | null>(null);

  const nameOf = (id: string) => profiles.data?.find((p) => p.id === id)?.full_name || "تلميذ";
  const uploaders = useMemo(() => {
    const ids = new Set((lessons.data ?? []).map((l) => l.user_id));
    return (profiles.data ?? []).filter((p) => ids.has(p.id) && p.full_name);
  }, [lessons.data, profiles.data]);

  // Tier 1: book covers — one card per (student, subject) notebook
  const books = useMemo(() => {
    const term = q.trim().toLowerCase();
    const map = new Map<string, Book>();
    for (const l of lessons.data ?? []) {
      if (studentId !== "all" && l.user_id !== studentId) continue;
      if (subject !== "all" && l.subject !== subject) continue;
      if (term && ![l.title, l.domain, l.unit, nameOf(l.user_id)].some((v) => v?.toLowerCase().includes(term))) continue;
      const key = `${l.user_id}:${l.subject}`;
      const b = map.get(key) ?? { userId: l.user_id, subject: l.subject, count: 0 };
      b.count++;
      map.set(key, b);
    }
    return [...map.values()].sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId), "ar"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons.data, studentId, subject, q, profiles.data]);

  // Tier 2: lessons inside the open book
  const bookLessons = useMemo(() => {
    if (!openBook) return [];
    return orderedBookPages((lessons.data ?? []).filter((l) => l.user_id === openBook.userId && l.subject === openBook.subject));
  }, [lessons.data, openBook]);

  const isOwnerBook = !!user && openBook?.userId === user.id;

  async function move(index: number, dir: -1 | 1) {
    const a = bookLessons[index], b = bookLessons[index + dir];
    if (!a || !b) return;
    const updates = bookLessons.map((l, i) => ({ id: l.id, order_index: i }));
    const first = updates[index], second = updates[index + dir];
    if (!first || !second) return;
    first.order_index = index + dir;
    second.order_index = index;
    const results = await Promise.all(
      updates.map((u) => supabase.from("lessons").update({ order_index: u.order_index }).eq("id", u.id)),
    );
    if (results.some((r) => r.error)) toast.error("تعذّر حفظ الترتيب");
    else toast.success("تم حفظ الترتيب");
    qc.invalidateQueries({ queryKey: ["lessons"] });
  }

  async function signIn() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) toast.error("فشل تسجيل الدخول");
  }
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    setStudentId("all");
    setOpenBook(null);
    toast("تم تسجيل الخروج");
  }

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <div className="size-10 rounded-lg bg-primary text-primary-foreground grid place-items-center">
            <BookOpen className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-extrabold text-lg leading-tight">المكتبة الرقمية المدرسية</h1>
            <p className="text-xs text-muted-foreground">2 ثانوي · لغات أجنبية · Español</p>
          </div>
          {ready && (user ? (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline text-sm text-muted-foreground">{myProfile?.full_name}</span>
              {isAdmin && (
                <Button size="sm" variant="outline" asChild>
                  <Link to="/admin"><ShieldCheck className="size-4" /> لوحة التحكم</Link>
                </Button>
              )}
              {canPublish ? (
                <Button size="sm" onClick={() => setUploadOpen(true)} disabled={needsName}>
                  <Plus className="size-4" /> إضافة درس
                </Button>
              ) : roles.isSuccess && (
                <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  <LockIcon className="size-3" /> النشر متاح فقط للكتّاب المعتمدين
                </span>
              )}
              <Button size="icon" variant="ghost" onClick={signOut} aria-label="تسجيل الخروج">
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={signIn}>تسجيل الدخول باستخدام Google</Button>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pt-6"><Timetable /></div>

      {ready && !user ? (
        <main className="mx-auto max-w-xl px-4 py-16">
          <div className="notebook-paper margin-line rounded-xl p-10 text-center space-y-4">
            <BookOpen className="mx-auto size-10 text-primary" />
            <h2 className="text-2xl font-extrabold">مكتبة كراريس القسم</h2>
            <p className="text-muted-foreground">سجّل الدخول لتصفّح دروس وملخصات زملائك.</p>
            <Button onClick={signIn}>تسجيل الدخول باستخدام Google</Button>
          </div>
        </main>
      ) : (
      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        {openBook ? (
          /* ============ Tier 2: Lesson List View (داخل الكراس) ============ */
          <section className="space-y-5">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setOpenBook(null)}>
                <ArrowRight className="size-4" /> كل الكراريس
              </Button>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-extrabold leading-tight">
                  كراس {subjectLabel(openBook.subject).replace("اللغة ", "")}
                  <span className="text-primary"> — {nameOf(openBook.userId)}</span>
                </h2>
                <p className="text-sm text-muted-foreground">{bookLessons.length} صفحة</p>
              </div>
            </div>

            {bookLessons.length === 0 ? (
              <div className="notebook-paper margin-line rounded-xl p-12 text-center text-muted-foreground">
                <NotebookPen className="mx-auto mb-3 size-8" />
                لا توجد دروس في هذا الكراس بعد.
              </div>
            ) : (
              <ol className="space-y-2">
                {bookLessons.map((l, i) => (
                  <LessonRow key={l.id} lesson={l}
                    parent={lessons.data?.find((p) => p.id === l.parent_lesson_id)}
                    onOpen={() => setZoom(l)}
                    controls={isOwnerBook ? {
                      up: i > 0 ? () => move(i, -1) : undefined,
                      down: i < bookLessons.length - 1 ? () => move(i, 1) : undefined,
                    } : undefined} />
                ))}
              </ol>
            )}
          </section>
        ) : (
          /* ============ Tier 1: Book Covers (أغلفة الكراريس) ============ */
          <>
            <section className="grid gap-3 sm:grid-cols-[1fr_1fr] lg:grid-cols-[220px_1fr_1.4fr]">
              <div className="space-y-1.5">
                <Label>اختر التلميذ</Label>
                <Select value={studentId} onValueChange={setStudentId}>
                  <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع التلاميذ</SelectItem>
                    {user && myProfile?.full_name && <SelectItem value={user.id}>كراريسي ({myProfile.full_name})</SelectItem>}
                    {uploaders.filter((p) => p.id !== user?.id).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>ابحث</Label>
                <div className="relative">
                  <Search className="size-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
                  <Input className="ps-9 bg-card" value={q} onChange={(e) => setQ(e.target.value)}
                    placeholder="ابحث عن درس محدد (مثلاً: درس غبت فيه...)" />
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1 lg:row-start-1 lg:col-start-3">
                <Label>اختر الكراس</Label>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  <button onClick={() => setSubject("all")}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${subject === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-secondary"}`}>
                    كل المواد
                  </button>
                  {SUBJECTS.map((s) => (
                    <button key={s.id} onClick={() => setSubject(s.id)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm transition ${subject === s.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-secondary"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <div className="flex items-baseline justify-between">
              <h2 className="text-xl font-extrabold">كراريس القسم</h2>
              <span className="text-sm text-muted-foreground">{books.length} كراس</span>
            </div>

            {lessons.isLoading ? (
              <div className="py-20 grid place-items-center"><Loader2 className="animate-spin text-primary" /></div>
            ) : books.length === 0 ? (
              <div className="notebook-paper margin-line rounded-xl p-12 text-center text-muted-foreground">
                <NotebookPen className="mx-auto mb-3 size-8" />
                لا توجد كراريس مطابقة بعد.
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {books.map((b) => (
                  <BookCover key={`${b.userId}:${b.subject}`} book={b} author={nameOf(b.userId)}
                    onOpen={() => setOpenBook(b)} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
      )}
      <DhikrPill />

      {needsName && user && <NameDialog userId={user.id} onDone={() => qc.invalidateQueries({ queryKey: ["profiles"] })} />}
      {user && (
        <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} userId={user.id}
          defaultSubject={subject === "all" ? "spanish" : subject}
          myLessons={(lessons.data ?? []).filter((l) => l.user_id === user.id)}
          onDone={() => qc.invalidateQueries({ queryKey: ["lessons"] })} />
      )}
      <BoundNotebookReader pages={bookLessons} initialId={zoom?.id ?? null} roles={roles.data ?? []} onClose={() => setZoom(null)} />
    </div>
  );
}

/* ---------- Tier 1: minimal book cover ---------- */
function BookCover({ book, author, onOpen }: { book: Book; author: string; onOpen: () => void }) {
  const sub = SUBJECTS.find((s) => s.id === book.subject);
  return (
    <button onClick={onOpen}
      className="group relative text-start rounded-xl border bg-card overflow-hidden transition hover:shadow-lg hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-primary">
      <div className="absolute inset-y-0 start-0 w-2 bg-primary/80" />
      <div className="p-5 ps-7 space-y-4 min-h-40 flex flex-col">
        <BookMarked className="size-7 text-primary" />
        <div className="flex-1 space-y-1">
          <h3 className="font-extrabold text-base leading-snug">{sub?.label ?? book.subject}</h3>
          {sub?.sub && <p className="text-xs text-muted-foreground" dir="ltr">{sub.sub}</p>}
          <p className="text-sm text-muted-foreground pt-1">✍️ {author}</p>
        </div>
        <Badge variant="secondary" className="self-start">{book.count} {book.count > 2 ? "دروس" : "درس"}</Badge>
      </div>
    </button>
  );
}

/* ---------- Tier 2: clean lesson row (no thumbnail) ---------- */
function LessonRow({ lesson: l, parent, onOpen, controls }: {
  lesson: Lesson; parent?: Lesson | undefined;
  onOpen: () => void;
  controls?: { up: (() => void) | undefined; down: (() => void) | undefined } | undefined;
}) {
  return (
    <li className="flex items-center gap-2">
      <button onClick={onOpen}
        className="flex-1 min-w-0 flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-start transition hover:bg-secondary/60 hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary">
        <span className="shrink-0 size-9 rounded-md bg-primary/10 text-primary grid place-items-center">
          <FileText className="size-4.5" />
        </span>
        <span className="flex-1 min-w-0 space-y-0.5">
          <span className="block font-bold truncate">{l.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <Badge className={`text-[10px] px-1.5 py-0 ${l.content_type === "summary" ? "bg-summary text-summary-foreground" : ""}`}>
              {contentTypeLabel(l.content_type)}
            </Badge>
            {l.unit && <span>{l.unit}</span>}
            {l.domain && <span>· {l.domain}</span>}
            {parent && <span className="text-primary inline-flex items-center gap-0.5"><Link2 className="size-3" /> تتمة: {parent.title}</span>}
          </span>
        </span>
        <span className="shrink-0 text-end text-xs text-muted-foreground space-y-0.5">
          <Badge variant="outline" className="block">صفحة {l.page_number}</Badge>
          <span className="block">{new Date(l.created_at).toLocaleDateString("ar-DZ")}</span>
        </span>
      </button>
      {controls && (
        <span className="flex flex-col gap-1 shrink-0">
          <Button size="icon" variant="outline" className="size-7" disabled={!controls.up}
            onClick={controls.up} aria-label="للأعلى"><ArrowUp className="size-3.5" /></Button>
          <Button size="icon" variant="outline" className="size-7" disabled={!controls.down}
            onClick={controls.down} aria-label="للأسفل"><ArrowDown className="size-3.5" /></Button>
        </span>
      )}
    </li>
  );
}

function NameDialog({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (name.trim().length < 3) { toast.error("أدخل اسمك الكامل"); return; }
    setBusy(true);
    const { error } = await supabase.from("profiles").upsert({ id: userId, full_name: name.trim() });
    setBusy(false);
    if (error) { toast.error("تعذّر الحفظ، حاول مجدداً"); return; }
    toast.success("مرحباً بك في المكتبة!");
    setDone(true);
    onDone();
  }
  return (
    <Dialog open={!done}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="[&>button.absolute]:hidden"
      >
        <DialogHeader><DialogTitle>مرحباً! ما اسمك؟</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <Label htmlFor="fn">اسم التلميذ الكامل</Label>
          <Input id="fn" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: أيوب بن علي" />
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="animate-spin size-4" />} تأكيد والحفظ
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ open, onOpenChange, userId, defaultSubject, myLessons, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; userId: string; defaultSubject: string;
  myLessons: Lesson[]; onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [type, setType] = useState<string>("lesson");
  const [domain, setDomain] = useState("");
  const [unit, setUnit] = useState("");
  const [isCont, setIsCont] = useState(false);
  const [parentId, setParentId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState("");
  const generate = useServerFn(generateFormattedPage);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) setSubject(defaultSubject); }, [open, defaultSubject]);
  const notebook = myLessons.filter((l) => l.subject === subject);
  const roots = notebook.filter((l) => !l.parent_lesson_id);

  function resetForm() {
    setTitle(""); setDomain(""); setUnit(""); setIsCont(false); setParentId("");
    setFiles([]); setType("lesson"); setProgress("");
  }

  async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  async function submit() {
    if (busy) return;
    if (!title.trim()) { toast.error("عنوان الدرس مطلوب"); return; }
    if (!files.length) { toast.error("أضف صور الصفحات"); return; }
    if (isCont && !parentId) { toast.error("اختر الدرس السابق"); return; }
    setBusy(true);
    const uploadedPaths: string[] = [];
    let published = false;
    try {
      const parent = isCont ? notebook.find((l) => l.id === parentId) : undefined;
      const rootId = parent?.id ?? crypto.randomUUID();
      const pageNumber = nextPageNumber(notebook, parent?.id ?? null);
      const order = notebook.reduce((m, l) => Math.max(m, l.order_index), -1) + 1;
      const rows = [];
      for (const [i, file] of files.entries()) {
        setProgress(`رفع الصفحة ${i+1} من ${files.length}`);
        const blob = await withTimeout(compressImage(file), 30000, "compress");
        const path = `${userId}/${crypto.randomUUID()}.jpg`;
        const up = await withTimeout(
          supabase.storage.from("lessons-images").upload(path, blob, { contentType: "image/jpeg" }),
          60000, "upload",
        );
        if (up.error) throw up.error;
        uploadedPaths.push(path);
        rows.push({id: !parent && i===0 ? rootId : crypto.randomUUID(), user_id:userId,
          title:title.trim(),subject,content_type:type,domain:domain.trim() || null,unit:unit.trim() || null,
          parent_lesson_id:parent || i>0 ? rootId : null,page_number:pageNumber+i,image_path:path,order_index:order+i});
      }
      const {error}=await supabase.from("lessons").insert(rows);
      if(error) throw error;
      published = true;
      onDone();
      toast.success(`تم ربط ${rows.length} صفحة في الكراس`);
      // Success: reset the form, close the dialog, and let formatting continue in the background.
      resetForm();
      onOpenChange(false);
      void (async () => {
        for (const row of rows) {
          try { const result = await generate({data:{lessonId:row.id}}); if (result.status === "error") break; }
          catch { break; }
        }
      })();
    } catch (cause) {
      if(!published && uploadedPaths.length) await supabase.storage.from("lessons-images").remove(uploadedPaths);
      const message = cause instanceof Error ? cause.message : "";
      if (message.startsWith("timeout:")) toast.error("انتهت مهلة رفع الصور؛ تحقق من الاتصال وحاول مجدداً.");
      else if (message) toast.error(`تعذّر رفع الصور: ${message}`);
      else toast.error("حدث خطأ أثناء الرفع؛ لم تُنشر الصفحات.");
    } finally {setBusy(false);setProgress("");}
  }

  return (
    <Dialog open={open} onOpenChange={o => {if(!busy)onOpenChange(o);}}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>إضافة درس أو ملخص</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>عنوان الدرس *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="El pretérito indefinido" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>المادة</Label>
              <Select value={subject} onValueChange={(v) => { setSubject(v); setParentId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SUBJECTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label>نوع المحتوى</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONTENT_TYPES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label>الميدان / المجال</Label>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="Gramática" /></div>
            <div className="space-y-1.5"><Label>الوحدة</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unidad 1" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={isCont} onCheckedChange={(v) => setIsCont(!!v)} disabled={roots.length === 0} />
            تتمة / تابع لدرس سابق {roots.length === 0 && <span className="text-muted-foreground">(لا توجد دروس سابقة)</span>}
          </label>
          {isCont && (
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger><SelectValue placeholder="اختر الدرس السابق" /></SelectTrigger>
              <SelectContent>{roots.map((l) => <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 cursor-pointer hover:bg-secondary text-sm text-muted-foreground">
            <ImagePlus className="size-6" /> إضافة صور صفحات الكراس
            <input type="file" accept="image/*" multiple disabled={busy} className="hidden" onChange={(e) => {
              setFiles(previous=>[...previous,...Array.from(e.target.files ?? [])].filter(f=>f.type.startsWith("image/")));
              e.target.value="";
            }} />
          </label>
          <ol className="space-y-2">
            {files.map((file,i)=><li key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <span className="text-muted-foreground shrink-0">{i+1}</span><span className="flex-1 min-w-0 truncate">{file.name}</span>
              <Button size="icon" variant="ghost" disabled={busy || i===0} aria-label={`تقديم الصفحة ${i+1}`} onClick={()=>setFiles(prev=>{const next=[...prev];const a=next[i],b=next[i-1];if(a && b){next[i-1]=a;next[i]=b;}return next;})}><ArrowUp className="size-4"/></Button>
              <Button size="icon" variant="ghost" disabled={busy || i===files.length-1} aria-label={`تأخير الصفحة ${i+1}`} onClick={()=>setFiles(prev=>{const next=[...prev];const a=next[i],b=next[i+1];if(a && b){next[i+1]=a;next[i]=b;}return next;})}><ArrowDown className="size-4"/></Button>
              <Button size="icon" variant="ghost" disabled={busy} aria-label={`حذف الصورة ${i+1}`} onClick={()=>setFiles(prev=>prev.filter((_,j)=>j!==i))}><X className="size-4"/></Button>
            </li>)}
          </ol>
          {progress && <p role="status" className="text-sm text-muted-foreground">{progress}</p>}
          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="animate-spin size-4" />} حفظ في الكراس
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
