/**
 * Clipboard Tool — Copies text to the user's system clipboard.
 *
 * Backends (tried in order):
 *   1. xclip        — Linux X11 clipboard
 *   2. pbcopy       — macOS clipboard
 *   3. OSC 52       — Universal fallback (SSH, tmux, zellij, any modern terminal)
 *
 * Security: Only copies TO clipboard. No paste/read-from-clipboard mode.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync, spawn } from "node:child_process";

/**
 * Check whether a CLI tool is available on the system PATH.
 */
function isAvailable(name: string): boolean {
	try {
		execSync(`which ${name}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Pipe text to a process's stdin and wait for it to complete.
 */
function pipeToProcess(cmd: string, args: string[], input: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
		let spawnError: Error | undefined;

		child.on("error", (err) => {
			spawnError = err;
		});
		child.stdin.on("error", (err) => {
			spawnError = err;
		});

		child.on("close", (code) => {
			if (spawnError) {
				reject(spawnError);
			} else if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${cmd} exited with code ${code}`));
			}
		});

		// Handle backpressure for large inputs
		const canWrite = child.stdin.write(input, "utf-8");
		if (!canWrite) {
			child.stdin.once("drain", () => child.stdin.end());
		} else {
			child.stdin.end();
		}
	});
}

export function createClipboardCopyTool() {
	return {
		name: "clipboard_copy",
		label: "Copy to Clipboard",
		description: "Copy text to the user's system clipboard.",
		promptSnippet: "Copy text to the user's system clipboard",
		parameters: Type.Object({
			text: Type.String({ description: "The text to copy to the clipboard" }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const text = params.text;

			// --- 1. xclip (Linux) ---
			if (isAvailable("xclip")) {
				try {
					await pipeToProcess("xclip", ["-selection", "clipboard", "-i"], text);
					return {
						content: [{ type: "text", text: "Copied to clipboard (via xclip)" }],
					};
				} catch {
					// Fall through to next backend
				}
			}

			// --- 2. pbcopy (macOS) ---
			if (isAvailable("pbcopy")) {
				try {
					await pipeToProcess("pbcopy", [], text);
					return {
						content: [{ type: "text", text: "Copied to clipboard (via pbcopy)" }],
					};
				} catch {
					// Fall through to next backend
				}
			}

			// --- 3. OSC 52 (universal terminal fallback) ---
			try {
				const b64 = Buffer.from(text, "utf-8").toString("base64");
				process.stdout.write(`\x1b]52;c;${b64}\x1b\\`);
				return {
					content: [{ type: "text", text: "Copied to clipboard (via OSC 52)" }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text:
								`Failed to copy to clipboard: ${message}. ` +
								"No clipboard backend available. Install xclip (Linux: apt install xclip, pacman -S xclip) " +
								"or use a terminal emulator that supports OSC 52.",
						},
					],
				};
			}
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(createClipboardCopyTool());
}
