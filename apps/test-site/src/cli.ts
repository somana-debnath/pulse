import { startTestSite, type SiteMode } from "./server";

const port = Number(process.env.PORT ?? 3012);
const site = await startTestSite({ port, host: process.env.HOST ?? "0.0.0.0", mode: (process.env.MODE as SiteMode) ?? "up" });
console.log(`Acme Shop test site on http://localhost:${site.port}  (control panel: /__pulse)`);
