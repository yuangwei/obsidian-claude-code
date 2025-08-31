import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	ItemView,
	Notice,
} from "obsidian";
import { ChildProcess, spawn } from "child_process";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
// Import xterm CSS
import "@xterm/xterm/css/xterm.css";

export const CLAUDE_CODE_VIEW_TYPE = "claude-code-terminal";

interface ClaudeCodeSettings {
	defaultCommand: string;
	panelPosition: "right" | "left" | "split-horizontal" | "split-vertical";
}

const DEFAULT_SETTINGS: ClaudeCodeSettings = {
	defaultCommand: "claude",
	panelPosition: "right",
};

export default class ClaudeCodePlugin extends Plugin {
	settings: ClaudeCodeSettings;

	async onload() {
		await this.loadSettings();

		// Register the terminal view
		this.registerView(
			CLAUDE_CODE_VIEW_TYPE,
			(leaf) => new ClaudeCodeTerminalView(leaf, this)
		);

		// Add ribbon icon
		this.addRibbonIcon("terminal", "Open Claude Code Terminal", () => {
			this.openClaudeCodeTerminal();
		});

		// Add command
		this.addCommand({
			id: "open-claude-code-terminal",
			name: "Open Claude Code Terminal",
			callback: () => this.openClaudeCodeTerminal(),
		});

		// Add settings tab
		this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async openClaudeCodeTerminal() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;

		// Find existing terminal view or create new one
		const existingLeaf = workspace.getLeavesOfType(
			CLAUDE_CODE_VIEW_TYPE
		)[0];
		if (existingLeaf) {
			leaf = existingLeaf;
		} else {
			// Create new leaf based on panel position setting
			switch (this.settings.panelPosition) {
				case "right":
					leaf = workspace.getRightLeaf(false);
					break;
				case "left":
					leaf = workspace.getLeftLeaf(false);
					break;
				case "split-horizontal":
					leaf = workspace.getLeaf("split", "horizontal");
					break;
				case "split-vertical":
					leaf = workspace.getLeaf("split", "vertical");
					break;
				default:
					leaf = workspace.getRightLeaf(false);
			}
			await leaf?.setViewState({
				type: CLAUDE_CODE_VIEW_TYPE,
				active: true,
			});
		}

		workspace.revealLeaf(leaf!);
	}
}

class ClaudeCodeTerminalView extends ItemView {
	plugin: ClaudeCodePlugin;
	terminal: Terminal;
	fitAddon: FitAddon;
	childProcess: ChildProcess | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
		super(leaf);
		this.plugin = plugin;
		this.terminal = new Terminal({
			theme: {
				background: "var(--background-primary)",
				foreground: "var(--text-normal)",
			},
			fontFamily: "var(--font-monospace)",
			fontSize: 14,
			cursorBlink: true,
		});
		this.fitAddon = new FitAddon();
		this.terminal.loadAddon(this.fitAddon);
	}

	getViewType() {
		return CLAUDE_CODE_VIEW_TYPE;
	}

	getDisplayText() {
		return "Claude Code Terminal";
	}

	getIcon() {
		return "terminal";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("claude-code-terminal-container");

		// Add restart button
		const header = this.containerEl.children[0];
		const restartBtn = header.createEl("button", {
			text: "↻",
			cls: "claude-code-restart-btn",
			attr: { "aria-label": "Restart Claude Code" },
		});
		restartBtn.addEventListener("click", () => {
			this.restartClaudeCode();
		});

		this.terminal.open(container as HTMLElement);
		this.fitAddon.fit();

		// Start Claude Code process
		this.startClaudeCode();

		// Handle terminal resize
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				setTimeout(() => this.fitAddon.fit(), 100);
			})
		);
	}

	async onClose() {
		if (this.childProcess) {
			this.childProcess.kill();
			this.childProcess = null;
		}
		this.terminal.dispose();
	}

	startClaudeCode() {
		try {
			const command = this.plugin.settings.defaultCommand;
			this.terminal.write(`Starting ${command}...\r\n`);

			// Use spawn with shell and proper stdio handling
			this.childProcess = spawn('/usr/local/bin/claude', [], {
				shell: false,
				stdio: ['pipe', 'pipe', 'pipe'],
				cwd: (this.app.vault.adapter as any).basePath || process.cwd(),
				env: { 
					...process.env, 
					TERM: "xterm-256color",
					PATH: process.env.PATH + ":/usr/local/bin:/opt/homebrew/bin",
					FORCE_COLOR: "1",
					COLUMNS: "80",
					LINES: "30"
				},
			});

			// Handle stdout data
			this.childProcess.stdout?.on('data', (data) => {
				this.terminal.write(data.toString());
			});

			// Handle stderr data
			this.childProcess.stderr?.on('data', (data) => {
				this.terminal.write(data.toString());
			});

			// Handle process exit
			this.childProcess.on('close', (code) => {
				this.terminal.write(
					`\r\n\r\n✓ Process exited with code ${code}\r\n`
				);
				this.terminal.write(`Click the terminal icon to restart.\r\n`);
				this.childProcess = null;
			});

			// Handle process error
			this.childProcess.on('error', (error) => {
				this.terminal.write(`\r\n✗ Error: ${error.message}\r\n`);
				this.terminal.write(
					`Make sure '${command}' is installed and accessible in your PATH.\r\n`
				);
				new Notice(
					`Failed to start ${command}. Check the terminal for details.`
				);
				this.childProcess = null;
			});

			// Handle terminal input
			this.terminal.onData((data: string) => {
				if (this.childProcess && this.childProcess.stdin) {
					this.childProcess.stdin.write(data);
				}
			});
		} catch (error) {
			this.terminal.write(`✗ Error starting Claude Code: ${error}\r\n`);
			new Notice(
				"Failed to start Claude Code. Make sure it's installed and accessible."
			);
		}
	}

	restartClaudeCode() {
		if (this.childProcess) {
			this.childProcess.kill();
			this.childProcess = null;
		}
		this.terminal.clear();
		this.startClaudeCode();
	}
}

class ClaudeCodeSettingTab extends PluginSettingTab {
	plugin: ClaudeCodePlugin;

	constructor(app: App, plugin: ClaudeCodePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Claude Code Settings" });

		new Setting(containerEl)
			.setName("Default Command")
			.setDesc(
				"The command to run when opening the terminal (default: claude)"
			)
			.addText((text) =>
				text
					.setPlaceholder("claude")
					.setValue(this.plugin.settings.defaultCommand)
					.onChange(async (value) => {
						this.plugin.settings.defaultCommand = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Panel Position")
			.setDesc("Where to open the Claude Code terminal")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("right", "Right Panel")
					.addOption("left", "Left Panel")
					.addOption("split-horizontal", "Split Horizontal")
					.addOption("split-vertical", "Split Vertical")
					.setValue(this.plugin.settings.panelPosition)
					.onChange(
						async (
							value:
								| "right"
								| "left"
								| "split-horizontal"
								| "split-vertical"
						) => {
							this.plugin.settings.panelPosition = value;
							await this.plugin.saveSettings();
						}
					)
			);
	}
}
