// Streaming encrypted backup core; never call on live application roots.
// No cluster access/release authority. See BACKUP_RECOVERY.md for prerequisites.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID} from 'node:crypto';
import {Readable, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip, createGunzip} from 'node:zlib';
import {StringDecoder} from 'node:string_decoder';
import path from 'node:path';

const MAGIC = Buffer.from('PILOTBACKUP001\n');
const ROOTS = ['configuration', 'cortex', 'livesync', 'vault'];
const MAX_LINE = 131072;
const MAX_ENTRIES = 100000;
const MAX_BYTES = 16 * 1024 ** 3;
const GENERATION = /^backup-\d{13}-[a-f0-9-]{36}$/;
function demand(ok) { if (!ok) throw new Error('BACKUP_REFUSED'); }
function line(record) { return Buffer.from(JSON.stringify(record) + '\n'); }
function digest() { return createHash('sha256'); }
async function* readRange(fd, start, end) {
  for (let position = start; position <= end;) {
    const buffer = Buffer.alloc(Math.min(65536, end - position + 1));
    const {bytesRead} = await fd.read(buffer, 0, buffer.length, position);
    demand(bytesRead > 0);
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}
async function writeBytes(fd, chunk, position) {
  let offset = 0;
  while (offset < chunk.length) {
    const {bytesWritten} = await fd.write(chunk, offset, chunk.length - offset, position + offset);
    demand(bytesWritten > 0);
    offset += bytesWritten;
  }
  return offset;
}
function safePath(value) {
  demand(typeof value === 'string' && Buffer.byteLength(value) <= 4096 &&
    !value.includes('\\') && !/[\x00-\x1f\x7f]/.test(value));
  const parts = value.split('/');
  demand(parts.every(p => p && p !== '.' && p !== '..') && ROOTS.includes(parts[0]));
  return value;
}
async function syncDirectory(directory) {
  const fd = await fs.open(directory, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
async function realDirectory(directory) {
  demand(path.isAbsolute(directory) && await fs.realpath(directory) === directory);
  const info = await fs.lstat(directory);
  demand(info.isDirectory() && !info.isSymbolicLink());
}
function overlaps(a, b) { return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep); }
function stamp(info) {
  return [info.dev, info.ino, info.mode, info.nlink, info.size, info.mtimeNs, info.ctimeNs].map(String);
}
async function inventory(roots) {
  const entries = [];
  let total = 0;
  async function walk(source, relative) {
    safePath(relative);
    const info = await fs.lstat(source, {bigint: true});
    demand(info.isDirectory() || (info.isFile() && info.nlink === 1n));
    const size = info.isFile() ? Number(info.size) : 0;
    total += size;
    demand(Number.isSafeInteger(size) && size >= 0 && total <= MAX_BYTES && entries.length < MAX_ENTRIES);
    entries.push({source, path: relative, kind: info.isDirectory() ? 'directory' : 'file',
      mode: Number(info.mode & 0o777n), size, stamp: stamp(info)});
    if (info.isDirectory()) for (const name of (await fs.readdir(source)).sort()) {
      await walk(path.join(source, name), relative + '/' + name);
    }
  }
  for (const root of ROOTS) await walk(roots[root], root);
  return entries;
}
async function* records(roots, metadata) {
  const plan = await inventory(roots);
  const summary = digest();
  let files = 0;
  let bytes = 0;
  yield line({kind: 'begin', version: 1, ...metadata});
  for (const entry of plan) {
    const header = {kind: entry.kind, path: entry.path, mode: entry.mode, size: entry.size};
    summary.update(line(header));
    yield line(header);
    if (entry.kind !== 'file') continue;
    const fd = await fs.open(entry.source, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      demand(JSON.stringify(stamp(await fd.stat({bigint: true}))) === JSON.stringify(entry.stamp));
      const hash = digest();
      let copied = 0;
      for await (const chunk of readRange(fd, 0, entry.size - 1)) {
        copied += chunk.length;
        demand(copied <= entry.size);
        hash.update(chunk);
        yield line({kind: 'chunk', data: chunk.toString('base64')});
      }
      demand(copied === entry.size &&
        JSON.stringify(stamp(await fd.stat({bigint: true}))) === JSON.stringify(entry.stamp));
      const end = {kind: 'end', sha256: hash.digest('hex')};
      summary.update(line(end));
      yield line(end);
      files++;
      bytes += copied;
    } finally { await fd.close(); }
  }
  demand(JSON.stringify(await inventory(roots)) === JSON.stringify(plan));
  yield line({kind: 'complete', files, bytes, entries: plan.length, inventorySHA256: summary.digest('hex')});
}

async function* jsonLines(stream) {
  let pending = '';
  const decoder = new StringDecoder('utf8');
  for await (const chunk of stream) {
    pending += decoder.write(chunk);
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      demand(end <= MAX_LINE);
      const value = pending.slice(0, end);
      pending = pending.slice(end + 1);
      demand(!value.includes('\ufffd'));
      yield JSON.parse(value);
    }
    demand(pending.length <= MAX_LINE);
  }
  demand(pending === '' && decoder.end() === '');
}

async function scan(stream, output, expected) {
  const names = new Set();
  const directories = [];
  const summary = digest();
  let begin, complete, active, files = 0, bytes = 0;
  try {
    for await (const record of jsonLines(stream)) {
      demand(record && !complete);
      if (!begin) {
        demand(record.kind === 'begin' && record.version === 1 &&
          record.vault === expected.vault && record.transactionID === expected.transactionID);
        begin = record;
      } else if (record.kind === 'directory' || record.kind === 'file') {
        demand(!active && names.size < MAX_ENTRIES);
        safePath(record.path);
        demand(!names.has(record.path) && Number.isInteger(record.mode) && record.mode >= 0 &&
          record.mode <= 0o777 && Number.isSafeInteger(record.size) && record.size >= 0 && record.size <= MAX_BYTES);
        if (record.path.includes('/')) demand(directories.some(d => d.path === path.posix.dirname(record.path)));
        names.add(record.path);
        summary.update(line(record));
        if (record.kind === 'directory') {
          demand(record.size === 0);
          directories.push(record);
          if (output) await fs.mkdir(path.join(output, record.path), {mode: 0o700});
        } else {
          active = {record, bytes: 0, hash: digest(),
            fd: output ? await fs.open(path.join(output, record.path), 'wx', 0o600) : null};
        }
      } else if (record.kind === 'chunk') {
        demand(active && typeof record.data === 'string' && record.data.length <= 87384);
        const chunk = Buffer.from(record.data, 'base64');
        demand(chunk.length > 0 && chunk.toString('base64') === record.data);
        active.bytes += chunk.length;
        bytes += chunk.length;
        demand(active.bytes <= active.record.size && bytes <= MAX_BYTES);
        active.hash.update(chunk);
        if (active.fd) {
          let offset = 0;
          while (offset < chunk.length) {
            const {bytesWritten} = await active.fd.write(chunk, offset, chunk.length - offset);
            demand(bytesWritten > 0);
            offset += bytesWritten;
          }
        }
      } else if (record.kind === 'end') {
        demand(active && active.bytes === active.record.size && record.sha256 === active.hash.digest('hex'));
        summary.update(line(record));
        if (active.fd) {
          await active.fd.chmod(active.record.mode);
          await active.fd.sync();
          await active.fd.close();
        }
        active = null;
        files++;
      } else if (record.kind === 'complete') {
        demand(!active && record.files === files && record.bytes === bytes && record.entries === names.size &&
          record.inventorySHA256 === summary.digest('hex') && ROOTS.every(root => directories.some(dir => dir.path === root)));
        complete = record;
      } else demand(false);
    }
    demand(begin && complete && !active);
    if (output) {
      for (const dir of directories.reverse()) {
        await fs.chmod(path.join(output, dir.path), dir.mode);
        await syncDirectory(path.join(output, dir.path));
      }
      await syncDirectory(output);
    }
    return complete;
  } finally { if (active?.fd) await active.fd.close(); }
}

async function encryptedInput(fd, key) {
  demand(Buffer.isBuffer(key) && key.length === 32);
  const {size} = await fd.stat();
  const prefix = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  demand(size > prefix.length + 16 && (await fd.read(prefix, 0, prefix.length, 0)).bytesRead === prefix.length &&
    prefix.subarray(0, MAGIC.length).equals(MAGIC) && (await fd.read(tag, 0, 16, size - 16)).bytesRead === 16);
  const decipher = createDecipheriv('aes-256-gcm', key, prefix.subarray(MAGIC.length));
  decipher.setAAD(prefix);
  decipher.setAuthTag(tag);
  return {source: Readable.from(readRange(fd, prefix.length, size - 17)), decipher};
}

async function verifyArchiveInternal(archive, key, expected, output) {
  const fd = await fs.open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    demand((await fd.stat()).isFile());
    // Authenticate the entire ciphertext BEFORE parsing or restoring any bytes.
    const first = await encryptedInput(fd, key);
    await pipeline(first.source, first.decipher, new Writable({write(_chunk, _encoding, done) { done(); }}));
    if (output) {
      await realDirectory(path.dirname(output));
      const parent = await fs.stat(path.dirname(output));
      demand((parent.mode & 0o077) === 0 && parent.uid === process.getuid());
      demand(!overlaps(await fs.realpath(archive), output));
      await fs.mkdir(output, {mode: 0o700}); // Never merge/overwrite existing data.
    }
    const second = await encryptedInput(fd, key);
    const unzip = createGunzip();
    let result;
    await pipeline(second.source, second.decipher, unzip, async source => { result = await scan(source, output, expected); });
    return result;
  } finally { await fd.close(); }
}

