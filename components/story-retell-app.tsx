"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Volume2, VolumeX, Mic, MicOff, Play, Pause, RotateCcw, Trophy, Target, Clock } from "lucide-react"
import { computeMatchScore, computeMatchScoreWithKeywords } from "@/lib/scoring"

// Web Speech API Type Definitions according to W3C specification
interface SpeechSynthesisEvent extends Event {
  readonly utterance: SpeechSynthesisUtterance
  readonly charIndex: number
  readonly charLength: number
  readonly elapsedTime: number
  readonly name: string
}

interface SpeechSynthesisErrorEvent extends SpeechSynthesisEvent {
  readonly error: 'canceled' | 'interrupted' | 'audio-busy' | 'audio-hardware' | 'network' | 'synthesis-unavailable' | 'synthesis-failed' | 'language-unavailable' | 'voice-unavailable' | 'text-too-long' | 'invalid-argument' | 'not-allowed'
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: 'no-speech' | 'aborted' | 'audio-capture' | 'network' | 'not-allowed' | 'service-not-allowed' | 'language-not-supported' | 'phrases-not-supported'
  readonly message: string
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  readonly length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  readonly isFinal: boolean
}

interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

type Phase = "idle" | "listening" | "prep" | "speaking" | "evaluating" | "result"

type Result = {
  percentage: number
  matchedKeywords: string[]
  missingKeywords: string[]
  transcript: string
  totalKeywords: number
}

type PracticeSession = {
  id: string
  storyIndex: number
  timestamp: Date
  score: number
  duration: number
}

type VoiceSettings = {
  selectedVoice: string
  volume: number
  rate: number
}

type StoryDifficulty = "easy" | "medium" | "hard"

type StoryWithDifficulty = {
  id: number
  text: string
  difficulty: StoryDifficulty
  wordCount: number
  keyWords: string[]
}

const STORY_LISTEN_MS = 30_000 // Minimum time, will be extended for longer stories
const PREP_MS = 5_000
const SPEAK_MS = 40_000

