// Define the structure for pre-chunked knowledge base entries
export interface KnowledgeChunk {
  id: string
  title: string
  content: string
  keywords: string[]
  relatedChunks?: string[] // IDs of related chunks
}

// Type for the entire knowledge base
export type KnowledgeBase = KnowledgeChunk[]
