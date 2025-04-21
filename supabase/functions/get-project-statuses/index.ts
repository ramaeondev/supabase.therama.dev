import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, addCorsHeaders } from "../shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { data, error } = await supabase
      .from("project_statuses")
      .select("id, name, description, class")
      .order("name", { ascending: true });

    if (error) {
      return addCorsHeaders(new Response(JSON.stringify({ error: error.message }), { status: 500 }));
    }

    return addCorsHeaders(new Response(JSON.stringify({ statuses: data }), { status: 200 }));
  } catch (err) {
    return addCorsHeaders(new Response(JSON.stringify({ error: "Unexpected error" }), { status: 500 }));
  }
});
