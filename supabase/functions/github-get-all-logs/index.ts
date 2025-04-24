import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;

async function getRepos(org: string): Promise<any[]> {
  const res = await fetch(`https://api.github.com/orgs/${org}/repos`, {
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GitHub API error (repos): ${errorText}`);
  }

  return await res.json();
}

async function getWorkflowRuns(owner: string, repo: string): Promise<any[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GitHub API error (workflow runs): ${errorText}`);
  }

  return (await res.json()).workflow_runs;
}

async function getWorkflowLogs(owner: string, repo: string, run_id: number): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run_id}/logs`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GitHub API error (logs): ${errorText}`);
  }

  // Convert the ZIP file to text
  const zipData = new Uint8Array(await res.arrayBuffer());
  const textDecoder = new TextDecoder();
  return textDecoder.decode(zipData);
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Only POST allowed", { status: 405 });
  }

  const { org } = await req.json();
  if (!org) {
    return new Response("Missing 'org' parameter", { status: 400 });
  }

  try {
    const repos = await getRepos(org);
    const results: any[] = [];
    
    // Use Promise.all for parallel execution
    await Promise.all(repos.map(async (repo) => {
      try {
        const workflowRuns = await getWorkflowRuns(org, repo.name);
        
        // Process workflow runs in parallel
        const runResults = await Promise.all(workflowRuns.map(async (run) => {
          try {
            //const logData = await getWorkflowLogs(org, repo.name, run.id);
            return {
              repo: repo.name,
              run_id: run.id,
              workflow: run.name,
              status: run.status,
              conclusion: run.conclusion,
              created_at: run.created_at,
              updated_at: run.updated_at,
              run_number: run.run_number,
              run_attempt: run.run_attempt,
              actor: run.actor?.login,
              event: run.event,
              url: run.html_url,
              duration: run.updated_at ? new Date(run.updated_at).getTime() - new Date(run.created_at).getTime() : null,
              branch: run.head_branch,
              commit: {
                sha: run.head_sha,
                message: run.head_commit?.message,
                author: run.head_commit?.author?.name,
                committer: run.head_commit?.committer?.name,
                timestamp: run.head_commit?.timestamp
              }
            };
          } catch (error) {
            console.error(`Error fetching logs for ${repo.name}/${run.id}:`, error);
            return null;
          }
        }));
        
        results.push(...runResults.filter(Boolean));
      } catch (error) {
        console.error(`Error processing repo ${repo.name}:`, error);
      }
    }));

    return new Response(JSON.stringify(results, null, 2), {
      headers: { 
        "Content-Type": "application/json",
        "Cache-Control": "max-age=300" // Add caching for 5 minutes
      },
    });

  } catch (err) {
    console.error("Main error:", err);
    return new Response(`Error: ${err.message}`, { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
