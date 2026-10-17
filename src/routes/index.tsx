import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen, LogOut, Plus, Search, ArrowUp, ArrowDown, Link2, Loader2, ImagePlus, X,
  NotebookPen, ShieldCheck, BookMarked, FileText, ArrowRight,
  SlidersHorizontal, Star, Trash2, Share2, GraduationCap,
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
import { SUBJECTS, CONTENT_TYPES, SEMESTERS, subjectLabel, contentTypeLabel, semesterLabel, compressImage } from "@/lib/library";
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
  domain: string | null; unit: string | null; page_number: number; semester: string | null;
  parent_lesson_id: string | null; image_path: string; order_index: number; created_at: string;
};
type Profile = { id: string; full_name: string | null };
type Book = { userId: string; subject: string; count: number; hasNew: boolean };
type Filters = { subject: string; type: string; semester: string; unit: string };
const EMPTY_FILTERS: Filters = { subject: "all", type: "all", semester: "all", unit: "all" };
const NEW_DAYS = 7;
type View = "books" | "summaries" | "favorites";

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

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [bookQ, setBookQ] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [zoom, setZoom] = useState<Lesson | null>(null);
  const [openBook, setOpenBook] = useState<Book | null>(null);
  const [view, setView] = useState<View>("books");
  const [summarySubject, setSummarySubject] = useState("all");
  const [deleting, setDeleting] = useState<Lesson | null>(null);

  const bookmarks = useQuery({
    queryKey: ["bookmarks", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [] as string[];
      const { data, error } = await supabase.from("bookmarks").select("lesson_id").eq("user_id", user.id);
      if (error) throw error;
      return data.map((b) => b.lesson_id);
    },
  });
  const bookmarked = useMemo(() => new Set(bookmarks.data ?? []), [bookmarks.data]);
  async function toggleBookmark(lessonId: string) {
    if (!user) return;
    if (bookmarked.has(lessonId)) {
      const { error } = await supabase.from("bookmarks").delete().eq("user_id", user.id).eq("lesson_id", lessonId);
      if (error) { toast.error("تعذّر تحديث المفضلة"); return; }
    } else {
      const { error } = await supabase.from("bookmarks").insert({ user_id: user.id, lesson_id: lessonId });
      if (error) { toast.error("تعذّر تحديث المفضلة"); return; }
    }
    qc.invalidateQueries({ queryKey: ["bookmarks", user.id] });
  }

  async function deleteLesson() {
    const l = deleting;
    if (!l) return;
    const ids = [l.id, ...(lessons.data ?? []).filter((x) => x.parent_lesson_id === l.id).map((x) => x.id)];
    const paths = (lessons.data ?? []).filter((x) => ids.includes(x.id)).map((x) => x.image_path);
    const { error } = await supabase.from("lessons").delete().in("id", ids);
    if (error) { toast.error("تعذّر الحذف"); return; }
    if (paths.length) await supabase.storage.from("lessons-images").remove(paths);
    toast.success("تم الحذف");
    setDeleting(null);
    qc.invalidateQueries({ queryKey: ["lessons"] });
  }

  function shareLesson(l: Lesson) {
    const url = `${window.location.origin}/?lesson=${l.id}`;
    void navigator.clipboard.writeText(url).then(() => toast.success("تم نسخ الرابط"), () => toast.error("تعذّر نسخ الرابط"));
  }

  // Open a shared lesson link (?lesson=<id>)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("lesson");
    if (!id || !lessons.data || zoom) return;
    const target = lessons.data.find((l) => l.id === id);
    if (!target) return;
    setOpenBook({ userId: target.user_id, subject: target.subject, count: 0, hasNew: false });
    setZoom(target);
  }, [lessons.data, zoom]);

  const nameOf = (id: string) => profiles.data?.find((p) => p.id === id)?.full_name || "تلميذ";

  // Tier 1: book covers — one card per (student, subject) notebook
  const books = useMemo(() => {
    const cutoff = Date.now() - NEW_DAYS * 24 * 60 * 60 * 1000;
    const map = new Map<string, Book>();
    for (const l of lessons.data ?? []) {
      if (filters.subject !== "all" && l.subject !== filters.subject) continue;
      if (filters.type !== "all" && l.content_type !== filters.type) continue;
      if (filters.semester !== "all" && l.semester !== filters.semester) continue;
      if (filters.unit !== "all" && l.unit !== filters.unit) continue;
      const key = `${l.user_id}:${l.subject}`;
      const b = map.get(key) ?? { userId: l.user_id, subject: l.subject, count: 0, hasNew: false };
      b.count++;
      if (new Date(l.created_at).getTime() >= cutoff) b.hasNew = true;
      map.set(key, b);
    }
    return [...map.values()].sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId), "ar"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons.data, filters, profiles.data]);

  // Tier 2: lessons inside the open book (searchable within the notebook)
  const bookLessons = useMemo(() => {
    if (!openBook) return [];
    const term = bookQ.trim().toLowerCase();
    return orderedBookPages(
      (lessons.data ?? []).filter((l) =>
        l.user_id === openBook.userId && l.subject === openBook.subject &&
        (!term || [l.title, l.domain, l.unit].some((v) => v?.toLowerCase().includes(term)))),
    );
  }, [lessons.data, openBook, bookQ]);

  // Group notebook pages by semester, then by unit
  const groupedBookLessons = useMemo(() => {
    const groups: { semester: string; units: { unit: string; items: Lesson[] }[] }[] = [];
    for (const l of bookLessons) {
      const s = l.semester || "none";
      const u = l.unit || "none";
      let sg = groups.find((g) => g.semester === s);
      if (!sg) { sg = { semester: s, units: [] }; groups.push(sg); }
      let ug = sg.units.find((x) => x.unit === u);
      if (!ug) { ug = { unit: u, items: [] }; sg.units.push(ug); }
      ug.items.push(l);
    }
    return groups;
  }, [bookLessons]);

  const unitOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of lessons.data ?? []) if (l.unit) set.add(l.unit);
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [lessons.data]);

  const summaries = useMemo(() => {
    return (lessons.data ?? [])
      .filter((l) => l.content_type === "summary" && (summarySubject === "all" || l.subject === summarySubject))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [lessons.data, summarySubject]);

  const favoriteLessons = useMemo(() => {
    return (lessons.data ?? []).filter((l) => bookmarked.has(l.id));
  }, [lessons.data, bookmarked]);

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
    setFilters(EMPTY_FILTERS);
    setBookQ("");
    setOpenBook(null);
    setView("books");
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
              <Button size="sm" onClick={() => setUploadOpen(true)} disabled={needsName}>
                <Plus className="size-4" /> {canPublish ? "إضافة درس" : "إضافة ملخص"}
              </Button>
              <Button size="icon" variant="ghost" onClick={signOut} aria-label="تسجيل الخروج">
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={signIn}>تسجيل الدخول باستخدام Google</Button>
          ))}
        </div>
      </header>

      {!openBook && <div className="mx-auto max-w-5xl px-4 pt-6"><Timetable /></div>}

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
              {bookLessons[0] && (
                <Button variant="outline" size="sm" onClick={() => { const first = bookLessons[0]; if (first) shareLesson(first); }}>
                  <Share2 className="size-4" /> نسخ الرابط
                </Button>
              )}
            </div>

            <div className="relative max-w-md">
              <Search className="size-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
              <Input className="ps-9 bg-card" value={bookQ} onChange={(e) => setBookQ(e.target.value)}
                placeholder="ابحث داخل هذا الكراس (عنوان، ميدان، وحدة...)" />
            </div>

            {bookLessons.length === 0 ? (
              <div className="notebook-paper margin-line rounded-xl p-12 text-center text-muted-foreground">
                <NotebookPen className="mx-auto mb-3 size-8" />
                لا توجد دروس في هذا الكراس بعد.
              </div>
            ) : (
              <div className="space-y-6">
                {groupedBookLessons.map((sg) => (
                  <section key={sg.semester} className="space-y-3">
                    <h3 className="flex items-center gap-2 text-base font-extrabold text-primary">
                      <span className="h-px flex-1 bg-border" />
                      {sg.semester === "none" ? "بدون فصل" : semesterLabel(sg.semester)}
                      <span className="h-px flex-1 bg-border" />
                    </h3>
                    {sg.units.map((ug) => (
                      <div key={ug.unit} className="space-y-2">
                        {ug.unit !== "none" && (
                          <p className="text-sm font-bold text-muted-foreground">{ug.unit}</p>
                        )}
                        <ol className="space-y-2">
                          {ug.items.map((l) => {
                            const i = bookLessons.indexOf(l);
                            return (
                              <LessonRow key={l.id} lesson={l}
                                parent={lessons.data?.find((p) => p.id === l.parent_lesson_id)}
                                starred={bookmarked.has(l.id)} onStar={() => toggleBookmark(l.id)}
                                onShare={() => shareLesson(l)}
                                onDelete={isAdmin ? () => setDeleting(l) : undefined}
                                onOpen={() => setZoom(l)}
                                controls={isOwnerBook ? {
                                  up: i > 0 ? () => move(i, -1) : undefined,
                                  down: i < bookLessons.length - 1 ? () => move(i, 1) : undefined,
                                } : undefined} />
                            );
                          })}
                        </ol>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </section>
        ) : (
          /* ============ Tier 1: Book Covers (أغلفة الكراريس) ============ */
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xl font-extrabold">
                  {view === "books" ? "كراريس القسم" : view === "summaries" ? "الملخصات" : "مفضلاتي"}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {view === "books" ? `${books.length} كراس` : view === "summaries" ? `${summaries.length} ملخص` : `${favoriteLessons.length} عنصر`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant={view === "summaries" ? "default" : "outline"} size="sm" onClick={() => setView(view === "summaries" ? "books" : "summaries")}>
                  <GraduationCap className="size-4" /> الملخصات
                </Button>
                <Button variant={view === "favorites" ? "default" : "outline"} size="sm" onClick={() => setView(view === "favorites" ? "books" : "favorites")}>
                  <Star className="size-4" /> مفضلاتي
                </Button>
                <Button variant="outline" size="sm" onClick={() => setFilterOpen(true)}
                  className={Object.values(filters).some((v) => v !== "all") ? "border-primary text-primary" : ""}>
                  <SlidersHorizontal className="size-4" /> تصفية
                  {Object.values(filters).filter((v) => v !== "all").length > 0 && (
                    <Badge className="ms-1 px-1.5 py-0 text-[10px]">{Object.values(filters).filter((v) => v !== "all").length}</Badge>
                  )}
                </Button>
              </div>
            </div>

            {view === "summaries" ? (
              <section className="space-y-4">
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {[{ id: "all", label: "كل المواد" }, ...SUBJECTS].map((s) => (
                    <button key={s.id} onClick={() => setSummarySubject(s.id)}
                      className={`shrink-0 rounded-full border px-4 py-1.5 text-sm transition ${summarySubject === s.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:bg-secondary"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
                {summaries.length === 0 ? (
                  <div className="notebook-paper margin-line rounded-xl p-12 text-center text-muted-foreground">
                    <GraduationCap className="mx-auto mb-3 size-8" />
                    لا توجد ملخصات هنا بعد.
                  </div>
                ) : (
                  <ol className="space-y-2">
                    {summaries.map((l) => (
                      <LessonRow key={l.id} lesson={l} author={nameOf(l.user_id)}
                        starred={bookmarked.has(l.id)} onStar={() => toggleBookmark(l.id)}
                        onShare={() => shareLesson(l)}
                        onDelete={isAdmin ? () => setDeleting(l) : undefined}
                        onOpen={() => {
                          setOpenBook({ userId: l.user_id, subject: l.subject, count: 0, hasNew: false });
                          setZoom(l);
                        }} />
                    ))}
                  </ol>
                )}
              </section>
            ) : view === "favorites" ? (
              favoriteLessons.length === 0 ? (
                <div className="notebook-paper margin-line rounded-xl p-12 text-center text-muted-foreground">
                  <Star className="mx-auto mb-3 size-8" />
                  لم تضف شيئاً إلى المفضلة بعد. اضغط نجمة أي درس أو ملخص لحفظه هنا.
                </div>
              ) : (
                <ol className="space-y-2">
                  {favoriteLessons.map((l) => (
                    <LessonRow key={l.id} lesson={l} author={nameOf(l.user_id)}
                      starred={true} onStar={() => toggleBookmark(l.id)}
                      onShare={() => shareLesson(l)}
                      onDelete={isAdmin ? () => setDeleting(l) : undefined}
                      onOpen={() => {
                        setOpenBook({ userId: l.user_id, subject: l.subject, count: 0, hasNew: false });
                        setZoom(l);
                      }} />
                  ))}
                </ol>
              )
            ) : lessons.isLoading ? (
              <div className="py-20 grid place-items-center"><Loader2 className="animate-spin text-primary" /></div>
            ) : books.length === 0 ? (
              <div className="notebook-paper margin-line rounded-xl p-12 text-center text-muted-foreground">
                <NotebookPen className="mx-auto mb-3 size-8" />
                لا توجد كراريس مطابقة بعد.
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
                {books.map((b) => (
                  <BookCover key={`${b.userId}:${b.subject}`} book={b} onOpen={() => setOpenBook(b)} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
      )}
      <DhikrPill />

      {needsName && user && <NameDialog userId={user.id} onDone={() => qc.invalidateQueries({ queryKey: ["profiles"] })} />}
      <FilterDialog open={filterOpen} onOpenChange={setFilterOpen} filters={filters} onApply={setFilters} units={unitOptions} />
      <Dialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="pe-8">تأكيد الحذف</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">هل أنت متأكد من الحذف؟ سيُحذف «{deleting?.title}» وكل صفحاته التابعة نهائياً.</p>
          <div className="flex gap-2">
            <Button variant="destructive" className="flex-1" onClick={deleteLesson}>نعم، احذف</Button>
            <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>
      {user && (
        <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} userId={user.id}
          canPublishLessons={canPublish}
          defaultSubject={filters.subject === "all" ? "spanish" : filters.subject}
          myLessons={(lessons.data ?? []).filter((l) => l.user_id === user.id)}
          onDone={() => qc.invalidateQueries({ queryKey: ["lessons"] })} />
      )}
      <BoundNotebookReader pages={bookLessons} initialId={zoom?.id ?? null} roles={roles.data ?? []} onClose={() => setZoom(null)} />
    </div>
  );
}

/* ---------- Tier 1: 3D book cover (no author name) ---------- */
function BookCover({ book, onOpen }: { book: Book; onOpen: () => void }) {
  const sub = SUBJECTS.find((s) => s.id === book.subject);
  return (
    <button onClick={onOpen}
      className="group relative text-start rounded-xl border bg-card overflow-hidden shadow-[0_10px_24px_-14px_oklch(0.3_0.05_40/45%),inset_0_1px_0_oklch(1_0_0/60%)] transition duration-300 hover:shadow-[0_18px_36px_-16px_oklch(0.3_0.05_40/50%)] hover:-translate-y-1 hover:rotate-[-0.5deg] focus-visible:ring-2 focus-visible:ring-primary">
      <div className="absolute inset-y-0 start-0 w-2.5 bg-gradient-to-b from-primary via-primary/90 to-primary/70" />
      <div className="absolute inset-y-0 start-2.5 w-px bg-foreground/10" />
      {book.hasNew && (
        <span className="absolute top-3 end-3 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-bold text-accent-foreground shadow-sm animate-pulse">جديد</span>
      )}
      <div className="p-5 ps-8 space-y-4 min-h-44 flex flex-col">
        <BookMarked className="size-7 text-primary transition-transform duration-300 group-hover:scale-110" />
        <div className="flex-1 space-y-1.5">
          <Badge variant="secondary" className="text-[10px]">{sub?.sub || "مادة"}</Badge>
          <h3 className="font-extrabold text-base leading-snug">{sub?.label ?? book.subject}</h3>
        </div>
        <span className="self-start inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-bold">
          <FileText className="size-3.5" /> {book.count} {book.count > 2 ? "دروس" : "درس"}
        </span>
      </div>
    </button>
  );
}

/* ---------- Filter modal ---------- */
function FilterDialog({ open, onOpenChange, filters, onApply, units }: {
  open: boolean; onOpenChange: (o: boolean) => void; filters: Filters; onApply: (f: Filters) => void;
  units: string[];
}) {
  const [draft, setDraft] = useState<Filters>(filters);
  useEffect(() => { if (open) setDraft(filters); }, [open, filters]);
  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2 pe-8"><SlidersHorizontal className="size-5 shrink-0" /> تصفية الكراريس</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>المادة</Label>
            <Select value={draft.subject} onValueChange={set("subject")}>
              <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المواد</SelectItem>
                {SUBJECTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>نوع المحتوى</Label>
            <Select value={draft.type} onValueChange={set("type")}>
              <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {CONTENT_TYPES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>الفصل الدراسي</Label>
            <Select value={draft.semester} onValueChange={set("semester")}>
              <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الفصول</SelectItem>
                {SEMESTERS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>المحور / الوحدة</Label>
            <Select value={draft.unit} onValueChange={set("unit")}>
              <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الوحدات</SelectItem>
                {units.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" onClick={() => { onApply(draft); onOpenChange(false); }}>تطبيق التصفية</Button>
            <Button variant="outline" onClick={() => { setDraft(EMPTY_FILTERS); onApply(EMPTY_FILTERS); onOpenChange(false); }}>إعادة التعيين</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Tier 2: clean lesson row (no thumbnail) ---------- */
function LessonRow({ lesson: l, parent, author, starred, onStar, onShare, onDelete, onOpen, controls }: {
  lesson: Lesson; parent?: Lesson | undefined; author?: string | undefined;
  starred?: boolean | undefined; onStar?: (() => void) | undefined;
  onShare?: (() => void) | undefined; onDelete?: (() => void) | undefined;
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
          {author && <span className="block text-[11px] text-primary font-semibold">{author}</span>}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <Badge className={`text-[10px] px-1.5 py-0 ${l.content_type === "summary" ? "bg-summary text-summary-foreground" : ""}`}>
              {contentTypeLabel(l.content_type)}
            </Badge>
            {l.unit && <span>{l.unit}</span>}
            {l.semester && <span>· {semesterLabel(l.semester)}</span>}
            {l.domain && <span>· {l.domain}</span>}
            {parent && <span className="text-primary inline-flex items-center gap-0.5"><Link2 className="size-3" /> تتمة: {parent.title}</span>}
          </span>
        </span>
        <span className="shrink-0 text-end text-xs text-muted-foreground space-y-0.5">
          <Badge variant="outline" className="block">صفحة {l.page_number}</Badge>
          <span className="block">{new Date(l.created_at).toLocaleDateString("ar-DZ")}</span>
        </span>
      </button>
      <span className="flex flex-col gap-1 shrink-0">
        {onStar && (
          <Button size="icon" variant="ghost" className="size-7" onClick={onStar}
            aria-label={starred ? "إزالة من المفضلة" : "إضافة للمفضلة"}>
            <Star className={`size-4 ${starred ? "fill-accent stroke-accent" : ""}`} />
          </Button>
        )}
        {onShare && (
          <Button size="icon" variant="ghost" className="size-7" onClick={onShare} aria-label="نسخ الرابط">
            <Share2 className="size-3.5" />
          </Button>
        )}
        {onDelete && (
          <Button size="icon" variant="ghost" className="size-7 text-destructive hover:bg-destructive/10" onClick={onDelete} aria-label="حذف">
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </span>
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
        <DialogHeader><DialogTitle className="pe-8">مرحباً! ما اسمك؟</DialogTitle></DialogHeader>
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

function UploadDialog({ open, onOpenChange, userId, canPublishLessons, defaultSubject, myLessons, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; userId: string; canPublishLessons: boolean;
  defaultSubject: string; myLessons: Lesson[]; onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [type, setType] = useState<string>(canPublishLessons ? "lesson" : "summary");
  const [semester, setSemester] = useState<string>("s1");
  const [domain, setDomain] = useState("");
  const [unit, setUnit] = useState("");
  const [isCont, setIsCont] = useState(false);
  const [parentId, setParentId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState("");
  const generate = useServerFn(generateFormattedPage);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setSubject(defaultSubject); if (!canPublishLessons) setType("summary"); } }, [open, defaultSubject, canPublishLessons]);
  const notebook = myLessons.filter((l) => l.subject === subject);
  const roots = notebook.filter((l) => !l.parent_lesson_id);

  function resetForm() {
    setTitle(""); setDomain(""); setUnit(""); setIsCont(false); setParentId("");
    setFiles([]); setType(canPublishLessons ? "lesson" : "summary"); setSemester("s1"); setProgress("");
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
          title:title.trim(),subject,content_type:type,semester,domain:domain.trim() || null,unit:unit.trim() || null,
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
        <DialogHeader><DialogTitle className="pe-8">إضافة درس أو ملخص</DialogTitle></DialogHeader>
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
              <Select value={type} onValueChange={setType} disabled={!canPublishLessons}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CONTENT_TYPES.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
              {!canPublishLessons && <p className="text-[11px] text-muted-foreground">الدروس للكتّاب المعتمدين؛ يمكنك نشر الملخصات.</p>}
            </div>
            <div className="space-y-1.5"><Label>الفصل الدراسي *</Label>
              <Select value={semester} onValueChange={setSemester}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEMESTERS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
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
