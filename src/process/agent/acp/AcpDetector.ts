/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpBackendAll, PresetAgentType, PotentialAcpCli } from '@/common/types/acpTypes';
import { POTENTIAL_ACP_CLIS } from '@/common/types/acpTypes';
import { ExtensionRegistry } from '@process/extensions';
import { ProcessConfig } from '@process/utils/initStorage';
import { getEnhancedEnv } from '@process/utils/shellEnv';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

interface DetectedAgent {
  backend: AcpBackendAll;
  name: string;
  cliPath?: string;
  acpArgs?: string[];
  customAgentId?: string;
  isPreset?: boolean;
  context?: string;
  avatar?: string;
  presetAgentType?: PresetAgentType | string;
  isExtension?: boolean;
  extensionName?: string;
}

/**
 * Result from `getKnownBackends()` — describes all POTENTIAL_ACP_CLIS entries
 * regardless of whether the binary was found on disk. Used by the settings UI
 * to show "not detected — set path" cards for backends where `which` failed
 * so users can manually configure the path even on fresh installs where CLI
 * detection is broken.
 */
export interface KnownBackendInfo {
  backend: AcpBackendAll;
  name: string;
  /** The default cliCommand name (e.g. 'claude', 'qwen'), for Test Connection. */
  defaultCommand: string;
  /** ACP arguments for this backend. */
  acpArgs: string[];
  /** Whether the CLI is currently detected on PATH or via saved override. */
  detected: boolean;
  /**
   * Effective cliPath the app will use. Either the user-saved override (from
   * `acp.config.<backend>.cliPath`) or the default command resolved via PATH.
   */
  cliPath?: string;
  /** User-saved override path, if any. */
  overridePath?: string;
}

/**
 * Global ACP detector — detects available agents from three sources:
 *
 * **Builtin agents** — Defined in POTENTIAL_ACP_CLIS. These are well-known
 * CLI tools (claude, qwen, goose, etc.) that the app knows about at compile
 * time. Each has a real `backendId` (e.g. 'claude', 'qwen') and is detected
 * via `which`/`where` on the system PATH. Gemini is a special builtin that
 * is always present (no CLI detection needed).
 *
 * **Extension agents** — Contributed by installed extensions via
 * `contributes.acpAdapters` in the extension manifest. Discovered from
 * ExtensionRegistry at runtime. Always have `backend: 'custom'` with a
 * `customAgentId` of the form `ext:<extensionName>:<adapterId>` and
 * `isExtension: true`. Also verified via `isCliAvailable` before inclusion.
 *
 * **Custom agents** — User-configured agents from the config store
 * (`acp.customAgents`). Always have `backend: 'custom'`. No CLI detection
 * is performed — the user is responsible for ensuring the CLI is available.
 * Includes preset agents (built-in templates like Academic Paper).
 *
 * All three sources run in parallel during detection, then results are
 * deduplicated by `cliPath` (first wins). Merge order determines priority:
 * Gemini > Builtin > Extension > Custom.
 */
class AcpDetector {
  private detectedAgents: DetectedAgent[] = [];
  private isDetected = false;
  private enhancedEnv: NodeJS.ProcessEnv | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  private createGeminiAgent(): DetectedAgent {
    return {
      backend: 'gemini',
      name: 'Gemini CLI',
      cliPath: undefined,
      acpArgs: undefined,
    };
  }

  private mergeDetectedAgents(params: {
    builtinAgents?: DetectedAgent[];
    extensionAgents?: DetectedAgent[];
    customAgents?: DetectedAgent[];
  }): DetectedAgent[] {
    const { builtinAgents = [], extensionAgents = [], customAgents = [] } = params;
    return this.deduplicate([this.createGeminiAgent(), ...builtinAgents, ...extensionAgents, ...customAgents]);
  }

