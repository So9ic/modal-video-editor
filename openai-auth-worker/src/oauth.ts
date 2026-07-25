// OAuth PKCE flow for "Sign in with ChatGPT" re-authentication
// Implements the same flow as openai-oauth's login.ts but for Cloudflare Workers

import { saveTokens, type AuthData } from "./token-manager";

const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OAUTH_SCOPE = "openid profile email offline_access";
const PKCE_KV_PREFIX = "pkce:";
const PKCE_TTL_SECONDS = 300; // 5 minutes

// --- PKCE Helpers (Web Crypto API) ---
function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function generateCodeVerifier(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return bytesToBase64Url(bytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoded = new TextEncoder().encode(verifier);
	const digest = await crypto.subtle.digest("SHA-256", encoded);
	return bytesToBase64Url(new Uint8Array(digest));
}

function generateExtensionCompatibleState(workerUrl: string): string {
	const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));
	const payload = {
		type: "openai-oauth-callback",
		version: 1,
		callbackUrl: `${workerUrl}/auth/callback`,
		nonce: nonce
	};
	const jsonStr = JSON.stringify(payload);
	const base64 = btoa(jsonStr).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	return `oo2_${base64}`;
}

// --- Parse JWT to extract account_id ---
function parseJwtPayload(token: string): Record<string, unknown> | undefined {
	if (!token || !token.includes(".")) return undefined;
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		let base64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
		const pad = base64.length % 4;
		if (pad) base64 += "=".repeat(4 - pad);
		const decoded = atob(base64);
		const parsed = JSON.parse(decoded);
		return typeof parsed === "object" && parsed !== null ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function deriveAccountId(idToken: string | undefined): string | undefined {
	if (!idToken) return undefined;
	const claims = parseJwtPayload(idToken);
	if (!claims) return undefined;
	const authClaim = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
	if (authClaim && typeof authClaim.chatgpt_account_id === "string") {
		return authClaim.chatgpt_account_id;
	}
	return undefined;
}

// --- OAuth Flow Handlers ---

/**
 * Start OAuth PKCE flow: generate verifier/challenge, store in KV, redirect to OpenAI
 */
export async function handleAuthStart(
	request: Request,
	kv: KVNamespace,
	workerUrl: string,
): Promise<Response> {
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = generateExtensionCompatibleState(workerUrl);

	// Store code_verifier in KV keyed by state (TTL 5 min)
	await kv.put(`${PKCE_KV_PREFIX}${state}`, codeVerifier, { expirationTtl: PKCE_TTL_SECONDS });

	// Use a localhost OOB (Out-Of-Band) redirect URI to satisfy OpenAI's loopback whitelist
	const redirectUri = "http://localhost:1455/auth/callback";

	const params = new URLSearchParams({
		client_id: OPENAI_OAUTH_CLIENT_ID,
		response_type: "code",
		redirect_uri: redirectUri,
		scope: OAUTH_SCOPE,
		state: state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		codex_cli_simplified_flow: "true",
		id_token_add_organizations: "true",
	});

	const authorizationUrl = `${OPENAI_AUTHORIZE_URL}?${params.toString()}`;

	return Response.redirect(authorizationUrl, 302);
}

/**
 * Handle OAuth callback: exchange code for tokens, save to KV
 */
export async function handleAuthCallback(
	request: Request,
	kv: KVNamespace,
	encKey: string,
	workerUrl: string,
): Promise<Response> {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const error = url.searchParams.get("error");

	if (error) {
		return new Response(generateResultPage(false, `OAuth error: ${error} — ${url.searchParams.get("error_description") || ""}`), {
			status: 400,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}

	if (!code || !state) {
		return new Response(generateResultPage(false, "Missing code or state parameter"), {
			status: 400,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}

	// Retrieve code_verifier from KV
	const codeVerifier = await kv.get(`${PKCE_KV_PREFIX}${state}`);
	if (!codeVerifier) {
		return new Response(generateResultPage(false, "PKCE state expired or invalid. Please try signing in again."), {
			status: 400,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}

	// Clean up PKCE state
	await kv.delete(`${PKCE_KV_PREFIX}${state}`);

	// Use the exact same OOB redirect URI used in the authorize step
	const redirectUri = "http://localhost:1455/auth/callback";

	// Exchange authorization code for tokens
	try {
		const tokenResponse = await fetch(OPENAI_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "authorization_code",
				client_id: OPENAI_OAUTH_CLIENT_ID,
				code: code,
				code_verifier: codeVerifier,
				redirect_uri: redirectUri,
			}),
		});

		if (!tokenResponse.ok) {
			const errText = await tokenResponse.text();
			console.error(`[OAuth] Token exchange failed: ${tokenResponse.status} ${errText}`);
			return new Response(generateResultPage(false, `Token exchange failed: ${tokenResponse.status}`), {
				status: 500,
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		const result = (await tokenResponse.json()) as Record<string, unknown>;

		const accessToken = result.access_token as string | undefined;
		const idToken = result.id_token as string | undefined;
		const refreshToken = result.refresh_token as string | undefined;

		if (!accessToken) {
			return new Response(generateResultPage(false, "No access_token in response"), {
				status: 500,
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		const accountId = deriveAccountId(idToken) || "";

		const authData: AuthData = {
			auth_mode: "chatgpt",
			tokens: {
				id_token: idToken,
				access_token: accessToken,
				refresh_token: refreshToken,
				account_id: accountId,
			},
			last_refresh: new Date().toISOString(),
		};

		await saveTokens(kv, encKey, authData);

		console.log("[OAuth] Successfully exchanged code for tokens and saved to KV");

		return new Response(generateResultPage(true, "Authentication successful! Tokens are now stored securely. You can close this window."), {
			status: 200,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	} catch (e) {
		console.error("[OAuth] Token exchange error:", e);
		return new Response(generateResultPage(false, `Token exchange error: ${e}`), {
			status: 500,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}
}

// --- Result Page HTML ---
function generateResultPage(success: boolean, message: string): string {
	const icon = success ? "✅" : "❌";
	const color = success ? "#4ade80" : "#f87171";
	const title = success ? "Authentication Successful" : "Authentication Failed";

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, shrink-to-fit=no, viewport-fit=cover">
	<title>${title} — OpenAI Auth Proxy</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
			touch-action: manipulation;
			-webkit-tap-highlight-color: transparent;
		}
		html, body {
			width: 100%;
			height: 100%;
			overflow-x: hidden;
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			background: #0a0a0f;
			color: #e4e4e7;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 1rem;
			-webkit-text-size-adjust: 100%;
		}
		.container {
			text-align: center;
			padding: 2rem 1.5rem;
			background: rgba(255,255,255,0.03);
			border: 1px solid rgba(255,255,255,0.08);
			border-radius: 1.25rem;
			backdrop-filter: blur(20px);
			width: 100%;
			max-width: 380px;
		}
		.icon { font-size: 3rem; margin-bottom: 1rem; }
		h1 { font-size: 1.25rem; color: ${color}; margin-bottom: 0.75rem; }
		p { color: #a1a1aa; font-size: 0.82rem; line-height: 1.5; word-break: break-all; }
		.back-link {
			display: inline-block;
			margin-top: 1.5rem;
			color: #818cf8;
			text-decoration: none;
			font-size: 0.85rem;
			font-weight: 600;
		}
		.back-link:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<div class="container">
		<div class="icon">${icon}</div>
		<h1>${title}</h1>
		<p>${message}</p>
		<a href="/" class="back-link">← Back to Dashboard</a>
	</div>
</body>
</html>`;
}
