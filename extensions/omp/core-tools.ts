// core-tools: disable read/write/edit via ~/.omp/agent/core-tools.yml and
// <cwd>/.omp/core-tools.yml (project overrides global per key).
// /core-tools opens a settings-style toggle overlay; toggles persist to
// core-tools.yml (project file if one exists, else global) and apply to the
// live session immediately.
// Internally removes the xd:// deferrable riders (ast_edit, debug) whenever
// read or write is disabled — they structurally require read/write as
// transport and would otherwise re-inject them (session-tools transportNeeded).
// Trust model: a project's own .omp/core-tools.yml can re-enable tools the
// global file disabled — omp's standard project-beats-user layering.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Container, type SettingItem, SettingsList } from "@oh-my-pi/pi-tui";
import { getSettingsListTheme } from "@oh-my-pi/pi-coding-agent";

const VALID = ["read", "write", "edit"] as const;
type Core = (typeof VALID)[number];

function parseCoreTools(text: string, origin: string): Partial<Record<Core, boolean>> {
	const out: Partial<Record<Core, boolean>> = {};
	for (const [i, raw] of text.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const m = /^([A-Za-z_]+)\s*:\s*(true|false)\s*(#.*)?$/.exec(line);
		if (!m) {
			throw new Error(
				`expected '<key>: true|false', got '${line}' — ${origin}:${i + 1}. Valid keys: ${VALID.join(", ")}`,
			);
		}
		const [, key, value] = m;
		if (!(VALID as readonly string[]).includes(key)) {
			throw new Error(
				`unknown key '${key}'. Valid keys: ${VALID.join(", ")} — ${origin}:${i + 1}. ` +
					`Other tools have native toggles (e.g. bash.enabled in config.yml; eval.py/eval.js; task.maxRecursionDepth).`,
			);
		}
		out[key as Core] = value === "true";
	}
	return out;
}

function globalAgentDir(): string {
	// Mirrors pi-utils getAgentDir(): a named profile exports PI_CODING_AGENT_DIR
	// (cli bootstrap calls setProfile before extension load); default mode derives
	// the dir from PI_CONFIG_DIR (a *name* relative to home, not a path) + HOME.
	if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
	if (!process.env.HOME) {
		throw new Error("core-tools: HOME is unset and PI_CODING_AGENT_DIR is not set — cannot locate the global agent dir");
	}
	return join(process.env.HOME, process.env.PI_CONFIG_DIR ?? ".omp", "agent");
}

function shortHome(p: string): string {
	return process.env.HOME && p.startsWith(process.env.HOME) ? `~${p.slice(process.env.HOME.length)}` : p;
}

function configPaths(): Array<{ label: string; path: string }> {
	const agentDir = globalAgentDir();
	return [
		{ label: shortHome(join(agentDir, "core-tools.yml")), path: join(agentDir, "core-tools.yml") },
		// cwd-only, mirrors omp's own project config resolution (getProjectAgentDir)
		{ label: join(".omp", "core-tools.yml"), path: join(process.cwd(), ".omp", "core-tools.yml") },
	];
}

function loadConfig(): Partial<Record<Core, boolean>> {
	const merged: Partial<Record<Core, boolean>> = {};
	// Origins double as display labels: essentials-first wording keeps the
	// actionable text inside omp's 100-char stderr truncation, with the
	// provenance tail (— <label>:<line>) absorbing any clip.
	for (const { label, path } of configPaths()) {
		if (!existsSync(path)) continue;
		Object.assign(merged, parseCoreTools(readFileSync(path, "utf8"), label));
	}
	return merged;
}

/** Toggles write to the project file when one exists (it wins at load), else global. */
function writeTargetPath(): string {
	for (const { path } of [...configPaths()].reverse()) {
		if (existsSync(path)) return path;
	}
	return configPaths()[0]!.path;
}

/** Flip VALID keys in place, preserving indentation/comments; append missing ones. */
function persistConfig(cfg: Readonly<Record<Core, boolean>>): string {
	const target = writeTargetPath();
	let text = existsSync(target) ? readFileSync(target, "utf8") : "";
	const missing: string[] = [];
	for (const key of VALID) {
		const re = new RegExp(`^([ \\t]*)${key}[ \\t]*:[ \\t]*(true|false)([^\\n]*)$`, "m");
		if (re.test(text)) {
			text = text.replace(re, (_m, indent: string, _old: string, tail: string) => `${indent}${key}: ${cfg[key]}${tail}`);
		} else {
			missing.push(key);
		}
	}
	if (missing.length > 0) {
		if (text.trim() !== "" && !text.endsWith("\n")) text += "\n";
		text += "\n# core-tools — read/write/edit toggles (/core-tools writes these)\n";
		for (const key of missing) text += `${key}: ${cfg[key]}\n`;
	}
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, text);
	return target;
}

