// Print a GitHub repo's size in KB (the `size` field of the repos API), or 0 if
// it can't be determined. Used by run-instance.sh to refuse pulling huge repos.
//   node repo-size-kb.mjs <org> <repo>
const [org, repo] = process.argv.slice(2);
const headers = { "user-agent": "ensemble-bench" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
try {
  const r = await fetch(`https://api.github.com/repos/${org}/${repo}`, { headers });
  if (!r.ok) { console.log(0); process.exit(0); }
  const j = await r.json();
  console.log(Number(j.size) || 0); // GitHub reports size in KB
} catch {
  console.log(0);
}
