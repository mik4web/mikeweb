import { ChatInterface } from "@/components/chat-interface"

export default function ChatPage() {
  return (
    <div className="h-screen flex flex-col">
      <ChatInterface embedded={true} />
    </div>
  )
}
