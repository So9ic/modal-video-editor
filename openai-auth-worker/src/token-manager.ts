// Token lifecycle management: KV read/write, JWT parsing, OpenAI token refresh
// Mirrors the refresh logic from openai-oauth's auth-file.ts

import { encrypt, decrypt } from "./crypto";

// --- Constants matching openai-oauth project ---
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const REFRESH_EXPIRY_MARGIN_MS = 5 * 60 * 1000; // Refresh if within 5 min of expiry
const REFRESH_INTERVAL_MS = 55 * 60 * 1000; // Force refresh every 55 minutes

const KV_KEY = "auth_tokens";

// --- Types ---
export interface StoredTokens {
	id_token?: string;
	access_token?: string;
	refresh_token?: string;
	account_id?: string;
}

export interface AuthData {
	auth_mode?: string;
	tokens: StoredTokens;
	last_refresh?: string;
}

export interface TokenStatus {
	valid: boolean;
	status: "healthy" | "expiring_soon" | "expired" | "broken" | "missing";
	email?: string;
	plan?: string;
	account_id?: string;
	access_token_exp?: number;
	last_refresh?: string;
	error?: string;
}

// --- JWT Parsing (no external dependencies) ---
function decodeBase64Url(value: string): string | undefined {
	try {
		const padded = value + "=".repeat(((-value.length % 4) + 4) % 4);
		const binary = atob(padded.replaceAll("-", "+").replaceAll("/", "_").split("").reverse().join("").split("").reverse().join("")
			.replaceAll("-", "+").replaceAll("_", "/"));
		return binary;
	} catch {
		return undefined;
	}
}

