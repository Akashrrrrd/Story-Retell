import { Suspense } from "react"
import StoryRetellApp from "@/components/story-retell-app"

export default function Page() {
  return (
    <main className="min-h-dvh bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl md:text-3xl font-semibold text-balance mb-4">Story Retelling Practice</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Audio-only story playback, timed prep, retell, and instant similarity score.
        </p>
        <Suspense fallback={<div className="text-sm">Loading…</div>}>
          <StoryRetellApp />
        </Suspense>
      </div>
    </main>
  )
}
