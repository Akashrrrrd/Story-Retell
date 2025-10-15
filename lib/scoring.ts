const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "that",
  "this",
  "those",
  "these",
  "there",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "do",
  "does",
  "did",
  "done",
  "doing",
  "have",
  "has",
  "had",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "as",
  "from",
  "it",
  "its",
  "it’s",
  "into",
  "out",
  "about",
  "over",
  "after",
  "he",
  "she",
  "they",
  "we",
  "you",
  "i",
  "me",
  "him",
  "her",
  "them",
  "us",
  "my",
  "your",
  "our",
  "their",
  "his",
  "hers",
  "ours",
  "theirs",
  "so",
  "very",
  "just",
  "also",
  "too",
  "much",
  "many",
  "more",
  "most",
  "some",
  "any",
  "all",
  "few",
  "several",
  "such",
  "up",
  "down",
  "before",
  "after",
  "again",
  "once",
  "when",
  "while",
  "where",
  "why",
  "how",
])

function normalize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(stem)
    .filter((t) => t && !STOPWORDS.has(t))
}

function stem(token: string): string {
  // Very light stemming: strip common suffixes
  return token.replace(/(ing|ed|ly|ness|ment|s)$/i, "")
}

export function extractKeywords(text: string, max = 12): string[] {
  const tokens = normalize(text)
  const freq = new Map<string, number>()
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1)
  }
  // Sort by frequency then alphabetically
  const sorted = [...freq.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1]
      return a[0] < b[0] ? -1 : 1
    })
    .map(([t]) => t)
  return sorted.slice(0, max)
}

export function computeMatchScore(story: string, transcript: string) {
  const storyKeywords = new Set(extractKeywords(story, 14)) // cap keywords
  const userTokens = new Set(normalize(transcript))

  const matched: string[] = []
  for (const k of storyKeywords) {
    if (userTokens.has(k)) matched.push(k)
  }

  const missing = [...storyKeywords].filter((k) => !userTokens.has(k))

  // Weighted score: 80% keyword recall + 20% token cosine-like measure (very simplified)
  const recall = storyKeywords.size ? matched.length / storyKeywords.size : 0

  const storyVec = new Map<string, number>()
  const userVec = new Map<string, number>()
  for (const t of normalize(story)) storyVec.set(t, (storyVec.get(t) || 0) + 1)
  for (const t of normalize(transcript)) userVec.set(t, (userVec.get(t) || 0) + 1)

  const dot = (() => {
    let sum = 0
    for (const [t, a] of storyVec) {
      const b = userVec.get(t) || 0
      sum += a * b
    }
    return sum
  })()
  const magA = Math.sqrt([...storyVec.values()].reduce((s, v) => s + v * v, 0))
  const magB = Math.sqrt([...userVec.values()].reduce((s, v) => s + v * v, 0))
  const cosine = magA && magB ? dot / (magA * magB) : 0

  const percentage = Math.round((recall * 0.8 + cosine * 0.2) * 100)

  return {
    percentage,
    matchedKeywords: matched.sort(),
    missingKeywords: missing.sort(),
    totalKeywords: storyKeywords.size,
  }
}
