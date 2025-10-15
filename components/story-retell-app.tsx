"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { computeMatchScore } from "@/lib/scoring"

type Phase = "idle" | "listening" | "prep" | "speaking" | "evaluating" | "result"

type Result = {
  percentage: number
  matchedKeywords: string[]
  missingKeywords: string[]
  transcript: string
  totalKeywords: number
}

const STORY_LISTEN_MS = 30_000 // Minimum time, will be extended for longer stories
const PREP_MS = 5_000
const SPEAK_MS = 40_000

export default function StoryRetellApp() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState(0)
  const [currentStoryIndex, setCurrentStoryIndex] = useState<number | null>(null)
  const [stories, setStories] = useState<string[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ttsCancelRef = useRef<() => void>(() => {})
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef<string>("")
  const timerRef = useRef<number | null>(null)
  const startTsRef = useRef<number>(0)

  // Estimate story duration for TTS (rough approximation)
  const estimateStoryDuration = useCallback((text: string): number => {
    const sentences = splitIntoSentences(text)
    const wordsPerSentence = 15 // average words per sentence
    const wordsPerMinute = 150 // average speaking rate
    const speechRate = 0.8 // slower rate for better comprehension
    const secondsPerWord = (60 / wordsPerMinute) / speechRate

    // Estimate: 3-5 seconds per sentence + buffer for natural pauses
    const estimatedSeconds = Math.max(
      sentences.length * 4.5, // slightly more time per sentence with slower rate
      text.length * secondsPerWord * 1.3 // 30% buffer for pauses and natural speech
    )

    return Math.max(estimatedSeconds * 1000, STORY_LISTEN_MS) // at least 30 seconds
  }, [])

  // Fetch and parse stories from public data files (no text shown to user)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [partE, readAloud] = await Promise.all([
          fetch("/data/part-e.txt").then((r) => r.text()),
          fetch("/data/read-aloud.txt").then((r) => r.text()),
        ])
        if (cancelled) return

        const storiesA = parsePartENumberedStories(partE)
        const storiesB = parseParagraphStories(readAloud)
        const all = [...storiesA, ...storiesB].filter(Boolean)
        setStories(all)
      } catch (e) {
        setError("Failed to load stories. Please refresh.")
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Helpers: Beep via WebAudio (short alert tone)
  const beep = useCallback((durationMs = 400, frequency = 880) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = frequency
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
      osc.start()
      setTimeout(() => {
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05)
        osc.stop()
        ctx.close()
      }, durationMs)
    } catch {
      // ignore
    }
  }, [])

  // Select two different TTS voices (aiming for “mixed” voices)
  const pickVoices = useCallback((): SpeechSynthesisVoice[] => {
    const voices = window.speechSynthesis.getVoices()
    if (!voices || voices.length === 0) return []
    // Try to pick distinct-sounding English voices
    const en = voices.filter((v) => /en/i.test(v.lang || ""))
    // Heuristic: prefer names mentioning Male/Female; else pick two different vendors
    const male = en.find((v) => /male/i.test(v.name)) || en.find((v) => /David|George|Guy|Daniel|Alex/i.test(v.name))
    const female =
      en.find((v) => /female/i.test(v.name)) ||
      en.find((v) => /Samantha|Emma|Victoria|Allison|Joanna|Olivia|Zira/i.test(v.name))
    const chosen: SpeechSynthesisVoice[] = []
    if (male) chosen.push(male)
    if (female && (!male || female.name !== male.name)) chosen.push(female)
    if (chosen.length < 2) {
      // fallback to any two distinct English voices
      for (const v of en) {
        if (!chosen.find((c) => c.name === v.name)) chosen.push(v)
        if (chosen.length >= 2) break
      }
    }
    return chosen.slice(0, 2)
  }, [])

  // Speak story for up to STORY_LISTEN_MS, alternating voices by sentence
  const speakStory = useCallback(
    async (text: string) => {
      return new Promise<void>((resolve) => {
        const synth = window.speechSynthesis
        if (!synth) {
          resolve()
          return
        }
        const sentences = splitIntoSentences(text)
        const voices = pickVoices()
        let cancelled = false
        let idx = 0

        const queueNext = () => {
          if (cancelled) return
          if (idx >= sentences.length) {
            // Add a small delay before resolving to ensure last sentence completes
            setTimeout(() => resolve(), 500)
            return
          }

          const sentence = sentences[idx].trim()
          if (!sentence) {
            idx++
            queueNext()
            return
          }

          const u = new SpeechSynthesisUtterance(sentence)

          // Use slower rate for better comprehension (0.8 instead of 1.0)
          u.rate = 0.8

          // Add slight pause between sentences for better listening experience
          if (idx > 0) {
            u.volume = 0.9 // Slightly reduce volume for smoother transitions
          }

          if (voices.length > 0) {
            u.voice = voices[idx % voices.length]
          }

          u.onstart = () => {
            // Ensure audio doesn't get interrupted
            if (cancelled) {
              synth.cancel()
              return
            }
          }

          u.onend = () => {
            if (cancelled) return
            idx++
            // Add small delay between sentences for better flow
            setTimeout(() => queueNext(), 200)
          }

          u.onerror = (error) => {
            console.warn('TTS Error:', error)
            if (cancelled) return
            idx++
            setTimeout(() => queueNext(), 100)
          }

          try {
            synth.speak(u)
          } catch (error) {
            console.warn('TTS speak error:', error)
            idx++
            setTimeout(() => queueNext(), 100)
          }
        }

        // Start speaking after a brief delay to ensure proper initialization
        setTimeout(() => queueNext(), 100)

        ttsCancelRef.current = () => {
          try {
            cancelled = true
            synth.cancel()
            // Wait a moment for cancellation to complete before resolving
            setTimeout(() => resolve(), 100)
          } catch {
            resolve()
          }
        }
      })
    },
    [pickVoices],
  )

  // Timers with progress
  const startTimedPhase = useCallback((ms: number, onDone: () => void) => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    startTsRef.current = Date.now()
    setProgress(0)
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTsRef.current
      const p = Math.min(100, Math.round((elapsed / ms) * 100))
      setProgress(p)
      if (elapsed >= ms) {
        if (timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
        onDone()
      }
    }, 100)
  }, [])

  // Speech recognition (Chrome): capture transcript during SPEAK_MS
  const startRecognition = useCallback(() => {
    transcriptRef.current = ""
    const SR: any = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (!SR) return null
    const rec = new SR()
    rec.lang = "en-US"
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (event: any) => {
      let finalChunk = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i]
        if (res.isFinal) {
          finalChunk += res[0].transcript + " "
        }
      }
      if (finalChunk) transcriptRef.current += finalChunk
    }
    rec.onerror = () => {
      // swallow errors; we’ll still end phase and score what we have
    }
    rec.onend = () => {
      // handled by phase timer
    }
    try {
      rec.start()
      recognitionRef.current = rec
    } catch {
      // ignore
    }
    return rec
  }, [])

  const stopRecognition = useCallback(() => {
    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    } catch {
      // ignore
    } finally {
      recognitionRef.current = null
    }
  }, [])

  // Orchestrate the full flow
  const startPractice = useCallback(async () => {
    setError(null)
    setResult(null)
    if (stories.length === 0) {
      setError("Stories not loaded yet. Please wait a moment.")
      return
    }
    // Pick a random story each run
    const idx = Math.floor(Math.random() * stories.length)
    setCurrentStoryIndex(idx)

    // Phase: listening
    setPhase("listening")
    const story = stories[idx]
    const listenStart = Date.now()
    const storyDuration = estimateStoryDuration(story) // Calculate dynamic duration

    startTimedPhase(storyDuration, () => {
      // end of listening (cancel any remaining TTS)
      ttsCancelRef.current?.()
      // proceed to prep
      setPhase("prep")
      startTimedPhase(PREP_MS, () => {
        beep(500, 880) // speak beep
        // speaking
        setPhase("speaking")
        startRecognition()
        startTimedPhase(SPEAK_MS, () => {
          beep(500, 660) // end beep
          stopRecognition()
          // evaluate
          setPhase("evaluating")
          const tr = (transcriptRef.current || "").trim()
          const score = computeMatchScore(story, tr)
          setResult({
            percentage: score.percentage,
            matchedKeywords: score.matchedKeywords,
            missingKeywords: score.missingKeywords,
            transcript: tr,
            totalKeywords: score.totalKeywords,
          })
          setPhase("result")
        })
      })
    })

    // Kick off TTS - let it run for its full duration
    try {
      await speakStory(story)
    } catch {
      // ignore TTS errors
    } finally {
      const elapsed = Date.now() - listenStart
      if (elapsed < storyDuration) {
        // Timer will move to next phase; nothing else to do
      }
    }
  }, [stories, estimateStoryDuration, startTimedPhase, beep, speakStory, startRecognition, stopRecognition])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        ttsCancelRef.current?.()
      } catch {}
      try {
        stopRecognition()
      } catch {}
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [stopRecognition])

  const currentStoryNumber = useMemo(() => {
    if (currentStoryIndex == null) return null
    return currentStoryIndex + 1
  }, [currentStoryIndex])

  const currentStoryDuration = useMemo(() => {
    if (currentStoryIndex == null || !stories[currentStoryIndex]) return STORY_LISTEN_MS
    return estimateStoryDuration(stories[currentStoryIndex])
  }, [currentStoryIndex, stories, estimateStoryDuration])

  const [speechSupported, setSpeechSupported] = useState(false)
  const [recoSupported, setRecoSupported] = useState(false)

  useEffect(() => {
    setSpeechSupported("speechSynthesis" in window)

    // Check if speech synthesis is actually available and working
    if ("speechSynthesis" in window) {
      const testUtterance = new SpeechSynthesisUtterance("Test")
      testUtterance.rate = 0.8
      testUtterance.volume = 0.1 // Very quiet test

      testUtterance.onend = () => {
        setSpeechSupported(true)
      }

      testUtterance.onerror = () => {
        setSpeechSupported(false)
      }

      try {
        window.speechSynthesis.speak(testUtterance)
      } catch {
        setSpeechSupported(false)
      }
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    setRecoSupported(!!SpeechRecognition)
  }, [])
  return (
    <div className="rounded-lg border bg-card text-card-foreground p-4 md:p-6 flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">Status</span>
            <strong className="text-base">{phaseLabel(phase, currentStoryDuration)}</strong>
          </div>
          <div className="text-right">
            <span className="text-sm text-muted-foreground">Story</span>
            <div className="text-base">{currentStoryNumber ?? "-"}</div>
          </div>
        </div>
        <Progress value={progress} className="h-2" />
      </section>

      {!speechSupported && (
        <p className="text-sm text-destructive">
          Your browser does not support speech synthesis properly. Audio playback may not work reliably. Try using Chrome or Edge for best results.
        </p>
      )}
      {!recoSupported && (
        <p className="text-sm text-destructive">
          Speech recognition not supported. We will still record time but cannot transcribe your retell automatically.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="flex items-center gap-3">
        <Button
          onClick={startPractice}
          disabled={phase === "listening" || phase === "prep" || phase === "speaking" || phase === "evaluating"}
        >
          {phase === "idle" || phase === "result" ? "Start Practice" : "Restart"}
        </Button>

        {phase === "listening" && (
          <Button variant="secondary" onClick={() => ttsCancelRef.current?.()}>
            Skip Audio
          </Button>
        )}
        {(phase === "listening" || phase === "prep" || phase === "speaking") && (
          <Button
            variant="outline"
            onClick={() => {
              try {
                ttsCancelRef.current?.()
              } catch {}
              try {
                stopRecognition()
              } catch {}
              setPhase("idle")
              setProgress(0)
              setResult(null)
              setCurrentStoryIndex(null)
            }}
          >
            Cancel
          </Button>
        )}
      </section>

      <section className={cn("rounded-md border p-3", phase === "result" ? "block" : "hidden")}>
        {result && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Match Score</div>
                <div className="text-2xl font-semibold">{Math.round(result.percentage)}%</div>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Keywords</div>
                <div className="text-base">
                  {result.matchedKeywords.length} / {result.totalKeywords}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="text-sm font-medium mb-1">Matched Keywords</div>
                <div className="text-sm text-pretty">
                  {result.matchedKeywords.length > 0 ? result.matchedKeywords.join(", ") : "—"}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Missed Keywords</div>
                <div className="text-sm text-pretty">
                  {result.missingKeywords.length > 0 ? result.missingKeywords.join(", ") : "—"}
                </div>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Your Retell (transcript)</div>
              <div className="text-sm text-muted-foreground text-pretty">
                {result.transcript || "No transcript captured."}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setPhase("idle")
                  setProgress(0)
                  setResult(null)
                  setCurrentStoryIndex(null)
                }}
              >
                Practice Again
              </Button>
              <Button
                onClick={() => {
                  setResult(null)
                  setPhase("idle")
                  setProgress(0)
                  // keep story list loaded, pick another random on start
                }}
              >
                New Story
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className="text-xs text-muted-foreground">
        Notes: Audio is TTS-only; story text is not displayed. You’ll get a beep to begin speaking and a beep to stop.
      </section>
    </div>
  )
}

// Utils

function phaseLabel(phase: Phase, duration?: number) {
  switch (phase) {
    case "idle":
      return "Ready"
    case "listening":
      const durationSeconds = duration ? Math.ceil(duration / 1000) : 30
      return `Listening to Story (${durationSeconds}s)`
    case "prep":
      return "Prepare (5s)"
    case "speaking":
      return "Speak / Retell (40s)"
    case "evaluating":
      return "Evaluating…"
    case "result":
      return "Result"
  }
}

function splitIntoSentences(text: string): string[] {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return []
  // split on sentence boundaries
  const parts = cleaned.split(/(?<=[.!?])\s+/)
  return parts.filter(Boolean)
}

function parsePartENumberedStories(raw: string): string[] {
  // split lines beginning with "number."
  const lines = raw.replace(/\r/g, "").split("\n")
  const collected: string[] = []
  let current: string[] = []
  for (const line of lines) {
    const l = line.trim()
    if (/^\d+\./.test(l)) {
      if (current.length > 0) {
        collected.push(current.join(" ").trim())
        current = []
      }
      current.push(l.replace(/^\d+\.\s*/, ""))
    } else if (l.length > 0) {
      current.push(l)
    }
  }
  if (current.length > 0) collected.push(current.join(" ").trim())
  return collected
}

function parseParagraphStories(raw: string): string[] {
  // Grab the "Read Aloud" paragraphs (skip title lines)
  const cleaned = raw.replace(/\r/g, "")
  // Split by blank lines or double newline
  const parts = cleaned
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  // Remove potential header like "Read Aloud"
  const withoutHeader = parts.filter((p) => !/^read aloud/i.test(p))
  return withoutHeader
}
