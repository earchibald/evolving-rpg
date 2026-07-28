import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { weave, renderWoven } from '../src/witness/weave.js';
import { listenerPrompt } from '../src/witness/listener.js';
import type { TranscribedTake, SpokenSegment } from '../src/witness/weave.js';
import type { TraceMark } from '../src/witness/trace.js';
import type { ListenerPacket } from '../src/witness/listener.js';

/**
 * The dev server's side of the witness and the listener.
 *
 * Two endpoints. `/__witness` takes a recorded WAV and transcribes it
 * locally — a small Swift CLI on SpeechAnalyzer (macOS 26+), compiled once
 * into node_modules/.cache (sub-second) and run per take (~12x real-time,
 * on-device, free). `/__listener` takes a submitted run, waits for any
 * transcription still in the air, weaves speech and play onto one clock,
 * and asks the `claude` CLI for the reading. The report is written to
 * runs/feedback/ — git-tracked, the bench precedent: reports are design
 * content — and the verdict goes back to the journal.
 *
 * Development only, like the chronicle: a build has no server and the
 * browser's posts fail into journal lines.
 */

const TRANSCRIBE_TIMEOUT_MS = 180_000;
// The listener reads far more than a naming call; give it room.
const LISTENER_TIMEOUT_MS = 240_000;

const SOURCE = 'scripts/transcribe.swift';
const BINARY = 'node_modules/.cache/evolving-rpg/witness-transcribe';

/** Take ids come from the browser; they become directory names. Anything
 *  outside this alphabet is refused rather than sanitised — a mangled id
 *  would silently orphan its transcript. */
const SAFE_TAKE = /^[A-Za-z0-9][A-Za-z0-9-]{0,120}$/u;

function run(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((done, refuse) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      if (error !== null) refuse(new Error(`${String(error)} — ${stderr.slice(0, 300)}`));
      else done(stdout);
    });
  });
}

/** Compiles the transcriber if the source is newer than the binary. Cached
 *  as a promise so concurrent takes share one compile. Resolves to the
 *  binary path, or null where there is no Swift toolchain — transcription
 *  is then honestly absent rather than quietly broken. */
let building: Promise<string | null> | null = null;

function ensureTranscriber(): Promise<string | null> {
  if (building !== null) return building;
  building = (async (): Promise<string | null> => {
    const source = resolve(process.cwd(), SOURCE);
    const binary = resolve(process.cwd(), BINARY);
    try {
      const fresh = existsSync(binary)
        && statSync(binary).mtimeMs >= statSync(source).mtimeMs;
      if (!fresh) {
        mkdirSync(resolve(process.cwd(), 'node_modules/.cache/evolving-rpg'), { recursive: true });
        await run('xcrun', ['swiftc', '-O', '-parse-as-library', source, '-o', binary], TRANSCRIBE_TIMEOUT_MS);
      }
      return binary;
    } catch (error) {
      console.warn(`[witness] transcriber unavailable: ${String(error).slice(0, 200)}`);
      return null;
    }
  })();
  return building;
}

/** In-flight transcriptions by take, so the listener can wait its turn. */
const jobs = new Map<string, Promise<void>>();

function takeDir(take: string): string {
  return resolve(process.cwd(), 'runs/witness', take);
}

async function transcribe(take: string): Promise<void> {
  const binary = await ensureTranscriber();
  const dir = takeDir(take);
  if (binary === null) {
    writeFileSync(resolve(dir, 'transcript-error.txt'), 'no swift toolchain — transcription unavailable\n', 'utf8');
    return;
  }
  try {
    const out = await run(binary, [resolve(dir, 'take.wav')], TRANSCRIBE_TIMEOUT_MS);
    writeFileSync(resolve(dir, 'transcript.json'), out, 'utf8');
  } catch (error) {
    writeFileSync(resolve(dir, 'transcript-error.txt'), `${String(error).slice(0, 500)}\n`, 'utf8');
  }
}

/** What a take can offer the weave: its start moment and its segments —
 *  empty when transcription failed, so the weave still places the marks. */
function transcribedTake(take: string): TranscribedTake | null {
  const dir = takeDir(take);
  try {
    const meta = JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')) as { startedWall?: unknown };
    if (typeof meta.startedWall !== 'string') return null;
    let segments: SpokenSegment[] = [];
    try {
      const raw = JSON.parse(readFileSync(resolve(dir, 'transcript.json'), 'utf8')) as { segments?: unknown };
      if (Array.isArray(raw.segments)) {
        segments = raw.segments.filter((s): s is SpokenSegment => {
          const x = s as Record<string, unknown>;
          return typeof x.start === 'number' && typeof x.end === 'number' && typeof x.text === 'string';
        });
      }
    } catch { /* not transcribed; the take still anchors its marks */ }
    return { take, startedWall: meta.startedWall, segments };
  } catch {
    return null;
  }
}

function readBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((done, refuse) => {
    const parts: Buffer[] = [];
    req.on('data', (chunk: Buffer) => { parts.push(chunk); });
    req.on('end', () => { done(Buffer.concat(parts)); });
    req.on('error', refuse);
  });
}

interface CliResult {
  is_error?: boolean;
  result?: string;
}

/**
 * The reply is a one-line JSON header, a `---` divider, then raw markdown.
 * The first live run taught this shape: a report packed INSIDE a JSON
 * array died to one unescaped quote at position 6535. Prose does not
 * belong in string escapes; only the two short fields ride as JSON.
 */
