CREATE POLICY "students upload own summary images" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'lessons-images' AND (storage.foldername(name))[1] = (auth.uid())::text);