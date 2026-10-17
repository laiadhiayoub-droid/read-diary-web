CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by signed in" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE TABLE public.lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  subject text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('lesson','summary')),
  domain text,
  unit text,
  page_number int NOT NULL DEFAULT 1,
  parent_lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,
  image_path text NOT NULL,
  order_index int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessons TO authenticated;
GRANT ALL ON public.lessons TO service_role;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lessons readable by signed in" ON public.lessons FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "update own lessons" ON public.lessons FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "delete own lessons" ON public.lessons FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TYPE public.app_role AS ENUM ('admin', 'writer', 'student');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student') ON CONFLICT DO NOTHING;
  IF lower(NEW.email) = 'laiadhiayoub@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "writers insert own lessons" ON public.lessons FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (public.has_role(auth.uid(), 'writer') OR public.has_role(auth.uid(), 'admin')));

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (id uuid, email text, full_name text, roles public.app_role[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
    SELECT u.id, u.email::text, p.full_name,
      COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}')
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    GROUP BY u.id, u.email, p.full_name
    ORDER BY p.full_name NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_writer(_user_id uuid, _is_writer boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _is_writer THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'writer') ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = 'writer';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_writer(uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_writer(uuid, boolean) TO authenticated;

CREATE TABLE public.banned_users (
  email text PRIMARY KEY,
  reason text,
  banned_at timestamptz NOT NULL DEFAULT now(),
  banned_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banned_users TO authenticated;
GRANT ALL ON public.banned_users TO service_role;
ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage bans" ON public.banned_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.current_user_banned() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.banned_users b
    WHERE lower(b.email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
GRANT EXECUTE ON FUNCTION public.current_user_banned() TO authenticated;

CREATE POLICY "banned blocked lessons" ON public.lessons AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_user_banned()) WITH CHECK (NOT public.current_user_banned());
CREATE POLICY "banned blocked profiles" ON public.profiles AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_user_banned()) WITH CHECK (NOT public.current_user_banned());

CREATE POLICY "admins update any lesson" ON public.lessons FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete any lesson" ON public.lessons FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "signed in read lesson images" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'lessons-images' AND auth.uid() IS NOT NULL);
CREATE POLICY "writers upload own lesson images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lessons-images' AND (storage.foldername(name))[1] = auth.uid()::text
    AND (public.has_role(auth.uid(), 'writer') OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "delete own lesson images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lessons-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "admins delete any lesson image" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lessons-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "banned blocked storage" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.current_user_banned()) WITH CHECK (NOT public.current_user_banned());

CREATE TABLE public.lesson_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  subject text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.lesson_views TO authenticated;
GRANT ALL ON public.lesson_views TO service_role;
ALTER TABLE public.lesson_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "log own views" ON public.lesson_views FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND NOT public.current_user_banned());
CREATE POLICY "admins read views" ON public.lesson_views FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.site_announcement (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  message text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.site_announcement TO anon, authenticated;
GRANT UPDATE ON public.site_announcement TO authenticated;
GRANT ALL ON public.site_announcement TO service_role;
ALTER TABLE public.site_announcement ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read active announcement" ON public.site_announcement FOR SELECT TO anon, authenticated
  USING (active OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins edit announcement" ON public.site_announcement FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.site_announcement (id, message, active) VALUES (1, '', false);

CREATE OR REPLACE FUNCTION public.admin_list_users_full()
RETURNS TABLE(id uuid, email text, full_name text, roles app_role[], banned boolean, lessons_count bigint, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.full_name,
    coalesce((SELECT array_agg(r.role) FROM public.user_roles r WHERE r.user_id = u.id), '{}'),
    EXISTS (SELECT 1 FROM public.banned_users b WHERE lower(b.email) = lower(u.email)),
    (SELECT count(*) FROM public.lessons l WHERE l.user_id = u.id),
    u.created_at
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_users_full() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users_full() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_name(_user_id uuid, _name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(trim(_name)) < 2 THEN RAISE EXCEPTION 'name too short'; END IF;
  INSERT INTO public.profiles (id, full_name) VALUES (_user_id, trim(_name))
  ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_name(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_name(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_ban(_email text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id
             WHERE lower(u.email) = lower(trim(_email)) AND r.role = 'admin') THEN
    RAISE EXCEPTION 'cannot ban an admin';
  END IF;
  INSERT INTO public.banned_users (email, banned_by) VALUES (lower(trim(_email)), auth.uid())
  ON CONFLICT (email) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.admin_ban(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_ban(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_stats()
RETURNS TABLE(students bigint, lessons bigint, banned bigint, top_subjects jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY SELECT
    (SELECT count(*) FROM auth.users),
    (SELECT count(*) FROM public.lessons),
    (SELECT count(*) FROM public.banned_users),
    coalesce((SELECT jsonb_agg(jsonb_build_object('subject', s.subject, 'views', s.c) ORDER BY s.c DESC)
      FROM (SELECT v.subject, count(*) c FROM public.lesson_views v GROUP BY v.subject ORDER BY c DESC LIMIT 5) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO authenticated;