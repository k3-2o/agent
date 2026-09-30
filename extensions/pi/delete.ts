import { unlinkSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
	pi.registerCommand("delete", {
		description: "Delete the current session and start a new one immediately",
		handler: async (_args, ctx) => {
			const hasMessages = ctx.sessionManager
				.getEntries()
				.some((entry) => entry.type === "message");
			if (!hasMessages) return;

			const doomed = ctx.sessionManager.getSessionFile();

			const { cancelled } = await ctx.newSession({
				withSession: async (fresh) => {
					if (!doomed) return;
					try {
						unlinkSync(doomed);
						fresh.ui.notify("Old session deleted. Fresh session started.", "info");
					} catch (err) {
						fresh.ui.notify(
							`New session started, but the old file could not be deleted: ${
								err instanceof Error ? err.message : String(err)
							}`,
							"warning",
						);
					}
				},
			});

			return cancelled ? "Cancelled." : undefined;
		},
	});
}
