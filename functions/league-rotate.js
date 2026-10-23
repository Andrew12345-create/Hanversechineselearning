/* Scheduled on the main site (hanverse.netlify.app) — no-op here so two Netlify sites never double-run sweeps. */
export default async () => ({ statusCode: 200, body: "sweeps run on main site" });
