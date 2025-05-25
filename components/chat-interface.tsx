"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MessageSquare, Send, X, Key, AlertTriangle, Zap } from "lucide-react"
import {
  saveConversation,
  loadConversation,
  clearConversation,
  shouldClearConversation,
  getConversationAge,
} from "@/utils/conversation-utils"
import type { Message } from "@/types/chat-types"

interface ChatInterfaceProps {
  embedded?: boolean
}

export function ChatInterface({ embedded = false }: ChatInterfaceProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [messages, setMessages] = useState<Message[]>(() => {
    // Check if old conversations should be cleared
    if (typeof window !== "undefined" && shouldClearConversation()) {
      clearConversation()
      return []
    }
    return loadConversation()
  })
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<string | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [showWarning, setShowWarning] = useState(false)
  const [ragEnabled, setRagEnabled] = useState(true) // Always enabled, toggle button removed
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [responseTime, setResponseTime] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load API key from localStorage on component mount
  useEffect(() => {
    const savedApiKey = localStorage.getItem("openrouter_api_key")
    if (savedApiKey) {
      setApiKey(savedApiKey)
    }

    // Load RAG preference
    const savedRagEnabled = localStorage.getItem("rag_enabled")
    if (savedRagEnabled !== null) {
      setRagEnabled(savedRagEnabled === "true")
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, debugInfo])

  useEffect(() => {
    if (messages.length > 0) {
      saveConversation(messages)
    }
  }, [messages])

  // Add a function to clear chat history
  const clearChatHistory = useCallback(() => {
    setMessages([])
    clearConversation()
  }, [])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value)

    // Show warning if input is very long
    if (e.target.value.length > 500) {
      setShowWarning(true)
    } else {
      setShowWarning(false)
    }
  }

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value)
    // Reset the saved state when the API key changes
    setApiKeySaved(false)
  }

  const saveApiKey = () => {
    // Save API key to localStorage
    localStorage.setItem("openrouter_api_key", apiKey)
    setApiKeySaved(true)

    // Show saved state for 2 seconds
    setTimeout(() => {
      setApiKeySaved(false)
    }, 2000)
  }

  const formatMessageContent = (content: string) => {
    // Replace line breaks with <br> tags
    return content.split("\n").map((line, i) => (
      <span key={i}>
        {line}
        {i < content.split("\n").length - 1 && <br />}
      </span>
    ))
  }

  const getConversationAgeText = useCallback(() => {
    const ageInMs = getConversationAge()
    if (ageInMs === 0) return ""

    const ageInHours = Math.floor(ageInMs / (60 * 60 * 1000))
    if (ageInHours < 1) {
      const ageInMinutes = Math.floor(ageInMs / (60 * 1000))
      return `${ageInMinutes} minute${ageInMinutes !== 1 ? "s" : ""} ago`
    }

    return `${ageInHours} hour${ageInHours !== 1 ? "s" : ""} ago`
  }, [])

  // Memoize message preparation to avoid recalculation
  const preparedMessages = useMemo(() => {
    return messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() === "" || isLoading) return

    const startTime = Date.now()

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setError(null)
    setDebugInfo(null)
    setIsLoading(true)
    setShowWarning(false)
    setResponseTime(null)

    try {
      // Set a client-side timeout to handle server timeouts
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 45000) // 45 second timeout

      // Use the simple non-streaming endpoint for testing
      const response = await fetch("/api/chat-simple", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            ...preparedMessages,
            {
              role: userMessage.role,
              content: userMessage.content,
            },
          ],
          userApiKey: apiKey || undefined, // Send the user's API key if available
          ragEnabled: ragEnabled, // Send RAG preference
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Calculate response time
      const endTime = Date.now()
      const responseTimeMs = endTime - startTime
      setResponseTime(responseTimeMs)

      // First get the response as text to handle potential non-JSON responses
      const responseText = await response.text()
      let data

      try {
        // Try to parse the text as JSON
        data = JSON.parse(responseText)
      } catch (parseError) {
        // If parsing fails, it's not valid JSON
        console.error("Failed to parse response as JSON:", parseError)

        // Check if this looks like a timeout error
        if (responseText.includes("FUNCTION_INVOCATION_TIMEOUT") || responseText.includes("timed out")) {
          throw new Error(
            "The request timed out. Your message might be too long or complex. Please try a shorter message.",
          )
        }

        throw new Error(`Server returned invalid JSON: ${responseText.substring(0, 100)}...`)
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to get response")
      }

      // Check if response content is empty or undefined
      if (!data.response || data.response.trim() === "") {
        console.warn("Received empty response from API")
        setDebugInfo(
          JSON.stringify(
            {
              warning: "Received empty response from API",
              fullResponse: data,
              usingUserApiKey: !!apiKey,
            },
            null,
            2,
          ),
        )

        throw new Error(
          "Received an empty response from the AI. This might be due to rate limiting or model limitations.",
        )
      }

      // Add assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.response,
        model: data.model,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, assistantMessage])

      // Set debug info if available
      if (data.debug) {
        // Add chunk IDs to debug info if available
        if (data.debug.chunkIds) {
          data.debug.usedChunks = data.debug.chunkIds
        }
        // Add response time to debug info
        data.debug.responseTime = `${responseTimeMs}ms`
        setDebugInfo(JSON.stringify(data.debug, null, 2))
      }

      // If rate limit error occurred, show API key input
      if (data.rateLimited) {
        setShowApiKeyInput(true)
      }

      // If timeout occurred, show a warning
      if (data.timedOut) {
        setShowWarning(true)
      }
    } catch (err) {
      console.error("Error:", err)

      // Handle abort errors (client-side timeout)
      if (err.name === "AbortError") {
        setError("The request timed out. Your message might be too long or complex. Please try a shorter message.")
      } else {
        setError(err instanceof Error ? err.message : "An unknown error occurred")
      }

      // If the error mentions rate limit, show API key input
      if (
        err instanceof Error &&
        (err.message.includes("rate") || err.message.includes("limit") || err.message.includes("quota"))
      ) {
        setShowApiKeyInput(true)
      }

      // If the error mentions timeout, show warning
      if (err instanceof Error && (err.message.includes("timeout") || err.message.includes("timed out"))) {
        setShowWarning(true)
      }
    } finally {
      setIsLoading(false)
      setTimeout(scrollToBottom, 100)
    }
  }

  const testOpenRouter = async () => {
    setDebugInfo("Testing OpenRouter API...")
    try {
      const response = await fetch("/api/test-openrouter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userApiKey: apiKey || undefined,
        }),
      })

      // First get the response as text to handle potential non-JSON responses
      const responseText = await response.text()
      let data

      try {
        // Try to parse the text as JSON
        data = JSON.parse(responseText)
      } catch (parseError) {
        // If parsing fails, it's not valid JSON
        console.error("Failed to parse test response as JSON:", parseError)
        setDebugInfo(`Test error: Failed to parse response as JSON. Raw response: ${responseText.substring(0, 200)}...`)
        setShowDebug(true)
        return
      }

      if (data.success) {
        setDebugInfo(
          `Test successful! Response: ${data.message}\n\nFull API Response: ${JSON.stringify(data.apiResponse, null, 2)}`,
        )
      } else {
        setDebugInfo(`Test failed: ${data.error}\n\nDetails: ${data.details || "No details provided"}`)
      }
    } catch (err) {
      setDebugInfo(`Test error: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
    setShowDebug(true)
  }

  if (embedded && !isOpen) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button className="rounded-full w-12 h-12 flex items-center justify-center" onClick={() => setIsOpen(true)}>
          <MessageSquare className="h-6 w-6" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col bg-background ${embedded ? "h-full" : "h-[600px]"} ${embedded && isOpen ? "fixed bottom-4 right-4 w-[350px] shadow-xl rounded-md z-50 border" : ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">Andrew AI</h3>
          {responseTime && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {responseTime}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setShowApiKeyInput(!showApiKeyInput)} title="Set API Key">
            <Key className="h-4 w-4" />
          </Button>
          {embedded && (
            <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* API Key Input */}
      {showApiKeyInput && (
        <div className="p-3 border-b">
          <label htmlFor="api-key" className="block text-sm font-medium mb-1">
            Your OpenRouter API Key:
          </label>
          <div className="flex gap-2">
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={handleApiKeyChange}
              placeholder="Enter your API key"
              className="flex-1"
            />
            <Button
              onClick={saveApiKey}
              size="sm"
              variant={apiKeySaved ? "outline" : "default"}
              className={apiKeySaved ? "bg-green-100 text-green-800 border-green-300" : ""}
            >
              {apiKeySaved ? "Saved!" : "Save"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Get a free key at{" "}
            <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="underline">
              openrouter.ai
            </a>
          </p>
        </div>
      )}

      {/* Conversation Info */}
      {messages.length > 0 && (
        <div className="px-4 py-2 bg-muted text-xs text-muted-foreground flex justify-between items-center">
          <span>Conversation started {getConversationAgeText()}</span>
          <Button variant="ghost" size="sm" onClick={clearChatHistory} className="h-6 text-xs">
            Clear Chat
          </Button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 message-container">
        {messages.length === 0 && !debugInfo && (
          <div className="text-center text-muted-foreground py-8">
            <MessageSquare className="h-8 w-8 mx-auto mb-2" />
            <p>How can I help you today?</p>
          </div>
        )}

        {showDebug && debugInfo && (
          <div className="mb-4 p-3 rounded-lg bg-blue-100 text-blue-800 w-full overflow-auto">
            <p className="font-semibold">Debug Info:</p>
            <pre className="text-xs whitespace-pre-wrap">{debugInfo}</pre>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="mb-4">
            <div
              className={`p-3 rounded-lg ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground ml-auto max-w-[80%]"
                  : "bg-secondary text-secondary-foreground mr-auto max-w-[80%]"
              }`}
            >
              {formatMessageContent(message.content)}
            </div>
            {message.model && showDebug && (
              <div className="text-xs text-muted-foreground mt-1 ml-1">Model: {message.model}</div>
            )}
          </div>
        ))}

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive text-destructive-foreground mr-auto max-w-[80%]">
            Error: {error}
          </div>
        )}

        {isLoading && (
          <div className="mb-4 p-3 rounded-lg bg-secondary text-secondary-foreground mr-auto">
            <div className="flex space-x-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }}></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }}></div>
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "600ms" }}></div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Warning for long messages */}
      {showWarning && (
        <div className="px-4 py-2 bg-amber-100 text-amber-800 text-sm flex items-center">
          <AlertTriangle className="h-4 w-4 mr-2 flex-shrink-0" />
          <span>Long messages may cause timeouts. Consider breaking your question into smaller parts.</span>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t flex items-end gap-2">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Type your message..."
          className="flex-1"
          disabled={isLoading}
        />
        <Button type="submit" size="icon" disabled={isLoading || input.trim() === ""}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  )
}
