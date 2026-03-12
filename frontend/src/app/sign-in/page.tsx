import { SignInCard } from "@/components/auth/sign-in-card";
import { isW3OAuthConfigured } from "@/server/better-auth/w3";

export default function SignInPage() {
  return <SignInCard w3Configured={isW3OAuthConfigured()} />;
}
