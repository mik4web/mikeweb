import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between p-8">
      <div className="w-full max-w-5xl flex flex-col items-center">
        <h1 className="text-4xl font-bold mb-6">Andrew AI </h1>
        <p className="text-lg mb-8 text-center">Mike Web AI Assistant </p>

        <div className="flex flex-col items-center">
          <Link href="/chat">
            <Button size="lg" className="text-lg px-8 py-6">
              Open Chat
            </Button>
          </Link>

          <p className="mt-8 text-muted-foreground">
            
          </p>
        </div>
      </div>
    </div>
  )
}