async function seal(file, roots, key, metadata) {
  demand(Buffer.isBuffer(key) && key.length === 32);
  const fd = await fs.open(file, 'wx', 0o600);
  try {
    const prefix = Buffer.concat([MAGIC, randomBytes(12)]);
    await fd.writeFile(prefix);
    const cipher = createCipheriv('aes-256-gcm', key, prefix.subarray(MAGIC.length));
    cipher.setAAD(prefix);
    let position = prefix.length;
    await pipeline(Readable.from(records(roots, metadata)), createGzip(), cipher,
      new Writable({write(chunk, _encoding, done) {
        writeBytes(fd, chunk, position).then(count => { position += count; done(); }, done);
      }}));
    demand((await fd.write(cipher.getAuthTag(), 0, 16, (await fd.stat()).size)).bytesWritten === 16);
    await fd.sync();
  } finally { await fd.close(); }
}

async function createBackupInternal({destination, roots, key, vault, transactionID, keep = 2}) {
  demand(typeof vault === 'string' && vault.length > 0 && typeof transactionID === 'string' && transactionID.length > 0 &&
    Number.isSafeInteger(keep) && keep >= 2 && keep <= 100 && Object.keys(roots).sort().join() === ROOTS.join());
  await realDirectory(destination);
  const destinationInfo = await fs.stat(destination);
  demand((destinationInfo.mode & 0o077) === 0 && destinationInfo.uid === process.getuid());
  for (const root of ROOTS) {
    await realDirectory(roots[root]);
    demand(!overlaps(destination, roots[root]));
    for (const other of ROOTS) if (other !== root) demand(!overlaps(roots[root], roots[other]));
  }
  const lock = path.join(destination, '.backup-lock');
  await fs.mkdir(lock, {mode: 0o700}); // NFS-atomic; never steal a stale lock.
  try {
    const createdAt = Date.now();
    const existing = (await fs.readdir(destination)).filter(name => GENERATION.test(name));
    // A backwards/equal clock must not make pruning immediately delete the new
    // generation while returning a successful receipt pointing at missing data.
    demand(existing.every(name => Number(name.split('-')[1]) < createdAt));
    const generation = `backup-${createdAt}-${randomUUID()}`;
    const temporary = path.join(destination, '.incomplete-' + generation);
    await fs.mkdir(temporary, {mode: 0o700});
    const metadata = {vault, transactionID};
    await seal(path.join(temporary, 'bundle.enc'), roots, key, metadata);
    const verified = await verifyArchive(path.join(temporary, 'bundle.enc'), key, metadata);
    const receipt = {version: 1, generation, ...metadata, ...verified};
    const receiptFile = await fs.open(path.join(temporary, 'receipt.json'), 'wx', 0o600);
    try { await receiptFile.writeFile(JSON.stringify(receipt)); await receiptFile.sync(); }
    finally { await receiptFile.close(); }
    await syncDirectory(temporary);
    await fs.rename(temporary, path.join(destination, generation));
    await syncDirectory(destination);

    // Verify ALL published generations before pruning ANY. Corrupt/unknown old
    // receipts, wrong keys or interrupted reads preserve every existing backup.
    const successes = (await fs.readdir(destination)).filter(name => GENERATION.test(name)).sort().reverse();
    for (const name of successes) {
      const directory = path.join(destination, name);
      await realDirectory(directory);
      const receiptPath = path.join(directory, 'receipt.json');
      demand((await fs.lstat(receiptPath)).isFile());
      const old = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
      demand(old.version === 1 && old.generation === name && old.vault === vault);
      const result = await verifyArchive(path.join(directory, 'bundle.enc'), key, old);
      demand(result.inventorySHA256 === old.inventorySHA256);
    }
    for (const name of successes.slice(keep)) {
      // Deliberately remove only known files in our exact generation namespace;
      // unexpected extra files stop pruning instead of recursive broad deletion.
      const directory = path.join(destination, name);
      demand((await fs.readdir(directory)).sort().join() === 'bundle.enc,receipt.json');
      const retired = path.join(destination, '.retired-' + name);
      await fs.rename(directory, retired);
      await syncDirectory(destination);
      await fs.unlink(path.join(retired, 'bundle.enc'));
      await fs.unlink(path.join(retired, 'receipt.json'));
      await fs.rmdir(retired);
    }
    await syncDirectory(destination);
    return receipt;
  } finally {
    await fs.rmdir(lock);
    await syncDirectory(destination);
  }
}

function sanitized(error) {
  // Never let a source filename, JSON fragment, credential or note content enter
  // an unhandled exception log. Keep only a small fixed filesystem error code.
  const safe = new Error('BACKUP_ARCHIVE_REFUSED');
  if (['EEXIST', 'ENOENT', 'EIO', 'ENOSPC', 'EACCES', 'EROFS'].includes(error?.code)) safe.code = error.code;
  return safe;
}
export async function verifyArchive(...args) {
  try { return await verifyArchiveInternal(...args); } catch (error) { throw sanitized(error); }
}
export async function createBackup(...args) {
  try { return await createBackupInternal(...args); } catch (error) { throw sanitized(error); }
}
