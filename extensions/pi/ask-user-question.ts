/**
 * AskUserQuestion — Pause agent execution and interview the user.
 *
 * When the LLM encounters ambiguity, multiple valid architectural paths,
 * or needs explicit user permission/preference, it calls this tool.
 * The tool renders an interactive multiple-choice menu in the terminal
 * with arrow-key navigation. An "Other" / "Type custom instruction..."
 * escape hatch is always appended so the user can type their own response.
 *
 * Once the user makes a selection (or types a custom response), the tool
 * packages the answer, returns it to the LLM's context window, and lifts
 * the execution pause so coding can resume.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ── Types ────────────────────────────────────────────────────────────────

const AskOptionSchema = Type.Object({
	label: Type.String({ description: "Display label for this option" }),
	description: Type.Optional(
		Type.String({
			description:
				"Brief explanation of the trade-offs for this choice. " +
				"Shown below the label to help the user understand implications. " +
				"Plain prose only — never use double-quote characters; " +
				"rephrase or use single quotes instead.",
		}),
	),
	value: Type.Optional(
		Type.String({
			description:
				"Value returned if selected (defaults to label). " +
				"Use short machine-readable values like 'option_a' when possible.",
		}),
	),
});

const AskUserQuestionParams = Type.Object({
	question: Type.String({
		description:
			"The question to ask. Be specific — the user should understand " +
			"exactly what decision they're making. Plain prose only — " +
			"never use double-quote characters; rephrase or use single quotes instead.",
	}),
	heading: Type.Optional(
		Type.String({
			description:
				"Optional heading displayed above the question for extra context, " +
				"e.g. 'Architecture Decision' or 'Permission Required'.",
		}),
	),
	options: Type.Array(AskOptionSchema, {
		description:
			"The options the user can choose from. A 'Type custom instruction...' " +
			"option is always auto-appended.",
	}),
});

interface AskOption {
	label: string;
	description?: string;
	value: string;
}

interface AskUserQuestionResult {
	question: string;
	heading?: string;
	options: { label: string; description?: string; value: string }[];
	answer: string | null;
	wasCustom: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────

const OTHER_VALUE = "__ask_other__";
const OTHER_LABEL = "Type custom instruction...";
const CANCELLED_BEFORE_DISPLAY_TEXT =
	"Question cancelled before displaying. Do not proceed " +
	"with assumptions — wait for the user's next instruction.";

// ── Gate — serializes concurrent questions ──────────────────────────
let isQuestionActive = false;
const questionQueue: Array<() => void> = [];

/**
 * Acquire the question slot. If another question is active, the caller
 * is queued and awaits its turn.  Returns immediately if the slot is free.
 * Throws AbortError if `signal` fires before the slot is acquired.
 */
function acquireSlot(signal?: AbortSignal): Promise<void> {
	if (!isQuestionActive) {
		isQuestionActive = true;
		return Promise.resolve();
	}

	return new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			const idx = questionQueue.indexOf(proceed);
			if (idx !== -1) questionQueue.splice(idx, 1);
			reject(new DOMException("Aborted", "AbortError"));
		};

		const proceed = (err?: unknown) => {
			signal?.removeEventListener("abort", onAbort);
			if (err) {
				reject(err);
			} else {
				isQuestionActive = true;
				resolve();
			}
		};

		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}

		signal?.addEventListener("abort", onAbort, { once: true });
		questionQueue.push(proceed);
	});
}

