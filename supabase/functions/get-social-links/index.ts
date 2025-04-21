// supabase/functions/get-social-links.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, addCorsHeaders } from "../shared/cors.ts";

// Initialize Supabase client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  // Handle CORS preflight
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const { data, error } = await supabase
      .from("social_links")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return addCorsHeaders(new Response(JSON.stringify({ error: error.message }), { status: 500 }));
    }

    return addCorsHeaders(new Response(JSON.stringify({ links: data }), { status: 200 }));
  } catch (err) {
    return addCorsHeaders(new Response(JSON.stringify({ error: "Something went wrong" }), { status: 500 }));
  }
});
