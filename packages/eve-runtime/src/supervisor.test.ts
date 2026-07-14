import { describe, expect, test } from "bun:test";
import { selectOrphanSandboxPids } from "./supervisor";

/** A realistic `ps -Ao pid=,ppid=,command=` snapshot for one running server. */
const PS = [
  "  100     1 /sbin/launchd",
  " 3000  2000 node /repo/apps/server/src/main.ts",
  " 3100  3000 node /repo/node_modules/eve/bin/eve.js dev --no-ui --port 0",
  // live host 3100 still owns this VM → must be kept
  " 4100  3100 /repo/.../msb sandbox --name eve-sbx-ses-live --sandbox-id 1 --vcpus 1",
  // parent is init: host died → orphan
  " 4200     1 /repo/.../msb sandbox --name eve-sbx-ses-orphanA --sandbox-id 2",
  // parent is a pid we don't own (a dead host) → orphan
  " 4300  9999 /repo/.../msb sandbox --name eve-sbx-ses-orphanB --sandbox-id 3",
  // our throwaway warm VM isn't an eve session sandbox → never reaped
  " 4400  3100 /repo/.../msb sandbox --name xagents-warm",
  // a decoy: an inspection tool whose *args* mention the pattern, not the msb
  // binary itself → must not be mistaken for a VM and killed
  " 4500     1 grep msb sandbox --name eve-sbx-ses-decoy",
].join("\n");

describe("selectOrphanSandboxPids", () => {
  test("reaps eve sandbox VMs not parented by a live host, keeps the rest", () => {
    expect(selectOrphanSandboxPids(PS, new Set([3100]))).toEqual([4200, 4300]);
  });

  test("with no live hosts (boot/shutdown) every eve sandbox VM is an orphan", () => {
    expect(selectOrphanSandboxPids(PS, new Set())).toEqual([4100, 4200, 4300]);
  });

  test("never matches the server, eve host, warm VM, decoy, or unrelated processes", () => {
    const reaped = selectOrphanSandboxPids(PS, new Set([3100]));
    expect(reaped).not.toContain(3000); // server
    expect(reaped).not.toContain(3100); // eve host
    expect(reaped).not.toContain(4400); // xagents-warm
    expect(reaped).not.toContain(4500); // grep whose args mention the pattern
    expect(reaped).not.toContain(100); // launchd
  });

  test("empty/garbage snapshot yields nothing", () => {
    expect(selectOrphanSandboxPids("", new Set())).toEqual([]);
    expect(selectOrphanSandboxPids("not a ps line\n\n", new Set())).toEqual([]);
  });
});
