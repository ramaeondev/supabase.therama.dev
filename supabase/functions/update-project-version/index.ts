import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Setup Supabase client using service role (for insert/update without auth)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  try {
    const { project_id, version, status } = await req.json()

    if (!project_id || !version || !status) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), {
        status: 400
      })
    }

    // Find status_id
    const { data: statusRow, error: statusError } = await supabase
      .from('project_statuses')
      .select('id')
      .eq('name', status)
      .maybeSingle()

    if (statusError || !statusRow) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), {
        status: 400
      })
    }

    // Update project
    const { error: updateError } = await supabase
      .from('projects')
      .update({
        current_version: version,
        last_deployed_at: new Date().toISOString(),
        status_id: statusRow.id
      })
      .eq('id', project_id)

    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400
    })
  }
})
