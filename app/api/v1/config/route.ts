import { MIN_IOS_BUILD } from "@/lib/native-client";
import { voiceProviders } from "@/lib/voice-elevenlabs";
import { nativeConfig } from "@/lib/native-api";

export const dynamic = "force-dynamic";

// Public and account-free, so an outdated build can learn it must update
// before it even signs in.
export async function GET() {
  return Response.json(
    nativeConfig.parse({
      minimumBuild: MIN_IOS_BUILD,
      voice: voiceProviders().length > 0,
      voiceProviders: voiceProviders(),
      serverTime: new Date().toISOString(),
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
