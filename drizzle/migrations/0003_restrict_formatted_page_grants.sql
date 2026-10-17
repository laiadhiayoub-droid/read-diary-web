REVOKE ALL ON public.formatted_pages FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.formatted_pages FROM authenticated;
GRANT SELECT ON public.formatted_pages TO authenticated;
REVOKE ALL ON public.notebook_generation_state FROM anon, authenticated;
GRANT ALL ON public.formatted_pages, public.notebook_generation_state TO service_role;