function releaseSlot(): void {
	isQuestionActive = false;
	const next = questionQueue.shift();
	if (next) next();
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Word-wrap text at `maxWidth`, breaking at word boundaries. */
function wordWrap(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [text];
	const lines: string[] = [];
	let remaining = text;
	while (remaining.length > 0) {
		if (remaining.length <= maxWidth) {
			lines.push(remaining);
			break;
		}
		// Try to break at a word boundary within maxWidth
		let cut = maxWidth;
		const spaceIdx = remaining.lastIndexOf(" ", maxWidth);
		if (spaceIdx > 0) {
			cut = spaceIdx;
		}
		lines.push(remaining.slice(0, cut).trimEnd());
		remaining = remaining.slice(cut).trimStart();
	}
	return lines;
}

/**
 * Trim JSON-fragment garbage left behind when a model emits unescaped
 * quotes in a tool-call string and a lenient parser absorbs the rest of
 * the raw JSON into the same field (e.g. `...off."}, {"label": "Save...`).
 */
function sanitizeText(text: string): string {
	const m = /\}\s*,\s*\{\s*"(?:label|description|value)"\s*:/.exec(text);
	if (!m) return text;
	return text.slice(0, m.index).replace(/[\s"',:;]+$/, "");
}

function normalizeOptions(raw: { label: string; description?: string; value?: string }[]): AskOption[] {
	const seen = new Set<string>();
	return raw.map((o, i) => {
		const label = sanitizeText(o.label?.trim() ?? "");
		if (!label) {
			throw new Error(`Option at index ${i} must have a non-empty label`);
		}
		const value = o.value ?? label;
		if (seen.has(value)) {
			throw new Error(`Duplicate option value "${value}" at index ${i}`);
		}
		seen.add(value);
		return {
			label,
			description: o.description ? sanitizeText(o.description) : undefined,
			value,
		};
	});
}

// ── Tool definition ──────────────────────────────────────────────────────
// One object, shared by both doors: the classic extension registration
// (default export) and the pi-bridge manifest (factory export).

const definition = {
	name: "AskUserQuestion",
	label: "Ask User Question",
	description:
		"Pause execution and ask the user a multiple-choice question. " +
		"A 'Type custom instruction...' option is always available so the " +
		"user can provide a free-form response.",
	parameters: AskUserQuestionParams,

	promptSnippet:
		"Ask the user one or more multiple-choice questions (queued one at a time; pauses execution until user responds)",

	promptGuidelines: [
		"Use AskUserQuestion when facing ambiguity, multiple valid paths, or when explicit user permission/preference is needed before writing code.",
		"Each option should include a description explaining the trade-offs so the user understands the implications of their choice.",
		"Prefer AskUserQuestion over making assumptions. When in doubt, ask.",
		"You can issue multiple AskUserQuestion calls at once — they are queued and presented one at a time, so feel free to gather several decisions in parallel.",
	],

	// ── Compatibility shim — accept Claude Code-shaped calls ────────
	//
	// Models trained on Claude Code's AskUserQuestion emit:
	//   { questions: [{ question, header, multiSelect, options: [{ label, description }] }] }
	// Fold that into this tool's flat shape before schema validation.
	// `multiSelect` is silently ignored (single-select only).
	prepareArguments(args) {
		if (!args || typeof args !== "object") return args;
		const a = args as Record<string, unknown>;

		// `questions` array wrapper → flat single question
		if (
			a.question === undefined &&
			Array.isArray(a.questions) &&
			a.questions.length > 0
		) {
			const q = a.questions[0] as Record<string, unknown> | undefined;
			if (q && typeof q === "object") {
				const rawOptions = Array.isArray(q.options) ? q.options : [];
				return {
					question: q.question,
					heading: (q.header as string | undefined) ?? a.heading,
					options: rawOptions.map((o) => {
						const opt = (o ?? {}) as Record<string, unknown>;
						return {
							label: opt.label as string,
							description: opt.description as string | undefined,
							value: (opt.value as string | undefined) ?? (opt.label as string),
						};
					}),
				};
			}
		}

		// Claude's `header` spelling → `heading`
		if (a.header !== undefined && a.heading === undefined) {
			return { ...a, heading: a.header };
		}

		return args;
	},

	// ── Execute ─────────────────────────────────────────────────────

	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		// Pre-compute the options summary once, reused in all return paths
		const optionsSummary = params.options.map((o) => ({
			label: o.label,
			description: o.description,
			value: o.value ?? o.label,
		}));

		if (!ctx.hasUI) {
			return {
				content: [
					{
						type: "text",
						text: "Error: UI not available (running in non-interactive mode)",
					},
				],
				details: {
					question: params.question,
					heading: params.heading,
					options: optionsSummary,
					answer: null,
					wasCustom: false,
				} satisfies AskUserQuestionResult,
			};
		}

		if (params.options.length === 0) {
			return {
				content: [{ type: "text", text: "Error: No options provided" }],
				details: {
					question: params.question,
					heading: params.heading,
					options: [],
					answer: null,
					wasCustom: false,
				} satisfies AskUserQuestionResult,
			};
		}

		// Respect agent-level cancellation before blocking on the UI
		if (signal?.aborted) {
			return {
				content: [
					{
						type: "text",
						text: CANCELLED_BEFORE_DISPLAY_TEXT,
					},
				],
				details: {
					question: params.question,
					heading: params.heading,
					options: optionsSummary,
					answer: null,
					wasCustom: false,
				} satisfies AskUserQuestionResult,
			};
		}

		const userOptions = normalizeOptions(params.options);
		const allOptions: AskOption[] = [
			...userOptions,
			{ label: OTHER_LABEL, value: OTHER_VALUE },
		];

		// ── Acquire gate slot (queues if another question is active) ──

		try {
			await acquireSlot(signal);
		} catch {
			return {
				content: [
					{
						type: "text",
						text: CANCELLED_BEFORE_DISPLAY_TEXT,
					},
				],
				details: {
					question: params.question,
					heading: params.heading,
					options: optionsSummary,
					answer: null,
					wasCustom: false,
				} satisfies AskUserQuestionResult,
			};
		}

		try {
			// ── Interactive UI ──────────────────────────────────────────

			const result = await ctx.ui.custom<{
				answer: string;
				wasCustom: boolean;
				label: string;
			} | null>((tui, theme, _kb, done) => {
				// State
				let mode: "options" | "editor" = "options";
				let optionIndex = 0;
				let cachedLines: string[] | undefined;

				// Editor for free-form input
				const editorTheme: EditorTheme = {
					borderColor: (s: string) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t: string) => theme.fg("accent", t),
						selectedText: (t: string) => theme.fg("accent", t),
						description: (t: string) => theme.fg("muted", t),
						scrollInfo: (t: string) => theme.fg("dim", t),
						noMatch: (t: string) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, editorTheme);

				editor.onSubmit = (value: string) => {
					const trimmed = value.trim();
					if (trimmed) {
						done({ answer: trimmed, wasCustom: true, label: trimmed });
					} else {
						mode = "options";
						editor.setText("");
						refresh();
					}
				};

				function refresh() {
					cachedLines = undefined;
					tui.requestRender();
				}

				// ── Input ────────────────────────────────────────────────

				function handleInput(data: string): void {
					if (mode === "editor") {
						if (matchesKey(data, Key.escape)) {
							mode = "options";
							editor.setText("");
							refresh();
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					// Option navigation
					if (matchesKey(data, Key.up)) {
						optionIndex = Math.max(0, optionIndex - 1);
						refresh();
						return;
					}
					if (matchesKey(data, Key.down)) {
						optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
						refresh();
						return;
					}

					// Select
					if (matchesKey(data, Key.enter)) {
						const selected = allOptions[optionIndex]!;
						if (selected.value === OTHER_VALUE) {
							mode = "editor";
							editor.setText("");
							refresh();
						} else {
							done({
								answer: selected.value,
								wasCustom: false,
								label: selected.label,
							});
						}
						return;
					}

					// Cancel
					if (matchesKey(data, Key.escape)) {
						done(null);
					}
				}

				// ── Render ───────────────────────────────────────────────

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;

					const lines: string[] = [];
					const add = (s: string) => lines.push(truncateToWidth(s, width));

					// Top border
					add(theme.fg("accent", theme.bold("\u2500".repeat(width))));

					// Heading (optional)
					if (params.heading) {
						add(theme.fg("accent", theme.bold(`  ${params.heading}`)));
						lines.push("");
					}

					// Question
					add(theme.fg("text", `  ${params.question}`));
					lines.push("");

					if (mode === "editor") {
						// Editor mode — free-form text input
						add(theme.fg("muted", "  Type your custom instruction:"));
						lines.push("");
						for (const line of editor.render(width - 2)) {
							add(` ${line}`);
						}
						lines.push("");
						add(theme.fg("dim", "  Enter to submit  \u2022  Esc to go back"));
					} else {
						// Options mode — arrow-key selection
						for (let i = 0; i < allOptions.length; i++) {
							const opt = allOptions[i]!;
							const selected = i === optionIndex;
							const isOther = opt.value === OTHER_VALUE;

							// Build the line prefix and content
							const pointer = selected
								? theme.fg("accent", " \u25b6 ")
								: "   ";

							let content: string;
							if (isOther) {
								// The "Type custom instruction..." escape hatch
								content = selected
									? theme.fg("accent", `\u270e ${opt.label}`)
									: theme.fg("muted", opt.label);
							} else if (selected) {
								content = theme.fg("accent", theme.bold(`${i + 1}. ${opt.label}`));
							} else {
								content = theme.fg("text", `${i + 1}. ${opt.label}`);
							}

							add(`${pointer}${content}`);

							// Description below each option (word-wrapped)
							if (opt.description) {
								const descWidth = Math.max(20, width - 6);
								const wrapped = wordWrap(opt.description, descWidth);
								for (const line of wrapped) {
									const colored = selected
										? theme.fg("muted", line)
										: theme.fg("dim", line);
									add(`      ${colored}`);
								}
							}
						}
					}

					lines.push("");
					add(theme.fg("dim", "  \u2191\u2193 navigate  \u2022  Enter select  \u2022  Esc cancel"));
					add(theme.fg("accent", theme.bold("\u2500".repeat(width))));

					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			// ── Build return value ──────────────────────────────────────

			if (!result) {
				return {
					content: [
						{
							type: "text",
							text:
								"User cancelled the question. Do not proceed with " +
								"assumptions — either ask again or wait for the user " +
								"to provide their own instruction.",
						},
					],
					details: {
						question: params.question,
						heading: params.heading,
						options: optionsSummary,
						answer: null,
						wasCustom: false,
					} satisfies AskUserQuestionResult,
				};
			}

			if (result.wasCustom) {
				return {
					content: [
						{
							type: "text",
							text:
								`User's custom instruction: "${result.answer}"\n\n` +
								"Resume execution following the user's exact instructions above.",
						},
					],
					details: {
						question: params.question,
						heading: params.heading,
						options: optionsSummary,
						answer: result.answer,
						wasCustom: true,
					} satisfies AskUserQuestionResult,
				};
			}

			const chosen = userOptions.find((o) => o.value === result.answer);
			const chosenLabel = chosen?.label ?? result.answer;

			return {
				content: [
					{
						type: "text",
						text:
							`User selected: "${chosenLabel}"\n\n` +
							"Resume execution respecting the user's choice above.",
					},
				],
				details: {
					question: params.question,
					heading: params.heading,
					options: optionsSummary,
					answer: result.answer,
					wasCustom: false,
				} satisfies AskUserQuestionResult,
			};
		} finally {
			releaseSlot();
		}
	},

	// ── Render Call (TUI display when tool is invoked) ──────────────

	renderCall(args, theme, _context) {
		const q = (args as { question: string; heading?: string }).question || "";
		const heading = (args as { heading?: string }).heading;
		let text = theme.fg("toolTitle", theme.bold("AskUserQuestion "));
		if (heading) {
			text += theme.fg("muted", `[${heading}] `);
		}
		text += theme.fg("text", q);
		return new Text(text, 0, 0);
	},

	// ── Render Result (TUI display after tool completes) ────────────

	renderResult(result, _options, theme, _context) {
		const details = result.details as AskUserQuestionResult | undefined;
		if (!details || details.answer === null) {
			return new Text(theme.fg("warning", "\u2717 Cancelled"), 0, 0);
		}

		if (details.wasCustom) {
			return new Text(
				theme.fg("success", "\u2713 ") +
					theme.fg("muted", "(custom) ") +
					theme.fg("text", details.answer),
				0,
				0,
			);
		}

		const chosen = details.options.find((o) => o.value === details.answer);
		const display = chosen ? `"${chosen.label}"` : details.answer;
		return new Text(theme.fg("success", "\u2713 ") + theme.fg("text", display), 0, 0);
	},
};

/** pi-bridge manifest factory — mounts the same definition the extension registers. */
export function createAskUserQuestionDefinition() {
	return definition;
}

// ── Extension ────────────────────────────────────────────────────────────

export default function askUserQuestion(pi: ExtensionAPI) {
	pi.registerTool(createAskUserQuestionDefinition());

	// ── Drain queue on session shutdown ────────────────────────────────

	pi.on("session_shutdown", () => {
		const rest = questionQueue.splice(0);
		for (const fn of rest) {
			fn(new DOMException("Session closed", "AbortError"));
		}
		isQuestionActive = false;
	});
}
