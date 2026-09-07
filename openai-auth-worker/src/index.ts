// Main Cloudflare Worker entry point
// Routes: /v1/* (API proxy), / (dashboard), /api/status, /api/seed, /auth/*

import {
	getTokens,
	saveTokens,
	refreshIfNeeded,
	proxyToOpenAI,
	getTokenStatus,
	type AuthData,
} from "./token-manager";
import { handleAuthStart, handleAuthCallback } from "./oauth";
import { generateDashboard } from "./dashboard";

export interface Env {
	AUTH_KV: KVNamespace;
	WORKER_SECRET: string;
	KV_ENCRYPTION_KEY: string;
	DASHBOARD_PASSWORD: string;
	WORKER_URL?: string;
}

// --- Helpers ---

function getWorkerUrl(request: Request, env: Env): string {
	if (env.WORKER_URL) return env.WORKER_URL.replace(/\/$/, "");
	const url = new URL(request.url);
	return `${url.protocol}//${url.host}`;
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			...headers,
		},
	});
}

function isDashboardAuthed(request: Request, env: Env): boolean {
	// Check X-Dashboard-Password header (for API calls from dashboard JS)
	const headerPw = request.headers.get("X-Dashboard-Password");
	if (headerPw && headerPw === env.DASHBOARD_PASSWORD) return true;

	// Check cookie (for page loads)
	const cookie = request.headers.get("Cookie") || "";
	const match = cookie.match(/(?:^|;\s*)dash_auth=([^;]+)/);
	if (match) {
		const cookiePw = decodeURIComponent(match[1]);
		if (cookiePw === env.DASHBOARD_PASSWORD) return true;
	}

	return false;
}

function isApiAuthed(request: Request, env: Env): boolean {
	const auth = request.headers.get("Authorization") || "";
	const token = auth.replace(/^Bearer\s+/i, "").trim();
	return token === env.WORKER_SECRET;
}

