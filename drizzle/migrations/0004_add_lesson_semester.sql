ALTER TABLE public.lessons ADD COLUMN semester TEXT;
COMMENT ON COLUMN public.lessons.semester IS 'Academic semester: s1 | s2 | s3';