  private async runExclusiveMutation<T>(task: () => Promise<T>): Promise<T> {
    const previousMutation = this.mutationQueue;
    let releaseCurrentMutation: (() => void) | undefined;

    this.mutationQueue = new Promise<void>((resolve) => {
      releaseCurrentMutation = resolve;
    });

    await previousMutation;

    try {
      return await task();
    } finally {
      releaseCurrentMutation?.();
    }
  }

  /**
   * Load per-backend saved `cliPath` overrides from `acp.config`.
   *
   * Users can manually configure a path for any builtin backend when the
   * default `which <cmd>` probe fails — e.g. when Claude Code is installed
   * at `~/.claude/local/claude` on a fresh install before we register that
   * directory on PATH. This lookup is consulted FIRST in `detectBuiltinAgents`
   * so that a saved override makes the agent appear as "detected" regardless
   * of PATH state. Missing config, missing keys, or an override pointing at
   * a file that no longer exists are all treated as "no override".
   */
  private async loadBuiltinOverrides(): Promise<Partial<Record<AcpBackendAll, string>>> {
    try {
      const acpConfig = await ProcessConfig.get('acp.config');
      if (!acpConfig || typeof acpConfig !== 'object') return {};

      const overrides: Partial<Record<AcpBackendAll, string>> = {};
      for (const [backend, cfg] of Object.entries(acpConfig) as Array<
        [AcpBackendAll, { cliPath?: string } | undefined]
      >) {
        const cliPath = cfg?.cliPath?.trim();
        if (!cliPath) continue;
        // Only honour absolute paths for overrides — relative or bare-name
        // entries should continue to go through PATH-based detection so the
        // user doesn't accidentally lock themselves to a non-existent path.
        if (!path.isAbsolute(cliPath)) continue;
        if (!existsSync(cliPath)) continue;
        overrides[backend] = cliPath;
      }
      return overrides;
    } catch (error) {
      if (error instanceof Error && (error.message.includes('ENOENT') || error.message.includes('not found'))) {
        return {};
      }
      console.warn('[AcpDetector] Failed to read acp.config overrides:', error);
      return {};
    }
  }

