import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, addCorsHeaders } from "../shared/cors.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  // Handle CORS preflight requests
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json()
    const {
      project_id,
      version,
      status,
      github_sha,
      github_ref,
      actor,
      commit_message,
      source = 'GitHub Actions',
      deployment_url,
      duration_in_seconds,
      is_success = true
    } = body

    if (!project_id || !version || !status) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400
      }));
    }

    const { error } = await supabase.from('deploy_logs').insert([{
      project_id,
      version,
      status,
      github_sha,
      github_ref,
      actor,
      commit_message,
      source,
      deployment_url,
      duration_in_seconds,
      is_success
    }])

    if (error) {
      return addCorsHeaders(new Response(JSON.stringify({ error: error.message }), { 
        status: 500 
      }));
    }

    return addCorsHeaders(new Response(JSON.stringify({ success: true }), { 
      status: 200 
    }));
  } catch (err) {
    return addCorsHeaders(new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400
    }));
  }
})
