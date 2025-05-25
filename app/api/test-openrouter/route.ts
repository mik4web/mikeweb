export async function POST(req: Request) {
  try {
    const { userApiKey } = await req.json()

    // Use user-provided API key if available, otherwise fall back to environment variable
    const apiKey = userApiKey || process.env.OPENROUTER_API_KEY

    if (!apiKey) {
      console.error("OpenRouter API key is missing")
      return Response.json(
        {
          success: false,
          error: "API key is not configured",
          details: "Please add your OpenRouter API key in the settings",
        },
        { status: 500 },
      )
    }

    // Make a simple request to test the API connection
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://vercel.com",
        "X-Title": "Customizable AI Chatbot",
      },
    })

    if (!response.ok) {
      // Get the response as text first to handle non-JSON errors
      const errorText = await response.text()
      console.error(`OpenRouter API Error: Status ${response.status}`, errorText)

      return Response.json(
        {
          success: false,
          error: `API Error: ${response.status}`,
          details: errorText,
          apiKeyProvided: !!apiKey,
          usingUserApiKey: !!userApiKey,
        },
        { status: response.status },
      )
    }

    // Try to parse the response as JSON, with error handling
    let data
    try {
      const responseText = await response.text()
      data = JSON.parse(responseText)
    } catch (parseError) {
      console.error("Failed to parse response as JSON:", parseError)
      return Response.json(
        {
          success: false,
          error: "Failed to parse API response",
          details: parseError instanceof Error ? parseError.message : "Unknown parsing error",
        },
        { status: 500 },
      )
    }

    return Response.json({
      success: true,
      message: "Successfully connected to OpenRouter API",
      apiResponse: data,
      usingUserApiKey: !!userApiKey,
    })
  } catch (error) {
    console.error("Test OpenRouter error:", error)
    return Response.json(
      {
        success: false,
        error: "Failed to connect to OpenRouter API",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
