// Enhanced stopwords list for Versant test scoring - focuses on meaningful content words
const STOPWORDS = new Set([
  // Articles
  "a", "an", "the",
  // Conjunctions
  "and", "or", "but", "if", "then", "than", "that", "this", "those", "these", "there",
  // Common verbs (auxiliary/helping)
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "doing",
  "have", "has", "had", "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  // Prepositions
  "for", "to", "of", "in", "on", "at", "by", "with", "as", "from", "into", "out", "about", "over", "after",
  // Pronouns
  "it", "its", "it's", "he", "she", "they", "we", "you", "i", "me", "him", "her", "them", "us",
  "my", "your", "our", "their", "his", "hers", "ours", "theirs",
  // Common adverbs/adjectives
  "so", "very", "just", "also", "too", "much", "many", "more", "most", "some", "any", "all",
  "few", "several", "such", "up", "down", "before", "again", "once", "when", "while",
  "where", "why", "how",
  // Common verbs (basic actions)
  "got", "get", "getting", "go", "going", "went", "come", "came", "coming"
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
  // Enhanced stemming: strip common suffixes and handle irregular forms
  let stemmed = token
  
  // Handle common irregular plurals and past tense
  const irregulars: { [key: string]: string } = {
    "children": "child", "people": "person", "men": "man", "women": "woman",
    "feet": "foot", "teeth": "tooth", "mice": "mouse", "geese": "goose",
    "went": "go", "went": "go", "came": "come", "saw": "see", "got": "get",
    "took": "take", "made": "make", "said": "say", "told": "tell", "gave": "give",
    "found": "find", "bought": "buy", "brought": "bring", "thought": "think"
  }
  
  if (irregulars[stemmed]) {
    return irregulars[stemmed]
  }
  
  // Regular stemming patterns
  stemmed = stemmed.replace(/(ies)$/i, "y") // cities -> city
  stemmed = stemmed.replace(/(ied)$/i, "y") // tried -> try
  stemmed = stemmed.replace(/(ing|ed|ly|ness|ment|s)$/i, "")
  
  return stemmed
}

export function extractKeywords(text: string, max = 15): string[] {
  const tokens = normalize(text)
  const freq = new Map<string, number>()
  
  // Count frequency and assign weights based on position and length
  tokens.forEach((token, index) => {
    const baseFreq = freq.get(token) || 0
    
    // Weight tokens that appear early in the text more heavily
    const positionWeight = Math.max(0.5, 1 - (index / tokens.length))
    
    // Weight longer tokens more heavily (they're more specific)
    const lengthWeight = Math.min(2, token.length / 5)
    
    freq.set(token, baseFreq + positionWeight * lengthWeight)
  })
  
  // Sort by weighted frequency, then by length (longer words first), then alphabetically
  const sorted = [...freq.entries()]
    .sort((a, b) => {
      if (Math.abs(b[1] - a[1]) > 0.1) return b[1] - a[1] // Significant frequency difference
      if (b[0].length !== a[0].length) return b[0].length - a[0].length // Longer words first
      return a[0] < b[0] ? -1 : 1 // Alphabetical
    })
    .map(([t]) => t)
  
  return sorted.slice(0, max)
}

// Versant-specific scoring function that focuses on meaningful content words
export function computeMatchScore(story: string, transcript: string) {
  // Extract meaningful keywords (excluding stopwords)
  const storyKeywords = new Set(extractKeywords(story, 20))
  const userTokens = new Set(normalize(transcript))

  // Find exact matches and partial matches
  const matched: string[] = []
  const partialMatches: string[] = []
  
  for (const keyword of storyKeywords) {
    if (userTokens.has(keyword)) {
      matched.push(keyword)
    } else {
      // Check for partial matches (substring matches)
      const hasPartialMatch = [...userTokens].some(token => 
        token.includes(keyword) || keyword.includes(token)
      )
      if (hasPartialMatch) {
        partialMatches.push(keyword)
      }
    }
  }

  const missing = [...storyKeywords].filter((k) => 
    !userTokens.has(k) && !partialMatches.includes(k)
  )

  // Versant-style scoring: Focus on content word accuracy
  const exactMatchScore = storyKeywords.size ? (matched.length / storyKeywords.size) : 0
  const partialMatchScore = storyKeywords.size ? (partialMatches.length / storyKeywords.size) * 0.5 : 0
  
  // Calculate meaningful word density in user response
  const storyTokens = normalize(story)
  const userTokensArray = normalize(transcript)
  
  // Count meaningful words (non-stopwords) in both story and user response
  const storyMeaningfulWords = storyTokens.filter(token => !STOPWORDS.has(token))
  const userMeaningfulWords = userTokensArray.filter(token => !STOPWORDS.has(token))
  
  // Content word overlap
  const storyContentSet = new Set(storyMeaningfulWords)
  const userContentSet = new Set(userMeaningfulWords)
  
  let contentMatches = 0
  for (const word of storyContentSet) {
    if (userContentSet.has(word)) {
      contentMatches++
    }
  }
  
  const contentWordScore = storyContentSet.size ? (contentMatches / storyContentSet.size) : 0
  
  // Length adequacy (bonus for substantial responses)
  const lengthRatio = Math.min(1, userMeaningfulWords.length / storyMeaningfulWords.length)
  const lengthBonus = lengthRatio > 0.5 ? (lengthRatio - 0.5) * 0.2 : 0
  
  // Versant-style scoring: Weighted combination
  const baseScore = (exactMatchScore * 0.6) + (partialMatchScore * 0.2) + (contentWordScore * 0.2) + lengthBonus
  
  // Apply Versant-friendly curve (more generous for practice)
  let finalScore = baseScore
  if (baseScore > 0.4) {
    // Boost scores above 40% more generously
    finalScore = 0.4 + (baseScore - 0.4) * 1.3
  } else if (baseScore > 0.2) {
    // Moderate boost for middle range
    finalScore = 0.2 + (baseScore - 0.2) * 1.2
  }
  
  const percentage = Math.round(Math.min(100, Math.max(0, finalScore * 100)))

  return {
    percentage,
    matchedKeywords: matched.sort(),
    missingKeywords: missing.sort(),
    totalKeywords: storyKeywords.size,
    contentWords: storyContentSet.size,
    userContentWords: userContentSet.size,
    contentMatches: contentMatches
  }
}

// Enhanced scoring function that uses predefined keywords from stories.json
export function computeMatchScoreWithKeywords(story: string, transcript: string, predefinedKeywords: string[]) {
  // Normalize predefined keywords
  const normalizedKeywords = predefinedKeywords.map(k => k.toLowerCase().trim()).filter(Boolean)
  const storyKeywords = new Set(normalizedKeywords)
  const userTokens = new Set(normalize(transcript))

  // Find exact matches and partial matches
  const matched: string[] = []
  const partialMatches: string[] = []
  
  for (const keyword of storyKeywords) {
    if (userTokens.has(keyword)) {
      matched.push(keyword)
    } else {
      // Check for partial matches (substring matches)
      const hasPartialMatch = [...userTokens].some(token => 
        token.includes(keyword) || keyword.includes(token)
      )
      if (hasPartialMatch) {
        partialMatches.push(keyword)
      }
    }
  }

  const missing = [...storyKeywords].filter((k) => 
    !userTokens.has(k) && !partialMatches.includes(k)
  )

  // Calculate scores
  const exactMatchScore = storyKeywords.size ? (matched.length / storyKeywords.size) : 0
  const partialMatchScore = storyKeywords.size ? (partialMatches.length / storyKeywords.size) * 0.5 : 0
  
  // Calculate meaningful word density in user response
  const storyTokens = normalize(story)
  const userTokensArray = normalize(transcript)
  
  // Count meaningful words (non-stopwords) in both story and user response
  const storyMeaningfulWords = storyTokens.filter(token => !STOPWORDS.has(token))
  const userMeaningfulWords = userTokensArray.filter(token => !STOPWORDS.has(token))
  
  // Content word overlap
  const storyContentSet = new Set(storyMeaningfulWords)
  const userContentSet = new Set(userMeaningfulWords)
  
  let contentMatches = 0
  for (const word of storyContentSet) {
    if (userContentSet.has(word)) {
      contentMatches++
    }
  }
  
  const contentWordScore = storyContentSet.size ? (contentMatches / storyContentSet.size) : 0
  
  // Length adequacy (bonus for substantial responses)
  const lengthRatio = Math.min(1, userMeaningfulWords.length / storyMeaningfulWords.length)
  const lengthBonus = lengthRatio > 0.5 ? (lengthRatio - 0.5) * 0.2 : 0
  
  // Enhanced scoring for predefined keywords: Weight exact keyword matches more heavily
  const baseScore = (exactMatchScore * 0.7) + (partialMatchScore * 0.2) + (contentWordScore * 0.1) + lengthBonus
  
  // Apply Versant-friendly curve (more generous for practice)
  let finalScore = baseScore
  if (baseScore > 0.4) {
    // Boost scores above 40% more generously
    finalScore = 0.4 + (baseScore - 0.4) * 1.3
  } else if (baseScore > 0.2) {
    // Moderate boost for middle range
    finalScore = 0.2 + (baseScore - 0.2) * 1.2
  }
  
  const percentage = Math.round(Math.min(100, Math.max(0, finalScore * 100)))

  return {
    percentage,
    matchedKeywords: matched.sort(),
    missingKeywords: missing.sort(),
    totalKeywords: storyKeywords.size,
    contentWords: storyContentSet.size,
    userContentWords: userContentSet.size,
    contentMatches: contentMatches
  }
}
