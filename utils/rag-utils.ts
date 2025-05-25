// Simple text chunking and embedding utilities for RAG

// Function to split text into chunks with overlap
export function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = []

  // If text is smaller than chunk size, return it as a single chunk
  if (text.length <= chunkSize) {
    return [text]
  }

  // Split by paragraphs first to avoid cutting in the middle of sentences
  const paragraphs = text.split(/\n\s*\n/)
  let currentChunk = ""

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed chunk size, save current chunk and start a new one
    if (currentChunk.length + paragraph.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk)
      // Keep some overlap from the previous chunk for context
      const lastSentences = currentChunk
        .split(/(?<=[.!?])\s+/)
        .slice(-3)
        .join(" ")
      currentChunk = lastSentences.length < overlap ? lastSentences : ""
    }

    // Add paragraph to current chunk
    if (currentChunk.length > 0) {
      currentChunk += "\n\n"
    }
    currentChunk += paragraph
  }

  // Add the last chunk if it's not empty
  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

// Simple cosine similarity function
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length")
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Function to create a simple embedding (character frequency based)
// This is a very basic embedding method for demonstration
// In production, you would use a proper embedding model like OpenAI's text-embedding-ada-002
export function createSimpleEmbedding(text: string): number[] {
  const normalizedText = text.toLowerCase()
  const embedding = new Array(26).fill(0) // One dimension for each letter of the alphabet

  for (let i = 0; i < normalizedText.length; i++) {
    const charCode = normalizedText.charCodeAt(i) - 97 // 'a' is 97
    if (charCode >= 0 && charCode < 26) {
      embedding[charCode]++
    }
  }

  // Normalize the embedding
  const sum = embedding.reduce((a, b) => a + b, 0)
  if (sum > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= sum
    }
  }

  return embedding
}

// Function to find the most relevant chunks for a query
export function findRelevantChunks(query: string, chunks: string[], embeddings: number[][], topK = 3): string[] {
  const queryEmbedding = createSimpleEmbedding(query)

  // Calculate similarity scores
  const similarities = embeddings.map((embedding) => cosineSimilarity(queryEmbedding, embedding))

  // Get indices of top K chunks
  const indices = similarities
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.index)

  // Return the top K chunks
  return indices.map((index) => chunks[index])
}

// Function to extract keywords from text
export function extractKeywords(text: string): string[] {
  // Remove common stop words
  const stopWords = new Set([
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "in",
    "on",
    "at",
    "to",
    "for",
    "with",
    "by",
    "about",
    "against",
    "between",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "from",
    "up",
    "down",
    "of",
    "off",
    "over",
    "under",
  ])

  // Tokenize and filter
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .split(/\s+/) // Split by whitespace
    .filter((word) => word.length > 2 && !stopWords.has(word)) // Filter out stop words and short words

  // Count word frequencies
  const wordCounts = new Map<string, number>()
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
  }

  // Sort by frequency and take top 10
  return Array.from(wordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((entry) => entry[0])
}
