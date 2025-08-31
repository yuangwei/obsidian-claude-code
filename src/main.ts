import {
	App,
	Editor,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	requestUrl,
} from "obsidian";

interface VibeSettings {
	apiBaseUrl: string;
	apiToken: string;
	embeddingModel: string;
	completionModel: string;
}

const DEFAULT_SETTINGS: VibeSettings = {
	apiBaseUrl: "https://api.openai.com/v1",
	apiToken: "",
	embeddingModel: "text-embedding-ada-002",
	completionModel: "gpt-3.5-turbo",
};

export default class ClaudeCodePlugin extends Plugin {
	settings: VibeSettings;
	vectors: Record<string, number[]> = {};

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new VibeSettingTab(this.app, this));
		this.addCommand({
			id: "vectorize-vault",
			name: "Vectorize Vault",
			callback: () => this.vectorizeVault(),
		});
		this.addCommand({
			id: "vibe-write",
			name: "Vibe Write Selection",
			editorCallback: (editor: Editor) => this.vibeWrite(editor),
		});
		if (Object.keys(this.vectors).length === 0) {
			await this.vectorizeVault();
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
		this.vectors = data?.vectors || {};
	}

	async savePluginData() {
		await this.saveData({ settings: this.settings, vectors: this.vectors });
	}

	async saveSettings() {
		await this.savePluginData();
	}

	async vectorizeVault() {
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const text = await this.app.vault.read(file);
			const emb = await this.getEmbedding(text);
			if (emb) {
				this.vectors[file.path] = emb;
			}
		}
		await this.savePluginData();
		new Notice("Vectorization complete");
	}

	async getEmbedding(text: string): Promise<number[] | null> {
		try {
			const res = await requestUrl({
				url: `${this.settings.apiBaseUrl}/embeddings`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.settings.apiToken}`,
				},
				body: JSON.stringify({
					model: this.settings.embeddingModel,
					input: text,
				}),
			});
			const data = await res.json;
			return data.data[0].embedding as number[];
		} catch (e) {
			console.error("Embedding error", e);
			new Notice("Error retrieving embedding");
			return null;
		}
	}

	async getCompletion(prompt: string): Promise<string> {
		const res = await requestUrl({
			url: `${this.settings.apiBaseUrl}/chat/completions`,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.settings.apiToken}`,
			},
			body: JSON.stringify({
				model: this.settings.completionModel,
				messages: [{ role: "user", content: prompt }],
				temperature: 0.7,
			}),
		});
		const data = await res.json;
		return data.choices[0].message.content as string;
	}

	similarity(a: number[], b: number[]): number {
		let dot = 0,
			a2 = 0,
			b2 = 0;
		for (let i = 0; i < a.length && i < b.length; i++) {
			dot += a[i] * b[i];
			a2 += a[i] * a[i];
			b2 += b[i] * b[i];
		}
		return dot / (Math.sqrt(a2) * Math.sqrt(b2));
	}

	async vibeWrite(editor: Editor) {
		const text = editor.getSelection();
		if (!text) {
			new Notice("Please select text to rewrite");
			return;
		}
		const emb = await this.getEmbedding(text);
		if (!emb) return;
		const scores: { path: string; score: number }[] = [];
		for (const path in this.vectors) {
			const score = this.similarity(emb, this.vectors[path]);
			scores.push({ path, score });
		}
		scores.sort((a, b) => b.score - a.score);
		const context: string[] = [];
		for (let i = 0; i < Math.min(3, scores.length); i++) {
			const file = this.app.vault.getAbstractFileByPath(scores[i].path);
			if (file instanceof TFile) {
				const t = await this.app.vault.read(file);
				context.push(t.slice(0, 500));
			}
		}
		const prompt = `Rewrite the following text in a vibey style using the context provided.\n\nContext:\n${context.join(
			"\n---\n"
		)}\n\nText:\n${text}\n`;
		const result = await this.getCompletion(prompt);
		editor.replaceSelection(result.trim());
	}
}

class VibeSettingTab extends PluginSettingTab {
	plugin: VibePlugin;

	constructor(app: App, plugin: VibePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("API Base URL").addText((text) =>
			text
				.setPlaceholder("https://api.openai.com/v1")
				.setValue(this.plugin.settings.apiBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.apiBaseUrl = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName("API Token").addText((text) => {
			text.inputEl.type = "password";
			text.setValue(this.plugin.settings.apiToken).onChange(
				async (value) => {
					this.plugin.settings.apiToken = value;
					await this.plugin.saveSettings();
				}
			);
		});

		new Setting(containerEl).setName("Embedding Model").addText((text) =>
			text
				.setPlaceholder("text-embedding-ada-002")
				.setValue(this.plugin.settings.embeddingModel)
				.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName("Completion Model").addText((text) =>
			text
				.setPlaceholder("gpt-3.5-turbo")
				.setValue(this.plugin.settings.completionModel)
				.onChange(async (value) => {
					this.plugin.settings.completionModel = value;
					await this.plugin.saveSettings();
				})
		);
	}
}
