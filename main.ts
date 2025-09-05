import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, Notice } from 'obsidian';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface ClaudeCodeSettings {
	defaultCommand: string;
	windowPosition: 'right' | 'horizontal' | 'vertical';
	autoRunCommand: boolean;
}

const DEFAULT_SETTINGS: ClaudeCodeSettings = {
	defaultCommand: '',
	windowPosition: 'right',
	autoRunCommand: false
}

const TERMINAL_VIEW_TYPE = 'claude-code-terminal';

class TerminalView extends ItemView {
	plugin: ClaudeCodePlugin;
	terminal: Terminal;
	fitAddon: FitAddon;
	ptyProcess: any;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TERMINAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Claude Code Terminal';
	}

	getIcon(): string {
		return 'code-glyph';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('claude-code-terminal-container');

		this.terminal = new Terminal({
			cursorBlink: true,
			theme: this.getTheme(),
			fontSize: 14,
			fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
			cols: 80,
			rows: 24,
			scrollback: 1000,
			convertEol: true,
			disableStdin: false,
			screenReaderMode: false,
			allowProposedApi: true,
			macOptionIsMeta: true,
			rightClickSelectsWord: true
		});

		this.fitAddon = new FitAddon();
		this.terminal.loadAddon(this.fitAddon);

		this.terminal.open(container);
		this.fitAddon.fit();

		// Focus the terminal
		this.terminal.focus();
		
		// Remove any unwanted textarea elements that might appear
		setTimeout(() => {
			const textareas = container.querySelectorAll('textarea');
			textareas.forEach(textarea => {
				if (textarea.className !== 'xterm-helper-textarea') {
					textarea.remove();
				}
			});
		}, 100);

		await this.startPty();

		// Auto-fit terminal on resize with better handling
		let resizeTimeout: NodeJS.Timeout;
		const doResize = () => {
			if (this.fitAddon && this.terminal) {
				this.fitAddon.fit();
				// Force refresh of terminal dimensions
				setTimeout(() => {
					if (this.terminal) {
						this.terminal.refresh(0, this.terminal.rows - 1);
					}
				}, 10);
			}
		};

		this.registerInterval(window.setInterval(() => {
			doResize();
		}, 500)); // Less frequent but more thorough

		this.registerDomEvent(window, 'resize', () => {
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => {
				doResize();
			}, 100);
		});

		// Ensure terminal stays focused when clicked
		this.registerDomEvent(container, 'click', () => {
			this.terminal.focus();
		});

		// Handle paste events
		this.registerDomEvent(container, 'contextmenu', (e) => {
			e.preventDefault();
			navigator.clipboard.readText().then(text => {
				if (text && this.ptyProcess && this.ptyProcess.stdin && !this.ptyProcess.killed) {
					this.ptyProcess.stdin.write(text);
				}
			});
		});

		// Handle keyboard paste (Ctrl+V / Cmd+V)
		this.registerDomEvent(container, 'keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
				e.preventDefault();
				navigator.clipboard.readText().then(text => {
					if (text && this.ptyProcess && this.ptyProcess.stdin && !this.ptyProcess.killed) {
						this.ptyProcess.stdin.write(text);
					}
				});
			}
		});
	}

	private getTheme() {
		const isDark = document.body.hasClass('theme-dark');
		return {
			background: isDark ? '#1e1e1e' : '#ffffff',
			foreground: isDark ? '#cccccc' : '#333333',
			cursor: isDark ? '#cccccc' : '#333333',
			cursorAccent: isDark ? '#1e1e1e' : '#ffffff',
			selection: isDark ? '#ffffff40' : '#00000040'
		};
	}

	private async startPty(): Promise<void> {
		try {
			// Try to use node-pty first
			try {
				const pty = await import('node-pty');
				const os = await import('os');
				
				const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
				
				this.ptyProcess = pty.spawn(shell, [], {
					name: 'xterm-color',
					cols: this.terminal.cols,
					rows: this.terminal.rows,
					cwd: process.env.HOME || process.cwd(),
					env: process.env
				});

				this.ptyProcess.onData((data: string) => {
					this.terminal.write(data);
				});

				this.terminal.onData((data: string) => {
					this.ptyProcess.write(data);
				});

				this.terminal.onResize(({ cols, rows }) => {
					this.ptyProcess.resize(cols, rows);
				});

				setTimeout(() => {
					this.ptyProcess.write(`${this.plugin.settings.defaultCommand}\r`);
				}, 500);
			} catch (ptyError) {
				// Fallback to basic shell execution
				this.startBasicShell();
			}
		} catch (error) {
			console.error('Failed to start terminal:', error);
			new Notice('Failed to start terminal: ' + error.message);
			this.terminal.write('Failed to initialize terminal. Please check that dependencies are properly installed.\r\n');
		}
	}

	private startBasicShell(): void {
		// Simple command execution approach
		const os = require('os');
		
		// Initialize state
		this.currentCommand = '';
		this.commandHistory = [];
		this.historyIndex = -1;
		
		// Set working directory to home directory
		try {
			process.chdir(os.homedir());
		} catch (error) {
			console.error('Failed to change to home directory:', error);
		}
		
		// Clear any startup noise and show clean prompt
		setTimeout(() => {
			// Multiple clears to ensure all startup noise is gone
			this.terminal.clear();
			this.terminal.reset();
			setTimeout(() => {
				this.terminal.clear();
				this.showPrompt();
				
				// Auto-run command if enabled
				if (this.plugin.settings.autoRunCommand && this.plugin.settings.defaultCommand !== '') {
					setTimeout(() => {
						this.currentCommand = this.plugin.settings.defaultCommand;
						this.terminal.write(this.plugin.settings.defaultCommand);
						// Simulate enter key
						setTimeout(() => {
							this.handleInput('\r');
						}, 100);
					}, 500);
				}
			}, 50);
		}, 200);
		
		// Handle terminal input
		this.terminal.onData((data: string) => {
			this.handleInput(data);
		});
		
		// Handle terminal selection for copy
		this.terminal.onSelectionChange(() => {
			const selection = this.terminal.getSelection();
			if (selection) {
				navigator.clipboard.writeText(selection);
			}
		});
	}

	private currentCommand = '';
	private commandHistory: string[] = [];
	private historyIndex = -1;
	private promptShown = false;
	private processingInput = false;

	private showPrompt(): void {
		const os = require('os');
		const cwd = process.cwd();
		const home = os.homedir();
		const displayCwd = cwd.startsWith(home) ? cwd.replace(home, '~') : cwd;
		const username = os.userInfo().username;
		const hostname = os.hostname();
		
		// Clean up any residual state
		this.currentCommand = '';
		
		// Don't add newline for the very first prompt
		if (this.promptShown) {
			this.terminal.write(`\r\n${username}@${hostname}:${displayCwd}$ `);
		} else {
			this.terminal.write(`${username}@${hostname}:${displayCwd}$ `);
			this.promptShown = true;
		}
		
		// Ensure cursor is visible and terminal is properly sized
		this.terminal.scrollToBottom();
		
		// Occasionally refresh terminal to prevent display issues
		setTimeout(() => {
			if (this.terminal && !this.ptyProcess) {
				this.terminal.refresh(0, this.terminal.rows - 1);
			}
		}, 50);
	}

	private handleInput(data: string): void {
		// Ignore input if we have an active process
		if (this.ptyProcess) {
			return;
		}
		
		// Prevent duplicate processing
		if (this.processingInput) {
			return;
		}
		
		// Set processing flag to prevent duplicates
		this.processingInput = true;
		
		if (data === '\r') {
			// Enter key - execute command
			this.terminal.write('\r\n');
			if (this.currentCommand.trim()) {
				// Clean command and add to history
				const cleanCommand = this.currentCommand.trim();
				this.commandHistory.push(cleanCommand);
				this.historyIndex = this.commandHistory.length;
				
				// Clear current command before execution
				this.currentCommand = '';
				
				// Reset processing flag before executing command (which is async)
				this.processingInput = false;
				
				// Execute command
				this.executeCommand(cleanCommand);
			} else {
				this.processingInput = false;
				this.showPrompt();
			}
		} else if (data === '\x7f' || data === '\b') {
			// Backspace
			if (this.currentCommand.length > 0) {
				this.currentCommand = this.currentCommand.slice(0, -1);
				this.terminal.write('\b \b');
			}
			this.processingInput = false;
		} else if (data === '\x03') {
			// Ctrl+C - interrupt current input or running process
			if (this.ptyProcess) {
				// Kill running process
				if (this.ptyProcess.kill) {
					this.ptyProcess.kill('SIGINT');
				}
				this.terminal.write('^C\r\n');
			} else if (this.currentCommand.length > 0) {
				this.terminal.write('^C\r\n');
				this.currentCommand = '';
				this.showPrompt();
			}
			this.processingInput = false;
		} else if (data === '\x1b[A') {
			// Up arrow - previous command
			if (this.historyIndex > 0) {
				this.historyIndex--;
				this.replaceCurrentCommand(this.commandHistory[this.historyIndex]);
			}
			this.processingInput = false;
		} else if (data === '\x1b[B') {
			// Down arrow - next command
			if (this.historyIndex < this.commandHistory.length - 1) {
				this.historyIndex++;
				this.replaceCurrentCommand(this.commandHistory[this.historyIndex]);
			} else if (this.historyIndex === this.commandHistory.length - 1) {
				this.historyIndex++;
				this.replaceCurrentCommand('');
			}
			this.processingInput = false;
		} else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
			// Printable ASCII characters only
			this.currentCommand += data;
			this.terminal.write(data);
			this.processingInput = false;
		} else {
			// Unknown/unsupported input - reset flag
			this.processingInput = false;
		}
	}

	private replaceCurrentCommand(newCommand: string): void {
		// Clear current command from display
		const clearLength = this.currentCommand.length;
		for (let i = 0; i < clearLength; i++) {
			this.terminal.write('\b \b');
		}
		
		// Write new command
		this.currentCommand = newCommand;
		this.terminal.write(newCommand);
	}

	private async executeCommand(command: string): Promise<void> {
		const { spawn } = require('child_process');
		const os = require('os');
		const path = require('path');
		
		// Parse command and arguments
		const parts = command.split(/\s+/);
		const cmd = parts[0];
		const args = parts.slice(1);
		
		// Handle built-in commands
		if (cmd === 'clear') {
			this.terminal.clear();
			this.terminal.scrollToTop();
			this.showPrompt();
			return;
		}
		
		if (cmd === 'cd') {
			try {
				const newDir = args[0] ? path.resolve(args[0]) : os.homedir();
				process.chdir(newDir);
				this.showPrompt();
			} catch (error: any) {
				this.terminal.write(`cd: ${error.message}\r\n`);
				this.showPrompt();
			}
			return;
		}

		// Special handling for claude command - needs PTY
		if (cmd === 'claude') {
			return this.handleClaudeCommand(args);
		}

		// Debug command to check Claude installation
		if (cmd === 'check-claude') {
			this.terminal.write('Checking Claude Code CLI installation...\r\n');
			const claudeAvailable = await this.testCommandAvailable('claude');
			if (claudeAvailable) {
				this.terminal.write('✓ Claude Code CLI found in PATH\r\n');
				
				// Test direct execution
				this.terminal.write('Testing direct claude execution...\r\n');
				const { spawn } = require('child_process');
				const testProcess = spawn('bash', ['-c', 'claude --version'], {
					stdio: ['pipe', 'pipe', 'pipe'],
					env: { ...process.env, PATH: this.getEnhancedPath() },
					cwd: process.cwd(),
					timeout: 5000
				});
				
				let outputReceived = false;
				
				testProcess.stdout.on('data', (data: Buffer) => {
					outputReceived = true;
					this.terminal.write(`[STDOUT] ${data.toString()}`);
				});
				
				testProcess.stderr.on('data', (data: Buffer) => {
					outputReceived = true;
					this.terminal.write(`[STDERR] ${data.toString()}`);
				});
				
				await new Promise<void>((resolve) => {
					testProcess.on('exit', (code: number) => {
						if (!outputReceived) {
							this.terminal.write(`No output received, exit code: ${code}\r\n`);
						}
						this.terminal.write('Direct test completed.\r\n');
						resolve();
					});
					
					testProcess.on('error', (error: any) => {
						this.terminal.write(`Test error: ${error.message}\r\n`);
						resolve();
					});
					
					setTimeout(() => {
						if (!testProcess.killed) {
							testProcess.kill();
							this.terminal.write('Test timed out after 5 seconds\r\n');
						}
						resolve();
					}, 5000);
				});
			} else {
				this.terminal.write('✗ Claude Code CLI not found in PATH\r\n');
				this.terminal.write('Please install it from: https://claude.ai/code\r\n');
			}
			this.showPrompt();
			return;
		}
		
		// Simple Claude test command
		if (cmd === 'claude-simple') {
			this.terminal.write('Testing Claude with simple execution...\r\n');
			const claudeAvailable = await this.testCommandAvailable('claude');
			if (!claudeAvailable) {
				this.terminal.write('✗ Claude CLI not found\r\n');
				this.showPrompt();
				return;
			}
			
			// Simple execution without TTY complexity
			const { spawn } = require('child_process');
			const simpleProcess = spawn('claude', [], {
				cwd: process.cwd(),
				env: {
					...process.env,
					PATH: this.getEnhancedPath(),
					TERM: 'dumb',
					FORCE_COLOR: '0'
				},
				stdio: ['pipe', 'pipe', 'pipe']
			});
			
			this.ptyProcess = simpleProcess;
			
			simpleProcess.stdout.on('data', (data: Buffer) => {
				this.terminal.write(data.toString());
			});
			
			simpleProcess.stderr.on('data', (data: Buffer) => {
				this.terminal.write(data.toString());
			});
			
			// Set up input handling
			const originalHandler = (data: string) => this.handleInput(data);
			const claudeHandler = (data: string) => {
				if (simpleProcess && simpleProcess.stdin && !simpleProcess.killed) {
					simpleProcess.stdin.write(data);
				}
			};
			
			this.terminal.onData(claudeHandler);
			
			simpleProcess.on('exit', () => {
				this.terminal.onData(originalHandler);
				this.ptyProcess = null;
				this.terminal.write('\r\nClaude simple test ended.\r\n');
				this.showPrompt();
			});
			
			simpleProcess.on('error', (error: any) => {
				this.terminal.onData(originalHandler);
				this.ptyProcess = null;
				this.terminal.write(`Error: ${error.message}\r\n`);
				this.showPrompt();
			});
			
			// Send initial message
			setTimeout(() => {
				if (simpleProcess.stdin) {
					simpleProcess.stdin.write('Hello\n');
				}
			}, 1000);
			
			return;
		}
		
		// Test command availability first
		if (cmd !== 'cd' && cmd !== 'clear') {
			const testAvailable = await this.testCommandAvailable(cmd);
			if (!testAvailable) {
				this.terminal.write(`${cmd}: command not found\r\n`);
				this.showPrompt();
				return;
			}
		}

		// Enhanced PATH for external commands
		const additionalPaths = [
			'/usr/local/bin',
			'/opt/homebrew/bin',
			path.join(os.homedir(), '.local/bin'),
			path.join(os.homedir(), 'bin'),
			'/usr/bin',
			'/bin'
		];
		
		const currentPath = process.env.PATH || '';
		const enhancedPath = [...new Set([...currentPath.split(':'), ...additionalPaths])].join(':');
		
		// Execute external command
		const childProcess = spawn(cmd, args, {
			cwd: process.cwd(),
			env: {
				...process.env,
				PATH: enhancedPath,
				TERM: 'xterm-256color',
				COLUMNS: this.terminal.cols.toString(),
				LINES: this.terminal.rows.toString()
			},
			stdio: ['pipe', 'pipe', 'pipe']
		});
		
		let outputReceived = false;
		let isInteractive = false;
		
		// Check if this is an interactive command
		if (cmd === 'python' || cmd === 'node' || cmd === 'mongo' || cmd === 'psql') {
			isInteractive = true;
			this.handleInteractiveCommand(childProcess);
		}
		
		childProcess.stdout.on('data', (data: Buffer) => {
			outputReceived = true;
			this.terminal.write(data.toString());
			// Keep output visible
			this.terminal.scrollToBottom();
		});
		
		childProcess.stderr.on('data', (data: Buffer) => {
			outputReceived = true;
			this.terminal.write(data.toString());
			this.terminal.scrollToBottom();
		});
		
		childProcess.on('error', () => {
			this.terminal.write(`${cmd}: command not found\r\n`);
			if (!isInteractive) {
				this.showPrompt();
			}
		});
		
		childProcess.on('exit', (code: number) => {
			if (!outputReceived && code === 0) {
				// Command succeeded but produced no output - normal for some commands
			}
			if (!isInteractive) {
				this.showPrompt();
			}
		});
	}

	private getEnhancedPath(): string {
		const os = require('os');
		const path = require('path');
		
		const additionalPaths = [
			'/usr/local/bin',
			'/opt/homebrew/bin',
			path.join(os.homedir(), '.local/bin'),
			path.join(os.homedir(), 'bin'),
			'/usr/bin',
			'/bin'
		];
		
		const currentPath = process.env.PATH || '';
		return [...new Set([...currentPath.split(':'), ...additionalPaths])].join(':');
	}

	private lastClaudeOutput = '';
	private clearScreenCount = 0;
	
	private filterClaudeOutput(output: string): string {
		let filtered = output;
		
		// Track repeated clear screen sequences
		const clearScreenPattern = /\x1b\[2J\x1b\[3J\x1b\[H/g;
		const clearScreenMatches = output.match(clearScreenPattern);
		
		if (clearScreenMatches) {
			this.clearScreenCount += clearScreenMatches.length;
			
			// If Claude is repeatedly clearing screen with same content, suppress it
			if (this.clearScreenCount > 2) {
				// Remove all clear screen sequences after the first few
				filtered = filtered.replace(clearScreenPattern, '');
				console.log('Suppressed clear screen sequence, count:', this.clearScreenCount);
			} else {
				// Allow first few clear screens but convert them to simple clear
				filtered = filtered.replace(clearScreenPattern, '\x1b[H\x1b[2J');
			}
		}
		
		// Reset clear screen count if we get different content
		const contentWithoutAnsi = filtered.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[[\d;]*[A-Za-z]/g, '');
		if (contentWithoutAnsi !== this.lastClaudeOutput && contentWithoutAnsi.length > 50) {
			this.clearScreenCount = 0;
			this.lastClaudeOutput = contentWithoutAnsi;
		}
		
		// Handle line endings consistently
		filtered = filtered.replace(/(?<!\r)\n/g, '\r\n');
		
		return filtered;
	}


	private async testCommandAvailable(cmd: string): Promise<boolean> {
		const { spawn } = require('child_process');
		const os = require('os');
		
		return new Promise((resolve) => {
			const testCmd = os.platform() === 'win32' ? 'where' : 'which';
			const testProcess = spawn(testCmd, [cmd], {
				env: { ...process.env, PATH: this.getEnhancedPath() },
				stdio: ['pipe', 'pipe', 'pipe']
			});
			
			testProcess.on('exit', (code: number) => {
				resolve(code === 0);
			});
			
			testProcess.on('error', () => {
				resolve(false);
			});
			
			setTimeout(() => {
				testProcess.kill();
				resolve(false);
			}, 1000);
		});
	}

	private async handleClaudeCommand(args: string[]): Promise<void> {
		// First, test if claude command exists
		const claudeAvailable = await this.testCommandAvailable('claude');
		if (!claudeAvailable) {
			this.terminal.write('claude: command not found\r\n');
			this.terminal.write('Please install Claude Code CLI first. Visit: https://claude.ai/code\r\n');
			this.showPrompt();
			return;
		}

		this.terminal.write('Starting Claude Code...\r\n');

		// Try to use socat to create a more realistic TTY simulation
		const { spawn } = require('child_process');
		const os = require('os');
		
		const claudeCmd = args.length > 0 ? `claude ${args.join(' ')}` : 'claude';
		
		let command: string;
		let spawnArgs: string[];
		
		if (os.platform() === 'win32') {
			command = 'cmd.exe';
			spawnArgs = ['/c', claudeCmd];
			this.terminal.write('Using Windows command prompt...\r\n');
		} else {
			// Try various methods to get Claude to work
			const expectAvailable = await this.testCommandAvailable('expect');
			const stdbufAvailable = await this.testCommandAvailable('stdbuf');
			const unbufferAvailable = await this.testCommandAvailable('unbuffer');
			
			if (expectAvailable) {
				// Use expect to handle Claude's TTY requirements
				command = 'expect';
				spawnArgs = ['-c', `
					spawn claude ${args.join(' ')}
					interact
				`];
				this.terminal.write('Using expect for TTY simulation...\r\n');
			} else if (stdbufAvailable) {
				// Use stdbuf to force line buffering
				command = 'stdbuf';
				spawnArgs = ['-oL', '-eL', 'claude'].concat(args);
				this.terminal.write('Using stdbuf for forced line buffering...\r\n');
			} else if (unbufferAvailable) {
				command = 'unbuffer';
				spawnArgs = ['-p', 'claude'].concat(args);
				this.terminal.write('Using unbuffer for TTY simulation...\r\n');
			} else {
				// Try with Python's script -based approach as last resort
				const pythonAvailable = await this.testCommandAvailable('python3');
				if (pythonAvailable) {
					command = 'python3';
					spawnArgs = ['-c', `
import pty
import subprocess
import sys
import os

def run_claude():
	# Create a pseudo-terminal
	master, slave = pty.openpty()
	
	# Start Claude with the slave as stdin/stdout/stderr
	proc = subprocess.Popen(['claude'] + ${JSON.stringify(args)}, 
		stdin=slave, stdout=slave, stderr=slave,
		preexec_fn=os.setsid)
	
	os.close(slave)
	
	# Forward data between master and our stdin/stdout
	while proc.poll() is None:
		try:
			data = os.read(master, 1024)
			if data:
				sys.stdout.buffer.write(data)
				sys.stdout.flush()
		except:
			break
	
	os.close(master)
	return proc.returncode

run_claude()
					`];
					this.terminal.write('Using Python PTY simulation...\r\n');
				} else {
					// Direct execution - last resort
					command = 'claude';
					spawnArgs = args;
					this.terminal.write('Using direct Claude execution...\r\n');
				}
			}
		}

		// Show what method we're using
		this.terminal.write(`Executing: ${command} ${spawnArgs.slice(0, 2).join(' ')}${spawnArgs.length > 2 ? '...' : ''}\r\n`);

		this.ptyProcess = spawn(command, spawnArgs, {
			cwd: process.cwd(),
			env: {
				...process.env,
				PATH: this.getEnhancedPath(),
				TERM: 'xterm-256color',
				COLUMNS: this.terminal.cols.toString(),
				LINES: this.terminal.rows.toString(),
				// Environment variables to help Claude CLI work better
				FORCE_COLOR: '1',
				COLORTERM: 'truecolor',
				TERM_PROGRAM: 'Claude-Code-Terminal',
				// Additional environment
				INTERACTIVE: '1',
				CLAUDE_INTERACTIVE: '1',
				// Python/Node.js specific
				PYTHONUNBUFFERED: '1',
				NODE_NO_WARNINGS: '1',
				// Remove any variables that might indicate CI/non-interactive
				CI: undefined,
				GITHUB_ACTIONS: undefined,
				DEBIAN_FRONTEND: undefined,
				AUTOMATED: undefined
			},
			stdio: ['pipe', 'pipe', 'pipe'],
			detached: false
		});

		let hasOutput = false;
		let isActive = true;
		
		// Handle process output
		this.ptyProcess.stdout.on('data', (data: Buffer) => {
			hasOutput = true;
			let output = data.toString();
			
			// Debug: Log only when there are clear screen sequences
			if (output.includes('\x1b[2J\x1b[3J\x1b[H')) {
				console.log('Claude clear screen detected, length:', output.length);
			}
			
			// Clean up Claude's problematic output
			output = this.filterClaudeOutput(output);
			
			this.terminal.write(output);
			this.terminal.scrollToBottom();
		});

		this.ptyProcess.stderr.on('data', (data: Buffer) => {
			hasOutput = true;
			let output = data.toString();
			
			// Clean stderr output too
			output = this.filterClaudeOutput(output);
			
			this.terminal.write(output);
			this.terminal.scrollToBottom();
		});

		// Handle terminal input
		const originalInputHandler = (data: string) => this.handleInput(data);
		const claudeInputHandler = (data: string) => {
			if (this.ptyProcess && this.ptyProcess.stdin && !this.ptyProcess.killed && isActive) {
				try {
					this.ptyProcess.stdin.write(data);
				} catch (error) {
					console.error('Error writing to Claude process:', error);
				}
			}
		};

		this.terminal.onData(claudeInputHandler);

		// Handle process events
		this.ptyProcess.on('error', (error: any) => {
			isActive = false;
			this.terminal.onData(originalInputHandler);
			this.ptyProcess = null;
			this.terminal.write(`Error starting Claude: ${error.message}\r\n`);
			this.showPrompt();
		});

		this.ptyProcess.on('exit', (code: number, signal: string) => {
			isActive = false;
			this.terminal.onData(originalInputHandler);
			this.ptyProcess = null;
			
			if (signal) {
				this.terminal.write(`\r\nClaude terminated by signal: ${signal}\r\n`);
			} else if (code !== 0 && code !== null) {
				this.terminal.write(`\r\nClaude exited with code ${code}\r\n`);
			}
			this.showPrompt();
		});

		// Success message
		this.terminal.write('✓ Claude Code started\r\n');
		
		// Send initial message to Claude to start conversation
		setTimeout(() => {
			if (this.ptyProcess && this.ptyProcess.stdin && isActive) {
				// Send a simple greeting to start the conversation
				this.ptyProcess.stdin.write('Hello! I\'m ready to help you with coding tasks.\n');
			}
		}, 500);
		
		// Monitor for output and provide feedback
		setTimeout(() => {
			if (!hasOutput && isActive) {
				this.terminal.write('Waiting for Claude to respond...\r\n');
				// Try sending another newline
				if (this.ptyProcess && this.ptyProcess.stdin) {
					this.ptyProcess.stdin.write('\r');
				}
			}
		}, 2000);

		// Extended timeout with helpful message
		setTimeout(() => {
			if (!hasOutput && isActive) {
				this.terminal.write('Claude is taking longer than expected.\r\n');
				this.terminal.write('This might be the first run - Claude may be initializing.\r\n');
				this.terminal.write('You can try typing a message or press Ctrl+C to cancel.\r\n');
			}
		}, 5000);
		
		// Final timeout - force quit if no response
		setTimeout(() => {
			if (!hasOutput && isActive && this.ptyProcess && !this.ptyProcess.killed) {
				this.terminal.write('\r\nClaude did not respond within 15 seconds. Terminating...\r\n');
				this.ptyProcess.kill('SIGTERM');
				setTimeout(() => {
					if (this.ptyProcess && !this.ptyProcess.killed) {
						this.ptyProcess.kill('SIGKILL');
					}
				}, 2000);
			}
		}, 15000);
	}


	private handleInteractiveCommand(childProcess: any): void {
		// Store current process for cleanup
		this.ptyProcess = childProcess;
		
		// Create a flag to track if we're in interactive mode
		let interactiveMode = true;
		let hasReceivedOutput = false;
		
		// Store the original input handler
		const originalInputHandler = (data: string) => this.handleInput(data);
		
		// Don't show the entering message immediately - wait for first output
		let enteringMessageShown = false;
		
		// Create new input handler for interactive mode
		const interactiveInputHandler = (data: string) => {
			if (childProcess && childProcess.stdin && !childProcess.killed && interactiveMode) {
				try {
					if (data === '\x03') {
						// Ctrl+C - try to interrupt the process
						if (hasReceivedOutput) {
							// If we've received output, forward Ctrl+C to the process
							childProcess.stdin.write('\x03');
						} else {
							// If no output yet, kill the process
							this.terminal.write('^C\r\n');
							childProcess.kill('SIGINT');
							setTimeout(() => {
								if (!childProcess.killed) {
									childProcess.kill('SIGTERM');
									setTimeout(() => {
										if (!childProcess.killed) {
											childProcess.kill('SIGKILL');
										}
									}, 2000);
								}
							}, 1000);
						}
						return;
					} else if (data === '\x04') {
						// Ctrl+D - EOF
						if (childProcess.stdin) {
							childProcess.stdin.end();
						}
						return;
					} else if (data === '\r') {
						childProcess.stdin.write('\n');
					} else {
						childProcess.stdin.write(data);
					}
				} catch (error) {
					console.error('Error writing to interactive process:', error);
				}
			}
		};
		
		// Switch to interactive input handling
		this.terminal.onData(interactiveInputHandler);
		
		// Monitor stdout to show entering message only after first output
		childProcess.stdout.on('data', (data: Buffer) => {
			hasReceivedOutput = true;
			if (!enteringMessageShown) {
				enteringMessageShown = true;
				// Don't show the entering message if we get real output
			}
			this.terminal.write(data.toString());
			this.terminal.scrollToBottom();
		});
		
		childProcess.on('exit', (code: number) => {
			interactiveMode = false;
			// Restore normal input handling
			this.terminal.onData(originalInputHandler);
			this.ptyProcess = null;
			
			// Only show exit message if we actually had an interactive session
			if (hasReceivedOutput) {
				if (code !== 0 && code !== null) {
					this.terminal.write(`\r\nProcess exited with code ${code}\r\n`);
				}
			} else {
				// Process exited without output - probably command not found or failed to start
				this.terminal.write(`claude: command failed to start or not found\r\n`);
			}
			this.showPrompt();
		});
		
		childProcess.on('error', (error: any) => {
			interactiveMode = false;
			this.terminal.onData(originalInputHandler);
			this.ptyProcess = null;
			this.terminal.write(`claude: ${error.message}\r\n`);
			this.showPrompt();
		});
		
		// Handle process close
		childProcess.on('close', () => {
			if (interactiveMode) {
				interactiveMode = false;
				this.terminal.onData(originalInputHandler);
				this.ptyProcess = null;
				if (!hasReceivedOutput) {
					this.terminal.write(`claude: command not found or failed to start\r\n`);
				}
				this.showPrompt();
			}
		});
	}

	async onClose(): Promise<void> {
		if (this.ptyProcess) {
			if (typeof this.ptyProcess.kill === 'function') {
				this.ptyProcess.kill();
			}
		}
		if (this.terminal) {
			this.terminal.dispose();
		}
	}

	async restartTerminal(): Promise<void> {
		// Kill any running process
		if (this.ptyProcess) {
			if (typeof this.ptyProcess.kill === 'function') {
				this.ptyProcess.kill('SIGTERM');
			}
			this.ptyProcess = null;
		}
		
		// CRITICAL: Clear all terminal event listeners to prevent duplication
		if (this.terminal) {
			this.terminal.clear();
			this.terminal.scrollToTop();
			
			// Remove all existing event listeners
			this.terminal.onData(() => {}); // This replaces all previous onData handlers
			this.terminal.onSelectionChange(() => {}); // Clear selection handlers too
		}
		
		// Reset internal state
		this.currentCommand = '';
		this.commandHistory = [];
		this.historyIndex = -1;
		this.promptShown = false;
		this.processingInput = false; // Reset processing flag too
		
		// Restart with clean state
		await this.startPty();
	}
}

export default class ClaudeCodePlugin extends Plugin {
	settings: ClaudeCodeSettings;
	terminalView: TerminalView | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(
			TERMINAL_VIEW_TYPE,
			(leaf) => new TerminalView(leaf, this)
		);

		const ribbonIconEl = this.addRibbonIcon('code-glyph', 'Claude Code Terminal', async () => {
			await this.toggleTerminal();
		});
		ribbonIconEl.addClass('claude-code-ribbon-icon');

		this.addCommand({
			id: 'open-claude-code-terminal',
			name: 'Open Claude Code Terminal',
			callback: async () => {
				await this.openTerminal();
			}
		});

		this.addSettingTab(new ClaudeCodeSettingTab(this.app, this));
	}

	async toggleTerminal(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(TERMINAL_VIEW_TYPE)[0];
		if (existingLeaf) {
			const view = existingLeaf.view as TerminalView;
			if (view) {
				await view.restartTerminal();
			}
			this.app.workspace.revealLeaf(existingLeaf);
		} else {
			await this.openTerminal();
		}
	}

	async openTerminal(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf;

		switch (this.settings.windowPosition) {
			case 'right':
				leaf = workspace.getRightLeaf(false) || workspace.createLeafBySplit(workspace.getLeaf(), 'vertical');
				break;
			case 'horizontal':
				leaf = workspace.createLeafBySplit(workspace.getLeaf(), 'horizontal');
				break;
			case 'vertical':
				leaf = workspace.createLeafBySplit(workspace.getLeaf(), 'vertical');
				break;
			default:
				leaf = workspace.getRightLeaf(false) || workspace.createLeafBySplit(workspace.getLeaf(), 'vertical');
		}

		await leaf.setViewState({
			type: TERMINAL_VIEW_TYPE,
			active: true
		});

		this.terminalView = leaf.view as TerminalView;
		workspace.revealLeaf(leaf);
	}

	onunload() {
		if (this.terminalView) {
			this.terminalView.onClose();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
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

		containerEl.createEl('h2', { text: 'Claude Code Terminal Settings' });

		new Setting(containerEl)
			.setName('Auto-run Command')
			.setDesc('Automatically run the default command when terminal starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoRunCommand)
				.onChange(async (value) => {
					this.plugin.settings.autoRunCommand = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Command')
			.setDesc('Command to run when terminal starts (only if auto-run is enabled)')
			.addText(text => text
				.setPlaceholder('claude')
				.setValue(this.plugin.settings.defaultCommand)
				.onChange(async (value) => {
					this.plugin.settings.defaultCommand = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Window Position')
			.setDesc('Where to open the terminal window')
			.addDropdown(dropdown => dropdown
				.addOption('right', 'Right Sidebar')
				.addOption('horizontal', 'Horizontal Split')
				.addOption('vertical', 'Vertical Split')
				.setValue(this.plugin.settings.windowPosition)
				.onChange(async (value: 'right' | 'horizontal' | 'vertical') => {
					this.plugin.settings.windowPosition = value;
					await this.plugin.saveSettings();
				}));
	}
}