function extractReading(text: string): { name: string; line: string; report: string } {
  const divider = text.indexOf('\n---');
  const head = divider < 0 ? text : text.slice(0, divider);
  const start = head.indexOf('{');
  const end = head.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`no header object in reply: ${text.slice(0, 120)}`);
  const parsed = JSON.parse(head.slice(start, end + 1)) as { name?: unknown; line?: unknown; report?: unknown };
  if (typeof parsed.name !== 'string' || typeof parsed.line !== 'string') throw new Error('reply had no name/line');
  // Tolerate the old all-JSON shape too, should a model insist on it.
  const inline = Array.isArray(parsed.report)
    ? parsed.report.map(String).join('\n')
    : typeof parsed.report === 'string' ? parsed.report : '';
  const report = divider < 0
    ? inline
    : text.slice(divider).replace(/^\n-{3,} *\n?/u, '').trim();
  return { name: parsed.name, line: parsed.line, report };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function witnessPlugin(): Plugin {
  return {
    name: 'evolving-rpg:witness',
    configureServer(server) {
      server.middlewares.use('/__witness', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const take = String(req.headers['x-witness-take'] ?? '');
        const world = String(req.headers['x-witness-world'] ?? '');
        const startedWall = String(req.headers['x-witness-started'] ?? '');
        if (!SAFE_TAKE.test(take) || Number.isNaN(Date.parse(startedWall))) {
          res.statusCode = 400;
          res.end('bad take id or start stamp');
          return;
        }
        void readBody(req).then((wav) => {
          const dir = takeDir(take);
          mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, 'take.wav'), wav);
          writeFileSync(resolve(dir, 'meta.json'), JSON.stringify({
            take, world, startedWall, bytes: wav.length,
          }), 'utf8');
          jobs.set(take, transcribe(take).finally(() => { jobs.delete(take); }));
          res.statusCode = 204;
          res.end();
        }).catch((error: unknown) => {
          res.statusCode = 500;
          res.end(String(error));
        });
      });

      server.middlewares.use('/__listener', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        void readBody(req).then(async (body) => {
          const wire = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
          const takes = strings(wire.takes).filter((t) => SAFE_TAKE.test(t));
          const marks = (Array.isArray(wire.marks) ? wire.marks : []) as TraceMark[];

          // Let every referenced take finish being written down first; a
          // failure leaves an empty transcript, never a hung listener.
          await Promise.allSettled(takes.map((t) => jobs.get(t)));
          const transcribed = takes
            .map(transcribedTake)
            .filter((t): t is TranscribedTake => t !== null);

          const woven = weave(marks, transcribed);
          const spoke = transcribed.some((t) => t.segments.length > 0);

          const packet: ListenerPacket = {
            world: String(wire.world ?? ''),
            reason: wire.reason === 'another-world' || wire.reason === 'wipe' ? wire.reason : 'begin-again',
            ended: String(wire.ended ?? 'unknown'),
            turns: Number(wire.turns ?? 0),
            depth: Number(wire.depth ?? 1),
            level: Number(wire.level ?? 1),
            happened: strings(wire.happened),
            said: strings(wire.said),
            measured: strings(wire.measured),
            inForce: strings(wire.inForce),
            woven: renderWoven(woven),
            spoke,
          };

          const stamp = new Date().toISOString().replace(/[:.]/gu, '-');

          // The factory keeps its raw material beside its bulky inputs —
          // enough for the listener persona to re-read a run offline.
          mkdirSync(resolve(process.cwd(), 'runs/witness'), { recursive: true });
          writeFileSync(
            resolve(process.cwd(), `runs/witness/listener-${stamp}.packet.json`),
            JSON.stringify({ packet, marks, takes, fullTimeline: renderWoven(woven, { keepAll: true }) }, null, 2),
            'utf8',
          );

          const stdout = await run('claude', ['-p', listenerPrompt(packet), '--output-format', 'json'], LISTENER_TIMEOUT_MS);
          const envelope = JSON.parse(stdout) as CliResult;
          if (envelope.is_error === true) throw new Error('cli reported an error');
          const reading = ((): ReturnType<typeof extractReading> => {
            try {
              return extractReading(envelope.result ?? '');
            } catch (error) {
              // The raw reply is kept, so model-flake and plugin-bug stay
              // tellable apart — the loop plugin's lesson, relearned live.
              writeFileSync(
                resolve(process.cwd(), `runs/witness/listener-${stamp}.reply.txt`),
                envelope.result ?? '(empty result)',
                'utf8',
              );
              throw error;
            }
          })();

          const file = `runs/feedback/${stamp}.md`;
          mkdirSync(resolve(process.cwd(), 'runs/feedback'), { recursive: true });
          writeFileSync(resolve(process.cwd(), file), [
            `# ${reading.name}`,
            '',
            `> ${reading.line}`,
            '',
            `*world ${packet.world} · ended ${packet.ended} at turn ${String(packet.turns)}, depth ${String(packet.depth)}`
              + ` · submitted: ${packet.reason} · ${String(takes.length)} take(s), spoke: ${String(spoke)}*`,
            '',
            reading.report,
            '',
            '---',
            `*inputs: runs/witness/listener-${stamp}.packet.json*`,
            '',
          ].join('\n'), 'utf8');
          appendFileSync(resolve(process.cwd(), 'runs/feedback/index.jsonl'), `${JSON.stringify({
            stamp, world: packet.world, reason: packet.reason, ended: packet.ended,
            turns: packet.turns, depth: packet.depth, spoke,
            name: reading.name, line: reading.line, file,
          })}\n`, 'utf8');

          res.setHeader('content-type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ name: reading.name, line: reading.line, file }));
        }).catch((error: unknown) => {
          res.setHeader('content-type', 'application/json');
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(error).slice(0, 300) }));
        });
      });
    },
  };
}