interface UiComponent {
	render(width: number): readonly string[];
	invalidate?(): void;
	handleInput?(data: string): void;
}

interface CommandCtx {
	hasUI: boolean;
	ui: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
		custom<T>(
			factory: (
				tui: { requestRender(): void },
				theme: { fg(token: string, text: string): string; bold(text: string): string },
				keybindings: unknown,
				done: (result: T) => void,
			) => UiComponent | Promise<UiComponent>,
		): Promise<T>;
	};
}

export default function (pi: {
	getActiveTools: () => string[];
	setActiveTools: (names: string[]) => Promise<void>;
	getAllTools: () => Array<{ name: string }>;
	on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) => void;
	registerCommand: (
		name: string,
		options: { description?: string; handler: (args: string, ctx: CommandCtx) => Promise<void> | void },
	) => void;
}): void {
	// throws on malformed config at extension load (fail-open: omp prints the error, session runs with stock tools)
	let cfg = loadConfig() as Record<Core, boolean>;

	function computeDisabled(c: Readonly<Partial<Record<Core, boolean>>>): Set<string> {
		const d = new Set<string>(VALID.filter(k => c[k] === false));
		// Cascade: read/write transport hosts — deferrable riders re-inject them otherwise.
		if (d.has("read") || d.has("write")) {
			d.add("ast_edit");
			d.add("debug");
		}
		return d;
	}
	let disabled = computeDisabled(cfg);
	// Tools removed by us, eligible for re-add when their disable reason goes away.
	let weDisabled = new Set<string>();

	async function applyLive(): Promise<void> {
		const active = new Set(pi.getActiveTools());
		const universe = new Set(pi.getAllTools().map(t => t.name));
		for (const name of disabled) {
			if (active.delete(name)) weDisabled.add(name);
		}
		for (const name of weDisabled) {
			if (!disabled.has(name) && universe.has(name)) active.add(name);
		}
		weDisabled = new Set([...weDisabled].filter(name => disabled.has(name)));
		await pi.setActiveTools([...active]);
	}

	const reapply = () => void applyLive();
	pi.on("session_start", reapply);
	pi.on("session_tree", reapply);
	pi.on("session_branch", reapply);

	pi.registerCommand("core-tools", {
		description: "Toggle read/write/edit tools (persists to core-tools.yml)",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("core-tools: interactive toggle needs TUI mode — edit core-tools.yml directly", "warning");
				return;
			}
			const target = writeTargetPath();
			await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
				const items: SettingItem[] = VALID.map(key => ({
					id: key,
					label: key,
					description:
						key === "read" || key === "write" ? "transport host — disabling also drops ast_edit and debug" : undefined,
					currentValue: cfg[key] === false ? "disabled" : "enabled",
					values: ["enabled", "disabled"],
					changed: cfg[key] === false,
				}));
				const header = [theme.fg("accent", theme.bold("core tools")), `persisted to ${shortHome(target)}`, ""];
				const headerComponent = new (class {
					render(_width: number): readonly string[] {
						return header;
					}
					invalidate() {}
				})();
				const container = new Container();
				container.addChild(headerComponent);
				const list = new SettingsList(
					items,
					Math.min(items.length + 2, 15),
					getSettingsListTheme(),
					(id, newValue) => {
						const key = id as Core;
						cfg[key] = newValue === "enabled";
						disabled = computeDisabled(cfg);
						void persistConfig(cfg);
						void applyLive();
					},
					() => done(undefined),
				);
				container.addChild(list);
				return {
					render(width: number): readonly string[] {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						list.handleInput?.(data);
						tui.requestRender();
					},
				};
			});
		},
	});
}
