CREATE POLICY "students insert own summaries" ON public.lessons FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND content_type = 'summary');