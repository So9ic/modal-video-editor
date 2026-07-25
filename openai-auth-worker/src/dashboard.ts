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
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, shrink-to-fit=no, viewport-fit=cover">
	<title>OpenAI Auth Proxy — Dashboard</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
			touch-action: manipulation;
			-webkit-tap-highlight-color: transparent;
		}

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

		html, body {
			width: 100%;
			min-height: 100vh;
			min-height: 100dvh;
			overflow-x: hidden;
			background: var(--bg-primary);
			color: var(--text-primary);
			font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
			-webkit-text-size-adjust: 100%;
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
			width: 100%;
			max-width: 600px;
			margin: 0 auto;
			padding: 1rem 0.85rem 2rem;
			position: relative;
			z-index: 1;
			display: flex;
			flex-direction: column;
			gap: 0.75rem;
		}

		/* Compact Header */
		.header {
			text-align: center;
			padding: 0.5rem 0;
		}

		.header-logo {
			font-size: 0.65rem;
			font-weight: 700;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: var(--accent);
			margin-bottom: 0.25rem;
		}

		.header h1 {
			font-size: 1.25rem;
			font-weight: 800;
			line-height: 1.2;
			background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
		}

		.header p {
			color: var(--text-secondary);
			font-size: 0.75rem;
			margin-top: 0.2rem;
		}

		/* Compact Status Card */
		.status-card {
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: 1rem;
			padding: 1rem;
			transition: border-color 0.3s ease;
		}

		.status-card:hover { border-color: var(--border-hover); }

		.status-header {
			display: flex;
			align-items: center;
			gap: 0.6rem;
			margin-bottom: 0.85rem;
		}

		.status-dot {
			width: 12px;
			height: 12px;
			border-radius: 50%;
			flex-shrink: 0;
			position: relative;
		}

		.status-dot::after {
			content: '';
			position: absolute;
			inset: -3px;
			border-radius: 50%;
			opacity: 0.4;
		}

		.status-dot.healthy {
			background: var(--green);
			box-shadow: 0 0 10px var(--green-glow);
			animation: pulse-green 2s infinite;
		}
		.status-dot.healthy::after { background: var(--green); }

		.status-dot.expiring_soon {
			background: var(--yellow);
			box-shadow: 0 0 10px var(--yellow-glow);
			animation: pulse-yellow 1.5s infinite;
		}
		.status-dot.expiring_soon::after { background: var(--yellow); }

		.status-dot.expired, .status-dot.broken, .status-dot.missing {
			background: var(--red);
			box-shadow: 0 0 10px var(--red-glow);
			animation: pulse-red 1s infinite;
		}
		.status-dot.expired::after, .status-dot.broken::after, .status-dot.missing::after { background: var(--red); }

		@keyframes pulse-green { 0%,100% { opacity:1; } 50% { opacity:0.6; } }
		@keyframes pulse-yellow { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
		@keyframes pulse-red { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

		.status-label {
			font-size: 0.95rem;
			font-weight: 700;
			text-transform: capitalize;
		}

		.status-label.healthy { color: var(--green); }
		.status-label.expiring_soon { color: var(--yellow); }
		.status-label.expired, .status-label.broken, .status-label.missing { color: var(--red); }

		/* Guaranteed 2-Column Grid on all screen sizes */
		.info-grid {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 0.5rem;
			width: 100%;
		}

		.info-item {
			background: rgba(255,255,255,0.015);
			border: 1px solid rgba(255,255,255,0.04);
			border-radius: 0.6rem;
			padding: 0.6rem 0.7rem;
			min-width: 0; /* Prevents grid cell overflow */
			overflow: hidden;
		}

		.info-label {
			font-size: 0.6rem;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.08em;
			color: var(--text-muted);
			margin-bottom: 0.2rem;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.info-value {
			font-family: 'JetBrains Mono', monospace;
			font-size: 0.75rem;
			color: var(--text-primary);
			word-break: break-all;
			overflow-wrap: anywhere;
			line-height: 1.3;
		}

		.info-value.countdown { color: var(--accent); font-weight: 600; }

		/* Error message */
		.error-message {
			background: var(--red-glow);
			border: 1px solid rgba(248,113,113,0.2);
			border-radius: 0.6rem;
			padding: 0.75rem;
			margin-top: 0.75rem;
			color: var(--red);
			font-size: 0.75rem;
			line-height: 1.4;
			word-break: break-all;
		}

		/* Actions */
		.actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0.5rem;
			width: 100%;
		}

		.btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 0.4rem;
			padding: 0.65rem 0.85rem;
			border-radius: 0.65rem;
			font-family: 'Inter', sans-serif;
			font-size: 0.78rem;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.2s ease;
			text-decoration: none;
			border: none;
			white-space: nowrap;
			text-align: center;
			width: 100%;
		}

		.btn-primary {
			background: linear-gradient(135deg, #818cf8, #a78bfa);
			color: #fff;
			box-shadow: 0 4px 16px var(--accent-glow);
		}
		.btn-primary:active { transform: scale(0.98); }

		.btn-secondary {
			background: var(--bg-card);
			color: var(--text-primary);
			border: 1px solid var(--border);
		}
		.btn-secondary:active { background: var(--bg-card-hover); transform: scale(0.98); }

		/* Seed Form */
		.seed-section {
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: 1rem;
			padding: 1rem;
		}

		.seed-section h3 {
			font-size: 0.9rem;
			font-weight: 700;
			margin-bottom: 0.3rem;
		}

		.seed-section p {
			color: var(--text-secondary);
			font-size: 0.72rem;
			margin-bottom: 0.75rem;
			line-height: 1.4;
		}

		textarea {
			width: 100%;
			min-height: 85px;
			max-height: 140px;
			background: rgba(0,0,0,0.3);
			border: 1px solid var(--border);
			border-radius: 0.6rem;
			padding: 0.65rem;
			color: var(--text-primary);
			font-family: 'JetBrains Mono', monospace;
			font-size: 0.72rem;
			resize: vertical;
			margin-bottom: 0.75rem;
			outline: none;
			transition: border-color 0.2s;
		}

		textarea:focus { border-color: var(--accent); }
		textarea::placeholder { color: var(--text-muted); }

		/* Loading spinner */
		.spinner {
			display: inline-block;
			width: 14px;
			height: 14px;
			border: 2px solid rgba(255,255,255,0.2);
			border-top-color: var(--accent);
			border-radius: 50%;
			animation: spin 0.8s linear infinite;
		}
		@keyframes spin { to { transform: rotate(360deg); } }

		/* Toast */
		.toast {
			position: fixed;
			bottom: 1.5rem;
			left: 50%;
			transform: translateX(-50%) translateY(100px);
			background: var(--bg-card);
			border: 1px solid var(--border);
			border-radius: 0.65rem;
			padding: 0.6rem 1.25rem;
			font-size: 0.78rem;
			backdrop-filter: blur(20px);
			transition: transform 0.3s ease;
			z-index: 100;
			white-space: nowrap;
		}
		.toast.show { transform: translateX(-50%) translateY(0); }

		/* Refresh indicator bar */
		.refresh-bar {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.5rem 0.75rem;
			background: rgba(255,255,255,0.015);
			border-radius: 0.5rem;
			margin-top: 0.75rem;
			font-size: 0.7rem;
			color: var(--text-muted);
		}

		.refresh-bar button {
			background: none;
			border: none;
			color: var(--accent);
			font-size: 0.7rem;
			cursor: pointer;
			font-family: 'Inter', sans-serif;
			font-weight: 500;
		}
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
			<a href="/auth/start" class="btn btn-primary" id="signin-btn">🔑 Sign in ChatGPT</a>
			<button class="btn btn-secondary" onclick="toggleSeed()" id="seed-toggle-btn">📋 Seed auth.json</button>
		</div>

		<div class="seed-section" id="seed-section" style="display: none;">
			<h3>Seed / Replace auth.json</h3>
			<p>Paste your <code>auth.json</code> contents below to bootstrap or update stored tokens.</p>
			<textarea id="seed-input" placeholder='{"auth_mode":"chatgpt","tokens":{...},"last_refresh":"..."}'></textarea>
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
				<button class="btn btn-primary" onclick="seedTokens()" id="seed-btn">Save to KV</button>
				<button class="btn btn-secondary" onclick="toggleSeed()">Cancel</button>
			</div>
			<div id="seed-result" style="margin-top: 0.5rem; font-size: 0.75rem;"></div>
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
				html += '<div class="info-item"><div class="info-label">Expires In</div><div class="info-value countdown" id="countdown">' + expiry + '</div></div>';
			}
			if (s.last_refresh) {
				const ago = timeAgo(new Date(s.last_refresh));
				html += '<div class="info-item"><div class="info-label">Last Refresh</div><div class="info-value">' + ago + '</div></div>';
			}
			if (s.account_id) {
				html += '<div class="info-item"><div class="info-label">Account ID</div><div class="info-value">' + escapeHtml(s.account_id.substring(0, 10)) + '…</div></div>';
			}
			html += '</div>';

			if (s.error) {
				html += '<div class="error-message">' + escapeHtml(s.error) + '</div>';
			}

			html += '<div class="refresh-bar">';
			html += '<span>Auto-refreshes 30s</span>';
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
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, shrink-to-fit=no, viewport-fit=cover">
	<title>Login — OpenAI Auth Proxy</title>
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
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
			font-family: 'Inter', sans-serif;
			background: #07070d;
			color: #f0f0f5;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 1rem;
			-webkit-text-size-adjust: 100%;
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
			border-radius: 1.25rem;
			padding: 2rem 1.5rem;
			width: 100%;
			max-width: 360px;
			text-align: center;
			backdrop-filter: blur(20px);
			position: relative;
			z-index: 1;
		}
		.logo {
			font-size: 0.65rem;
			font-weight: 700;
			letter-spacing: 0.12em;
			text-transform: uppercase;
			color: #818cf8;
			margin-bottom: 1rem;
		}
		h1 { font-size: 1.2rem; font-weight: 800; margin-bottom: 0.3rem; }
		p { color: #8b8b9e; font-size: 0.78rem; margin-bottom: 1.5rem; }
		input {
			width: 100%;
			padding: 0.75rem 0.85rem;
			background: rgba(0,0,0,0.3);
			border: 1px solid rgba(255,255,255,0.08);
			border-radius: 0.65rem;
			color: #f0f0f5;
			font-family: 'Inter', sans-serif;
			font-size: 0.85rem;
			outline: none;
			transition: border-color 0.2s;
			margin-bottom: 0.85rem;
		}
		input:focus { border-color: #818cf8; }
		input::placeholder { color: #55556a; }
		button {
			width: 100%;
			padding: 0.75rem;
			background: linear-gradient(135deg, #818cf8, #a78bfa);
			border: none;
			border-radius: 0.65rem;
			color: #fff;
			font-family: 'Inter', sans-serif;
			font-size: 0.85rem;
			font-weight: 600;
			cursor: pointer;
			transition: all 0.2s;
		}
		button:active { transform: scale(0.98); }
		.error { color: #f87171; font-size: 0.75rem; margin-top: 0.65rem; display: none; }
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
