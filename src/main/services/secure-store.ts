import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import { ensureDirectory, pathExists } from "@main/utils/fs";

interface SecretsFile {
  githubToken?: string;
}

export class SecureStore {
  private readonly filePath = join(app.getPath("userData"), "secrets.json");

  private async readSecrets(): Promise<SecretsFile> {
    if (!(await pathExists(this.filePath))) {
      return {};
    }

    const raw = await readFile(this.filePath, "utf8");
    return JSON.parse(raw) as SecretsFile;
  }

  private async writeSecrets(secrets: SecretsFile): Promise<void> {
    await ensureDirectory(app.getPath("userData"));
    await writeFile(this.filePath, JSON.stringify(secrets, null, 2), "utf8");
  }

  async getGitHubToken(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) {
      return null;
    }

    const secrets = await this.readSecrets();
    if (!secrets.githubToken) {
      return null;
    }

    return safeStorage.decryptString(Buffer.from(secrets.githubToken, "base64"));
  }

  async setGitHubToken(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure token storage is not available on this device.");
    }

    const secrets = await this.readSecrets();
    secrets.githubToken = safeStorage.encryptString(token).toString("base64");
    await this.writeSecrets(secrets);
  }

  async clearGitHubToken(): Promise<void> {
    if (!(await pathExists(this.filePath))) {
      return;
    }

    const secrets = await this.readSecrets();
    delete secrets.githubToken;

    if (Object.keys(secrets).length === 0) {
      await rm(this.filePath, { force: true });
      return;
    }

    await this.writeSecrets(secrets);
  }
}
