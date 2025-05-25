import type { KnowledgeChunk } from "@/types/knowledge-types"
import { cosineSimilarity, createSimpleEmbedding, extractKeywords } from "../utils/rag-utils"

// Interface for internal chunk representation with embeddings
interface EnhancedKnowledgeChunk extends KnowledgeChunk {
  embedding: number[]
  autoKeywords: string[]
}

// RAG Service class
export class RAGService {
  private chunks: EnhancedKnowledgeChunk[] = []
  private isInitialized = false
  private systemPrompt = ""
  private chunkMap: Map<string, EnhancedKnowledgeChunk> = new Map()

  // Initialize the service with pre-chunked knowledge base
  async initialize(knowledgeChunks: KnowledgeChunk[], systemPrompt: string) {
    if (this.isInitialized) return

    if (this.chunks.length > 0 && this.systemPrompt === systemPrompt) {
      console.log("RAG Service already initialized with same data, skipping...")
      return
    }

    this.systemPrompt = systemPrompt

    // Enhance chunks with embeddings and auto-extracted keywords
    this.chunks = knowledgeChunks.map((chunk) => {
      // Combine title and content for better embedding
      const fullText = `${chunk.title}\n\n${chunk.content}`

      const enhancedChunk = {
        ...chunk,
        embedding: createSimpleEmbedding(fullText),
        // Extract additional keywords to supplement manual ones
        autoKeywords: extractKeywords(fullText),
      }

      // Add to map for quick lookup
      this.chunkMap.set(chunk.id, enhancedChunk)

      return enhancedChunk
    })

    // If chunks don't have relatedChunks defined, infer relationships
    this.inferChunkRelationships()

    this.isInitialized = true
    console.log(`RAG Service initialized with ${this.chunks.length} pre-defined chunks`)
  }

  // Infer relationships between chunks based on content similarity and keyword overlap
  private inferChunkRelationships() {
    // For each chunk, find other chunks that might be related
    for (const chunk of this.chunks) {
      if (chunk.relatedChunks && chunk.relatedChunks.length > 0) continue // Skip if already defined

      const relatedChunks: string[] = []

      // Find chunks with similar content or overlapping keywords
      for (const otherChunk of this.chunks) {
        if (chunk.id === otherChunk.id) continue

        // Check keyword overlap
        const keywordOverlap = [...chunk.keywords, ...chunk.autoKeywords].filter(
          (keyword) => otherChunk.keywords.includes(keyword) || otherChunk.autoKeywords.includes(keyword),
        ).length

        // Check content similarity
        const similarity = cosineSimilarity(chunk.embedding, otherChunk.embedding)

        // If there's significant overlap or similarity, consider them related
        if (keywordOverlap >= 2 || similarity > 0.6) {
          relatedChunks.push(otherChunk.id)
        }
      }

      // Add inferred relationships
      chunk.relatedChunks = relatedChunks
    }
  }

  // Get relevant chunks for a query with improved cross-chunk reasoning
  getRelevantContext(query: string, conversationHistory = "", maxChunks = 3): string {
    if (!this.isInitialized) {
      throw new Error("RAG Service not initialized")
    }

    // Combine query with recent conversation history for better context
    const combinedQuery = `${query} ${conversationHistory}`

    // Create embedding for the query
    const queryEmbedding = createSimpleEmbedding(combinedQuery)

    // Limit chunks to process for better performance
    const chunksToProcess = this.chunks.length > 50 ? this.chunks.slice(0, 50) : this.chunks

    // Calculate similarity scores
    const similarities = chunksToProcess.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))

    // Extract keywords from the query
    const queryKeywords = extractKeywords(combinedQuery)

    // Boost scores based on keyword matches
    similarities.forEach((item) => {
      // Check for manual keyword matches
      const manualKeywordMatches = item.chunk.keywords.filter((keyword) =>
        combinedQuery.toLowerCase().includes(keyword.toLowerCase()),
      ).length

      // Check for auto-extracted keyword matches
      const autoKeywordMatches = item.chunk.autoKeywords.filter((keyword) => queryKeywords.includes(keyword)).length

      // Boost score based on keyword matches (manual keywords get higher weight)
      item.score += manualKeywordMatches * 0.15 + autoKeywordMatches * 0.05
    })

    // Sort by score and take top chunks
    const topChunks = similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks)
      .map((item) => item.chunk)

    // Get IDs of top chunks
    const topChunkIds = topChunks.map((chunk) => chunk.id)

    // Find related chunks that might be relevant
    const relatedChunkIds = new Set<string>()

    // For each top chunk, add its related chunks
    topChunks.forEach((chunk) => {
      if (chunk.relatedChunks) {
        chunk.relatedChunks.forEach((relatedId) => {
          // Don't add if it's already in the top chunks
          if (!topChunkIds.includes(relatedId)) {
            relatedChunkIds.add(relatedId)
          }
        })
      }
    })

    // Get the related chunks
    const relatedChunks = Array.from(relatedChunkIds)
      .map((id) => this.chunkMap.get(id))
      .filter((chunk) => chunk !== undefined) as EnhancedKnowledgeChunk[]

    // Combine top chunks with related chunks, but ensure we don't exceed maxChunks + 2
    const combinedChunks = [...topChunks]

    // Add related chunks, but limit the total
    const maxRelatedToAdd = Math.min(relatedChunks.length, 2)
    for (let i = 0; i < maxRelatedToAdd; i++) {
      combinedChunks.push(relatedChunks[i])
    }

    // Format the chunks with titles for better context
    const formattedChunks = combinedChunks.map((chunk) => {
      // Add a note if this is a related chunk
      const isRelated = !topChunkIds.includes(chunk.id)
      const relationNote = isRelated ? " (Related Information)" : ""

      return `## ${chunk.title}${relationNote}\n\n${chunk.content}`
    })

    // Join the chunks with separators
    return formattedChunks.join("\n\n---\n\n")
  }

  // Get the system prompt
  getSystemPrompt(): string {
    return this.systemPrompt
  }

  // Check if the service is initialized
  isReady(): boolean {
    return this.isInitialized
  }

  // Get all chunk IDs (useful for debugging)
  getChunkIds(): string[] {
    return this.chunks.map((chunk) => chunk.id)
  }
}

// Singleton instance
let ragServiceInstance: RAGService | null = null

// Get or create the RAG service instance
export function getRagService(): RAGService {
  if (!ragServiceInstance) {
    ragServiceInstance = new RAGService()
  }
  return ragServiceInstance
}
