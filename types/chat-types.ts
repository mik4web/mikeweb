export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  model?: string
  timestamp?: number
}

export interface ChatSettings {
  apiKey?: string
  ragEnabled: boolean
  autoDeleteHours: number
}