// --- Request Handler ---

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Dashboard-Password",
					"Access-Control-Max-Age": "86400",
				},
			});
		}

		try {
			// =============================================
			// ROUTE: /v1/* — OpenAI-compatible API proxy
			// =============================================
			if (path.startsWith("/v1/")) {
				// Authenticate with WORKER_SECRET (or Dashboard Password for /v1/models)
				if (!isApiAuthed(request, env)) {
					const isModelsEndpoint = path === "/v1/models" && request.method === "GET";
					if (!(isModelsEndpoint && isDashboardAuthed(request, env))) {
						return jsonResponse({ error: "Unauthorized. Provide Bearer WORKER_SECRET." }, 401);
					}
				}

				// Handle /v1/models endpoint by querying OpenAI directly
				if (path === "/v1/models" && request.method === "GET") {
					try {
						const authData = await getTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY);
						if (!authData || !authData.tokens?.access_token) {
							throw new Error("No tokens");
						}

						// Use proxyToOpenAI to mimic exactly what chat/completions does
						const modelsProxyRes = await proxyToOpenAI(
							request,
							authData.tokens.access_token,
							authData.tokens.account_id || "",
							"/models?client_version=0.144.1"
						);

						if (!modelsProxyRes.ok) throw new Error(`Fetch failed: ${modelsProxyRes.status}`);
						
						const bodyText = await modelsProxyRes.text();
						const data = JSON.parse(bodyText) as any;
						const mappedModels = (data.models || []).map((m: any) => ({
							id: m.slug,
							object: "model",
							owned_by: "openai"
						}));

						return jsonResponse({ object: "list", data: mappedModels });
					} catch (e) {
						// Fallback to static list on Cloudflare 403 or parse error
						return jsonResponse({
							object: "list",
							error_message: e instanceof Error ? e.message : String(e),
							data: [
								{ id: "gpt-4o", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "gpt-4o-mini", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "o1-mini", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "o3-mini", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "gpt-reserve", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "gpt-5.6-terra", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "gpt-5.6-luna", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "gpt-5.5", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "gpt-5.4-mini", object: "model", owned_by: "openai-oauth-proxy" },
								{ id: "codex-auto-review", object: "model", owned_by: "openai-oauth-proxy" }
							],
						});
					}
				}

				// Get tokens from KV
				let authData = await getTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY);
				if (!authData || !authData.tokens?.access_token) {
					return jsonResponse({ error: "No tokens stored. Seed auth.json or sign in via dashboard." }, 503);
				}

				// Temporary debug endpoint to grab token for curling
				if (path === "/v1/dump-token" && request.method === "GET") {
					let authData = await getTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY);
					return jsonResponse({ access_token: authData?.tokens?.access_token });
				}

				// Refresh if needed
				try {
					const refreshed = await refreshIfNeeded(authData);
					if (refreshed !== authData) {
						// Tokens were refreshed — save updated tokens back to KV
						await saveTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY, refreshed);
						authData = refreshed;
						console.log("[Worker] Tokens refreshed and saved to KV");
					}
				} catch (refreshErr) {
					console.error("[Worker] Token refresh failed, attempting with existing token:", refreshErr);
					// Continue with existing token — it may still work
				}

				const accessToken = authData.tokens.access_token!;
				const accountId = authData.tokens.account_id || "";

				// Strip /v1 prefix to get the API path
				const apiPath = path.substring(3); // "/v1/chat/completions" → "/chat/completions"

				return proxyToOpenAI(request, accessToken, accountId, apiPath);
			}

			// =============================================
			// ROUTE: / — Dashboard
			// =============================================
			if (path === "/" || path === "") {
				const isAuthed = isDashboardAuthed(request, env);
				const workerUrl = getWorkerUrl(request, env);
				const html = generateDashboard(workerUrl, isAuthed);
				return new Response(html, {
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}

			// =============================================
			// ROUTE: /api/status — Token health status
			// =============================================
			if (path === "/api/status") {
				if (!isDashboardAuthed(request, env)) {
					return jsonResponse({ error: "Unauthorized" }, 401);
				}

				const authData = await getTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY);
				const status = getTokenStatus(authData);
				return jsonResponse(status);
			}

			// =============================================
			// ROUTE: /api/seed — Seed auth.json into KV
			// =============================================
			if (path === "/api/seed" && request.method === "POST") {
				if (!isDashboardAuthed(request, env)) {
					return jsonResponse({ error: "Unauthorized" }, 401);
				}

				try {
					const body = await request.json() as AuthData;

					// Validate structure
					if (!body.tokens || (!body.tokens.access_token && !body.tokens.refresh_token)) {
						return jsonResponse({ error: "Invalid auth.json: must contain tokens.access_token or tokens.refresh_token" }, 400);
					}

					await saveTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY, body);
					return jsonResponse({ ok: true, message: "Tokens saved successfully" });
				} catch (e) {
					return jsonResponse({ error: `Invalid JSON body: ${e}` }, 400);
				}
			}

			// =============================================
			// ROUTE: /api/token — Get active access token (for Modal script)
			// =============================================
			if (path === "/api/token" && request.method === "GET") {
				if (!isApiAuthed(request, env) && !isDashboardAuthed(request, env)) {
					return jsonResponse({ error: "Unauthorized. Provide Bearer WORKER_SECRET." }, 401);
				}

				let authData = await getTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY);
				if (!authData || !authData.tokens?.access_token) {
					return jsonResponse({ error: "No tokens stored. Seed auth.json or sign in via dashboard." }, 503);
				}

				// Refresh if needed
				try {
					const refreshed = await refreshIfNeeded(authData);
					if (refreshed !== authData) {
						await saveTokens(env.AUTH_KV, env.KV_ENCRYPTION_KEY, refreshed);
						authData = refreshed;
						console.log("[Worker] Tokens refreshed and saved to KV");
					}
				} catch (refreshErr) {
					console.error("[Worker] Token refresh failed:", refreshErr);
				}

				return jsonResponse({
					access_token: authData.tokens.access_token,
					account_id: authData.tokens.account_id || "",
				});
			}

			// =============================================
			// ROUTE: /api/model — Get/Set Selected Model
			// =============================================
			if (path === "/api/model") {
				if (!isApiAuthed(request, env) && !isDashboardAuthed(request, env)) {
					return jsonResponse({ error: "Unauthorized." }, 401);
				}

				if (request.method === "GET") {
					const model = await env.AUTH_KV.get("SELECTED_MODEL") || "gpt-4o";
					return jsonResponse({ model });
				} else if (request.method === "POST") {
					try {
						const body = await request.json() as { model: string };
						if (body.model) {
							await env.AUTH_KV.put("SELECTED_MODEL", body.model);
							return jsonResponse({ ok: true, message: "Model updated successfully" });
						}
						return jsonResponse({ error: "Missing model in body" }, 400);
					} catch (e) {
						return jsonResponse({ error: `Invalid JSON body: ${e}` }, 400);
					}
				}
			}

			// =============================================
			// ROUTE: /auth/start — Begin OAuth PKCE flow
			// =============================================
			if (path === "/auth/start") {
				const workerUrl = getWorkerUrl(request, env);
				return handleAuthStart(request, env.AUTH_KV, workerUrl);
			}

			// =============================================
			// ROUTE: /auth/callback — OAuth callback
			// =============================================
			if (path === "/auth/callback") {
				const workerUrl = getWorkerUrl(request, env);
				return handleAuthCallback(request, env.AUTH_KV, env.KV_ENCRYPTION_KEY, workerUrl);
			}

			// =============================================
			// 404
			// =============================================
			return jsonResponse({ error: "Not found" }, 404);
		} catch (err) {
			console.error("[Worker] Unhandled error:", err);
			return jsonResponse({ error: `Internal error: ${err}` }, 500);
		}
	},
} satisfies ExportedHandler<Env>;
