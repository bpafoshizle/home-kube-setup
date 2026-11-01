// Canonical fail-closed process wrapper shared by the two pinned Node images.
// This is NOT fencing: every new Pod must also be operator-released BEFORE
// scheduling/mounting. An unreachable former worker must be physically fenced.
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function requireCondition(value, code) {
  if (!value) throw new Error(code);
}

export function diagnosticCode(error) {
  // Explicit vocabulary only: an arbitrary uppercase error message can still be
  // a credential/content fragment, so never infer safety from its character set.
  const filesystem = {EIO: 'STORAGE_IO_ERROR', EACCES: 'STATE_ACCESS_DENIED',
    ENOENT: 'STATE_PATH_MISSING', ENOSPC: 'STORAGE_FULL', EROFS: 'STORAGE_READ_ONLY'};
  if (Object.hasOwn(filesystem, error?.code)) return filesystem[error.code];
  if (error instanceof SyntaxError) return 'STATE_JSON_INVALID';
  const known = new Set(['MOUNTINFO_INVALID', 'CAPACITY_UNKNOWN', 'CAPACITY_POLICY_INVALID',
    'CAPACITY_CRITICAL', 'INODES_CRITICAL', 'OBSERVED_POLICY_INVALID', 'OBSERVED_STATE_INVALID',
    'OBSERVED_FILE_INVALID', 'CONFIG_INVALID', 'OWNER_NOT_RELEASED', 'MOUNT_CONFIG_INVALID',
    'EXPECTED_MOUNT_ABSENT', 'MARKER_CONFIG_INVALID', 'IDENTITY_MARKER_INVALID',
    'STORAGE_IDENTITY_MISMATCH', 'STATE_CONFIG_INVALID', 'REQUIRED_STATE_ABSENT',
    'PRIVATE_STATE_PERMISSIONS_INVALID', 'REQUIRED_STATE_IDENTITY_MISMATCH',
    'STORAGE_CHECK_TIMEOUT', 'INVOCATION_INVALID']);
  return known.has(error?.message) ? error.message : 'CHECK_FAILED';
}

