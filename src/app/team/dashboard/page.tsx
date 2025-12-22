// src/app/team/dashboard/page.tsx - Team Lead Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { Users, Upload, FileText, Award } from 'lucide-react';
import { motion } from 'framer-motion';

export default function TeamDashboard() {
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
      if (!role || role !== UserRole.TEAM_LEAD) {
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
          <h1 className="text-3xl font-bold tracking-tight">Team Dashboard</h1>
          <p className="text-gray-600">Manage your team and submissions</p>
        </div>
      </FadeIn>

      <div className="grid md:grid-cols-2 gap-6">
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Manage your team and submissions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <motion.div whileHover={{ x: 4 }}>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => router.push('/team/register')}
                >
                  <Users className="mr-2 h-4 w-4" />
                  Register Team
                </Button>
              </motion.div>
              <motion.div whileHover={{ x: 4 }}>
                <Button variant="outline" className="w-full justify-start">
                  <Upload className="mr-2 h-4 w-4" />
                  Submit Idea
                </Button>
              </motion.div>
              <motion.div whileHover={{ x: 4 }}>
                <Button 
                  variant="outline" 
                  className="w-full justify-start"
                  onClick={() => router.push('/themes')}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  View Themes
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle>Team Status</CardTitle>
              <CardDescription>Your current progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <StatusItem label="Team Registration" status="Pending" />
                <StatusItem label="Team Members" status="0/4 Added" />
                <StatusItem label="Idea Submission" status="Not Started" />
                <StatusItem label="Institution Review" status="Awaiting" />
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      </div>
    </div>
  );
}

function StatusItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-medium">{status}</span>
    </div>
  );
}