function parseJwtPayload(token: string): Record<string, unknown> | undefined {
	if (!token || !token.includes(".")) return undefined;
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		// Standard base64url decode
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

function getTokenExpiry(accessToken: string | undefined): number | undefined {
	if (!accessToken) return undefined;
	const claims = parseJwtPayload(accessToken);
	if (!claims || typeof claims.exp !== "number") return undefined;
	return claims.exp;
}

function extractEmailFromToken(token: string | undefined): string | undefined {
	if (!token) return undefined;
	const claims = parseJwtPayload(token);
	if (!claims) return undefined;
	// Check id_token style
	if (typeof claims.email === "string") return claims.email;
	// Check access_token style
	const profile = claims["https://api.openai.com/profile"] as Record<string, unknown> | undefined;
	if (profile && typeof profile.email === "string") return profile.email;
	return undefined;
}

function extractPlanFromToken(token: string | undefined): string | undefined {
	if (!token) return undefined;
	const claims = parseJwtPayload(token);
	if (!claims) return undefined;
	const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
	if (auth && typeof auth.chatgpt_plan_type === "string") return auth.chatgpt_plan_type;
	return undefined;
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

// --- KV Operations ---
export async function getTokens(kv: KVNamespace, encKey: string): Promise<AuthData | null> {
	const raw = await kv.get(KV_KEY);
	if (!raw) return null;
	try {
		const decrypted = await decrypt(raw, encKey);
		return JSON.parse(decrypted) as AuthData;
	} catch (e) {
		console.error("Failed to decrypt tokens from KV:", e);
		return null;
	}
}

export async function saveTokens(kv: KVNamespace, encKey: string, data: AuthData): Promise<void> {
	data.last_refresh = new Date().toISOString();
	const json = JSON.stringify(data);
	const encrypted = await encrypt(json, encKey);
	await kv.put(KV_KEY, encrypted);
}

// --- Token Health Check ---
export function getTokenStatus(data: AuthData | null): TokenStatus {
	if (!data || !data.tokens) {
		return { valid: false, status: "missing" };
	}

	const { tokens } = data;
	if (!tokens.access_token) {
		return { valid: false, status: "missing", error: "No access_token found" };
	}

	const exp = getTokenExpiry(tokens.access_token);
	const now = Date.now();
	const email = extractEmailFromToken(tokens.id_token) || extractEmailFromToken(tokens.access_token);
	const plan = extractPlanFromToken(tokens.id_token) || extractPlanFromToken(tokens.access_token);

	if (exp && exp * 1000 <= now) {
		// Check if we have a refresh token to recover
		if (tokens.refresh_token) {
			return {
				valid: false,
				status: "expired",
				email,
				plan,
				account_id: tokens.account_id,
				access_token_exp: exp,
				last_refresh: data.last_refresh,
				error: "Access token expired but refresh token available — will auto-refresh on next request",
			};
		}
		return {
			valid: false,
			status: "broken",
			email,
			plan,
			account_id: tokens.account_id,
			access_token_exp: exp,
			last_refresh: data.last_refresh,
			error: "Access token expired and no refresh token available",
		};
	}

	if (exp && exp * 1000 <= now + REFRESH_EXPIRY_MARGIN_MS) {
		return {
			valid: true,
			status: "expiring_soon",
			email,
			plan,
			account_id: tokens.account_id,
			access_token_exp: exp,
			last_refresh: data.last_refresh,
		};
	}

	if (!tokens.refresh_token) {
		return {
			valid: true,
			status: "expiring_soon",
			email,
			plan,
			account_id: tokens.account_id,
			access_token_exp: exp,
			last_refresh: data.last_refresh,
			error: "No refresh token — tokens cannot auto-renew",
		};
	}

	return {
		valid: true,
		status: "healthy",
		email,
		plan,
		account_id: tokens.account_id,
		access_token_exp: exp,
		last_refresh: data.last_refresh,
	};
}

// --- Token Refresh ---
function shouldRefresh(data: AuthData): boolean {
	const { tokens } = data;
	if (!tokens.access_token || !tokens.refresh_token) return false;

	const now = Date.now();

	// Check JWT expiry
	const exp = getTokenExpiry(tokens.access_token);
	if (exp && exp * 1000 <= now + REFRESH_EXPIRY_MARGIN_MS) {
		return true;
	}

	// Check time since last refresh
	if (data.last_refresh) {
		const lastRefreshMs = new Date(data.last_refresh).getTime();
		if (!isNaN(lastRefreshMs) && lastRefreshMs <= now - REFRESH_INTERVAL_MS) {
			return true;
		}
	}

	return false;
}

export async function refreshIfNeeded(data: AuthData): Promise<AuthData> {
	if (!shouldRefresh(data)) return data;
	if (!data.tokens.refresh_token) return data;

	console.log("[TokenManager] Refreshing access token via OpenAI OAuth...");

	const response = await fetch(OPENAI_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: OPENAI_OAUTH_CLIENT_ID,
			refresh_token: data.tokens.refresh_token,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error(`[TokenManager] Refresh failed (${response.status}): ${errorText}`);
		throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
	}

	const result = (await response.json()) as Record<string, unknown>;
	console.log("[TokenManager] Token refresh successful!");

	// Update tokens with fresh values
	const updatedTokens = { ...data.tokens };

	if (typeof result.access_token === "string") {
		updatedTokens.access_token = result.access_token;
	}
	if (typeof result.id_token === "string") {
		updatedTokens.id_token = result.id_token;
	}
	// OpenAI may rotate the refresh token
	if (typeof result.refresh_token === "string") {
		updatedTokens.refresh_token = result.refresh_token;
	}
	// Re-derive account_id from fresh id_token
	const freshAccountId = deriveAccountId(updatedTokens.id_token);
	if (freshAccountId) {
		updatedTokens.account_id = freshAccountId;
	}

	return {
		...data,
		tokens: updatedTokens,
		last_refresh: new Date().toISOString(),
	};
}

// --- OpenAI API Proxy ---
export async function proxyToOpenAI(
	request: Request,
	accessToken: string,
	accountId: string,
	path: string,
): Promise<Response> {
	// Determine target URL — route through Codex backend
	const targetUrl = `${CODEX_BASE_URL}${path}`;

	// Clone headers, inject auth
	const proxyHeaders = new Headers();
	proxyHeaders.set("Authorization", `Bearer ${accessToken}`);
	proxyHeaders.set("Content-Type", "application/json");
	proxyHeaders.set("Openai-Organization", accountId);
	proxyHeaders.set("Openai-Sentinel-Chat-Requirements-Token", "");

	// Copy accept header from original request
	const accept = request.headers.get("Accept");
	if (accept) proxyHeaders.set("Accept", accept);

	const body = await request.text();

	console.log(`[Proxy] Forwarding ${request.method} to ${targetUrl}`);

	const upstream = await fetch(targetUrl, {
		method: request.method,
		headers: proxyHeaders,
		body: body || undefined,
	});

	// Return upstream response directly (including streaming)
	const responseHeaders = new Headers(upstream.headers);
	responseHeaders.set("Access-Control-Allow-Origin", "*");

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
}
