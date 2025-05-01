import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCors } from "../shared/cors.ts";

// Get all rows from a given table name
async function getAllRowsFromTable(tableName: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.from(tableName).select("*");
  if (error) throw error;
  return data;
}

serve(async (req: Request) => {
  // Use shared CORS handler
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  try {
    const { table } = await req.json();
    if (!table || typeof table !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid 'table' parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rows = await getAllRowsFromTable(table);
    return new Response(JSON.stringify({ result: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    let message = "Unknown error";
    if (err instanceof Error) message = err.message;
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


// curl -X POST 'https://api.therama.dev/functions/v1/get-table-rows' \
//   -H "Content-Type: application/json" \
//   -d '{"table": "languages"}'