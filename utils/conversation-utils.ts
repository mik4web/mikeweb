import type { Message } from "@/types/chat-types"

// Maximum number of messages to keep in history
const MAX_MESSAGES = 20

// Time in milliseconds after which conversations should be cleared (24 hours)
const CONVERSATION_EXPIRY = 24 * 60 * 60 * 1000

export function saveConversation(messages: Message[]): void {
  if (typeof window === "undefined") return

  // Limit the number of messages to prevent excessive storage
  const limitedMessages = messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages

  localStorage.setItem("chat_messages", JSON.stringify(limitedMessages))

  // Update the last interaction time
  localStorage.setItem("last_interaction_time", new Date().getTime().toString())
}

export function loadConversation(): Message[] {
  if (typeof window === "undefined") return []

  try {
    const savedMessages = localStorage.getItem("chat_messages")
    if (!savedMessages) return []

    return JSON.parse(savedMessages)
  } catch (e) {
    console.error("Failed to load conversation:", e)
    return []
  }
}

export function clearConversation(): void {
  if (typeof window === "undefined") return

  localStorage.removeItem("chat_messages")
}

export function shouldClearConversation(): boolean {
  if (typeof window === "undefined") return false

  const lastInteractionTime = localStorage.getItem("last_interaction_time")
  if (!lastInteractionTime) return false

  const currentTime = new Date().getTime()
  const timeSinceLastInteraction = currentTime - Number.parseInt(lastInteractionTime)

  return timeSinceLastInteraction > CONVERSATION_EXPIRY
}

export function getConversationAge(): number {
  if (typeof window === "undefined") return 0

  const lastInteractionTime = localStorage.getItem("last_interaction_time")
  if (!lastInteractionTime) return 0

  const currentTime = new Date().getTime()
  return currentTime - Number.parseInt(lastInteractionTime)
}
