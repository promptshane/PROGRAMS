import { shell } from "electron";
import type { GitHubAuthStatus, GitHubLoginPrompt, RepoVisibility } from "@shared/types";
import { SecureStore } from "@main/services/secure-store";

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

type Emit = (event: { type: "auth.github"; status: GitHubAuthStatus } | { type: "toast"; level: "success" | "error" | "info"; message: string }) => void;

export class GitHubService {
  private pollingLoginId: string | null = null;

  constructor(
    private readonly secureStore: SecureStore,
    private readonly emit: Emit,
  ) {}

  async getStatus(clientId: string | null): Promise<GitHubAuthStatus> {
    const configured = Boolean(clientId?.trim());
    if (!configured) {
      return {
        configured: false,
        loggedIn: false,
        login: null,
        avatarUrl: null,
        expiresAt: null,
        errorMessage: null,
      };
    }

    const token = await this.secureStore.getGitHubToken();
    if (!token) {
      return {
        configured: true,
        loggedIn: false,
        login: null,
        avatarUrl: null,
        expiresAt: null,
        errorMessage: null,
      };
    }

    try {
      const user = await this.requestGitHub<GitHubUser>("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return {
        configured: true,
        loggedIn: true,
        login: user.login,
        avatarUrl: user.avatar_url,
        expiresAt: null,
        errorMessage: null,
      };
    } catch (error) {
      return {
        configured: true,
        loggedIn: true,
        login: null,
        avatarUrl: null,
        expiresAt: null,
        errorMessage: error instanceof Error ? error.message : "GitHub could not confirm the current permissions.",
      };
    }
  }

  async login(clientId: string | null): Promise<GitHubLoginPrompt> {
    if (!clientId?.trim()) {
      throw new Error("Add a GitHub client ID in Settings before signing in to GitHub.");
    }

    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: "repo read:user",
      }),
    });

    if (!response.ok) {
      throw new Error("GitHub sign-in could not be started.");
    }

    const payload = (await response.json()) as DeviceCodeResponse;
    const expiresAt = new Date(Date.now() + payload.expires_in * 1000).toISOString();
    this.pollingLoginId = payload.device_code;
    void this.pollForToken(clientId, payload);
    await shell.openExternal(payload.verification_uri);

    return {
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      expiresAt,
      interval: payload.interval,
    };
  }

  async logout(): Promise<GitHubAuthStatus> {
    await this.secureStore.clearGitHubToken();
    const status: GitHubAuthStatus = {
      configured: true,
      loggedIn: false,
      login: null,
      avatarUrl: null,
      expiresAt: null,
      errorMessage: null,
    };
    this.emit({ type: "auth.github", status });
    return status;
  }

  async createRepository(input: {
    clientId: string | null;
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
      ssh_url: string;
      default_branch: string;
    };

    return {
      htmlUrl: payload.html_url,
      remoteUrl: payload.ssh_url || payload.clone_url,
      defaultBranch: payload.default_branch || "main",
    };
  }

  private async pollForToken(clientId: string, payload: DeviceCodeResponse): Promise<void> {
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
          client_id: clientId,
          device_code: payload.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });

      const tokenPayload = (await response.json()) as AccessTokenResponse;
      if (tokenPayload.access_token) {
        await this.secureStore.setGitHubToken(tokenPayload.access_token);
        const status = await this.getStatus(clientId);
        this.emit({
          type: "toast",
          level: "success",
          message: "GitHub is connected.",
        });
        this.emit({ type: "auth.github", status });
        this.pollingLoginId = null;
        return;
      }

      if (tokenPayload.error === "slow_down") {
        interval += 5000;
        continue;
      }

      if (tokenPayload.error === "authorization_pending") {
        continue;
      }

      this.emit({
        type: "toast",
        level: "error",
        message: tokenPayload.error_description || "GitHub sign-in was cancelled.",
      });
      this.pollingLoginId = null;
      return;
    }

    this.emit({
      type: "toast",
      level: "error",
      message: "GitHub sign-in timed out. Start it again when you are ready.",
    });
    this.pollingLoginId = null;
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