  /**
   * Check if a CLI command is available on the system PATH.
   */
  private isCliAvailable(cliCommand: string): boolean {
    const isWindows = process.platform === 'win32';
    const whichCommand = isWindows ? 'where' : 'which';

    if (!this.enhancedEnv) {
      this.enhancedEnv = getEnhancedEnv();
    }

    try {
      execSync(`${whichCommand} ${cliCommand}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 1000,
        env: this.enhancedEnv,
      });
      return true;
    } catch {
      if (!isWindows) return false;
    }

    if (isWindows) {
      try {
        execSync(
          `powershell -NoProfile -NonInteractive -Command "Get-Command -All ${cliCommand} | Select-Object -First 1 | Out-Null"`,
          {
            encoding: 'utf-8',
            stdio: 'pipe',
            timeout: 1000,
            env: this.enhancedEnv,
          }
        );
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Three detection sources — each returns an array of DetectedAgent candidates
  // ---------------------------------------------------------------------------

  /**
   * Source 1: Built-in POTENTIAL_ACP_CLIS.
   *
   * For each entry: if the user has saved an absolute-path override in
   * `acp.config.<backend>.cliPath`, use it directly (no `which` probe — the
   * user has already told us where the binary is). Otherwise fall back to
   * parallel `isCliAvailable` on the CLI name.
   *
   * This means the settings UI's "Set path" feature keeps working even on
   * minimal-PATH launches (Finder/Dock) where Claude Code's installer
   * directory (`~/.claude/local`) isn't visible to child processes.
   */
  private async detectBuiltinAgents(): Promise<DetectedAgent[]> {
    const overrides = await this.loadBuiltinOverrides();

    const promises = POTENTIAL_ACP_CLIS.map((cli) =>
      Promise.resolve().then((): DetectedAgent | null => {
        const override = overrides[cli.backendId];
        if (override) {
          return { backend: cli.backendId, name: cli.name, cliPath: override, acpArgs: cli.args };
        }
        return this.isCliAvailable(cli.cmd)
          ? { backend: cli.backendId, name: cli.name, cliPath: cli.cmd, acpArgs: cli.args }
          : null;
      })
    );

    const results = await Promise.allSettled(promises);
    return results
      .filter((r): r is PromiseFulfilledResult<DetectedAgent> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);
  }

  /**
   * Return the full list of known backends from `POTENTIAL_ACP_CLIS` enriched
   * with detection state + any saved override. The settings UI uses this to
   * render "Not detected — Set path" cards for backends where CLI detection
   * failed, so users can point the app at a non-PATH install location
   * (e.g. `~/.claude/local/claude` on a fresh `curl … | sh` Claude install)
   * without having to restart their shell or edit rc files.
   */
  async getKnownBackends(): Promise<KnownBackendInfo[]> {
    const overrides = await this.loadBuiltinOverrides();
    const detectedMap = new Map(this.detectedAgents.filter((a) => !!a.cliPath).map((a) => [a.backend, a.cliPath!]));

    return (POTENTIAL_ACP_CLIS as unknown as PotentialAcpCli[]).map((cli) => {
      const overridePath = overrides[cli.backendId];
      const detectedPath = detectedMap.get(cli.backendId);
      return {
        backend: cli.backendId,
        name: cli.name,
        defaultCommand: cli.cmd,
        acpArgs: cli.args,
        detected: !!detectedPath,
        cliPath: detectedPath,
        overridePath,
      };
    });
  }

  /**
   * Persist a user-supplied `cliPath` for a builtin backend and re-run
   * builtin detection. Passing `undefined` (or an empty string) clears the
   * override and re-detects via PATH.
   *
   * Returns the fresh `KnownBackendInfo` for the backend so the caller can
   * reflect the new detection state in the UI without a second round-trip.
   */
  async setBuiltinCliPath(backend: AcpBackendAll, cliPath: string | undefined): Promise<KnownBackendInfo | null> {
    const trimmed = typeof cliPath === 'string' ? cliPath.trim() : '';
    const existingConfig = (await ProcessConfig.get('acp.config').catch((): undefined => undefined)) || {};
    const prevEntry = (existingConfig as Record<string, { cliPath?: string } | undefined>)[backend] ?? {};
    const nextEntry: { cliPath?: string } = { ...prevEntry };

    if (trimmed) {
      nextEntry.cliPath = trimmed;
    } else {
      delete nextEntry.cliPath;
    }

    const nextConfig = { ...existingConfig } as Record<string, typeof nextEntry>;
    if (Object.keys(nextEntry).length === 0) {
      delete nextConfig[backend];
    } else {
      nextConfig[backend] = nextEntry;
    }

    await ProcessConfig.set('acp.config', nextConfig as Parameters<typeof ProcessConfig.set<'acp.config'>>[1]);

    // Re-run builtin detection so callers (and any listeners) see the update.
    await this.refreshBuiltinAgents();

    const known = await this.getKnownBackends();
    return known.find((k) => k.backend === backend) ?? null;
  }

  /**
   * Source 2: Extension-contributed ACP adapters — parallel CLI availability check.
   */
  private async detectExtensionAgents(): Promise<DetectedAgent[]> {
    try {
      const adapters = ExtensionRegistry.getInstance().getAcpAdapters();
      if (!adapters || adapters.length === 0) return [];

      const candidates: Array<{ agent: DetectedAgent; cliCommand: string }> = [];

      for (const item of adapters) {
        const adapter = item as Record<string, unknown>;
        const id = typeof adapter.id === 'string' ? adapter.id : '';
        const name = typeof adapter.name === 'string' ? adapter.name : id;
        const cliCommand = typeof adapter.cliCommand === 'string' ? adapter.cliCommand : undefined;
        const acpArgs = Array.isArray(adapter.acpArgs)
          ? adapter.acpArgs.filter((v): v is string => typeof v === 'string')
          : undefined;
        const avatar = typeof adapter.avatar === 'string' ? adapter.avatar : undefined;
        const extensionName = typeof adapter._extensionName === 'string' ? adapter._extensionName : 'unknown-extension';
        const connectionType = typeof adapter.connectionType === 'string' ? adapter.connectionType : 'unknown';

        if (connectionType !== 'cli' && connectionType !== 'stdio') continue;
        if (!cliCommand) continue;

        candidates.push({
          cliCommand,
          agent: {
            backend: 'custom' as const,
            name,
            cliPath: cliCommand,
            acpArgs,
            avatar,
            customAgentId: id,
            isExtension: true,
            extensionName,
          },
        });
      }

      const promises = candidates.map((c) =>
        Promise.resolve().then((): DetectedAgent | null => (this.isCliAvailable(c.cliCommand) ? c.agent : null))
      );

      const results = await Promise.allSettled(promises);
      return results
        .filter((r): r is PromiseFulfilledResult<DetectedAgent> => r.status === 'fulfilled' && r.value !== null)
        .map((r) => r.value);
    } catch (error) {
      console.warn('[AcpDetector] Failed to load extension ACP adapters:', error);
      return [];
    }
  }

  /**
   * Source 3: User-configured custom agents (no CLI check — user is responsible).
   */
  private async detectCustomAgents(): Promise<DetectedAgent[]> {
    try {
      const customAgents = await ProcessConfig.get('acp.customAgents');
      if (!customAgents || !Array.isArray(customAgents) || customAgents.length === 0) return [];

      const enabledAgents = customAgents.filter((agent) => agent.enabled && (agent.defaultCliPath || agent.isPreset));
      if (enabledAgents.length === 0) return [];

      return enabledAgents.map((agent) => ({
        backend: 'custom' as const,
        name: agent.name || 'Custom Agent',
        cliPath: agent.defaultCliPath,
        acpArgs: agent.acpArgs,
        customAgentId: agent.id,
        isPreset: agent.isPreset,
        context: agent.context,
        avatar: agent.avatar,
        presetAgentType: agent.presetAgentType,
      }));
    } catch (error) {
      if (error instanceof Error && (error.message.includes('ENOENT') || error.message.includes('not found'))) {
        return [];
      }
      console.warn('[AcpDetector] Unexpected error loading custom agents:', error);
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------------------

  /**
   * Deduplicate agents by cliPath. First occurrence wins (so ordering of the
   * input arrays determines priority: builtin > extension > custom).
   * Agents without cliPath (e.g. Gemini, presets) are always kept.
   */
  private deduplicate(agents: DetectedAgent[]): DetectedAgent[] {
    const seen = new Set<string>();
    const result: DetectedAgent[] = [];
    // console.debug(
    //   `[AcpDetector] Deduplicating ${agents.length} agents: [ ${agents.map((a) => a.name).join(', ')} ]`
    // );
    // console.debug(
    //   `[AcpDetector] Deduplicating ${agents.length} agents: [ ${agents.map((a) => JSON.stringify(a)).join('\n')} ]`
    // );
    for (const agent of agents) {
      if (agent.cliPath) {
        if (seen.has(agent.cliPath)) continue;
        seen.add(agent.cliPath);
      }
      result.push(agent);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await this.runExclusiveMutation(async () => {
      if (this.isDetected) return;

      console.log('[ACP] Starting agent detection...');
      const startTime = Date.now();

      // Run all three sources in parallel
      const [builtinAgents, extensionAgents, customAgents] = await Promise.all([
        this.detectBuiltinAgents(),
        this.detectExtensionAgents(),
        this.detectCustomAgents(),
      ]);

      this.detectedAgents = this.mergeDetectedAgents({ builtinAgents, extensionAgents, customAgents });
      this.isDetected = true;
      const elapsed = Date.now() - startTime;

      const agentSummary = this.detectedAgents.map((a) => a.name).join(', ');
      console.log(
        `[ACP Detector] Completed in ${elapsed}ms, found ${this.detectedAgents.length} agents: ${agentSummary}`
      );
    });
  }

  getDetectedAgents(): DetectedAgent[] {
    return this.detectedAgents;
  }

  hasAgents(): boolean {
    return this.detectedAgents.length > 0;
  }

  /**
   * Refresh custom agents detection only (called when config changes).
   */
  async refreshCustomAgents(): Promise<void> {
    await this.runExclusiveMutation(async () => {
      const builtinAgents = this.detectedAgents.filter(
        (agent) => agent.backend !== 'gemini' && agent.backend !== 'custom'
      );
      const extensionAgents = this.detectedAgents.filter((agent) => agent.backend === 'custom' && agent.isExtension);
      const customAgents = await this.detectCustomAgents();
      this.detectedAgents = this.mergeDetectedAgents({ builtinAgents, extensionAgents, customAgents });
    });
  }

  /**
   * Refresh builtin CLI agents only (called when system PATH may have changed).
   * Clears cached env so newly installed/removed CLIs are detected.
   * Gemini is a builtin that requires no CLI — it is always kept.
   */
  async refreshBuiltinAgents(): Promise<void> {
    await this.runExclusiveMutation(async () => {
      this.enhancedEnv = undefined;
      // Snapshot old builtin backends for diff logging
      const oldBuiltins = this.detectedAgents
        .filter((a) => a.backend !== 'gemini' && a.backend !== 'custom')
        .map((a) => a.backend);
      const extensionAgents = this.detectedAgents.filter((agent) => agent.backend === 'custom' && agent.isExtension);
      const customAgents = this.detectedAgents.filter((agent) => agent.backend === 'custom' && !agent.isExtension);
      const builtinAgents = await this.detectBuiltinAgents();
      const newBuiltins = builtinAgents.map((a) => a.backend);
      this.detectedAgents = this.mergeDetectedAgents({ builtinAgents, extensionAgents, customAgents });

      const added = newBuiltins.filter((b) => !oldBuiltins.includes(b));
      const removed = oldBuiltins.filter((b) => !newBuiltins.includes(b));
      if (added.length > 0 || removed.length > 0) {
        console.log(`[AcpDetector] Builtin agents changed: +[${added.join(', ')}] -[${removed.join(', ')}]`);
      }
    });
  }

  /**
   * Refresh extension-contributed agents (called after ExtensionRegistry.hotReload).
   * Clears cached env so newly installed CLIs are discoverable.
   */
  async refreshExtensionAgents(): Promise<void> {
    await this.runExclusiveMutation(async () => {
      this.enhancedEnv = undefined;
      const builtinAgents = this.detectedAgents.filter(
        (agent) => agent.backend !== 'gemini' && agent.backend !== 'custom'
      );
      const customAgents = this.detectedAgents.filter((agent) => agent.backend === 'custom' && !agent.isExtension);
      const extensionAgents = await this.detectExtensionAgents();
      this.detectedAgents = this.mergeDetectedAgents({ builtinAgents, extensionAgents, customAgents });
    });
  }

  /**
   * Re-run all three detection paths from scratch.
   * Called after hub install since onInstall hooks may have installed new CLIs.
   * Clears cached env to pick up PATH changes.
   */
  async refreshAll(): Promise<void> {
    await this.runExclusiveMutation(async () => {
      this.enhancedEnv = undefined;

      const [builtinAgents, extensionAgents, customAgents] = await Promise.all([
        this.detectBuiltinAgents(),
        this.detectExtensionAgents(),
        this.detectCustomAgents(),
      ]);

      this.detectedAgents = this.mergeDetectedAgents({ builtinAgents, extensionAgents, customAgents });
    });
  }
}

export const acpDetector = new AcpDetector();
