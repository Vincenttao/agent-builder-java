const base = process.env.APP_ORIGIN ?? 'http://127.0.0.1:8080';
const deadline = Date.now() + 30000;
let ready = false;
while (Date.now() < deadline) {
  try { const response = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 250));
}
if (!ready) { console.error('Application readiness timed out'); process.exitCode = 1; }
