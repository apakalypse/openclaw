import { type RunOptions, run } from "@grammyjs/runner";
import type { OpenClawConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveAgentMaxConcurrent } from "../config/agent-limits.js";
import { loadConfig } from "../config/config.js";
import { computeBackoff, sleepWithAbort } from "../infra/backoff.js";
import { formatErrorMessage } from "../infra/errors.js";
import { formatDurationMs } from "../infra/format-duration.js";
import { resolveTelegramAccount } from "./accounts.js";
import { resolveTelegramAllowedUpdates } from "./allowed-updates.js";
import { createTelegramBot } from "./bot.js";
import { isRecoverableTelegramNetworkError } from "./network-errors.js";
import { makeProxyFetch } from "./proxy.js";
import {
  hashTelegramToken,
  readTelegramUpdateOffsetState,
  writeTelegramUpdateOffset,
} from "./update-offset-store.js";
import { startTelegramWebhook } from "./webhook.js";

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  config?: OpenClawConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  webhookPort?: number;
  webhookSecret?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
};

export function createTelegramRunnerOptions(cfg: OpenClawConfig): RunOptions<unknown> {
  return {
    sink: {
      concurrency: resolveAgentMaxConcurrent(cfg),
    },
    runner: {
      fetch: {
        // Match grammY defaults
        timeout: 30,
        // Request reactions without dropping default update types.
        allowed_updates: resolveTelegramAllowedUpdates(),
      },
      // Suppress grammY getUpdates stack traces; we log concise errors ourselves.
      silent: true,
      // Retry transient failures for a limited window before surfacing errors.
      maxRetryTime: 5 * 60 * 1000,
      retryInterval: "exponential",
    },
  };
}

const TELEGRAM_POLL_RESTART_POLICY = {
  initialMs: 2000,
  maxMs: 30_000,
  factor: 1.8,
  jitter: 0.25,
};

