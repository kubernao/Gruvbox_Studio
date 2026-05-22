import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { defineTool } from "@mariozechner/pi-coding-agent";

/**
 * Gruvbox Studio: bridge tool that signals the Electron UI to open a file via
 * extension_ui_request (setWidget) — see Gruvbox pi-gui handler + AIAssistantTab.
 */
export default function gruvboxEditorBridgeExtension(pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "gruvbox_open_file",
			label: "Open in Gruvbox editor",
			description:
				"Open a file in Gruvbox Studio. Pass a path relative to the project root or an absolute path.",
			parameters: Type.Object({
				path: Type.String({ description: "File path to open in the editor" }),
			}),
			execute: async (_toolCallId, args, _signal, _onUpdate, ctx) => {
				const raw = String(args.path ?? "").trim();
				if (!raw) {
					return { content: [{ type: "text", text: "Missing path." }], isError: true };
				}
				ctx.ui.setWidget("gruvbox_open_file", [raw], { placement: "belowEditor" });
				return { content: [{ type: "text", text: `Editor open requested for: ${raw}` }] };
			},
		}),
	);
}
