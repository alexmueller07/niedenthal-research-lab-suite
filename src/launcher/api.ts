// Typed wrappers over the machine_* commands. The shared secret is
// write-only from every webview: it goes in through machineConfigure and the
// status reports only whether one exists.

import { invoke } from "@tauri-apps/api/core";

export type RoleName = "record" | "station" | "control";

export interface MachinePublic {
  role: string | null;
  roundRobinUrl: string | null;
  researchDriveRoot: string | null;
  secretConfigured: boolean;
  migratedFrom: string | null;
}

export interface MachineUpdate {
  roundRobinUrl?: string;
  /** Empty string clears it; omitting the field leaves it untouched. */
  roundRobinSecret?: string;
  researchDriveRoot?: string;
}

export const machineStatus = () => invoke<MachinePublic>("machine_status");

export const machineConfigure = (update: MachineUpdate) =>
  invoke<MachinePublic>("machine_configure", { update });

export const machineTest = () => invoke<string>("machine_test");

/** Persists the role and restarts the app into it. Does not resolve. */
export const machineFinishSetup = (role: RoleName) =>
  invoke<void>("machine_finish_setup", { role });