const isGetUpdatesConflict = (err: unknown) => {
  if (!err || typeof err !== "object") {
    return false;
  }
  const typed = err as {
    error_code?: number;
    errorCode?: number;
    description?: string;
    method?: string;
    message?: string;
  };
  const errorCode = typed.error_code ?? typed.errorCode;
  if (errorCode !== 409) {
    return false;
  }
  const haystack = [typed.method, typed.description, typed.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes("getupdates");
};

const NETWORK_ERROR_SNIPPETS = [
  "fetch failed",
  "network",
  "timeout",
  "socket",
  "econnreset",
  "econnrefused",
  "undici",
];

const isNetworkRelatedError = (err: unknown) => {
  if (!err) {
    return false;
  }
  const message = formatErrorMessage(err).toLowerCase();
  if (!message) {
    return false;
  }
  return NETWORK_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
};

export async function monitorTelegramProvider(opts: MonitorTelegramOpts = {}) {
  const cfg = opts.config ?? loadConfig();
  const account = resolveTelegramAccount({
    cfg,
    accountId: opts.accountId,
  });
  const token = opts.token?.trim() || account.token;
  if (!token) {
    throw new Error(
      `Telegram bot token missing for account "${account.accountId}" (set channels.telegram.accounts.${account.accountId}.botToken/tokenFile or TELEGRAM_BOT_TOKEN for default).`,
    );
  }

  const proxyFetch =
    opts.proxyFetch ?? (account.config.proxy ? makeProxyFetch(account.config.proxy) : undefined);

  const tokenHash = hashTelegramToken(token);
  const storedState = await readTelegramUpdateOffsetState({
    accountId: account.accountId,
  });
  let lastUpdateId = storedState?.lastUpdateId ?? null;

  const base = `https://api.telegram.org/bot${token}`;
  const fetcher = proxyFetch ?? fetch;
  const fetchWithTimeout = async (url: string, timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetcher(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  // If the bot token changed since we last ran, a stale lastUpdateId can silently skip all updates.
  // We catch up by sampling pending updates, setting the offset to the latest id, and letting the
  // runner advance normally from there (dropping backlog without deadlocking).
  if (storedState?.tokenHash && storedState.tokenHash !== tokenHash) {
    (opts.runtime?.error ?? console.error)(
      `telegram: token changed for account "${account.accountId}" (offset store mismatch); catching up to avoid skipping all updates.`,
    );
    try {
      const res = await fetchWithTimeout(`${base}/getUpdates?limit=100&timeout=0`, 5000);
      const json = (await res.json()) as {
        ok?: boolean;
        description?: string;
        result?: Array<{ update_id?: number }>;
      };
      if (res.ok && json?.ok) {
        const ids = (json.result ?? [])
          .map((u) => u.update_id)
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        const maxId = ids.length ? Math.max(...ids) : null;
        if (typeof maxId === "number") {
          lastUpdateId = maxId;
        } else {
          lastUpdateId = null;
        }
      } else {
        (opts.runtime?.error ?? console.error)(
          `telegram: catch-up getUpdates failed (${res.status}): ${json?.description ?? "unknown error"}`,
        );
        lastUpdateId = null;
      }
    } catch (err) {
      (opts.runtime?.error ?? console.error)(
        `telegram: catch-up getUpdates failed: ${String(err)}`,
      );
      lastUpdateId = null;
    }
  } else if (storedState?.tokenHash == null && storedState?.lastUpdateId != null) {
    // Backfill tokenHash to make future token swaps detectable (no behavior change).
    try {
      await writeTelegramUpdateOffset({
        accountId: account.accountId,
        updateId: storedState.lastUpdateId,
        tokenHash,
      });
    } catch {
      // best-effort
    }
  }

  const persistUpdateId = async (updateId: number) => {
    if (lastUpdateId !== null && updateId <= lastUpdateId) {
      return;
    }
    lastUpdateId = updateId;
    try {
      await writeTelegramUpdateOffset({
        accountId: account.accountId,
        updateId,
        tokenHash,
      });
    } catch (err) {
      (opts.runtime?.error ?? console.error)(
        `telegram: failed to persist update offset: ${String(err)}`,
      );
    }
  };

  const bot = createTelegramBot({
    token,
    runtime: opts.runtime,
    proxyFetch,
    config: cfg,
    accountId: account.accountId,
    updateOffset: {
      lastUpdateId,
      onUpdateId: persistUpdateId,
    },
  });

  if (opts.useWebhook) {
    await startTelegramWebhook({
      token,
      accountId: account.accountId,
      config: cfg,
      path: opts.webhookPath,
      port: opts.webhookPort,
      secret: opts.webhookSecret,
      runtime: opts.runtime as RuntimeEnv,
      fetch: proxyFetch,
      abortSignal: opts.abortSignal,
      publicUrl: opts.webhookUrl,
    });
    return;
  }

  // Use grammyjs/runner for concurrent update processing
  let restartAttempts = 0;

  while (!opts.abortSignal?.aborted) {
    const runner = run(bot, createTelegramRunnerOptions(cfg));
    const stopOnAbort = () => {
      if (opts.abortSignal?.aborted) {
        void runner.stop();
      }
    };
    opts.abortSignal?.addEventListener("abort", stopOnAbort, { once: true });
    try {
      // runner.task() returns a promise that resolves when the runner stops
      await runner.task();
      return;
    } catch (err) {
      if (opts.abortSignal?.aborted) {
        throw err;
      }
      const isConflict = isGetUpdatesConflict(err);
      const isRecoverable = isRecoverableTelegramNetworkError(err, { context: "polling" });
      const isNetworkError = isNetworkRelatedError(err);
      if (!isConflict && !isRecoverable && !isNetworkError) {
        throw err;
      }
      restartAttempts += 1;
      const delayMs = computeBackoff(TELEGRAM_POLL_RESTART_POLICY, restartAttempts);
      const reason = isConflict ? "getUpdates conflict" : "network error";
      const errMsg = formatErrorMessage(err);
      (opts.runtime?.error ?? console.error)(
        `Telegram ${reason}: ${errMsg}; retrying in ${formatDurationMs(delayMs)}.`,
      );
      try {
        await sleepWithAbort(delayMs, opts.abortSignal);
      } catch (sleepErr) {
        if (opts.abortSignal?.aborted) {
          return;
        }
        throw sleepErr;
      }
    } finally {
      opts.abortSignal?.removeEventListener("abort", stopOnAbort);
    }
  }
}
