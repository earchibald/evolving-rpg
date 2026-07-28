// The witness's ear: on-device transcription for recorded playtest audio.
//
// Uses SpeechAnalyzer/SpeechTranscriber (macOS 26+) — the engine behind
// Voice Memos and Notes: local, free, fast (~12x real-time measured here),
// with per-segment timestamps. It is a Swift file because this API surface
// is Swift-only — not ObjC-bridged, so no PyObjC route exists; the legacy
// SFSpeechRecognizer is the only thing Python can reach, and it is not the
// current best. The dev server compiles this once (sub-second) into
// node_modules/.cache/evolving-rpg/ and runs the binary per take.
//
//   usage: transcribe <audio-file> [locale]
//   stdout: {"locale":"en_US","segments":[{"start":0.0,"end":2.04,"text":"…"}]}
//
// File-based transcription needs no microphone or speech-recognition TCC
// grant; the browser owns the mic and its permission prompt.

import Foundation
import Speech
import AVFoundation

struct Segment: Codable {
    let start: Double
    let end: Double
    let text: String
}

struct Output: Codable {
    let locale: String
    let segments: [Segment]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

@main
struct Transcribe {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count >= 2 else { fail("usage: transcribe <audio-file> [locale]") }
        let url = URL(fileURLWithPath: args[1])
        let localeId = args.count >= 3 ? args[2] : "en_US"

        do {
            let transcriber = SpeechTranscriber(
                locale: Locale(identifier: localeId),
                transcriptionOptions: [],
                reportingOptions: [],
                attributeOptions: [.audioTimeRange]
            )

            // First run on a fresh machine downloads the locale's model; every
            // run after finds it installed and this is a no-op.
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                try await request.downloadAndInstall()
            }

            let analyzer = SpeechAnalyzer(modules: [transcriber])
            let file = try AVAudioFile(forReading: url)

            // Results stream concurrently with analysis; collect off to the side.
            let collect = Task { () -> [Segment] in
                var segments: [Segment] = []
                for try await result in transcriber.results {
                    let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    if text.isEmpty { continue }
                    segments.append(Segment(
                        start: result.range.start.seconds,
                        end: result.range.end.seconds,
                        text: text
                    ))
                }
                return segments
            }

            if let last = try await analyzer.analyzeSequence(from: file) {
                try await analyzer.finalizeAndFinish(through: last)
            } else {
                await analyzer.cancelAndFinishNow()
            }

            let segments = try await collect.value
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(Output(locale: localeId, segments: segments))
            print(String(decoding: data, as: UTF8.self))
        } catch {
            fail("transcription failed: \(error)")
        }
    }
}
