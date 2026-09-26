// --- save-session: write the current in-memory session to the sessions dir. ---
// Rescues a session running with --no-session (ephemeral, "File: In-memory"):
// reads the live entries from ctx.sessionManager and writes a proper pi session
// file so /resume can find and reload this conversation after pi exits.

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	SessionManager,
	CURRENT_SESSION_VERSION,
	type SessionEntry,
	type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

/** Same dir encoding pi uses: working dir with "/" replaced by "-", wrapped in "--". */
function encodeCwdDir(cwd: string): string {
	return "--" + cwd.split("/").filter(Boolean).join("-") + "--";
}

/** Guard against persisting a non-terminal stopReason ("pending" is streaming-only). */
function finalizeEntry(entry: SessionEntry): SessionEntry {
	if (entry.type !== "message") return entry;
	const msg = (entry as SessionMessageEntry).message as SessionMessageEntry["message"] & {
		stopReason?: unknown;
	};
	if (msg?.role === "assistant" && msg.stopReason === "pending") {
		return { ...entry, message: { ...msg, stopReason: "stop" } } as SessionEntry;
	}
	return entry;
}

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("save-session", {
		description:
			"Write the current in-memory session to ~/.pi/agent/sessions so /resume can find it (rescues ephemeral sessions)",
		handler: async (_args, ctx) => {
			const sm = ctx.sessionManager;
			const entries = sm.getEntries();
			const sessionId = sm.getSessionId();
			const cwd = sm.getCwd() ?? ctx.cwd;

			// Already persisted live (pi is appending to a file)? Nothing to snapshot.
			const liveFile = sm.getSessionFile();
			if (liveFile) {
				const msg = `Session is already persisted live at ${liveFile}\u2014no snapshot needed.`;
				ctx.ui.notify(msg, "info");
				return msg;
			}

			const dir = join(homedir(), ".pi", "agent", "sessions", encodeCwdDir(cwd));
			mkdirSync(dir, { recursive: true });

			// One snapshot per session id: remove any older file for this conversation first.
			for (const existing of readdirSync(dir)) {
				if (existing.endsWith(`_${sessionId}.jsonl`)) {
					try {
						unlinkSync(join(dir, existing));
					} catch {
						/* best effort */
					}
				}
			}

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const file = join(dir, `${timestamp}_${sessionId}.jsonl`);

			// header: use pi's own header when available, else build one matching the format
			let header: Record<string, unknown>;
			try {
				const anySm = sm as unknown as { getHeader?: () => Record<string, unknown> | undefined };
				header = anySm.getHeader?.() ?? {
					type: "session",
					cwd,
					id: sessionId,
					timestamp: new Date().toISOString(),
					version: CURRENT_SESSION_VERSION,
				};
			} catch {
				header = {
					type: "session",
					cwd,
					id: sessionId,
					timestamp: new Date().toISOString(),
					version: CURRENT_SESSION_VERSION,
				};
			}

			const lines = [
				JSON.stringify(header),
				...entries.map((entry) => JSON.stringify(finalizeEntry(entry))),
			];
			writeFileSync(file, lines.join("\n") + "\n", "utf8");

			// verify /resume can discover it
			let discovered = false;
			let listed: Array<{ id?: string; sessionFile?: string }> = [];
			try {
				listed = (await SessionManager.list(cwd)) as Array<{ id?: string; sessionFile?: string }>;
				discovered = listed.some((s) => s.sessionFile === file || s.id === sessionId);
			} catch {
				/* list failure is not fatal; report the file path regardless */
			}

			const message = `Saved ${entries.length} entries to ${file}` +
				(discovered ? " \u2713 listed in /resume" : " (not listed \u2014 check format)") +
				(listed.length ? ` \u00b7 ${listed.length} session(s) total` : "");
			ctx.ui.notify(message, "info");
			return message;
		},
	});
}