export default function StoryRetellApp() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [progress, setProgress] = useState(0)
  const [currentStoryIndex, setCurrentStoryIndex] = useState<number | null>(null)
  const [stories, setStories] = useState<StoryWithDifficulty[]>([])
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDifficulty, setSelectedDifficulty] = useState<StoryDifficulty | "all">("all")
  const [practiceHistory, setPracticeHistory] = useState<PracticeSession[]>([])
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    selectedVoice: '',
    volume: 1.0,
    rate: 0.8
  })
  const [timeRemaining, setTimeRemaining] = useState<number>(0)
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([])
  const [showVoiceSettings, setShowVoiceSettings] = useState(false)

  const ttsCancelRef = useRef<() => void>(() => {})
  const recognitionRef = useRef<any>(null)
  const transcriptRef = useRef<string>("")
  const timerRef = useRef<number | null>(null)
  const startTsRef = useRef<number>(0)

  // Categorize story difficulty based on text characteristics
  const categorizeStoryDifficulty = useCallback((text: string): StoryDifficulty => {
    const wordCount = text.split(/\s+/).length
    const sentenceCount = splitIntoSentences(text).length
    const avgWordsPerSentence = wordCount / sentenceCount
    
    // Calculate complexity score based on multiple factors
    const complexityScore = 
      (wordCount / 100) * 0.4 +           // Length factor (40%)
      (avgWordsPerSentence / 20) * 0.3 +  // Sentence complexity (30%)
      (text.match(/[A-Z]{2,}/g)?.length || 0) * 0.1 + // Proper nouns (10%)
      (text.match(/[.,!?;:]/g)?.length || 0) / wordCount * 100 * 0.2 // Punctuation density (20%)
    
    if (complexityScore < 1.5) return "easy"
    if (complexityScore < 2.5) return "medium"
    return "hard"
  }, [])

  // Enhanced story duration estimation for TTS
  const estimateStoryDuration = useCallback((text: string): number => {
    const wordCount = text.split(/\s+/).length
    const sentenceCount = splitIntoSentences(text).length
    
    // More accurate estimation based on actual word count and speech rate
    const wordsPerMinute = 150 // average speaking rate
    const speechRate = voiceSettings.rate // Use user's preferred rate
    const pauseTime = sentenceCount * 0.5 // 0.5 seconds pause per sentence
    
    // Calculate base duration
    const baseDurationSeconds = (wordCount / wordsPerMinute) * 60 / speechRate
    
    // Add pause time and buffer
    const totalDurationSeconds = baseDurationSeconds + pauseTime + 2 // 2 second buffer
    
    // Ensure minimum duration for comprehension
    const minDurationSeconds = Math.max(15, wordCount * 0.3) // At least 0.3 seconds per word
    
    return Math.max(totalDurationSeconds * 1000, minDurationSeconds * 1000)
  }, [voiceSettings.rate])

  // Fetch and parse stories from JSON data file
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetch("/data/stories.json")
        if (!response.ok) throw new Error("Failed to fetch stories")
        
        const data = await response.json()
        if (cancelled) return

        // Use stories directly from JSON with their pre-defined difficulty and keywords
        const storiesWithDifficulty: StoryWithDifficulty[] = data.stories.map((story: any) => ({
          id: story.id,
          text: story.text,
          difficulty: story.difficulty,
          wordCount: story.wordCount,
          keyWords: story.keyWords || []
        }))
        
        setStories(storiesWithDifficulty)
      } catch (e) {
        setError("Failed to load stories. Please refresh.")
        console.error("Error loading stories:", e)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Enhanced beep function with better audio handling
  const beep = useCallback((durationMs = 400, frequency = 880, type: 'start' | 'end' = 'start') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      // Create oscillator
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      // Configure oscillator
      osc.type = "sine"
      osc.frequency.value = frequency
      
      // Connect nodes
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      // Set up volume envelope for smooth sound
      const now = ctx.currentTime
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.3, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.01, now + durationMs / 1000)
      
      // Start and stop oscillator
      osc.start(now)
      osc.stop(now + durationMs / 1000)
      
      // Clean up context after sound completes
      setTimeout(() => {
        try {
          ctx.close()
        } catch {
          // ignore cleanup errors
        }
      }, durationMs + 100)
      
    } catch (error) {
      console.warn('Beep failed:', error)
      // Fallback: try to play a system beep if available
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(type === 'start' ? 'beep' : 'end')
          utterance.volume = 0.1
          utterance.rate = 10
          utterance.pitch = 2
          window.speechSynthesis.speak(utterance)
        }
      } catch {
        // ignore fallback errors
      }
    }
  }, [])

  // Enhanced voice selection with user preferences
  const pickVoices = useCallback((): SpeechSynthesisVoice[] => {
    const voices = window.speechSynthesis.getVoices()
    if (!voices || voices.length === 0) return []
    
    // If user has selected a specific voice, use it
    if (voiceSettings.selectedVoice) {
      const selectedVoice = voices.find(v => v.name === voiceSettings.selectedVoice)
      if (selectedVoice) return [selectedVoice]
    }
    
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
  }, [voiceSettings.selectedVoice])

  // Load available voices
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices()
      setAvailableVoices(voices.filter(v => /en/i.test(v.lang || "")))
    }
    
    loadVoices()
    // Some browsers load voices asynchronously
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices
    }
  }, [])

  // Enhanced TTS implementation using correct Web Speech API specification
  const speakStory = useCallback(
    async (text: string) => {
      return new Promise<void>((resolve, reject) => {
        const synthesis = window.speechSynthesis
        if (!synthesis) {
          console.error("Speech synthesis not supported")
          reject(new Error("Speech synthesis not supported"))
          return
        }

        // Cancel any ongoing speech according to Web Speech API
        synthesis.cancel()

        // Create utterance using Web Speech API specification
        const utterance = new SpeechSynthesisUtterance(text)
        
        // Set properties according to Web Speech API spec
        utterance.lang = "en-US"
        utterance.rate = voiceSettings.rate
        utterance.volume = voiceSettings.volume
        utterance.pitch = 1.0

        // Enhanced voice selection
        const voices = synthesis.getVoices()
        if (voices.length > 0) {
          // Try to find the user's selected voice first
          let selectedVoice = null
          if (voiceSettings.selectedVoice) {
            selectedVoice = voices.find(voice => voice.name === voiceSettings.selectedVoice)
          }
          
          // Fallback to best English voice
          if (!selectedVoice) {
            selectedVoice = voices.find(voice => 
              voice.lang.startsWith('en') && voice.localService
            ) || voices.find(voice => voice.lang.startsWith('en')) || voices[0]
          }
          
          if (selectedVoice) {
            utterance.voice = selectedVoice
            console.log('Using voice:', selectedVoice.name, selectedVoice.lang, selectedVoice.localService ? 'local' : 'remote')
          }
        }

        let isCompleted = false

        // Event handlers according to Web Speech API specification
        utterance.onstart = (event: SpeechSynthesisEvent) => {
          console.log('TTS started speaking:', event.name, 'at', event.charIndex)
        }

        utterance.onend = (event: SpeechSynthesisEvent) => {
          if (!isCompleted) {
            isCompleted = true
            console.log('TTS finished speaking:', event.name, 'elapsed:', event.elapsedTime)
            resolve()
          }
        }

        utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
          if (!isCompleted) {
            isCompleted = true
            console.error('TTS Error:', event.error, event.name)
            
            // Handle specific error types
            switch (event.error) {
              case 'not-allowed':
                reject(new Error('Speech synthesis not allowed - check permissions'))
                break
              case 'audio-busy':
                reject(new Error('Audio device busy - try again'))
                break
              case 'audio-hardware':
                reject(new Error('Audio hardware not available'))
                break
              case 'network':
                reject(new Error('Network error during speech synthesis'))
                break
              case 'synthesis-unavailable':
                reject(new Error('Speech synthesis engine not available'))
                break
              case 'synthesis-failed':
                reject(new Error('Speech synthesis failed'))
                break
              case 'language-unavailable':
                reject(new Error('Language not available for synthesis'))
                break
              case 'voice-unavailable':
                reject(new Error('Selected voice not available'))
                break
              case 'text-too-long':
                reject(new Error('Text too long for synthesis'))
                break
              case 'invalid-argument':
                reject(new Error('Invalid argument for speech synthesis'))
                break
              default:
                reject(new Error(`Speech synthesis error: ${event.error}`))
            }
          }
        }

        utterance.onpause = (event: SpeechSynthesisEvent) => {
          console.log('TTS paused:', event.name, 'at', event.charIndex)
        }

        utterance.onresume = (event: SpeechSynthesisEvent) => {
          console.log('TTS resumed:', event.name, 'at', event.charIndex)
        }

        utterance.onmark = (event: SpeechSynthesisEvent) => {
          console.log('TTS mark reached:', event.name, 'at', event.charIndex)
        }

        utterance.onboundary = (event: SpeechSynthesisEvent) => {
          console.log('TTS boundary reached:', event.name, 'at', event.charIndex, 'length:', event.charLength)
        }

        // Set up cancellation
        ttsCancelRef.current = () => {
          if (!isCompleted) {
            isCompleted = true
            try {
              synthesis.cancel()
              console.log('TTS cancelled by user')
              resolve()
            } catch (error) {
              console.error('Error cancelling TTS:', error)
              resolve()
            }
          }
        }

        // Start speaking using Web Speech API
        console.log('Starting TTS speech...', 'Rate:', utterance.rate, 'Volume:', utterance.volume)
        synthesis.speak(utterance)
      })
    },
    [voiceSettings],
  )

  // Enhanced timers with accurate progress calculation
  const startTimedPhase = useCallback((ms: number, onDone: () => void) => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    startTsRef.current = Date.now()
    setProgress(0)
    setTimeRemaining(ms)
    
    timerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTsRef.current
      const remaining = Math.max(0, ms - elapsed)
      const p = Math.min(100, Math.round((elapsed / ms) * 100))
      
      setProgress(p)
      setTimeRemaining(remaining)
      
      if (elapsed >= ms) {
        if (timerRef.current) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
        setProgress(100)
        setTimeRemaining(0)
        onDone()
      }
    }, 50) // More frequent updates for smoother progress
  }, [])

  // Enhanced Speech recognition using correct Web Speech API
  const startRecognition = useCallback(() => {
    transcriptRef.current = ""
    
    // Use correct Web Speech API according to W3C specification
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported')
      return null
    }
    
    const recognition = new SpeechRecognition()
    
    // Configure according to Web Speech API specification
    recognition.lang = "en-US"
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    
    // Enhanced result processing for better accuracy
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = ""
      let interimChunk = ""
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalChunk += result[0].transcript + " "
        } else {
          interimChunk += result[0].transcript + " "
        }
      }
      
      if (finalChunk) {
        transcriptRef.current += finalChunk
        console.log('Final transcript:', finalChunk)
      }
      
      // Log interim results for debugging
      if (interimChunk) {
        console.log('Interim transcript:', interimChunk)
      }
    }
    
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('Speech recognition error:', event.error, event.message)
      
      // Handle specific error types according to W3C spec
      switch (event.error) {
        case 'no-speech':
          console.log('No speech detected, continuing...')
          break
        case 'audio-capture':
          console.error('Audio capture failed - check microphone permissions')
          break
        case 'not-allowed':
          console.error('Speech recognition not allowed - check permissions')
          break
        case 'network':
          console.error('Network error during speech recognition')
          break
        case 'aborted':
          console.log('Speech recognition aborted')
          break
        default:
          console.warn('Unknown speech recognition error:', event.error)
      }
    }
    
    recognition.onend = () => {
      console.log('Speech recognition ended')
    }
    
    recognition.onstart = () => {
      console.log('Speech recognition started')
    }
    
    recognition.onsoundstart = () => {
      console.log('Sound detected')
    }
    
    recognition.onspeechstart = () => {
      console.log('Speech detected')
    }
    
    recognition.onspeechend = () => {
      console.log('Speech ended')
    }
    
    recognition.onsoundend = () => {
      console.log('Sound ended')
    }
    
    recognition.onaudioend = () => {
      console.log('Audio capture ended')
    }
    
    recognition.onaudiostart = () => {
      console.log('Audio capture started')
    }
    
    try {
      recognition.start()
      recognitionRef.current = recognition
    } catch (error) {
      console.error('Failed to start speech recognition:', error)
    }
    return recognition
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
    // Filter stories by selected difficulty
    const filteredStories = selectedDifficulty === "all" 
      ? stories 
      : stories.filter(story => story.difficulty === selectedDifficulty)
    
    if (filteredStories.length === 0) {
      setError(`No stories available for ${selectedDifficulty} difficulty level.`)
      return
    }

    // Pick a random story from filtered set
    const idx = Math.floor(Math.random() * filteredStories.length)
    const selectedStory = filteredStories[idx]
    const originalIndex = stories.findIndex(story => story === selectedStory)
    setCurrentStoryIndex(originalIndex)

    // Phase: listening
    setPhase("listening")
    const story = selectedStory.text
    const listenStart = Date.now()
    const storyDuration = estimateStoryDuration(story) // Calculate dynamic duration

    startTimedPhase(storyDuration, () => {
      // end of listening (cancel any remaining TTS)
      ttsCancelRef.current?.()
      // proceed to prep
      setPhase("prep")
      startTimedPhase(PREP_MS, () => {
        beep(500, 880, 'start') // speak beep - higher pitch for start
        // speaking
        setPhase("speaking")
        startRecognition()
        startTimedPhase(SPEAK_MS, () => {
          beep(500, 660, 'end') // end beep - lower pitch for end
          stopRecognition()
          // evaluate
          setPhase("evaluating")
          const tr = (transcriptRef.current || "").trim()
          const currentStory = stories[currentStoryIndex]
          
          // Use predefined keywords from stories.json if available, otherwise fallback to computed keywords
          const storyKeywords = currentStory?.keyWords || []
          const score = storyKeywords.length > 0 
            ? computeMatchScoreWithKeywords(story, tr, storyKeywords)
            : computeMatchScore(story, tr)
            
          const sessionResult = {
            percentage: score.percentage,
            matchedKeywords: score.matchedKeywords,
            missingKeywords: score.missingKeywords,
            transcript: tr,
            totalKeywords: score.totalKeywords,
          }
          setResult(sessionResult)
          
          // Save to practice history
          const session: PracticeSession = {
            id: Date.now().toString(),
            storyIndex: idx,
            timestamp: new Date(),
            score: score.percentage,
            duration: SPEAK_MS
          }
          setPracticeHistory(prev => [session, ...prev.slice(0, 9)]) // Keep last 10 sessions
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
  }, [stories, selectedDifficulty, estimateStoryDuration, startTimedPhase, beep, speakStory, startRecognition, stopRecognition])

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
    return estimateStoryDuration(stories[currentStoryIndex].text)
  }, [currentStoryIndex, stories, estimateStoryDuration])

  const [speechSupported, setSpeechSupported] = useState(false)
  const [recoSupported, setRecoSupported] = useState(false)

  useEffect(() => {
    // TTS support detection using Web Speech API specification
    const checkTTS = () => {
      const synthesis = window.speechSynthesis
      if (synthesis) {
        console.log("Speech synthesis available, checking functionality...")
        
        // Test TTS with a simple utterance according to Web Speech API
        const testUtterance = new SpeechSynthesisUtterance("test")
        testUtterance.lang = "en-US"
        testUtterance.volume = 0.01 // Very quiet test
        testUtterance.rate = 2.0 // Very fast
        testUtterance.pitch = 1.0
        
        let testCompleted = false
        
        // Event handlers according to Web Speech API specification
        testUtterance.onstart = (event: SpeechSynthesisEvent) => {
          if (!testCompleted) {
            testCompleted = true
        setSpeechSupported(true)
            console.log("TTS test passed - speech synthesis works:", event.name)
          }
        }
        
        testUtterance.onend = (event: SpeechSynthesisEvent) => {
          if (!testCompleted) {
            testCompleted = true
            setSpeechSupported(true)
            console.log("TTS test passed - speech synthesis works:", event.name)
          }
        }
        
        testUtterance.onerror = (event: SpeechSynthesisErrorEvent) => {
          if (!testCompleted) {
            testCompleted = true
        setSpeechSupported(false)
            console.log("TTS test failed - speech synthesis not working:", event.error, event.name)
          }
        }
        
        // Timeout after 3 seconds
        setTimeout(() => {
          if (!testCompleted) {
            testCompleted = true
            setSpeechSupported(false)
            console.log("TTS test timeout - speech synthesis not working")
          }
        }, 3000)
        
        try {
          // Cancel any existing speech and start test
          synthesis.cancel()
          synthesis.speak(testUtterance)
        } catch (error) {
        setSpeechSupported(false)
          console.log("TTS test exception:", error)
        }
      } else {
        setSpeechSupported(false)
        console.log("TTS not supported - speechSynthesis not available")
      }
    }

    // Check Speech Recognition support according to Web Speech API
    const checkSTT = () => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setRecoSupported(!!SpeechRecognition)
      
      if (SpeechRecognition) {
        console.log("Speech Recognition available")
      } else {
        console.log("Speech Recognition not supported")
      }
    }

    // Delay TTS test to allow page to fully load
    setTimeout(checkTTS, 1000)
    checkSTT()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Only handle shortcuts when not typing in input fields
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (event.key) {
        case ' ': // Space bar
          event.preventDefault()
          if (phase === "idle" || phase === "result") {
            startPractice()
          }
          break
        case 'Escape':
          if (phase === "listening" || phase === "prep" || phase === "speaking") {
            event.preventDefault()
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
              setTimeRemaining(0)
          }
          break
        case 's':
          if (phase === "listening") {
            event.preventDefault()
            ttsCancelRef.current?.()
          }
          break
        case 'r':
          if (phase === "result") {
            event.preventDefault()
              setPhase("idle")
              setProgress(0)
              setResult(null)
              setCurrentStoryIndex(null)
              setTimeRemaining(0)
          }
          break
        case 'n':
          if (phase === "result") {
            event.preventDefault()
            setResult(null)
            setPhase("idle")
            setProgress(0)
            setTimeRemaining(0)
            // setIsPaused(false) // Removed pause functionality
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [phase, startPractice, stopRecognition])
  // Helper function to format time
  const formatTime = (ms: number) => {
    const seconds = Math.ceil(ms / 1000)
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
  }

  // Helper function to get phase icon
  const getPhaseIcon = (phase: Phase) => {
    switch (phase) {
      case "listening": return <Volume2 className="h-4 w-4" />
      case "prep": return <Clock className="h-4 w-4" />
      case "speaking": return <Mic className="h-4 w-4" />
      case "evaluating": return <Target className="h-4 w-4" />
      case "result": return <Trophy className="h-4 w-4" />
      default: return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Main Practice Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {getPhaseIcon(phase)}
            Story Retell Practice
          </CardTitle>
          <CardDescription>
            Listen to a story, prepare your retelling, and get instant feedback on your performance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={phase === "idle" ? "secondary" : phase === "result" ? "default" : "destructive"}>
                  {phaseLabel(phase, currentStoryDuration)}
                </Badge>
          </div>
              {timeRemaining > 0 && (
                <div className="text-2xl font-mono font-bold text-primary">
                  {formatTime(timeRemaining)}
          </div>
              )}
        </div>
            
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Story</div>
              <div className="text-lg font-semibold">
                {currentStoryNumber ? `Story #${currentStoryNumber}` : "Not Selected"}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Practice Sessions</div>
              <div className="text-lg font-semibold">
                {practiceHistory.length} completed
              </div>
            </div>
          </div>

          {/* Difficulty Selector */}
          <div className="space-y-3">
            <div className="text-sm font-medium">Story Difficulty</div>
            <div className="flex flex-wrap gap-2">
              {(["all", "easy", "medium", "hard"] as const).map((diff) => (
                <Button
                  key={diff}
                  variant={selectedDifficulty === diff ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedDifficulty(diff)}
                  disabled={phase === "listening" || phase === "prep" || phase === "speaking" || phase === "evaluating"}
                >
                  {diff === "all" ? "All Stories" : `${diff.charAt(0).toUpperCase() + diff.slice(1)}`}
                  {diff !== "all" && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {stories.filter(s => s.difficulty === diff).length}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Progress Bar */}
          {progress > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Progress</span>
                <span>{progress}%</span>
          </div>
              <Progress value={progress} className="h-3" />
        </div>
          )}

          {/* Browser Compatibility Warnings */}
      {!speechSupported && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
        <p className="text-sm text-destructive">
          <strong>Text-to-Speech Not Available:</strong> Your browser environment doesn't support speech synthesis. 
          This is common in automated browsers or certain configurations. 
          For full functionality, please test in a regular Chrome or Edge browser where TTS works properly.
        </p>
            </div>
      )}
      {!recoSupported && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
        <p className="text-sm text-destructive">
          Speech recognition not supported. We will still record time but cannot transcribe your retell automatically.
        </p>
            </div>
          )}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Control Buttons */}
          <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={startPractice}
          disabled={phase === "listening" || phase === "prep" || phase === "speaking" || phase === "evaluating"}
              size="lg"
        >
          {phase === "idle" || phase === "result" ? "Start Practice" : "Restart"}
        </Button>

        {phase === "listening" && (
              <Button variant="outline" onClick={() => ttsCancelRef.current?.()} size="lg">
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
              setTimeRemaining(0)
            }}
                size="lg"
          >
            Cancel
          </Button>
        )}

            <Button
              variant="ghost"
              onClick={() => setShowVoiceSettings(!showVoiceSettings)}
              size="lg"
            >
              <Volume2 className="h-4 w-4" />
              Voice Settings
            </Button>

            <Button
              variant="ghost"
              onClick={() => {
                const synthesis = window.speechSynthesis
                if (synthesis) {
                  console.log('Test TTS button clicked')
                  
                  // Create utterance using Web Speech API specification
                  const utterance = new SpeechSynthesisUtterance("Test test, this is a test of the text to speech system.")
                  utterance.lang = "en-US"
                  utterance.rate = 0.8
                  utterance.volume = 0.7
                  utterance.pitch = 1.0
                  
                  // Event handlers according to Web Speech API
                  utterance.onstart = (event: SpeechSynthesisEvent) => {
                    console.log('Test TTS started:', event.name)
                  }
                  
                  utterance.onend = (event: SpeechSynthesisEvent) => {
                    console.log('Test TTS ended:', event.name)
                  }
                  
                  utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
                    console.error('Test TTS error:', event.error, event.name)
                  }
                  
                  // Cancel any ongoing speech and start new one
                  synthesis.cancel()
                  synthesis.speak(utterance)
                } else {
                  console.error('Speech synthesis not available')
                }
              }}
              size="lg"
            >
              <Volume2 className="h-4 w-4" />
              Test TTS
            </Button>
          </div>

          {/* Voice Settings Panel */}
          {showVoiceSettings && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Voice Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
              <div>
                  <label className="text-sm font-medium">Voice</label>
                  <select
                    value={voiceSettings.selectedVoice}
                    onChange={(e) => setVoiceSettings(prev => ({ ...prev, selectedVoice: e.target.value }))}
                    className="w-full mt-1 p-2 border rounded-md"
                  >
                    <option value="">Auto-select (Recommended)</option>
                    {availableVoices.map(voice => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
              </div>
                
              <div>
                  <label className="text-sm font-medium">
                    Speech Rate: {voiceSettings.rate.toFixed(1)}x
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.1"
                    value={voiceSettings.rate}
                    onChange={(e) => setVoiceSettings(prev => ({ ...prev, rate: parseFloat(e.target.value) }))}
                    className="w-full mt-1"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-medium">
                    Volume: {Math.round(voiceSettings.volume * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={voiceSettings.volume}
                    onChange={(e) => setVoiceSettings(prev => ({ ...prev, volume: parseFloat(e.target.value) }))}
                    className="w-full mt-1"
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      {phase === "result" && result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Practice Results
            </CardTitle>
            <CardDescription>
              Great job! Here's how you performed on this story retelling exercise.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Score Display */}
            <div className="text-center space-y-4">
              <div className="text-6xl font-bold text-primary">
                {Math.round(result.percentage)}%
              </div>
              <div className="text-lg text-muted-foreground">Match Score</div>
              <div className="flex justify-center">
                <Badge 
                  variant={result.percentage >= 80 ? "default" : result.percentage >= 60 ? "secondary" : "destructive"}
                  className="text-lg px-4 py-2"
                >
                  {result.percentage >= 80 ? "Excellent" : result.percentage >= 60 ? "Good" : "Keep Practicing"}
                </Badge>
              </div>
            </div>

            <Separator />

            {/* Versant-Style Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-primary">{result.matchedKeywords.length}</div>
                <div className="text-sm text-muted-foreground">Keywords Matched</div>
                <div className="text-xs text-muted-foreground">out of {result.totalKeywords}</div>
                </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {(result as any).contentWords || 0}
              </div>
                <div className="text-sm text-muted-foreground">Content Words</div>
                <div className="text-xs text-muted-foreground">in story</div>
                </div>
              <div className="text-center p-4 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {(result as any).contentMatches || 0}
                </div>
                <div className="text-sm text-muted-foreground">Content Matches</div>
                <div className="text-xs text-muted-foreground">you captured</div>
              </div>
            </div>

            {/* Keywords Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="default" className="text-sm">
                    {result.matchedKeywords.length} / {result.totalKeywords}
                  </Badge>
                  <span className="font-medium">Key Words Matched</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {result.matchedKeywords.length > 0 ? (
                    result.matchedKeywords.map((keyword, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {keyword}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground text-sm">No keywords matched</span>
                  )}
              </div>
            </div>

              <div className="space-y-3">
            <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-sm">
                    {result.missingKeywords.length}
                  </Badge>
                  <span className="font-medium">Key Words Missed</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {result.missingKeywords.length > 0 ? (
                    result.missingKeywords.map((keyword, index) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {keyword}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-green-600 text-sm">All keywords captured!</span>
                  )}
                </div>
              </div>
            </div>

            <Separator />

            {/* Transcript */}
            <div className="space-y-3">
              <div className="font-medium flex items-center gap-2">
                <Mic className="h-4 w-4" />
                Your Retelling
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {result.transcript || "No transcript captured. Make sure your microphone is working and try speaking more clearly."}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setPhase("idle")
                  setProgress(0)
                  setResult(null)
                  setCurrentStoryIndex(null)
                  setTimeRemaining(0)
                }}
                className="flex-1"
                size="lg"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Try Same Story
              </Button>
              <Button
                onClick={() => {
                  setResult(null)
                  setPhase("idle")
                  setProgress(0)
                  setTimeRemaining(0)
                  // keep story list loaded, pick another random on start
                }}
                className="flex-1"
                size="lg"
              >
                New Story
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Practice History */}
      {practiceHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Practice Sessions</CardTitle>
            <CardDescription>
              Track your progress over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {practiceHistory.slice(0, 5).map((session, index) => {
                const story = stories[session.storyIndex]
                return (
                  <div key={session.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-mono">
                        #{session.storyIndex + 1}
          </div>
                      <div>
                        <div className="text-sm text-muted-foreground">
                          {session.timestamp.toLocaleDateString()} at {session.timestamp.toLocaleTimeString()}
                        </div>
                        {story && (
                          <Badge variant="outline" className="text-xs mt-1">
                            {story.difficulty} ({story.wordCount} words)
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge 
                      variant={session.score >= 80 ? "default" : session.score >= 60 ? "secondary" : "destructive"}
                    >
                      {session.score}%
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground space-y-4">
            <div>
              <p><strong>Versant English Speaking Test Practice:</strong></p>
              <ul className="list-disc list-inside space-y-1 ml-4">
                <li>Listen carefully to the story (no text is shown, just like the real test)</li>
                <li>Use the 5-second prep time to organize your thoughts</li>
                <li>Retell the story in your own words when you hear the beep</li>
                <li>Focus on meaningful content words (not connecting words like "and", "the", "it")</li>
                <li>Get instant feedback on your content word accuracy</li>
              </ul>
            </div>
            
            <div>
              <p><strong>Keyboard Shortcuts:</strong></p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-xs">
                <div className="flex justify-between">
                  <span>Space</span>
                  <span>Start practice</span>
                </div>
                <div className="flex justify-between">
                  <span>Escape</span>
                  <span>Cancel</span>
                </div>
                <div className="flex justify-between">
                  <span>S</span>
                  <span>Skip audio</span>
                </div>
                <div className="flex justify-between">
                  <span>R</span>
                  <span>Retry same story</span>
                </div>
                <div className="flex justify-between">
                  <span>N</span>
                  <span>New story</span>
                </div>
              </div>
            </div>
            
            <p className="mt-3 text-xs">
              <strong>Note:</strong> For best results, use Chrome or Edge with a working microphone.
            </p>
          </div>
        </CardContent>
      </Card>
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

  // More robust sentence splitting for the story data format
  // Split on periods, exclamation marks, question marks followed by space or end of string
  const sentences = cleaned.split(/(?<=[.!?])(?=\s|$)/)

  // Filter out empty strings and trim each sentence
  return sentences
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => !/^\d+\.$/.test(s)) // Remove standalone numbers like "1." "2." etc.
}

function splitIntoReadableChunks(text: string, maxLength: number = 150): string[] {
  const sentences = splitIntoSentences(text)
  const chunks: string[] = []
  let currentChunk = ""

  for (const sentence of sentences) {
    // If adding this sentence would make chunk too long, start new chunk
    if (currentChunk && (currentChunk.length + sentence.length + 1) > maxLength) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim())
      }
      currentChunk = sentence
    } else {
      // Add sentence to current chunk
      currentChunk += (currentChunk ? " " : "") + sentence
    }
  }

  // Add the last chunk if it exists
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  // If no chunks were created (shouldn't happen), return original text as single chunk
  return chunks.length > 0 ? chunks : [text]
}

