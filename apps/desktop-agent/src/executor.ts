import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

// Every action is a fixed AppleScript with the step's values passed as `argv`, never interpolated
// into the script text. A step that names an app called `" & do shell script "…` is just a string
// that fails to match a process, which is the whole point: the agent has no path from workflow
// data to arbitrary code, and no shell action exists to reach for in the first place.
// needsAx marks the scripts that read or drive the accessibility tree. When that permission is
// missing macOS does not return an error -- the request simply blocks on a TCC prompt that never
// resolves -- so for those scripts a timeout is the denial, and reporting it as a generic timeout
// sent people hunting for a hung app instead of the checkbox they actually needed.
async function osa(script: string, args: string[] = [], timeoutMs = 20000, needsAx = true): Promise<string> {
  try {
    const { stdout } = await run("osascript", ["-e", script, "--", ...args], { timeout: timeoutMs });
    return stdout.trim();
  } catch (error) {
    // osascript reports the useful part on stderr; execFile puts it on the error object rather
    // than in `message`, and dropping it turned every failure into "Command failed".
    const err = error as { message?: string; stderr?: string; killed?: boolean };
    const detail = [err.stderr, err.message].filter(Boolean).join(" ").trim();
    if (/not allowed assistive access|-1743|-25211|errAEEventNotPermitted/.test(detail)) {
      throw new Error("ACCESSIBILITY_DENIED");
    }
    if (err.killed) throw new Error(needsAx ? "ACCESSIBILITY_DENIED" : `That step timed out after ${timeoutMs}ms`);
    const line = detail.split("\n").find((l) => l.includes("execution error") || l.includes("error"));
    throw new Error((line ?? detail).slice(0, 300));
  }
}

export const DESKTOP_ACTIONS = [
  "desktop.open_app", "desktop.focus_window", "desktop.click", "desktop.type_text",
  "desktop.keypress", "desktop.wait_for", "desktop.verify_text", "desktop.capture_evidence",
] as const;
export type DesktopAction = (typeof DESKTOP_ACTIONS)[number];

export type DesktopEvidence = { app?: string; window?: string; observedAt: string; screenshot?: string };
export type ExecOutcome = { ok: boolean; error?: string; evidence: DesktopEvidence } & Record<string, unknown>;

