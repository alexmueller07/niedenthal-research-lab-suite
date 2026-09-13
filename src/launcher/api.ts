// Typed wrappers over the machine_* commands.
//
// There is no device key here, and no field for one. Round Robin still
// authenticates every call, but the key is compiled into the build (see
// src-tauri/src/machine.rs) — nobody types it, so no screen has to show it,
// hide it, or explain it.

import { invoke } from "@tauri-apps/api/core";

export type RoleName = "record" | "station" | "control";

export interface MachinePublic {
  role: string | null;
  roundRobinUrl: string | null;
  researchDriveRoot: string | null;
  /** False when the folder is this computer's own rather than the shared drive. */
  driveIsShared: boolean;
  /** Folders this machine has used before, newest first — the one-click chips. */
  recentDriveRoots: string[];
  migratedFrom: string | null;
}

export interface MachineUpdate {
  roundRobinUrl?: string;
  researchDriveRoot?: string;
}

export interface MachineHealth {
  configured: boolean;
  serverOk: boolean;
  sessionCount: number | null;
  serverDetail: string | null;
  driveConfigured: boolean;
  driveOk: boolean;
}

export const machineStatus = () => invoke<MachinePublic>("machine_status");

/** Research Drive folders that exist on this computer right now. Best-effort. */
export const detectDriveRoots = () => invoke<string[]>("detect_drive_roots");

export const machineConfigure = (update: MachineUpdate) =>
  invoke<MachinePublic>("machine_configure", { update });

export const machineTest = () => invoke<string>("machine_test");

/** Structured probes for the home screen's status chips. */
export const machineHealth = () => invoke<MachineHealth>("machine_health");

export interface CheckResult {
  label: string;
  passed: boolean | null;
  detail: string;
}

/** Every precondition for a session, checked in one click. */
export const machineSelfTest = () => invoke<CheckResult[]>("machine_self_test");

/**
 * Opens the chosen mode's window and closes the launcher.
 *
 * With `force`, a mode already running is asked to hand over first: Rust sends
 * it a `leave-mode` event, that mode flushes whatever it holds and calls
 * `leave_mode` itself. So a forced call resolving does NOT mean the switch
 * finished — poll `runningMode` for that, and fall back to `forceCloseMode`
 * if nothing moves.
 */
export const launchMode = (role: RoleName, force = false) =>
  invoke<void>("launch_mode", { role, force });

/** Which mode window is open right now, or null for none. */
export const runningMode = () => invoke<RoleName | null>("running_mode");

/** Last resort when a mode was asked to close and did not. */
export const forceCloseMode = () => invoke<void>("force_close_mode");

/** Closes the whole app from the chooser. */
export const quitSuite = () => invoke<void>("quit_suite");

/** The error `launch_mode` returns when a mode is already running, un-forced. */
export const MODE_RUNNING_PREFIX = "__MODE_RUNNING__";

export function modeAlreadyRunning(error: unknown): RoleName | null {
  const text = String(error);
  const at = text.indexOf(MODE_RUNNING_PREFIX);
  if (at < 0) return null;
  const label = text.slice(at + MODE_RUNNING_PREFIX.length).trim();
  if (label.startsWith("recorder")) return "record";
  if (label.startsWith("station")) return "station";
  if (label.startsWith("control")) return "control";
  return null;
}
