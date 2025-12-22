"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authHelpers } from "@/lib/appwrite";
import { FadeIn } from "@/components/animations/FadeIn";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      if (user) {
        const role = authHelpers.getUserRole(user);
        if (role) {
          const dashboard = authHelpers.getRoleDashboard(role);
          router.push(dashboard);
        } else {
          // Handle case where user exists but has no role
          router.push("/auth/login");
        }
      } else {
        router.push("/auth/login");
      }
    };
    checkAuth();
  }, [router]);

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