const str = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${field} is required`);
  return v;
};

// Reads the frontmost window of a named app. Used both to satisfy verify steps and to stamp every
// result with the window the agent was actually looking at.
async function frontWindow(app: string): Promise<string> {
  return osa(
    'on run argv\nset a to item 1 of argv\ntell application "System Events" to tell process a\nif (count of windows) is 0 then return ""\nreturn name of front window\nend tell\nend run',
    [app],
  ).catch(() => "");
}

// Launching and focusing go through `open -a` and System Events rather than
// `tell application X to activate`. That AppleEvent is delivered to the target app's own event
// loop, so an app sitting on a modal panel -- TextEdit's open dialog, for one -- never answers it
// and the script hangs until it is killed. System Events is a different process and always
// answers, which makes focus deterministic regardless of what the target app is showing.
async function activate(app: string) {
  await run("open", ["-a", app], { timeout: 15000 });
}

async function frontmost(app: string) {
  await osa(
    'on run argv\ntell application "System Events" to set frontmost of process (item 1 of argv) to true\nend run',
    [app],
    8000,
  );
}

async function appRunning(app: string): Promise<boolean> {
  // Process existence is answerable without Accessibility, so this stays usable (and honest) even
  // before the permission is granted -- it is what open_app and wait_for confirm themselves with.
  const out = await osa(
    'on run argv\ntell application "System Events" to return (exists process (item 1 of argv)) as string\nend run',
    [app], 8000, false,
  ).catch(() => "false");
  return out === "true";
}

// The grant names the destination application; nothing may act on anything else. This is enforced
// again here rather than trusted from the task body, so a tampered task cannot redirect the agent.
export function assertDestination(action: string, input: Record<string, unknown>, destination: string | null) {
  if (!destination) return;
  const app = typeof input.app === "string" ? input.app : typeof input.window === "string" ? input.window : null;
  if (app && app !== destination) {
    throw new Error(`This grant only authorizes ${destination}, but the step asked for ${app}`);
  }
}

export async function executeDesktopAction(
  action: string,
  input: Record<string, unknown>,
  opts: { captureAllowed: boolean },
): Promise<ExecOutcome> {
  const stamp = () => new Date().toISOString();
  switch (action) {
    case "desktop.open_app": {
      const app = str(input.app, "app");
      await activate(app);
      // Confirm rather than assume: a launch that silently failed must not report success.
      for (let i = 0; i < 20 && !(await appRunning(app)); i++) await new Promise((r) => setTimeout(r, 250));
      if (!(await appRunning(app))) return { ok: false, error: `${app} did not start`, evidence: { app, observedAt: stamp() } };
      return { ok: true, app, evidence: { app, window: await frontWindow(app), observedAt: stamp() } };
    }
    case "desktop.focus_window": {
      const app = str(input.app, "app");
      if (!(await appRunning(app))) await activate(app);
      await frontmost(app);
      const window = await frontWindow(app);
      return { ok: true, app, window, evidence: { app, window, observedAt: stamp() } };
    }
    case "desktop.click": {
      const app = str(input.app, "app");
      const element = str(input.element, "element");
      const role = typeof input.role === "string" ? input.role : "button";
      await osa(
        'on run argv\nset a to item 1 of argv\nset e to item 2 of argv\nset r to item 3 of argv\ntell application "System Events" to tell process a\nset frontmost to true\nif r is "menu" then\nclick menu item e of menu 1 of menu bar item 1 of menu bar 1\nelse\nclick (first UI element whose name is e)\nend if\nend tell\nend run',
        [app, element, role],
      );
      return { ok: true, clicked: element, evidence: { app, window: await frontWindow(app), observedAt: stamp() } };
    }
    case "desktop.type_text": {
      const app = str(input.app, "app");
      const text = str(input.text, "text");
      await frontmost(app);
      await osa('on run argv\ntell application "System Events" to keystroke (item 1 of argv)\nend run', [text]);
      return { ok: true, typed: true, evidence: { app, window: await frontWindow(app), observedAt: stamp() } };
    }
    case "desktop.keypress": {
      const app = str(input.app, "app");
      const key = str(input.key, "key");
      const modifiers = Array.isArray(input.modifiers) ? (input.modifiers as unknown[]).map(String) : [];
      const allowed = new Set(["command", "option", "control", "shift"]);
      const bad = modifiers.find((m) => !allowed.has(m));
      if (bad) return { ok: false, error: `Unsupported modifier ${bad}`, evidence: { app, observedAt: stamp() } };
      const using = modifiers.length ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}` : "";
      await frontmost(app);
      await osa(`on run argv\ntell application "System Events" to keystroke (item 1 of argv)${using}\nend run`, [key]);
      return { ok: true, pressed: key, evidence: { app, window: await frontWindow(app), observedAt: stamp() } };
    }
    case "desktop.wait_for": {
      const app = str(input.app, "app");
      const window = typeof input.window === "string" ? input.window : null;
      const timeoutMs = Math.min(Number(input.timeoutMs) || 10000, 60000);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await appRunning(app)) {
          if (!window) return { ok: true, appeared: true, evidence: { app, window: await frontWindow(app), observedAt: stamp() } };
          const current = await frontWindow(app);
          if (current.includes(window)) return { ok: true, appeared: true, window: current, evidence: { app, window: current, observedAt: stamp() } };
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return { ok: false, error: `Timed out waiting for ${window ?? app}`, evidence: { app, observedAt: stamp() } };
    }
    case "desktop.verify_text": {
      const app = str(input.app, "app");
      const expected = str(input.expected, "expected");
      // Reads the window title, or the value of a named field when the step points at one.
      const field = typeof input.element === "string" ? input.element : null;
      const actual = field
        ? await osa(
            'on run argv\nset a to item 1 of argv\ntell application "System Events" to tell process a\nreturn value of (first UI element whose name is (item 2 of argv)) as string\nend tell\nend run',
            [app, field],
          )
        : await frontWindow(app);
      const verified = actual.includes(expected);
      return { ok: true, verified, actual, expected, evidence: { app, window: actual, observedAt: stamp() } };
    }
    case "desktop.capture_evidence": {
      const app = str(input.app, "app");
      if (!opts.captureAllowed) {
        return { ok: false, error: "SCREEN_RECORDING_DENIED", evidence: { app, observedAt: stamp() } };
      }
      // Only the target application's own front window is ever captured -- never the full screen,
      // never another app, so nothing unrelated to the approved step can end up in evidence.
      const dir = await mkdtemp(join(tmpdir(), "amazflow-evidence-"));
      const file = join(dir, "window.png");
      try {
        const id = await osa(
          'on run argv\ntell application "System Events" to tell process (item 1 of argv)\nreturn (value of attribute "AXWindowNumber" of front window) as string\nend tell\nend run',
          [app],
        ).catch(() => "");
        if (!id) throw new Error(`${app} has no visible window to capture`);
        await run("screencapture", ["-x", "-o", "-l", id, file], { timeout: 15000 });
        const png = await readFile(file);
        return {
          ok: true, captured: true,
          evidence: { app, window: await frontWindow(app), observedAt: stamp(), screenshot: `data:image/png;base64,${png.toString("base64")}` },
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
    default:
      return { ok: false, error: `${action} is not an action this agent performs`, evidence: { observedAt: stamp() } };
  }
}

// Accessibility is the one permission every action needs. Probed with a read-only query so the
// check itself can never change anything on the machine.
export async function checkPermissions(): Promise<{ accessibility: boolean; screenRecording: boolean }> {
  // Counting processes does NOT require Accessibility, so it used to report "granted" on a Mac
  // that would refuse every real action. Reading a UI attribute does require it, and reading the
  // frontmost flag changes nothing.
  let accessibility = true;
  try {
    await osa('tell application "System Events" to return (frontmost of first process) as string', [], 6000);
  } catch {
    // Any failure of an accessibility-tree read -- refusal or a blocked TCC prompt -- means the
    // agent cannot drive this Mac yet.
    accessibility = false;
  }
  // CGPreflight isn't reachable without a native module; a zero-length capture of a 1x1 region is
  // the cheapest honest probe and captures nothing meaningful either way.
  let screenRecording = true;
  const dir = await mkdtemp(join(tmpdir(), "amazflow-probe-"));
  const probe = join(dir, "p.png");
  try {
    await run("screencapture", ["-x", "-R", "0,0,1,1", probe], { timeout: 8000 });
    const png = await readFile(probe);
    screenRecording = png.length > 0;
  } catch {
    screenRecording = false;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return { accessibility, screenRecording };
}
