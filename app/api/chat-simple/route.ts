import { getRagService } from "@/services/rag-service"

export const maxDuration = 60 // Set maximum duration to 60 seconds (if your plan supports it)

// Simple intent detection function
function detectIntent(message: string): "greeting" | "question" | "general" {
  const lowerMessage = message.toLowerCase().trim()

  // Greeting patterns
  const greetingPatterns = [
    /^(hi|hello|hey|good morning|good afternoon|good evening)$/,
    /^(hi there|hello there|hey there)$/,
    /^(what's up|whats up|sup)$/,
    /^(how are you|how's it going|hows it going)$/,
  ]

  // Check if it's a simple greeting
  if (greetingPatterns.some((pattern) => pattern.test(lowerMessage))) {
    return "greeting"
  }

  // Check if it's a question (contains question words or ends with ?)
  const questionPatterns = [
    /\?$/,
    /^(what|how|when|where|why|who|which|can|could|would|should|is|are|do|does|did)/,
    /\b(help|explain|tell me|show me|guide|tutorial|steps)\b/,
  ]

  if (questionPatterns.some((pattern) => pattern.test(lowerMessage))) {
    return "question"
  }

  return "general"
}

// Function to determine if we need RAG context
function needsKnowledgeBase(intent: string, message: string): boolean {
  if (intent === "greeting") return false

  // Simple messages that don't need knowledge base
  const simplePatterns = [/^(thanks|thank you|ok|okay|yes|no|sure)$/i, /^(bye|goodbye|see you|talk to you later)$/i]

  if (simplePatterns.some((pattern) => pattern.test(message.trim()))) {
    return false
  }

  return true
}

export async function POST(req: Request) {
  try {
    const { messages, userApiKey, ragEnabled = true } = await req.json()

    // Extract the user's query (last message)
    const userQuery = messages.length > 0 ? messages[messages.length - 1].content : ""

    // Detect intent and determine if we need knowledge base
    const intent = detectIntent(userQuery)
    const needsRAG = ragEnabled && needsKnowledgeBase(intent, userQuery)

    let systemMessage
    let relevantContext = ""

    if (needsRAG) {
      // Fetch the system prompt and knowledge base from the config endpoint
      const configResponse = await fetch(new URL("/api/config", req.url).toString())
      const config = await configResponse.json()

      // Get or initialize the RAG service
      const ragService = getRagService()
      if (!ragService.isReady()) {
        await ragService.initialize(config.knowledgeBase, config.systemPrompt)
      }

      // Get more conversation history for context (up to 6 previous messages)
      const recentHistory =
        messages.length > 1
          ? messages
              .slice(-7, -1)
              .map((m) => `${m.role}: ${m.content}`)
              .join("\n")
          : ""

      // Get relevant context from the knowledge base with enhanced cross-chunk reasoning
      relevantContext = ragService.getRelevantContext(userQuery, recentHistory, 3)

      // Create the system message with the relevant context and improved instructions
      systemMessage = {
        role: "system",
        content: `${ragService.getSystemPrompt()}

Here is the relevant information from your knowledge base that you should reference when answering this question:

${relevantContext}

IMPORTANT INSTRUCTIONS FOR RESPONSES:
1. Be concise and direct - only provide information that directly answers the user's question
2. Don't volunteer additional information unless specifically asked
3. If the user asks a simple question, give a simple answer
4. Only use the knowledge base information when it's directly relevant to the question
5. For greetings or simple interactions, respond naturally without referencing the knowledge base

CROSS-CHUNK REASONING (only when needed):
1. The information above may come from multiple related knowledge chunks
2. You should synthesize information across all provided chunks to give complete answers
3. If you see sections marked as "Related Information", use them to provide more comprehensive answers
4. When information from different chunks needs to be combined (like calculations or cross-references), do so explicitly
5. If the user is asking about something that requires information from multiple chunks, make connections between them

Remember to only use this information and your general knowledge to answer the question. If the answer is not in the provided context, you can use your general knowledge but make it clear when you're doing so.`,
      }
    } else {
      // For simple interactions, use a minimal system prompt
      systemMessage = {
        role: "system",
        content: `You are Andrew AI, a helpful assistant. 

For this interaction:
- Be friendly and concise
- Don't provide unnecessary information
- Respond naturally to greetings and simple messages
- Keep responses brief unless the user asks for more details

Current interaction type: ${intent}`,
      }
    }

    // Limit conversation history to prevent timeouts
    const maxHistoryMessages = 10
    const limitedMessages =
      messages.length > maxHistoryMessages ? messages.slice(messages.length - maxHistoryMessages) : messages

    // Prepare all messages including system message
    const allMessages = [systemMessage, ...limitedMessages]

    // Use user-provided API key if available, otherwise fall back to environment variable
    const apiKey = userApiKey || process.env.OPENROUTER_API_KEY

    if (!apiKey) {
      console.error("No API key provided")
      return Response.json(
        {
          error: "API key required",
          details:
            "Please provide your OpenRouter API key in the chat interface settings, or contact your administrator to configure the server API key.",
          rateLimited: true,
        },
        { status: 400 },
      )
    }

    // Calculate approximate token count (rough estimate)
    const totalPromptChars = allMessages.reduce((sum, msg) => sum + msg.content.length, 0)
    const estimatedTokens = Math.ceil(totalPromptChars / 4) // Very rough estimate: ~4 chars per token

    console.log(
      "Sending to OpenRouter:",
      JSON.stringify({
        messages: [
          { role: "system", content: `${systemMessage.content.substring(0, 100)}... [Truncated]` },
          ...limitedMessages.map((m) => ({ role: m.role, content: m.content })),
        ],
        model: "deepseek/deepseek-chat-v3-0324:free",
        usingUserApiKey: !!userApiKey,
        hasServerApiKey: !!process.env.OPENROUTER_API_KEY,
        estimatedTokens,
        contextLength: relevantContext.length,
        intent,
        needsRAG,
      }),
    )

    // Add timeout to API requests to prevent function timeouts
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 20000) // 20 second timeout

    // Try with primary model first
    let response
    let errorMessage = ""

    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://vercel.com",
          "X-Title": "Customizable AI Chatbot",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-chat-v3-0324:free", // Primary model
          messages: allMessages,
          temperature: intent === "greeting" ? 0.3 : 0.7, // Lower temperature for greetings
          max_tokens: intent === "greeting" ? 50 : 1200, // Shorter responses for greetings
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId) // Clear the timeout if request completes

      if (!response.ok) {
        // Get the response as text first to handle non-JSON errors
        const errorText = await response.text()
        console.error(`OpenRouter API Error: Status ${response.status}`, errorText)

        // Check if this is a rate limit error
        const isRateLimit =
          errorText.includes("rate") ||
          errorText.includes("limit") ||
          errorText.includes("quota") ||
          response.status === 429

        errorMessage = `API Error: ${response.status} - ${errorText}`

        if (isRateLimit) {
          return Response.json(
            {
              error: "Rate limit exceeded",
              details: "You've reached the OpenRouter API rate limit. Please use your own API key.",
              rateLimited: true,
            },
            { status: 429 },
          )
        }

        throw new Error(errorMessage)
      }

      // Try to parse the response as JSON, with error handling
      let data
      try {
        const responseText = await response.text()
        try {
          data = JSON.parse(responseText)
        } catch (parseError) {
          console.error("Failed to parse response as JSON:", parseError)
          console.error("Raw response:", responseText)
          throw new Error(`Failed to parse API response: ${responseText.substring(0, 100)}...`)
        }
      } catch (parseError) {
        throw new Error(`API returned invalid JSON: ${parseError.message}`)
      }

      // Check if the response is empty or missing content
      if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
        console.error("API returned empty or invalid response structure:", data)
        throw new Error("API returned an empty or invalid response")
      }

      const responseContent = data.choices[0].message.content

      // Check if content is empty
      if (responseContent.trim() === "") {
        console.warn("API returned empty content")
        throw new Error(
          "The AI model returned an empty response. This might be due to content filtering or token limits.",
        )
      }

      // Return the successful response
      console.log(
        "Response from API:",
        JSON.stringify({
          model: data.model,
          contentLength: responseContent.length,
          usage: data.usage,
          intent,
          usedRAG: needsRAG,
        }),
      )

      return Response.json({
        response: responseContent,
        model: data.model,
        debug: {
          usage: data.usage,
          id: data.id,
          contextLength: relevantContext.length,
          usingUserApiKey: !!userApiKey,
          estimatedInputTokens: estimatedTokens,
          ragEnabled: needsRAG,
          intent,
          chunkIds: needsRAG ? (await import("@/services/rag-service")).getRagService().getChunkIds().slice(0, 3) : [],
        },
      })
    } catch (primaryError) {
      clearTimeout(timeoutId) // Clear the timeout if request fails

      // Check if this was an abort error (timeout)
      if (primaryError.name === "AbortError") {
        console.error("Primary model request timed out")
        errorMessage = "Request to AI model timed out. Please try again with a shorter message."
      } else {
        console.error("Primary model error:", primaryError)
      }

      // Fallback to secondary model
      console.log("Falling back to secondary model...")

      // New timeout for fallback request
      const fallbackController = new AbortController()
      const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), 15000) // 15 second timeout for fallback

      try {
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://vercel.com",
            "X-Title": "Customizable AI Chatbot",
          },
          body: JSON.stringify({
            model: "openai/gpt-3.5-turbo",
            messages: allMessages,
            temperature: intent === "greeting" ? 0.3 : 0.7,
            max_tokens: intent === "greeting" ? 50 : 1200,
          }),
          signal: fallbackController.signal,
        })

        clearTimeout(fallbackTimeoutId) // Clear the timeout if request completes

        if (!response.ok) {
          // Get the response as text first to handle non-JSON errors
          const errorText = await response.text()
          console.error(`Secondary Model Error: Status ${response.status}`, errorText)

          // Check if this is a rate limit error
          const isRateLimit =
            errorText.includes("rate") ||
            errorText.includes("limit") ||
            errorText.includes("quota") ||
            response.status === 429

          if (isRateLimit) {
            return Response.json(
              {
                error: "Rate limit exceeded",
                details: "You've reached the OpenRouter API rate limit. Please use your own API key.",
                rateLimited: true,
              },
              { status: 429 },
            )
          }

          throw new Error(`Secondary Model Error: ${response.status} - ${errorText}`)
        }

        // Try to parse the response as JSON, with error handling
        let data
        try {
          const responseText = await response.text()
          try {
            data = JSON.parse(responseText)
          } catch (parseError) {
            console.error("Failed to parse fallback response as JSON:", parseError)
            console.error("Raw fallback response:", responseText)
            throw new Error(`Failed to parse fallback API response: ${responseText.substring(0, 100)}...`)
          }
        } catch (parseError) {
          throw new Error(`Fallback API returned invalid JSON: ${parseError.message}`)
        }

        // Check if the response is empty or missing content
        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
          console.error("Fallback API returned empty or invalid response structure:", data)
          throw new Error("Fallback API returned an empty or invalid response")
        }

        const responseContent = data.choices[0].message.content

        // Check if content is empty
        if (responseContent.trim() === "") {
          console.warn("Fallback API returned empty content")
          throw new Error(
            "The fallback AI model returned an empty response. This might be due to content filtering or token limits.",
          )
        }

        // Return the successful fallback response
        console.log(
          "Response from fallback API:",
          JSON.stringify({
            model: data.model,
            contentLength: responseContent.length,
            usage: data.usage,
            intent,
            usedRAG: needsRAG,
          }),
        )

        return Response.json({
          response: responseContent,
          model: data.model,
          debug: {
            usage: data.usage,
            id: data.id,
            contextLength: relevantContext.length,
            usingUserApiKey: !!userApiKey,
            fallback: true,
            estimatedInputTokens: estimatedTokens,
            ragEnabled: needsRAG,
            intent,
            chunkIds: needsRAG
              ? (await import("@/services/rag-service")).getRagService().getChunkIds().slice(0, 3)
              : [],
          },
        })
      } catch (secondaryError) {
        clearTimeout(fallbackTimeoutId) // Clear the timeout if request fails

        // Check if this was an abort error (timeout)
        if (secondaryError.name === "AbortError") {
          console.error("Fallback model request timed out")
          secondaryError = new Error("Request to fallback AI model timed out. Please try again with a shorter message.")
        } else {
          console.error("Secondary model error:", secondaryError)
        }

        // If both fail, return a hardcoded response as last resort
        return Response.json({
          response:
            "I'm sorry, I'm having trouble connecting to my knowledge base right now. The request may have timed out due to the size of the conversation or complexity of the question. Please try again with a shorter message.",
          debug: {
            primaryError:
              errorMessage || (primaryError instanceof Error ? primaryError.message : "Unknown primary error"),
            secondaryError: secondaryError instanceof Error ? secondaryError.message : "Unknown secondary error",
            apiKeyProvided: !!apiKey,
            usingUserApiKey: !!userApiKey,
            estimatedInputTokens: estimatedTokens,
            ragEnabled: needsRAG,
            intent,
          },
          rateLimited: false,
          timedOut: true,
        })
      }
    }
  } catch (error) {
    console.error("Chat error:", error)
    return Response.json(
      {
        error: "Failed to process chat request",
        details: error instanceof Error ? error.message : "Unknown error",
        possibleTimeout: error.message?.includes("timeout") || error.message?.includes("FUNCTION_INVOCATION_TIMEOUT"),
      },
      { status: 500 },
    )
  }
}
