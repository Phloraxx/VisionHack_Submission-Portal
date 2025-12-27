"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authHelpers } from "@/lib/appwrite";
import { FadeIn } from "@/components/animations/FadeIn";

export default function Home() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      try {
        const user = await authHelpers.getCurrentUser();
        if (!isMounted) return;

        if (user) {
          const role = authHelpers.getUserRole(user);
          if (role) {
            const dashboard = authHelpers.getRoleDashboard(role);
            router.push(dashboard);
          } else {
            router.push("/auth/login");
          }
        } else {
          router.push("/auth/login");
        }
      } catch (error) {
        if (isMounted) {
          router.push("/auth/login");
        }
      } finally {
        if (isMounted) {
          setIsChecking(false);
        }
      }
    };

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (!isChecking) {
    return null; // Avoid flash of content before redirect
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <FadeIn>
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Vision Hack 2026</h1>
          <p className="text-gray-600">Loading...</p>
        </div>
      </FadeIn>
    </div>
  );
}
