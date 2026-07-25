// Premium dark-themed dashboard for token status monitoring and management

import type { TokenStatus } from "./token-manager";

export function generateDashboard(workerUrl: string, isAuthed: boolean): string {
	if (!isAuthed) {
		return generateLoginPage();
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>OpenAI Auth Proxy — Dashboard</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }

		:root {
			--bg-primary: #07070d;
			--bg-card: rgba(255,255,255,0.025);
			--bg-card-hover: rgba(255,255,255,0.04);
			--border: rgba(255,255,255,0.06);
			--border-hover: rgba(255,255,255,0.12);
			--text-primary: #f0f0f5;
			--text-secondary: #8b8b9e;
			--text-muted: #55556a;
			--accent: #818cf8;
			--accent-glow: rgba(129,140,248,0.15);
			--green: #4ade80;
			--green-glow: rgba(74,222,128,0.12);
			--yellow: #facc15;
			--yellow-glow: rgba(250,204,21,0.12);
			--red: #f87171;
			--red-glow: rgba(248,113,113,0.12);
		}

		body {
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
			background: var(--bg-primary);
			color: var(--text-primary);
			min-height: 100vh;
			overflow-x: hidden;
		}

		/* Ambient glow background */
		body::before {
			content: '';
			position: fixed;
			top: -50%;
			left: -50%;
			width: 200%;
			height: 200%;
			background: radial-gradient(ellipse at 30% 20%, rgba(129,140,248,0.04) 0%, transparent 50%),
			            radial-gradient(ellipse at 70% 80%, rgba(168,85,247,0.03) 0%, transparent 50%);
			pointer-events: none;
			z-index: 0;
		}

		.container {
			max-width: 720px;
			margin: 0 auto;
			padding: 2rem 1.5rem 4rem;
			position: relative;
			z-index: 1;
		}

		/* Header */
		.header {
			text-align: center;
			margin-bottom: 2.5rem;
		}

		.header-logo {
			font-size: 0.75rem;
			font-weight: 600;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: var(--accent);
			margin-bottom: 0.75rem;
		}

		.header h1 {
			font-size: 1.75rem;
			font-weight: 800;
			background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
		}

		.header p {
			color: var(--text-secondary);
			font-size: 0.9rem;
			margin-top: 0.5rem;
		}

		/* Status Card */
		.status-card {
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: 1.25rem;
			padding: 2rem;
			margin-bottom: 1.5rem;
			transition: border-color 0.3s ease;
		}

		.status-card:hover { border-color: var(--border-hover); }

		.status-header {
			display: flex;
			align-items: center;
			gap: 1rem;
			margin-bottom: 1.5rem;
		}

		.status-dot {
			width: 14px;
			height: 14px;
			border-radius: 50%;
			flex-shrink: 0;
			position: relative;
		}

		.status-dot::after {
			content: '';
			position: absolute;
			inset: -4px;
			border-radius: 50%;
			opacity: 0.4;
		}

		.status-dot.healthy {
			background: var(--green);
			box-shadow: 0 0 12px var(--green-glow);
			animation: pulse-green 2s infinite;
		}
		.status-dot.healthy::after { background: var(--green); }

		.status-dot.expiring_soon {
			background: var(--yellow);
			box-shadow: 0 0 12px var(--yellow-glow);
			animation: pulse-yellow 1.5s infinite;
		}
		.status-dot.expiring_soon::after { background: var(--yellow); }

		.status-dot.expired, .status-dot.broken, .status-dot.missing {
			background: var(--red);
			box-shadow: 0 0 12px var(--red-glow);
			animation: pulse-red 1s infinite;
		}
		.status-dot.expired::after, .status-dot.broken::after, .status-dot.missing::after { background: var(--red); }

		@keyframes pulse-green { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
		@keyframes pulse-yellow { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
		@keyframes pulse-red { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

		.status-label {
			font-size: 1.1rem;
			font-weight: 700;
			text-transform: capitalize;
		}

		.status-label.healthy { color: var(--green); }
		.status-label.expiring_soon { color: var(--yellow); }
		.status-label.expired, .status-label.broken, .status-label.missing { color: var(--red); }

		/* Info Grid */
		.info-grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 1rem;
		}

		.info-item {
			background: rgba(255,255,255,0.015);
			border: 1px solid rgba(255,255,255,0.04);
			border-radius: 0.75rem;
			padding: 1rem;
		}

		.info-label {
			font-size: 0.7rem;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.1em;
			color: var(--text-muted);
			margin-bottom: 0.4rem;
		}

		.info-value {
			font-family: 'JetBrains Mono', monospace;
			font-size: 0.85rem;
			color: var(--text-primary);
			word-break: break-all;
		}

		.info-value.countdown { color: var(--accent); font-weight: 600; }

		/* Error message */
		.error-message {
			background: var(--red-glow);
			border: 1px solid rgba(248,113,113,0.2);
			border-radius: 0.75rem;
			padding: 1rem;
			margin-top: 1rem;
			color: var(--red);
			font-size: 0.85rem;
			line-height: 1.5;
		}

		/* Actions */
		.actions {
			display: flex;
			gap: 1rem;
			flex-wrap: wrap;
		}

		.btn {
			display: inline-flex;
			align-items: center;
			gap: 0.5rem;
			padding: 0.75rem 1.5rem;
			border-radius: 0.75rem;
			font-family: 'Inter', sans-serif;
			font-size: 0.85rem;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.2s ease;
			text-decoration: none;
			border: none;
		}

		.btn-primary {
			background: linear-gradient(135deg, #818cf8, #a78bfa);
			color: #fff;
			box-shadow: 0 4px 20px var(--accent-glow);
		}
		.btn-primary:hover {
			transform: translateY(-1px);
			box-shadow: 0 6px 28px rgba(129,140,248,0.3);
		}

		.btn-secondary {
			background: var(--bg-card);
			color: var(--text-primary);
			border: 1px solid var(--border);
		}
		.btn-secondary:hover {
			border-color: var(--border-hover);
			background: var(--bg-card-hover);
		}

		.btn-danger {
			background: var(--red-glow);
			color: var(--red);
			border: 1px solid rgba(248,113,113,0.2);
		}
		.btn-danger:hover {
			background: rgba(248,113,113,0.2);
		}

		/* Seed Form */
		.seed-section {
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: 1.25rem;
			padding: 2rem;
			margin-top: 1.5rem;
		}

		.seed-section h3 {
			font-size: 1rem;
			font-weight: 700;
			margin-bottom: 0.5rem;
		}

		.seed-section p {
			color: var(--text-secondary);
			font-size: 0.8rem;
			margin-bottom: 1rem;
			line-height: 1.5;
		}

		textarea {
			width: 100%;
			min-height: 120px;
			background: rgba(0,0,0,0.3);
			border: 1px solid var(--border);
			border-radius: 0.75rem;
			padding: 1rem;
			color: var(--text-primary);
			font-family: 'JetBrains Mono', monospace;
			font-size: 0.8rem;
			resize: vertical;
			margin-bottom: 1rem;
			outline: none;
			transition: border-color 0.2s;
		}

		textarea:focus { border-color: var(--accent); }
		textarea::placeholder { color: var(--text-muted); }

		/* Loading spinner */
		.spinner {
			display: inline-block;
			width: 16px;
			height: 16px;
			border: 2px solid rgba(255,255,255,0.2);
			border-top-color: var(--accent);
			border-radius: 50%;
			animation: spin 0.8s linear infinite;
		}
		@keyframes spin { to { transform: rotate(360deg); } }

		/* Toast */
		.toast {
			position: fixed;
			bottom: 2rem;
			left: 50%;
			transform: translateX(-50%) translateY(100px);
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: 0.75rem;
			padding: 0.75rem 1.5rem;
			font-size: 0.85rem;
			backdrop-filter: blur(20px);
			transition: transform 0.3s ease;
			z-index: 100;
		}
		.toast.show { transform: translateX(-50%) translateY(0); }

		/* Responsive */
		@media (max-width: 540px) {
			.info-grid { grid-template-columns: 1fr; }
			.actions { flex-direction: column; }
			.container { padding: 1.5rem 1rem; }
		}

		/* Last refresh indicator */
		.refresh-bar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.75rem 1rem;
			background: rgba(255,255,255,0.015);
			border-radius: 0.75rem;
			margin-top: 1rem;
			font-size: 0.75rem;
			color: var(--text-muted);
		}

		.refresh-bar button {
			background: none;
			border: none;
			color: var(--accent);
			font-size: 0.75rem;
			cursor: pointer;
			font-family: 'Inter', sans-serif;
			font-weight: 500;
		}
		.refresh-bar button:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<div class="header-logo">⚡ OpenAI Auth Proxy</div>
			<h1>Token Dashboard</h1>
			<p>Cloudflare Worker managing your ChatGPT OAuth tokens</p>
		</div>

		<div id="status-card" class="status-card">
			<div class="status-header">
				<div class="spinner"></div>
				<span class="status-label" style="color: var(--text-secondary);">Loading...</span>
			</div>
		</div>

		<div class="actions">
			<a href="/auth/start" class="btn btn-primary" id="signin-btn">🔑 Sign in with ChatGPT</a>
			<button class="btn btn-secondary" onclick="toggleSeed()" id="seed-toggle-btn">📋 Seed auth.json</button>
		</div>

		<div class="seed-section" id="seed-section" style="display: none;">
			<h3>Seed / Replace auth.json</h3>
			<p>Paste your local <code>~/.codex/auth.json</code> contents below to bootstrap or replace the stored tokens.</p>
			<textarea id="seed-input" placeholder='{"auth_mode":"chatgpt","tokens":{...},"last_refresh":"..."}'></textarea>
			<div style="display: flex; gap: 0.75rem;">
				<button class="btn btn-primary" onclick="seedTokens()" id="seed-btn">Save to KV</button>
				<button class="btn btn-secondary" onclick="toggleSeed()">Cancel</button>
			</div>
			<div id="seed-result" style="margin-top: 0.75rem; font-size: 0.85rem;"></div>
		</div>
	</div>

	<div class="toast" id="toast"></div>

	<script>
		const PASSWORD = getCookie('dash_auth') || '';
		let autoRefreshInterval;

		async function fetchStatus() {
			try {
				const res = await fetch('/api/status', {
					headers: { 'X-Dashboard-Password': PASSWORD }
				});
				if (!res.ok) throw new Error('Status fetch failed');
				const data = await res.json();
				renderStatus(data);
			} catch (e) {
				renderError(e.message);
			}
		}

		function renderStatus(s) {
			const card = document.getElementById('status-card');
			const statusLabels = {
				healthy: '✅ Healthy',
				expiring_soon: '⚠️ Expiring Soon',
				expired: '🔴 Expired',
				broken: '❌ Broken',
				missing: '⭕ No Tokens'
			};

			let expiry = '';
			if (s.access_token_exp) {
				const expMs = s.access_token_exp * 1000;
				const now = Date.now();
				const diff = expMs - now;
				if (diff > 0) {
					const hrs = Math.floor(diff / 3600000);
					const mins = Math.floor((diff % 3600000) / 60000);
					expiry = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
				} else {
					expiry = 'Expired';
				}
			}

			let html = '<div class="status-header">';
			html += '<div class="status-dot ' + s.status + '"></div>';
			html += '<span class="status-label ' + s.status + '">' + (statusLabels[s.status] || s.status) + '</span>';
			html += '</div>';

			html += '<div class="info-grid">';
			if (s.email) {
				html += '<div class="info-item"><div class="info-label">Account</div><div class="info-value">' + escapeHtml(s.email) + '</div></div>';
			}
			if (s.plan) {
				html += '<div class="info-item"><div class="info-label">Plan</div><div class="info-value">' + escapeHtml(s.plan) + '</div></div>';
			}
			if (expiry) {
				html += '<div class="info-item"><div class="info-label">Token Expires In</div><div class="info-value countdown" id="countdown">' + expiry + '</div></div>';
			}
			if (s.last_refresh) {
				const ago = timeAgo(new Date(s.last_refresh));
				html += '<div class="info-item"><div class="info-label">Last Refresh</div><div class="info-value">' + ago + '</div></div>';
			}
			if (s.account_id) {
				html += '<div class="info-item"><div class="info-label">Account ID</div><div class="info-value">' + escapeHtml(s.account_id.substring(0, 12)) + '…</div></div>';
			}
			html += '</div>';

			if (s.error) {
				html += '<div class="error-message">' + escapeHtml(s.error) + '</div>';
			}

			html += '<div class="refresh-bar">';
			html += '<span>Auto-refreshes every 30s</span>';
			html += '<button onclick="fetchStatus()">Refresh now</button>';
			html += '</div>';

			card.innerHTML = html;
		}

		function renderError(msg) {
			const card = document.getElementById('status-card');
			card.innerHTML = '<div class="status-header"><div class="status-dot broken"></div><span class="status-label broken">Error</span></div><div class="error-message">' + escapeHtml(msg) + '</div>';
		}

		function toggleSeed() {
			const section = document.getElementById('seed-section');
			section.style.display = section.style.display === 'none' ? 'block' : 'none';
		}

		async function seedTokens() {
			const input = document.getElementById('seed-input').value.trim();
			const resultEl = document.getElementById('seed-result');

			if (!input) {
				resultEl.innerHTML = '<span style="color:var(--red)">Please paste auth.json content</span>';
				return;
			}

			try {
				JSON.parse(input);
			} catch {
				resultEl.innerHTML = '<span style="color:var(--red)">Invalid JSON format</span>';
				return;
			}

			const btn = document.getElementById('seed-btn');
			btn.disabled = true;
			btn.innerHTML = '<span class="spinner"></span> Saving...';

			try {
				const res = await fetch('/api/seed', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Dashboard-Password': PASSWORD
					},
					body: input
				});

				const data = await res.json();
				if (res.ok) {
					resultEl.innerHTML = '<span style="color:var(--green)">✅ Tokens saved successfully!</span>';
					showToast('Tokens seeded successfully');
					document.getElementById('seed-input').value = '';
					setTimeout(() => { toggleSeed(); fetchStatus(); }, 1500);
				} else {
					resultEl.innerHTML = '<span style="color:var(--red)">❌ ' + escapeHtml(data.error || 'Failed') + '</span>';
				}
			} catch (e) {
				resultEl.innerHTML = '<span style="color:var(--red)">❌ Network error: ' + escapeHtml(e.message) + '</span>';
			} finally {
				btn.disabled = false;
				btn.innerHTML = 'Save to KV';
			}
		}

		function showToast(msg) {
			const t = document.getElementById('toast');
			t.textContent = msg;
			t.classList.add('show');
			setTimeout(() => t.classList.remove('show'), 3000);
		}

		function timeAgo(date) {
			const now = new Date();
			const diff = now - date;
			const secs = Math.floor(diff / 1000);
			if (secs < 60) return secs + 's ago';
			const mins = Math.floor(secs / 60);
			if (mins < 60) return mins + 'm ago';
			const hrs = Math.floor(mins / 60);
			if (hrs < 24) return hrs + 'h ' + (mins % 60) + 'm ago';
			return date.toLocaleString();
		}

		function escapeHtml(str) {
			if (!str) return '';
			return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
		}

		function getCookie(name) {
			const v = document.cookie.match('(^|;)\\\\s*' + name + '\\\\s*=\\\\s*([^;]+)');
			return v ? decodeURIComponent(v.pop()) : '';
		}

		// Initial fetch + auto-refresh
		fetchStatus();
		autoRefreshInterval = setInterval(fetchStatus, 30000);
	</script>
</body>
</html>`;
}

function generateLoginPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Login — OpenAI Auth Proxy</title>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: 'Inter', sans-serif;
			background: #07070d;
			color: #f0f0f5;
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		body::before {
			content: '';
			position: fixed;
			top: -50%;
			left: -50%;
			width: 200%;
			height: 200%;
			background: radial-gradient(ellipse at 30% 20%, rgba(129,140,248,0.04) 0%, transparent 50%);
			pointer-events: none;
		}
		.login-card {
			background: rgba(255,255,255,0.025);
			border: 1px solid rgba(255,255,255,0.06);
			border-radius: 1.5rem;
			padding: 3rem;
			width: 100%;
			max-width: 380px;
			text-align: center;
			backdrop-filter: blur(20px);
			position: relative;
			z-index: 1;
		}
		.logo {
			font-size: 0.7rem;
			font-weight: 600;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: #818cf8;
			margin-bottom: 1.5rem;
		}
		h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.5rem; }
		p { color: #8b8b9e; font-size: 0.85rem; margin-bottom: 2rem; }
		input {
			width: 100%;
			padding: 0.85rem 1rem;
			background: rgba(0,0,0,0.3);
			border: 1px solid rgba(255,255,255,0.08);
			border-radius: 0.75rem;
			color: #f0f0f5;
			font-family: 'Inter', sans-serif;
			font-size: 0.9rem;
			outline: none;
			transition: border-color 0.2s;
			margin-bottom: 1rem;
		}
		input:focus { border-color: #818cf8; }
		input::placeholder { color: #55556a; }
		button {
			width: 100%;
			padding: 0.85rem;
			background: linear-gradient(135deg, #818cf8, #a78bfa);
			border: none;
			border-radius: 0.75rem;
			color: #fff;
			font-family: 'Inter', sans-serif;
			font-size: 0.9rem;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.2s;
		}
		button:hover { transform: translateY(-1px); box-shadow: 0 6px 28px rgba(129,140,248,0.3); }
		.error { color: #f87171; font-size: 0.8rem; margin-top: 0.75rem; display: none; }
	</style>
</head>
<body>
	<div class="login-card">
		<div class="logo">⚡ OpenAI Auth Proxy</div>
		<h1>Dashboard Access</h1>
		<p>Enter your dashboard password to continue</p>
		<form onsubmit="login(event)">
			<input type="password" id="password" placeholder="Dashboard password" autofocus>
			<button type="submit">Sign In</button>
		</form>
		<div class="error" id="error">Invalid password. Try again.</div>
	</div>
	<script>
		function login(e) {
			e.preventDefault();
			const pw = document.getElementById('password').value;
			document.cookie = 'dash_auth=' + encodeURIComponent(pw) + '; path=/; max-age=86400; SameSite=Strict';
			window.location.reload();
		}
	</script>
</body>
</html>`;
}
