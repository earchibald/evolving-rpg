# The Witness & the Listener — voice-annotated human playtesting

*2026-07-28 · design spec (autonomous /goal session; user's prompt supplied the
requirements, this doc records the decisions taken)*

## What this is

A feedback factory for the one signal the machinery cannot synthesise: what a
human **feels** while playing, said out loud in the moment. Two facilities:

- **The witness** — press <kbd>c</kbd> (or click the indicator in the header)
  and the microphone listens while you play. Every word is kept with a wall
  clock and a sample-accurate audio clock; every game beat (actions, journal
  lines) is marked into the same trace, recording or not — so speech, play,
  and the *silences between them* correlate exactly.
- **The listener** — when a run is submitted (any of the three world-menu
  actions: *begin this world again*, *another world*, *wipe everything*), the
  ended run's facts, the player's typed notes, the lens readings, and the
  woven speech-and-play timeline go to an agent whose one question is: **where
  is the fun, and where does it break?** Its report lands in `runs/feedback/`
  — the factory's belt — and its verdict line lands in the journal.

## Decisions (with reasons)

1. **Capture in the browser, not the OS.** `getUserMedia` → `AudioContext`
   (16 kHz) → an inline `AudioWorklet` accumulating Float32 chunks → WAV
   (16-bit mono) encoded client-side on stop. The browser owns the permission
   prompt (one click, remembered per origin), the sample counter gives exact
   `audioMs` for every trace mark, and WAV avoids codec roulette —
   AVFoundation reads it natively. MediaRecorder's webm/opus would not decode
   on the transcription side without ffmpeg.

2. **Transcription is a ~90-line Swift CLI on `SpeechAnalyzer` /
   `SpeechTranscriber`** (`scripts/transcribe.swift`), compiled once by the
   dev-server plugin into `node_modules/.cache/evolving-rpg/` (< 1 s) and run
   per take. **Verified live on this machine before this spec was written**:
   5.8 s of `say`-generated speech transcribed in 0.46 s (≈12× real-time),
   on-device, free, timestamped segments, no TCC prompt for file-based use.
   Why not Python: the user hoped PyObjC could reach the modern models — it
   cannot. `SpeechAnalyzer` and FoundationModels are Swift-only API surfaces
   (not ObjC-bridged); PyObjC can only reach the legacy `SFSpeechRecognizer`,
   and FoundationModels is an LLM framework, not a speech engine. The Swift
   file is the "if we MUST" case, and it costs one sub-second compile. Fully
   local, as demanded — no model call, no network, no fee.

3. **The trace is a sidecar, never the chain.** Events are content-addressed
   and deterministic; stamping wall clocks into them would move every hash and
   break replay. So the witness keeps its own capped ring of marks
   (`kind: action | journal | witness`), each carrying wall time, audio time
   (null when the mic is off), world, turn, depth, and head seq. Two one-line
   hooks in `debug.ts` feed it: `say()` (every narrated journal line) and
   `finish()` (raw event types — including silent MOVEs, which is what makes
   hesitation measurable).

4. **Weaving happens server-side.** Transcripts arrive asynchronously, so the
   plugin (not the browser) merges trace marks and transcript segments by wall
   clock into one timeline. Long gaps are annotated ("a long pause — 41 s");
   prompt rendering keeps every spoken line plus a few beats of context around
   each and elides the rest. Full timeline is kept on disk.

5. **The listener rides the oracle plugin's pattern**: `POST /__listener` →
   `claude -p` (default model — this is the judgment call worth the strong
   one), 240 s timeout, SIGKILL, JSON out (`report` as an array of lines so
   multiline markdown survives JSON). Report → `runs/feedback/<stamp>.md`
   (git-tracked via a new `!runs/feedback/` — reports are design content, the
   bench precedent); one line appended to `runs/feedback/index.jsonl`; the raw
   packet mirrored to `runs/witness/` (ignored, like all bulky run artifacts).

6. **Submission order beats the wipe.** Each world-menu handler snapshots the
   run (`summariseRun` — the same machinery death proposals use) *before*
   mutating anything; the mutation never waits on the network. If the mic is
   live at submit, the take is stopped, uploaded, and a fresh one starts (the
   witness turns a fresh page) — so the words spoken during a run always ride
   with that run. An unplayed run (turn 0, nothing spoken) submits nothing.
   Death does **not** trigger the listener — death already provokes the Forge;
   the *new-game press* is the run's true end, per the designer's spec.

7. **The indicator is the button.** One element in the header: dim when off,
   red and glowing when recording. Clicking it toggles; <kbd>c</kbd> presses
   it via the existing `BUTTON_KEYS` path — key and mouse take exactly one
   code path, the keymap-table convention. Mic refusal is said in the journal,
   never thrown.

8. **Non-blocking, covenant-shaped.** Mechanics never wait on the witness or
   the listener. Every failure lands as a journal line ("the listener could
   not be reached — the run is kept, unread"). Nothing here touches `apply`,
   the RNG, or the chain: the golden replay is bit-identical by construction.

## Components

| Piece | Where | Job |
|---|---|---|
| WAV encoder | `src/witness/wav.ts` | Float32 → 16-bit mono RIFF (pure) |
| Trace | `src/witness/trace.ts` | capped mark ring, dual clocks (pure) |
| Weave | `src/witness/weave.ts` | marks + transcripts → timeline, prompt render (pure) |
| Listener prompt | `src/witness/listener.ts` | packet → persona prompt (pure) |
| Recorder | `src/ui/witness.ts` | mic lifecycle, upload, indicator state (browser) |
| Plugin | `server/witness-plugin.ts` | `/__witness` (audio in, transcribe), `/__listener` (weave, `claude`, report) |
| Transcriber | `scripts/transcribe.swift` | file → timestamped segments (SpeechAnalyzer) |
| Persona | `.claude/agents/listener.md` | the same reading, runnable headless over kept packets |

Tests (`tests/witness/`): byte-exact WAV header/sample proofs, trace cap and
clock proofs, weave ordering/offset/gap/elision proofs, prompt content proofs
— the mutation-proof idiom throughout.

## Out of scope (named, not forgotten)

- Trace persistence across reloads (takes and reports already live on disk).
- Playing audio back in the UI; a transcript browser panel.
- Auto-ratifying anything the listener recommends — its report may *sketch*
  Forge-ready rules; ratification stays a human button.
- The build (`vite build`): the witness posts fail gracefully with no server,
  same as the chronicle.
