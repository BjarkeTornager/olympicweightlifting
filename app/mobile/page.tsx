import MobileSignIn from "@/components/mobile-sign-in";
import { reviewEnabled } from "@/lib/review";
export const dynamic = "force-dynamic";
export default function MobilePage() {
  return <MobileSignIn review={reviewEnabled()} />;
}
