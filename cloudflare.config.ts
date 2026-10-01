import { readFileSync } from "node:fs";
import { bindings, defineConfig } from "cf/config";

const { domain } = JSON.parse(readFileSync(new URL("./.local/deploy.json", import.meta.url), "utf8")) as { domain: string };
if (!domain || new URL(`https://${domain}`).host !== domain) throw new Error("Set a valid domain in .local/deploy.json");

export default defineConfig({
	worker: {
		name: "nail",
		compatibilityDate: "2026-09-30",
		entrypoint: "./src/worker/index.ts",
		workersDev: false,
		previewUrls: false,
		observability: {
			enabled: true,
			traces: {
				enabled: true,
				headSamplingRate: 0.01,
			},
		},
		assets: {
			runWorkerFirst: [
				"/api/*",
				"/auth/*",
			],
		},
		domains: [
			domain,
		],
		env: {
			APP_ORIGIN: bindings.text(`https://${domain}`),
			DB: bindings.d1({
				name: "nail-mail",
				id: "da8dd701-bf2d-4c9a-98bf-91e0dcc9fe4e",
			}),
			ASSETS: bindings.assets(),
		},
	},
});
