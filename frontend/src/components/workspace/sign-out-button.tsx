"use client";

import { LogOutIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";
import { authClient } from "@/server/better-auth/client";

type SignOutButtonProps = {
  className?: string;
};

export function SignOutButton({ className }: SignOutButtonProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true);
      await authClient.signOut();
      router.replace("/sign-in");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t.settings.actions.signOutFailed,
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("h-8 gap-2", className)}
      disabled={isSigningOut}
      onClick={() => void handleSignOut()}
    >
      <LogOutIcon className="size-4" />
      <span className="hidden sm:inline">
        {isSigningOut
          ? t.settings.actions.signingOut
          : t.settings.actions.signOut}
      </span>
    </Button>
  );
}
