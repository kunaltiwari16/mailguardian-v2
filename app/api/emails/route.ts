import { type NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { fetchGmailMessages, getGmailMessage, analyzeEmail } from "@/lib/gmail"

// Mark this route as dynamic to prevent static generation issues
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions)

    if (!session) {
      console.error("❌ Session Error: No session found")
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    if (!session.accessToken) {
      console.error("❌ Token Error: No access token in session")
      return NextResponse.json({ error: "No access token available. Please sign in again." }, { status: 401 })
    }

    // 🔍 DIAGNOSTIC LOGGING - Session & Token Info
    console.log("\n🔍 === MAIL GUARDIAN - GMAIL API DIAGNOSTIC ===")
    console.log("⏰ Timestamp:", new Date().toISOString())
    console.log("👤 User Email:", session.user?.email)
    console.log("🔑 Access Token Exists:", !!session.accessToken)
    console.log("📏 Token Length:", session.accessToken?.length || 0)
    console.log("🔐 Token Preview:", session.accessToken?.substring(0, 50) + "...")
    console.log("📅 Token Expires At:", session.expiresAt || "Not set")
    console.log("🔄 Refresh Token Exists:", !!session.refreshToken)
    console.log("============================================\n")

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const maxResults = Math.min(Number.parseInt(searchParams.get("maxResults") || "10"), 20) // Limit to 20

    console.log(`📧 Fetching ${maxResults} emails for user: ${session.user?.email}`)

    // Fetch messages from Gmail API
    let messagesResponse
    try {
      messagesResponse = await fetchGmailMessages(session.accessToken, maxResults)
      console.log("✅ Gmail messages fetched successfully")
    } catch (gmailError) {
      console.error("❌ Error fetching Gmail messages:", gmailError)
      throw gmailError
    }

    if (!messagesResponse.messages || messagesResponse.messages.length === 0) {
      console.log("⚠️  No emails found in inbox")
      return NextResponse.json({
        emails: [],
        message: "No emails found in your inbox.",
        totalFetched: 0,
        timestamp: new Date().toISOString(),
      })
    }

    console.log(`📬 Found ${messagesResponse.messages.length} messages, analyzing...`)

    // Fetch detailed message data and analyze each email
    const emailPromises = messagesResponse.messages.map(async (msg, index) => {
      try {
        console.log(`  📨 Processing email ${index + 1}/${messagesResponse.messages.length} (ID: ${msg.id})`)
        const messageDetail = await getGmailMessage(session.accessToken!, msg.id)
        const analyzed = analyzeEmail(messageDetail)
        console.log(`  ✅ Email analyzed: "${analyzed.subject}" - Trust Score: ${analyzed.trustScore}%`)
        return analyzed
      } catch (error) {
        console.error(`  ❌ Error processing email ${msg.id}:`, error instanceof Error ? error.message : error)
        return null
      }
    })

    const results = await Promise.all(emailPromises)
    const analyzedEmails = results.filter((email) => email !== null)

    console.log(`\n✅ Successfully analyzed ${analyzedEmails.length} out of ${messagesResponse.messages.length} emails`)
    console.log("🎉 Emails ready to display on dashboard\n")

    return NextResponse.json({
      emails: analyzedEmails,
      totalFetched: analyzedEmails.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("\n❌ ═══════════════════════════════════════════")
    console.error("❌ GMAIL API ERROR")
    console.error("❌ ═══════════════════════════════════════════")

    if (error instanceof Error) {
      console.error("❌ Error Type:", error.constructor.name)
      console.error("❌ Error Message:", error.message)
      console.error("❌ Error Stack:", error.stack)

      // Parse the actual API response for more details
      const errorDetails = error.message
      console.error("❌ Full Error:", errorDetails)

      // 401 - Unauthorized / Token Expired
      if (error.message.includes("401")) {
        console.error("💡 Issue: Access token has expired or is invalid")
        console.error("💡 Solution: User needs to sign out and sign in again")
        return NextResponse.json(
          {
            error: "Gmail access token expired. Please sign out and sign in again.",
            code: "TOKEN_EXPIRED",
            details: "Your authentication token is no longer valid.",
            timestamp: new Date().toISOString(),
          },
          { status: 401 },
        )
      }

      // 403 - Forbidden / Permission Denied
      if (error.message.includes("403")) {
        console.error("💡 Issue: Access token exists but lacks Gmail permissions")
        console.error("💡 Solution: User didn't grant Gmail permissions during sign-in")
        console.error("💡 Action: Need to revoke app permission and re-authenticate")
        return NextResponse.json(
          {
            error: "Gmail API access denied. Make sure you granted permission to read your emails.",
            code: "PERMISSION_DENIED",
            details: "The access token doesn't have Gmail permission. Please sign out and sign in again, then allow Gmail access.",
            suggestion: "Check that you clicked 'Allow' for Gmail permissions during login.",
            troubleshooting: "1. Visit https://myaccount.google.com/permissions 2. Find MailGuardian 3. Click Remove Access 4. Sign in again",
            timestamp: new Date().toISOString(),
          },
          { status: 403 },
        )
      }

      // 429 - Rate Limited
      if (error.message.includes("429")) {
        console.error("💡 Issue: Gmail API rate limit exceeded")
        console.error("💡 Solution: Wait a few minutes before retrying")
        return NextResponse.json(
          {
            error: "Gmail API rate limit exceeded. Please try again in a few minutes.",
            code: "RATE_LIMITED",
            timestamp: new Date().toISOString(),
          },
          { status: 429 },
        )
      }

      // 400 - Bad Request
      if (error.message.includes("400")) {
        console.error("💡 Issue: Invalid request to Gmail API")
        console.error("💡 Possible cause: Malformed access token or invalid parameters")
        return NextResponse.json(
          {
            error: "Invalid request to Gmail API.",
            code: "BAD_REQUEST",
            details: error.message,
            timestamp: new Date().toISOString(),
          },
          { status: 400 },
        )
      }

      // 500 - Gmail Server Error
      if (error.message.includes("500") || error.message.includes("5")) {
        console.error("💡 Issue: Gmail API server error")
        console.error("💡 Solution: Try again in a few minutes")
        return NextResponse.json(
          {
            error: "Gmail API server error. Please try again in a few minutes.",
            code: "SERVER_ERROR",
            timestamp: new Date().toISOString(),
          },
          { status: 503 },
        )
      }
    }

    console.error("❌ Unknown error encountered")
    console.error("❌ ═══════════════════════════════════════════\n")

    return NextResponse.json(
      {
        error: "Failed to fetch emails from Gmail API",
        code: "UNKNOWN_ERROR",
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    )
  }
}