function unescapeMount(value) {
  return value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

async function readJsonStable(io, path) {
  // Upstream JSON writers are not all atomic; tolerate a short in-progress write,
  // but never turn a persistently malformed state file into empty/default state.
  for (let attempt = 0; ; attempt++) {
    try { return JSON.parse(await io.readFile(path, 'utf8')); } catch (error) {
      if (!(error instanceof SyntaxError) || attempt >= 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}

export function parseMounts(text) {
  return text.trim().split('\n').filter(Boolean).map(line => {
    const [before, after] = line.split(' - ');
    requireCondition(before && after, 'MOUNTINFO_INVALID');
    const left = before.split(' ');
    const right = after.split(' ');
    return { path: unescapeMount(left[4]), type: right[0], source: unescapeMount(right[1]) };
  });
}

export function checkCapacity(stats, policy) {
  const blocks = BigInt(stats.blocks);
  const available = BigInt(stats.bavail);
  const freeBytes = available * BigInt(stats.bsize);
  requireCondition(blocks > 0n, 'CAPACITY_UNKNOWN');
  const criticalPercent = BigInt(policy.criticalPercent ?? 10);
  const warningPercent = BigInt(policy.warningPercent ?? 20);
  requireCondition(criticalPercent > 0n && criticalPercent < warningPercent && warningPercent < 100n,
    'CAPACITY_POLICY_INVALID');
  requireCondition(freeBytes > BigInt(policy.minimumFreeBytes ?? 134217728) &&
    available * 100n > blocks * criticalPercent, 'CAPACITY_CRITICAL');
  const files = BigInt(stats.files);
  const freeFiles = BigInt(stats.ffree);
  if (files > 0n) requireCondition(freeFiles * 100n > files * criticalPercent, 'INODES_CRITICAL');
  return available * 100n <= blocks * warningPercent ||
    (files > 0n && freeFiles * 100n <= files * warningPercent);
}

async function verifyObservedFiles(config, io) {
  const policy = config.observedFiles;
  if (!policy) return;
  requireCondition(policy.stateFile === '/data/.guard-observed-files.json' &&
    Array.isArray(policy.paths) && policy.paths.length > 0, 'OBSERVED_POLICY_INVALID');
  const info = await io.lstat(policy.stateFile);
  requireCondition(info.isFile() && !info.isSymbolicLink(), 'OBSERVED_STATE_INVALID');
  const state = JSON.parse(await io.readFile(policy.stateFile, 'utf8'));
  requireCondition(state.vault === config.vault && state.version === 1 && state.observed &&
    JSON.stringify(Object.keys(state.observed).sort()) === JSON.stringify([...policy.paths].sort()), 'OBSERVED_STATE_INVALID');
  let changed = false;
  for (const path of policy.paths) {
    requireCondition(typeof state.observed[path] === 'boolean' && !path.split('/').includes('..') &&
      config.mounts.some(mount => path.startsWith(mount.path + '/')), 'OBSERVED_POLICY_INVALID');
    try {
      const file = await io.lstat(path);
      requireCondition(file.isFile() && !file.isSymbolicLink(), 'OBSERVED_FILE_INVALID');
      requireCondition(Array.isArray(await readJsonStable(io, path)), 'OBSERVED_FILE_INVALID');
      if (!state.observed[path]) { state.observed[path] = true; changed = true; }
    } catch (error) {
      if (error.code !== 'ENOENT' || state.observed[path]) throw error;
    }
  }
  if (changed) {
    if (io.persistObservedState) {
      await io.persistObservedState(policy.stateFile, state);
    } else {
      // Bootstrap creates this checkpoint; normal startup never recreates it.
      // An interrupted update leaves a temporary file and fails closed on retry.
      const temporary = policy.stateFile + '.new';
      const file = await io.open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await io.rename(temporary, policy.stateFile);
      const directory = await io.open('/data', 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
}

export async function verify(config, dependencies = fs) {
  const { readFile, lstat, statfs } = dependencies;
  requireCondition(config.vault && config.podUID && config.node && config.releaseFile &&
    Array.isArray(config.mounts) && config.mounts.length > 0, 'CONFIG_INVALID');
  const release = JSON.parse(await readFile(config.releaseFile, 'utf8'));
  requireCondition(release.vault === config.vault && release.podUID === config.podUID &&
    release.node === config.node, 'OWNER_NOT_RELEASED');
  const mounts = parseMounts(await readFile('/proc/self/mountinfo', 'utf8'));
  let warning = false;
  for (const expected of config.mounts) {
    requireCondition(expected.path && expected.marker && expected.identity &&
      Array.isArray(expected.types) && expected.types.length > 0 &&
      typeof expected.source === 'string' && expected.source.length > 0, 'MOUNT_CONFIG_INVALID');
    // Require an actual mount at this exact path, never a directory underneath
    // the image root. Reject stacked mount ambiguity instead of guessing.
    const actual = mounts.filter(mount => mount.path === expected.path);
    requireCondition(actual.length === 1 && expected.types.includes(actual[0].type) &&
      actual[0].source === expected.source, 'EXPECTED_MOUNT_ABSENT');
    requireCondition(!expected.marker.includes('/') && expected.marker !== '..', 'MARKER_CONFIG_INVALID');
    const marker = `${expected.path}/${expected.marker}`;
    const markerStat = await lstat(marker);
    requireCondition(markerStat.isFile() && !markerStat.isSymbolicLink(), 'IDENTITY_MARKER_INVALID');
    const identity = JSON.parse(await readFile(marker, 'utf8'));
    requireCondition(Object.entries(expected.identity).every(([key, value]) => identity[key] === value),
      'STORAGE_IDENTITY_MISMATCH');
    for (const required of expected.required ?? []) {
      requireCondition(required.path && !required.path.startsWith('/') &&
        !required.path.split('/').includes('..'), 'STATE_CONFIG_INVALID');
      const state = await lstat(`${expected.path}/${required.path}`);
      requireCondition(!state.isSymbolicLink() && (required.directory ? state.isDirectory() :
        state.isFile() && (required.format === 'json' || state.size > 0)), 'REQUIRED_STATE_ABSENT');
      if (required.private) requireCondition((state.mode & 0o077) === 0, 'PRIVATE_STATE_PERMISSIONS_INVALID');
      if (required.format === 'json') {
        const value = await readJsonStable(dependencies, `${expected.path}/${required.path}`);
        if (required.identity) requireCondition(value && Object.entries(required.identity).every(
          ([key, expectedValue]) => value[key] === expectedValue), 'REQUIRED_STATE_IDENTITY_MISMATCH');
      }
    }
    warning = checkCapacity(await statfs(expected.path, { bigint: true }), expected.capacity ?? {}) || warning;
  }
  await verifyObservedFiles(config, dependencies);
  return { warning };
}

export async function boundedCheck(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('STORAGE_CHECK_TIMEOUT')), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  process.umask(0o077);
  const [configFile, command, ...args] = process.argv.slice(2);
  requireCondition(configFile && command && process.env.POD_UID && process.env.NODE_NAME, 'INVOCATION_INVALID');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  config.podUID = process.env.POD_UID;
  config.node = process.env.NODE_NAME;
  const check = () => boundedCheck(() => verify(config), 5000);
  await check(); // No child starts before expected mounts, state and release pass.
  // Suppress unreviewed application logs: upstream output can contain settings
  // or note content. Application-specific sanitized health is a separate gate.
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  let stopping = false;
  let failedStop = false;
  let busy = false;
  let interval;
  function stop(failed) {
    if (stopping) return;
    stopping = true;
    failedStop = failed;
    clearInterval(interval);
    // Do not include exceptions, filesystem paths, credentials or file contents.
    console.error(failed ? 'PILOT_GUARD_STOPPED_UNSAFE' : 'PILOT_GUARD_SHUTDOWN');
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* child may already have exited */ }
    setTimeout(() => {
      console.error('PILOT_GUARD_FORCED_STOP');
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
      process.exit(1);
    }, 15000);
  }
  child.on('error', () => stop(true));
  child.on('exit', code => {
    clearInterval(interval);
    process.exit(stopping ? (failedStop || code !== 0 ? 1 : 0) : (code === 0 ? 0 : 1));
  });
  process.on('SIGTERM', () => stop(false));
  process.on('SIGINT', () => stop(false));
  interval = setInterval(async () => {
    if (busy || stopping) return;
    busy = true;
    try {
      const result = await check();
      if (result.warning) console.error('PILOT_GUARD_CAPACITY_WARNING');
    } catch (error) {
      console.error('PILOT_GUARD_FAILURE reason=' + diagnosticCode(error));
      stop(true);
    } finally {
      busy = false;
    }
  }, 2000);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => {
    console.error('PILOT_GUARD_START_REFUSED');
    console.error('PILOT_GUARD_FAILURE reason=' + diagnosticCode(error));
    process.exit(1);
  });
}
