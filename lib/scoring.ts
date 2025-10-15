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
  let stemmed = token.toLowerCase()
  
  // Handle common irregular plurals and past tense
  const irregulars: { [key: string]: string } = {
    "children": "child", "people": "person", "men": "man", "women": "woman",
    "feet": "foot", "teeth": "tooth", "mice": "mouse", "geese": "goose",
    "went": "go", "came": "come", "saw": "see", "got": "get",
    "took": "take", "made": "make", "said": "say", "told": "tell", "gave": "give",
    "found": "find", "bought": "buy", "brought": "bring", "thought": "think",
    "rode": "ride", "": "ride", "riding": "ride", "rides": "ride",
    "decided": "decide", "decides": "decide", "deciding": "decide",
    "loved": "love", "loves": "love", "loving": "love",
    "trained": "train", "trains": "train", "training": "train",
    "competed": "compete", "competes": "compete", "competing": "compete",
    "beaten": "beat", "beats": "beat", "beating": "beat",
    "raced": "race", "races": "race", "racing": "race"
  }
  
  if (irregulars[stemmed]) {
    return irregulars[stemmed]
  }
  
  // Regular stemming patterns - more comprehensive
  stemmed = stemmed.replace(/(ies)$/i, "y") // cities -> city
  stemmed = stemmed.replace(/(ied)$/i, "y") // tried -> try
  stemmed = stemmed.replace(/(ing)$/i, "") // riding -> rid
  stemmed = stemmed.replace(/(ed)$/i, "") // trained -> train
  stemmed = stemmed.replace(/(ly|ness|ment|s)$/i, "")
  
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
  // Keep original keywords for display, but also create stemmed versions for matching
  const originalKeywords = predefinedKeywords.map(k => k.toLowerCase().trim()).filter(Boolean)
  const stemmedKeywords = originalKeywords.map(k => stem(k)).filter(Boolean)
  const userTokens = new Set(normalize(transcript))
  
  // Debug logging removed for production

  // Find exact matches and partial matches
  const matched: string[] = []
  const partialMatches: string[] = []
  
  // Enhanced matching logic with better fuzzy matching
  for (let i = 0; i < originalKeywords.length; i++) {
    const originalKeyword = originalKeywords[i]
    const stemmedKeyword = stemmedKeywords[i]
    
    let isMatched = false
    let isPartialMatch = false
    
    // Check exact matches first
    const hasExactMatch = userTokens.has(originalKeyword.toLowerCase()) || userTokens.has(stemmedKeyword)
    if (hasExactMatch) {
      matched.push(originalKeyword)
      isMatched = true
    }
    
    if (!isMatched) {
      // Check for stemmed matches
      const hasStemmedMatch = userTokens.has(stemmedKeyword)
      if (hasStemmedMatch) {
        matched.push(originalKeyword)
        isMatched = true
      }
    }
    
    if (!isMatched) {
      // Check for substring matches (more flexible)
      const hasSubstringMatch = [...userTokens].some(token => {
        const tokenLower = token.toLowerCase()
        const keywordLower = originalKeyword.toLowerCase()
        const stemmedLower = stemmedKeyword.toLowerCase()
        
        // Check if token contains keyword or vice versa
        return tokenLower.includes(keywordLower) || 
               keywordLower.includes(tokenLower) ||
               tokenLower.includes(stemmedLower) ||
               stemmedLower.includes(tokenLower)
      })
      
      if (hasSubstringMatch) {
        matched.push(originalKeyword)
        isMatched = true
      }
    }
    
    if (!isMatched) {
      // Check for partial matches (at least 3 characters overlap)
      const hasPartialMatch = [...userTokens].some(token => {
        const tokenLower = token.toLowerCase()
        const keywordLower = originalKeyword.toLowerCase()
        
        // Find longest common substring
        let maxLength = 0
        for (let i = 0; i < tokenLower.length; i++) {
          for (let j = 0; j < keywordLower.length; j++) {
            let k = 0
            while (i + k < tokenLower.length && 
                   j + k < keywordLower.length && 
                   tokenLower[i + k] === keywordLower[j + k]) {
              k++
            }
            maxLength = Math.max(maxLength, k)
          }
        }
        
        // Consider it a partial match if at least 3 characters overlap
        return maxLength >= 3
      })
      
      if (hasPartialMatch) {
        partialMatches.push(originalKeyword)
        isPartialMatch = true
      }
    }
  }

  const missing = originalKeywords.filter((k) => 
    !matched.includes(k) && !partialMatches.includes(k)
  )

  // Calculate scores
  const exactMatchScore = originalKeywords.length ? (matched.length / originalKeywords.length) : 0
  const partialMatchScore = originalKeywords.length ? (partialMatches.length / originalKeywords.length) * 0.5 : 0
  
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
  
  // Calculate additional metrics for better feedback
  const totalAttempted = matched.length + partialMatches.length
  const accuracyRate = originalKeywords.length > 0 ? (totalAttempted / originalKeywords.length) : 0

  return {
    percentage,
    matchedKeywords: matched.sort(),
    missingKeywords: missing.sort(),
    partialMatches: partialMatches.sort(),
    totalKeywords: originalKeywords.length,
    contentWords: storyContentSet.size,
    userContentWords: userContentSet.size,
    contentMatches: contentMatches,
    accuracyRate: Math.round(accuracyRate * 100),
    totalAttempted: totalAttempted,
    exactMatches: matched.length,
    partialMatchesCount: partialMatches.length
  }
}
