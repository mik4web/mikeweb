interface ApiConfig {
  provider: string
  apiKey?: string
}

export async function POST(req: Request) {
  try {
    const { apiConfig } = await req.json()

    // Default to system provider if not specified
    const provider = apiConfig?.provider || "system"

    // Use appropriate API key based on provider
    let apiKey
    if (provider === "system") {
      apiKey = process.env.OPENROUTER_API_KEY
    } else {
      apiKey = apiConfig?.apiKey
    }

    if (!apiKey) {
      console.error(`API key is missing for provider: ${provider}`)
      return Response.json(
        {
          success: false,
          error: "API key is not configured",
          details: `Please add your ${provider} API key in the settings`,
        },
        { status: 500 },
      )
    }

    // Test the appropriate API based on provider
    let response
    let data

    if (provider === "openrouter" || provider === "system") {
      // Test OpenRouter API
      response = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": "https://vercel.com",
          "X-Title": "Customizable AI Chatbot",
        },
      })
    } else if (provider === "deepseek") {
      // Test Deepseek API
      response = await fetch("https://api.deepseek.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
    } else {
      return Response.json(
        {
          success: false,
          error: "Invalid provider",
          details: `Provider ${provider} is not supported`,
        },
        { status: 400 },
      )
    }

    if (!response.ok) {
      const errorData = await response.text()
      console.error(`API Error (${provider}): Status ${response.status}`, errorData)
      return Response.json(
        {
          success: false,
          error: `API Error: ${response.status}`,
          details: errorData,
          provider: provider,
        },
        { status: response.status },
      )
    }

    data = await response.json()

    return Response.json({
      success: true,
      message: `Successfully connected to ${provider} API`,
      apiResponse: data,
      provider: provider,
    })
  } catch (error) {
    console.error("Test API error:", error)
    return Response.json(
      {
        success: false,
        error: "Failed to connect to API",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
