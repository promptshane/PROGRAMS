import { shell } from "electron";
import type {
  GitHubAuthStatus,
  GitHubClientIdSource,
  GitHubLoginPrompt,
  RepoVisibility,
} from "@shared/types";
import { SecureStore } from "./secure-store.ts";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
}

export interface GitHubClientConfig {
  clientId: string;
  source: GitHubClientIdSource;
}

type Emit = (
  event:
    | { type: "auth.github"; status: GitHubAuthStatus }
    | { type: "toast"; level: "success" | "error" | "info"; message: string },
) => void;

export class GitHubService {
  private pollingLoginId: string | null = null;
  private currentPrompt: GitHubLoginPrompt | null = null;

  constructor(
    private readonly secureStore: SecureStore,
    private readonly emit: Emit,
  ) {}

  async getStoredToken(): Promise<string | null> {
    return this.secureStore.getGitHubToken();
  }

  async getStatus(config: GitHubClientConfig | null): Promise<GitHubAuthStatus> {
    const configured = Boolean(config?.clientId.trim());
    const token = configured ? await this.secureStore.getGitHubToken() : null;
    const baseStatus: GitHubAuthStatus = {
      configured,
      canConnect: configured,
      clientIdSource: config?.source ?? null,
      hasStoredToken: Boolean(token),
      loggedIn: false,
      verified: false,
      login: null,
      avatarUrl: null,
      expiresAt: this.currentPrompt?.expiresAt ?? null,
      errorMessage: null,
      loginPrompt: this.currentPrompt,
    };

    if (!configured || !token) {
      return baseStatus;
    }

    try {
      const user = await this.requestGitHub<GitHubUser>("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return {
        ...baseStatus,
        loggedIn: true,
        verified: true,
        login: user.login,
        avatarUrl: user.avatar_url,
      };
    } catch (error) {
      return {
        ...baseStatus,
        errorMessage:
          error instanceof Error
            ? error.message
            : "GitHub could not confirm the current permissions.",
      };
    }
  }

  async login(config: GitHubClientConfig | null): Promise<GitHubLoginPrompt> {
    if (!config?.clientId.trim()) {
      throw new Error("Add a GitHub client ID in Settings before signing in to GitHub.");
    }

    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: "repo read:user",
      }),
    });

    if (!response.ok) {
      throw new Error("GitHub sign-in could not be started.");
    }

    const payload = (await response.json()) as DeviceCodeResponse;
    const prompt: GitHubLoginPrompt = {
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
      interval: payload.interval,
    };

    this.pollingLoginId = payload.device_code;
    this.currentPrompt = prompt;
    this.emit({ type: "auth.github", status: await this.getStatus(config) });
    void this.pollForToken(config, payload);
    await shell.openExternal(payload.verification_uri);

    return prompt;
  }

  async logout(config: GitHubClientConfig | null = null): Promise<GitHubAuthStatus> {
    await this.secureStore.clearGitHubToken();
    this.pollingLoginId = null;
    this.currentPrompt = null;
    const status = await this.getStatus(config);
    this.emit({ type: "auth.github", status });
    return status;
  }

  async createRepository(input: {
    client: GitHubClientConfig | null;
    name: string;
    description: string;
    visibility: RepoVisibility;
  }): Promise<{ htmlUrl: string; remoteUrl: string; defaultBranch: string }> {
    const token = await this.secureStore.getGitHubToken();
    if (!token) {
      throw new Error("Sign in to GitHub before creating a remote project.");
    }

    const response = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        private: input.visibility !== "public",
        auto_init: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || "GitHub could not create the remote project.");
    }

    const payload = (await response.json()) as {
      html_url: string;
      clone_url: string;
      default_branch: string;
    };

    return {
      htmlUrl: payload.html_url,
      remoteUrl: payload.clone_url,
      defaultBranch: payload.default_branch || "main",
    };
  }

  private async pollForToken(config: GitHubClientConfig, payload: DeviceCodeResponse): Promise<void> {
    const expiresAt = Date.now() + payload.expires_in * 1000;
    let interval = payload.interval * 1000;

    while (Date.now() < expiresAt && this.pollingLoginId === payload.device_code) {
      await new Promise((resolve) => setTimeout(resolve, interval));

      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          device_code: payload.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const tokenPayload = (await response.json()) as AccessTokenResponse;
      if (tokenPayload.access_token) {
        await this.secureStore.setGitHubToken(tokenPayload.access_token);
        this.pollingLoginId = null;
        this.currentPrompt = null;
        const status = await this.getStatus(config);
        this.emit({
          type: "toast",
          level: "success",
          message: "GitHub is connected.",
        });
        this.emit({ type: "auth.github", status });
        return;
      }

      if (tokenPayload.error === "slow_down") {
        interval += 5000;
        continue;
      }

      if (tokenPayload.error === "authorization_pending") {
        continue;
      }

      this.pollingLoginId = null;
      this.currentPrompt = null;
      this.emit({
        type: "toast",
        level: "error",
        message: tokenPayload.error_description || "GitHub sign-in was cancelled.",
      });
      this.emit({ type: "auth.github", status: await this.getStatus(config) });
      return;
    }

    this.pollingLoginId = null;
    this.currentPrompt = null;
    this.emit({
      type: "toast",
      level: "error",
      message: "GitHub sign-in timed out. Start it again when you are ready.",
    });
    this.emit({ type: "auth.github", status: await this.getStatus(config) });
  }

  private async requestGitHub<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return (await response.json()) as T;
  }
}
