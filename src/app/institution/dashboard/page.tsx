// src/app/institution/dashboard/page.tsx - Institution Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { Users, CheckCircle, Lock } from 'lucide-react';

export default function InstitutionDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      const role = authHelpers.getUserRole(user);
      if (!role || role !== UserRole.INSTITUTION) {
        router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
        return;
      }
      setIsLoading(false);
    };
    checkAuth();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <FadeIn>
        <div className="space-y-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Institution Dashboard</h1>
          <p className="text-gray-600">View your teams and nominate top 5</p>
        </div>
      </FadeIn>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-gray-600">Total Teams</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">0</p>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-gray-600">Nominated</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">0/5</p>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-gray-600">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold flex items-center gap-2">
                <Lock className="h-6 w-6" />
                Unlocked
              </p>
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      <SlideIn delay={0.4}>
        <Card className="border-gray-100">
          <CardHeader>
            <CardTitle>Your Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">No teams registered yet</p>
          </CardContent>
        </Card>
      </SlideIn>
    </div>
  );
}