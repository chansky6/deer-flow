"use client";

import { useEffect } from "react";
import { GithubIcon, LockIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthSession } from "@/core/auth";
import { authClient } from "@/server/better-auth/client";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isPending } = useAuthSession();

  const next = searchParams.get("next") || "/workspace";

  useEffect(() => {
    if (data?.user) {
      router.replace(next);
    }
  }, [data?.user, next, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border">
            <LockIcon className="size-5" />
          </div>
          <CardTitle>Sign in to DeerFlow</CardTitle>
          <CardDescription>
            Continue with your organization login or GitHub account.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            disabled={isPending}
            onClick={() =>
              authClient.signIn.oauth2({
                providerId: "oidc",
                callbackURL: next,
              })
            }
          >
            Continue with OIDC
          </Button>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() =>
              authClient.signIn.social({
                provider: "github",
                callbackURL: next,
              })
            }
          >
            <GithubIcon className="size-4" />
            Continue with GitHub
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
