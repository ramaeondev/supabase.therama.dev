import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, addCorsHeaders } from "../shared/cors.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!
);

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const { data, error } = await supabase.from("projects").select("*");

  if (error) {
    return addCorsHeaders(
      new Response(JSON.stringify({ error: error.message }), {
        status: 500,
      })
    );
  }

  return addCorsHeaders(
    new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    })
  );
});
