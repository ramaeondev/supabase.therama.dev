import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const GITHUB_ORG = Deno.env.get("GITHUB_ORG")!;
const GITHUB_PAT = Deno.env.get("GITHUB_PAT")!;

interface WorkflowLog {
  repo: string;
  run_id: number;
  workflow: string;
  status: string;
  conclusion: string;
  created_at: string;
  updated_at: string;
  run_number: number;
  run_attempt: number;
  actor: string;
  event: string;
  url: string;
  duration: number;
  branch: string;
  commit: {
    sha: string;
    message: string;
    author: string;
    committer: string;
    timestamp: string;
  };
}

interface RepositoryStats {
  name: string;
  url: string;
  created_at: string;
  total_workflows: number;
  successful_deployments: number;
  failed_deployments: number;
  total_deployment_time: number;
  workflow_logs?: WorkflowLog[];
}

interface RequestPayload {
  org: string;
  group_by_repository?: boolean;
}

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

async function getWorkflowRuns(org: string, repo: string): Promise<any[]> {
  const res = await fetch(
    `https://api.github.com/repos/${org}/${repo}/actions/runs`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`GitHub API error (workflow runs): ${errorText}`);
  }

  const data = await res.json();
  return data.workflow_runs || [];
}

function processRepositories(logs: WorkflowLog[], org: string): RepositoryStats[] {
  const repoMap = new Map<string, RepositoryStats>();
  
  logs.forEach(log => {
    if (!repoMap.has(log.repo)) {
      repoMap.set(log.repo, {
        name: log.repo,
        url: `https://github.com/${org}/${log.repo}`,
        created_at: log.created_at,
        total_workflows: 0,
        successful_deployments: 0,
        failed_deployments: 0,
        total_deployment_time: 0
      });
    }
    
    const repoStats = repoMap.get(log.repo)!;
    repoStats.total_workflows++;
    
    if (log.conclusion === 'success') {
      repoStats.successful_deployments++;
    } else if (log.conclusion === 'failure') {
      repoStats.failed_deployments++;
    }
    
    repoStats.total_deployment_time += log.duration || 0;
    
    if (new Date(log.created_at) < new Date(repoStats.created_at)) {
      repoStats.created_at = log.created_at;
    }
  });
  
  return Array.from(repoMap.values());
}

serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response('Method must be POST', { status: 405 });
    }

    const payload: RequestPayload = await req.json();
    const { org, group_by_repository = false } = payload;

    const repos = await getRepos(org);
    const results: (WorkflowLog | null)[] = []; // Updated type annotation

    await Promise.all(repos.map(async (repo) => {
      try {
        const workflowRuns = await getWorkflowRuns(GITHUB_ORG, repo.name);
        
        const runResults = await Promise.all(workflowRuns.map(async (run) => {
          try {
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
              actor: run.actor?.login || '',
              event: run.event,
              url: run.html_url,
              duration: run.updated_at ? new Date(run.updated_at).getTime() - new Date(run.created_at).getTime() : 0,
              branch: run.head_branch,
              commit: {
                sha: run.head_sha,
                message: run.head_commit?.message || '',
                author: run.head_commit?.author?.name || '',
                committer: run.head_commit?.committer?.name || '',
                timestamp: run.head_commit?.timestamp || ''
              }
            } as WorkflowLog; // Type assertion to ensure it matches WorkflowLog
          } catch (error) {
            console.error(`Error fetching logs for ${repo.name}/${run.id}:`, error);
            return null;
          }
        }));
        
        results.push(...runResults.filter((result): result is WorkflowLog => result !== null));
      } catch (error) {
        console.error(`Error processing repo ${repo.name}:`, error);
      }
    }));

    if (group_by_repository) {
      // Group logs by repository
      const repoMap = new Map<string, RepositoryStats>();
      
      // Filter out null values before processing
      const validLogs = results.filter((log): log is WorkflowLog => log !== null);
      
      validLogs.forEach(log => {
        if (!repoMap.has(log.repo)) {
          repoMap.set(log.repo, {
            name: log.repo,
            url: `https://github.com/${org}/${log.repo}`,
            created_at: log.created_at,
            total_workflows: 0,
            successful_deployments: 0,
            failed_deployments: 0,
            total_deployment_time: 0,
            workflow_logs: [] // Initialize empty array

          });
        }
        
        const repoStats = repoMap.get(log.repo)!;
        repoStats.total_workflows++;
        
        if (log.conclusion === 'success') {
          repoStats.successful_deployments++;
        } else if (log.conclusion === 'failure') {
          repoStats.failed_deployments++;
        }
        
        repoStats.total_deployment_time += log.duration || 0;
        
        if (new Date(log.created_at) < new Date(repoStats.created_at)) {
          repoStats.created_at = log.created_at;
        }

         // Add the workflow log to the repository's logs
        repoStats.workflow_logs?.push(log);
      });

      return new Response(JSON.stringify({
        repositories: Array.from(repoMap.values())
      }, null, 2), {
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "max-age=300"
        },
      });
    } else {
      // Return in existing format
      return new Response(JSON.stringify({
        repositories: processRepositories(results as WorkflowLog[], org),
        workflow_logs: results
      }, null, 2), {
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "max-age=300"
        },
      });
    }

  } catch (err) {
    console.error("Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
